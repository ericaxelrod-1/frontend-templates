import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { UiComponent } from '../entities/ui-component.entity';
import { Permission } from '../entities/permission.entity';
import { ConfigService } from '@nestjs/config';

/**
 * Interface for component information in the manifest
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
 * Service for scanning Angular components to identify and register
 * those with permission requirements
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
  ) { }

  /**
   * Scan all Angular components to find those with appHasPermission directives
   */
  async scanComponents(): Promise<ComponentManifest> {
    this.logger.log('Starting UI component scan for permission requirements');

    const frontendPath = this.configService.get<string>('FRONTEND_PATH');
    if (!frontendPath) {
      this.logger.error(
        'FRONTEND_PATH not configured. Component scanning aborted.',
      );
      return { components: [], generated: new Date() };
    }

    try {
      const componentInfos: ComponentInfo[] = [];

      // Look for component files
      const componentFiles = glob.sync(
        path.join(frontendPath, 'src/app/**/*.component.ts'),
      );
      const htmlFiles = glob.sync(
        path.join(frontendPath, 'src/app/**/*.component.html'),
      );

      // Map component files to their corresponding HTML files
      const componentMap = new Map<string, string>();
      componentFiles.forEach((componentFile) => {
        const baseName = path.basename(componentFile, '.component.ts');
        const dirName = path.dirname(componentFile);
        const htmlFile = path.join(dirName, `${baseName}.component.html`);

        if (htmlFiles.includes(htmlFile)) {
          componentMap.set(componentFile, htmlFile);
        }
      });

      // Process each component
      for (const [tsFile, htmlFile] of componentMap.entries()) {
        const componentInfo = await this.processComponent(tsFile, htmlFile);
        if (componentInfo) {
          componentInfos.push(componentInfo);
        }
      }

      this.logger.log(
        `Completed UI component scan: ${componentInfos.length} components with permissions found`,
      );

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

  /**
   * Process a component file to extract its selector and check for permissions
   */
  private async processComponent(
    tsFile: string,
    htmlFile: string,
  ): Promise<ComponentInfo | null> {
    try {
      // Read component file
      const tsContent = fs.readFileSync(tsFile, 'utf8');
      const htmlContent = fs.readFileSync(htmlFile, 'utf8');

      // Extract component selector
      const selectorMatch = tsContent.match(
        /@Component\(\s*\{[^}]*selector\s*:\s*['"]([^'"]+)['"]/,
      );
      if (!selectorMatch) return null;

      const selector = selectorMatch[1];

      // Check if this component has permission directives
      const hasPermissionMatches =
        htmlContent.match(/\*appHasPermission="'([^']+)'"/g) ||
        htmlContent.match(/\*appHasPermission="\[([^\]]+)\]"/g);

      if (!hasPermissionMatches || hasPermissionMatches.length === 0)
        return null;

      // Extract permissions from the directives
      const permissions = new Set<string>();
      hasPermissionMatches.forEach((match) => {
        const permMatch = match.match(/\*appHasPermission="'([^']+)'"/);
        if (permMatch) {
          permissions.add(permMatch[1]);
        } else {
          const arrayMatch = match.match(/\*appHasPermission="\[([^\]]+)\]"/);
          if (arrayMatch) {
            const permArray = arrayMatch[1]
              .split(',')
              .map((p) => p.trim().replace(/'/g, '').replace(/"/g, ''));
            permArray.forEach((p) => permissions.add(p));
          }
        }
      });

      if (permissions.size === 0) return null;

      // Get description from component class comments
      const classCommentMatch = tsContent.match(
        /\/\*\*\s*\n([^*]|\*[^/])*\*\/\s*@Component/,
      );
      let description = '';
      if (classCommentMatch) {
        const commentLines = classCommentMatch[0].split('\n');
        description = commentLines
          .filter(
            (line) =>
              !line.trim().startsWith('*') || line.trim().startsWith('* '),
          )
          .map((line) => line.trim().replace(/^\* /, '').replace(/^\*/, ''))
          .join(' ')
          .trim();
      }

      // Create ComponentInfo object
      const componentInfo: ComponentInfo = {
        selector,
        filePath: tsFile,
        description: description || `Component with selector ${selector}`,
        requiredPermissions: Array.from(permissions),
      };

      // Find or create component entity
      let component = await this.componentRepository.findOne({
        where: { id: selector },
      });

      if (!component) {
        component = this.componentRepository.create({
          id: selector,
          description: componentInfo.description,
          filePath: tsFile,
          requiredPermissions: [],
          overridePermissions: false,
          lastSyncedAt: new Date(),
        });
      } else {
        // Only update if not overridden
        if (!component.overridePermissions) {
          component.description = description || component.description;
          component.filePath = tsFile;
          component.lastSyncedAt = new Date();
        }
      }

      // If permissions are not overridden, update them
      if (!component.overridePermissions) {
        // Find permission entities for the requirements
        const requiredPermissions = [];
        for (const permission of permissions) {
          const [resourceName, actionName] = permission.split(':');

          let permissionEntity = await this.permissionRepository.findOne({
            where: { name: permission },
          });

          if (!permissionEntity) {
            // Create the permission if it doesn't exist
            permissionEntity = this.permissionRepository.create({
              resourceName,
              name: permission,
              description: `Permission required by component ${selector}`,
            });
            await this.permissionRepository.save(permissionEntity);
          }

          requiredPermissions.push(permissionEntity);
        }

        component.requiredPermissions = requiredPermissions;
      }

      await this.componentRepository.save(component);
      this.logger.debug(
        `Processed component ${selector} with ${permissions.size} permissions`,
      );

      return componentInfo;
    } catch (error) {
      this.logger.error(
        `Error processing component ${tsFile}: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }
}
