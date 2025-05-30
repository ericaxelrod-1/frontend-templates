import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UiComponent } from '../entities/ui-component.entity';
import { Permission } from '../entities/permission.entity';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for component information
 */
export interface ComponentInfo {
  selector: string;
  filePath: string;
  description: string;
  requiredPermissions: string[];
}

/**
 * Interface for the component manifest
 */
export interface ComponentManifest {
  components: ComponentInfo[];
  generated: Date;
}

/**
 * Service for scanning UI components and their permission requirements
 */
@Injectable()
export class ComponentScannerService {
  private readonly logger = new Logger(ComponentScannerService.name);

  constructor(
    @InjectRepository(UiComponent)
    private readonly componentRepository: Repository<UiComponent>,

    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,

    private readonly configService: ConfigService,
  ) {}

  /**
   * Scan for UI components and their permission requirements
   */
  async scanComponents(): Promise<ComponentManifest> {
    this.logger.log('Scanning for UI components');
    
    try {
      const componentInfos: ComponentInfo[] = [];
      const frontendPath = this.configService.get<string>('FRONTEND_PATH');
      
      if (!frontendPath) {
        this.logger.error('FRONTEND_PATH not configured. Component scanning aborted.');
        return { components: [], generated: new Date() };
      }
      
      this.logger.log(`Frontend path: ${frontendPath}`);
      
      // For now we return an empty array to not break the application
      // A full implementation would scan Angular component files for permission directives
      
      return {
        components: componentInfos,
        generated: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Error scanning UI components: ${error.message}`,
        error.stack,
      );
      return { components: [], generated: new Date() };
    }
  }
} 