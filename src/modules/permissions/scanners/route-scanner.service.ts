import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FrontendRoute } from '../entities/frontend-route.entity';
import { Permission } from '../entities/permission.entity';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for route information
 */
export interface RouteInfo {
  id: string;
  path: string;
  name: string;
  description: string;
  requiredPermissions: string[];
}

/**
 * Interface for the route manifest
 */
export interface RouteManifest {
  routes: RouteInfo[];
  generated: Date;
}

/**
 * Service for scanning frontend routes and their permission requirements
 */
@Injectable()
export class RouteScannerService {
  private readonly logger = new Logger(RouteScannerService.name);

  constructor(
    @InjectRepository(FrontendRoute)
    private readonly routeRepository: Repository<FrontendRoute>,

    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,

    private readonly configService: ConfigService,
  ) {}

  /**
   * Scan for frontend routes and their permission requirements
   */
  async scanRoutes(): Promise<RouteManifest> {
    this.logger.log('Scanning for frontend routes');
    
    try {
      const routeInfos: RouteInfo[] = [];
      const frontendPath = this.configService.get<string>('FRONTEND_PATH');
      
      if (!frontendPath) {
        this.logger.error('FRONTEND_PATH not configured. Route scanning aborted.');
        return { routes: [], generated: new Date() };
      }
      
      this.logger.log(`Frontend path: ${frontendPath}`);
      
      // For now we return an empty array to not break the application
      // A full implementation would scan the Angular routes configuration files
      
      return {
        routes: routeInfos,
        generated: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Error scanning frontend routes: ${error.message}`,
        error.stack,
      );
      return { routes: [], generated: new Date() };
    }
  }
} 