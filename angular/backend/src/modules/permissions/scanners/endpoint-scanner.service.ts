import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { ApiEndpoint } from '../entities/api-endpoint.entity';
import { Permission } from '../entities/permission.entity';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { NestContainer } from '@nestjs/core/injector/container';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { ConfigService } from '@nestjs/config';

/**
 * Interface for endpoint information in the manifest
 */
export interface EndpointInfo {
  id: string;
  method: string;
  path: string;
  controllerName: string;
  handlerName: string;
  description: string;
  requiredPermissions: string[];
}

/**
 * Interface for the endpoint manifest
 */
export interface EndpointManifest {
  endpoints: EndpointInfo[];
  generated: Date;
}

/**
 * Service for scanning NestJS controllers to identify and register
 * API endpoints with permission requirements
 */
@Injectable()
export class EndpointScannerService {
  private readonly logger = new Logger(EndpointScannerService.name);

  constructor(
    @InjectRepository(ApiEndpoint)
    private readonly endpointRepository: Repository<ApiEndpoint>,

    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,

    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Scan all NestJS controllers to find endpoints with permission requirements
   */
  async scanEndpoints(): Promise<EndpointManifest> {
    this.logger.log('Starting API endpoint scan for permission requirements');

    try {
      const endpointInfos: EndpointInfo[] = [];

      // Get all controllers
      const controllers = this.discoveryService.getControllers();
      this.logger.log(`Found ${controllers.length} controllers to scan`);

      for (const controller of controllers) {
        const controllerEndpoints = await this.processController(controller);
        endpointInfos.push(...controllerEndpoints);
      }

      this.logger.log(
        `Completed API endpoint scan: ${endpointInfos.length} endpoints with permissions found`,
      );

      return {
        endpoints: endpointInfos,
        generated: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Error scanning API endpoints: ${error.message}`,
        error.stack,
      );
      return { endpoints: [], generated: new Date() };
    }
  }

  /**
   * Process a controller to extract endpoints with permission requirements
   */
  private async processController(
    wrapper: InstanceWrapper,
  ): Promise<EndpointInfo[]> {
    try {
      if (!wrapper.instance || !wrapper.metatype) {
        return [];
      }

      const endpointInfos: EndpointInfo[] = [];
      const instance = wrapper.instance;
      const prototype = Object.getPrototypeOf(instance);
      const controllerName = wrapper.name || 'UnknownController';

      // Get controller base path (from @Controller decorator)
      const controllerPath = this.reflector.get('path', wrapper.metatype) || '';

      // Get methods from prototype and scan for route handlers
      this.metadataScanner.scanFromPrototype(
        instance,
        prototype,
        async (methodName) => {
          const endpointInfo = await this.processEndpoint(
            controllerName,
            controllerPath,
            instance,
            methodName,
          );
          if (endpointInfo) {
            endpointInfos.push(endpointInfo);
          }
        },
      );

      return endpointInfos;
    } catch (error) {
      this.logger.error(
        `Error processing controller ${wrapper.name}: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  /**
   * Process an endpoint to extract its metadata and permission requirements
   */
  private async processEndpoint(
    controllerName: string,
    controllerPath: string,
    instance: any,
    methodName: string,
  ): Promise<EndpointInfo | null> {
    try {
      const targetMethod = instance[methodName];

      // Skip if not a valid method
      if (typeof targetMethod !== 'function') {
        return null;
      }

      // Get HTTP method from metadata
      const httpMethod = this.getHttpMethod(targetMethod);
      if (!httpMethod) {
        return null; // Not a route handler
      }

      // Get endpoint path
      const methodPath = this.reflector.get('path', targetMethod) || '';

      // Combine controller path and method path
      const fullPath = this.normalizePath(`${controllerPath}/${methodPath}`);

      // Get permission requirements from RequirePermission decorator
      const requiredPermissions = this.extractPermissions(targetMethod);

      // Skip if no permissions required and not using PermissionGuard
      const usesPermissionGuard = this.usesPermissionGuard(targetMethod);
      if (requiredPermissions.length === 0 && !usesPermissionGuard) {
        return null;
      }

      // Get description from comments
      const description =
        this.extractDescription(targetMethod) ||
        `${httpMethod.toUpperCase()} ${fullPath}`;

      // Create unique ID for endpoint
      const endpointId = `${httpMethod.toLowerCase()}_${fullPath.replace(/\//g, '_').replace(/:/g, 'param_')}`;

      // Create endpoint info
      const endpointInfo: EndpointInfo = {
        id: endpointId,
        method: httpMethod.toUpperCase(),
        path: fullPath,
        controllerName,
        handlerName: methodName,
        description,
        requiredPermissions,
      };

      // Find or create the endpoint entity
      let endpoint = await this.endpointRepository.findOne({
        where: { method: httpMethod.toUpperCase(), path: fullPath },
      });

      if (!endpoint) {
        endpoint = this.endpointRepository.create({
          id: endpointId,
          method: httpMethod.toUpperCase(),
          path: fullPath,
          description,
          controllerName,
          handlerName: methodName,
          requiredPermissions: [],
          overridePermissions: false,
          lastSyncedAt: new Date(),
        });
      } else {
        // Only update if not overridden
        if (!endpoint.overridePermissions) {
          endpoint.description = description;
          endpoint.controllerName = controllerName;
          endpoint.handlerName = methodName;
          endpoint.lastSyncedAt = new Date();
        }
      }

      // If permissions are not overridden, update them
      if (!endpoint.overridePermissions && requiredPermissions.length > 0) {
        // Find permission entities
        const permissions = [];

        for (const permString of requiredPermissions) {
          const [resourceName, actionName] = permString.split(':');

          let permission = await this.permissionRepository.findOne({
            where: { name: permString },
          });

          if (!permission) {
            permission = this.permissionRepository.create({
              resourceName,
              name: permString,
              description: `Permission required by ${httpMethod.toUpperCase()} ${fullPath}`,
            });
            await this.permissionRepository.save(permission);
          }

          permissions.push(permission);
        }

        endpoint.requiredPermissions = permissions;
      }

      await this.endpointRepository.save(endpoint);
      this.logger.debug(
        `Processed endpoint ${httpMethod.toUpperCase()} ${fullPath}`,
      );

      return endpointInfo;
    } catch (error) {
      this.logger.error(
        `Error processing endpoint ${controllerName}.${methodName}: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Get HTTP method from method metadata
   */
  private getHttpMethod(target: any): string | null {
    const httpMethods = [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'options',
      'head',
      'all',
    ];

    for (const method of httpMethods) {
      if (this.reflector.get(method, target)) {
        return method;
      }
    }

    return null;
  }

  /**
   * Extract permissions from RequirePermission decorator
   */
  private extractPermissions(target: any): string[] {
    const requirePermissionMeta = this.reflector.get(
      'require_permission',
      target,
    );

    if (!requirePermissionMeta) {
      return [];
    }

    if (typeof requirePermissionMeta === 'string') {
      return [requirePermissionMeta];
    }

    if (Array.isArray(requirePermissionMeta)) {
      return requirePermissionMeta;
    }

    return [];
  }

  /**
   * Check if an endpoint uses PermissionGuard
   */
  private usesPermissionGuard(target: any): boolean {
    const guards = this.reflector.get('__guards__', target) || [];
    return guards.some(
      (guard) =>
        guard.name === 'PermissionGuard' ||
        /PermissionGuard/.test(guard.toString()),
    );
  }

  /**
   * Extract description from method comments
   */
  private extractDescription(target: any): string | null {
    const apidoc = this.reflector.get('swagger/apiOperation', target);
    if (apidoc && apidoc.summary) {
      return apidoc.summary;
    }

    return null;
  }

  /**
   * Normalize a path by removing double slashes and trailing slashes
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\/\//g, '/') // Replace double slashes with single slash
      .replace(/\/+$/, '') // Remove trailing slashes
      .replace(/^([^/])/, '/$1'); // Ensure path starts with /
  }
}
