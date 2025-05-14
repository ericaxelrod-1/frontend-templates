import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiEndpoint } from '../entities/api-endpoint.entity';
import { Permission } from '../entities/permission.entity';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

/**
 * Interface for endpoint information
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
 * Service for scanning API endpoints and their permission requirements
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
  ) {}

  /**
   * Scan for API endpoints and their permission requirements
   */
  async scanEndpoints(): Promise<EndpointManifest> {
    this.logger.log('Scanning for API endpoints');
    
    try {
      const endpointInfos: EndpointInfo[] = [];

      // Get all controllers
      const controllers = this.discoveryService.getControllers();
      this.logger.log(`Found ${controllers.length} controllers to scan`);

      // For now we return an empty array to not break the application
      // A full implementation would process each controller to find endpoints
      // with permission requirements
      
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
} 