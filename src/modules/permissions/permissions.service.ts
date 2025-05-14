import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Connection } from 'typeorm';
import { Permission } from './entities/permission.entity';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    private connection: Connection,
  ) {}

  /**
   * Find permission by name
   * @param name The permission name (format: 'resource:action')
   */
  async findByName(name: string): Promise<Permission | null> {
    return this.permissionRepository.findOne({ where: { name } });
  }

  /**
   * Find permission by resource name and action
   * @param resourceName The resource name
   * @param action The action
   */
  async findByResourceAndAction(resourceName: string, action: string): Promise<Permission | null> {
    try {
      // First try using TypeORM
      return await this.permissionRepository.findOne({
        where: { resourceName, actionName: action }
      });
    } catch (error) {
      console.log('Error with TypeORM query, falling back to raw SQL:', error.message);
      
      // Fallback to raw SQL query if TypeORM fails due to schema issues
      const result = await this.connection.query(
        `SELECT * FROM permissions WHERE resource_name = ? AND action = ? LIMIT 1`,
        [resourceName, action]
      );
      
      if (result && result.length > 0) {
        // Map the raw result to a Permission entity
        const permission = new Permission();
        permission.id = result[0].id;
        permission.name = result[0].name;
        permission.description = result[0].description;
        permission.resourceName = result[0].resource_name;
        permission.actionName = result[0].action;
        permission.createdAt = result[0].created_at;
        permission.updatedAt = result[0].updated_at;
        return permission;
      }
      
      return null;
    }
  }

  /**
   * List all permissions
   */
  async findAll(): Promise<Permission[]> {
    try {
      return await this.permissionRepository.find();
    } catch (error) {
      console.log('Error with TypeORM query, falling back to raw SQL:', error.message);
      
      // Fallback to raw SQL query
      const results = await this.connection.query(`SELECT * FROM permissions`);
      
      return results.map(row => {
        const permission = new Permission();
        permission.id = row.id;
        permission.name = row.name;
        permission.description = row.description;
        permission.resourceName = row.resource_name;
        permission.actionName = row.action;
        permission.createdAt = row.created_at;
        permission.updatedAt = row.updated_at;
        return permission;
      });
    }
  }

  /**
   * Find permissions by resource
   * @param resourceName The resource name
   */
  async findByResource(resourceName: string): Promise<Permission[]> {
    try {
      return await this.permissionRepository.find({
        where: { resourceName }
      });
    } catch (error) {
      console.log('Error with TypeORM query, falling back to raw SQL:', error.message);
      
      // Fallback to raw SQL query
      const results = await this.connection.query(
        `SELECT * FROM permissions WHERE resource_name = ?`,
        [resourceName]
      );
      
      return results.map(row => {
        const permission = new Permission();
        permission.id = row.id;
        permission.name = row.name;
        permission.description = row.description;
        permission.resourceName = row.resource_name;
        permission.actionName = row.action;
        permission.createdAt = row.created_at;
        permission.updatedAt = row.updated_at;
        return permission;
      });
    }
  }

  /**
   * Create a new permission
   */
  async create(permissionData: Partial<Permission>): Promise<Permission> {
    const permission = this.permissionRepository.create(permissionData);
    
    // Ensure resource_name and action are populated from name if not provided
    if (!permission.resourceName && permission.name && permission.name.includes(':')) {
      permission.resourceName = permission.name.split(':')[0];
    }
    
    if (!permission.actionName && permission.name && permission.name.includes(':')) {
      permission.actionName = permission.name.split(':')[1];
    }
    
    return this.permissionRepository.save(permission);
  }

  /**
   * Update a permission
   */
  async update(id: number, permissionData: Partial<Permission>): Promise<Permission> {
    await this.permissionRepository.update(id, permissionData);
    return this.permissionRepository.findOneOrFail({ where: { id } });
  }

  /**
   * Delete a permission
   */
  async remove(id: number): Promise<void> {
    await this.permissionRepository.delete(id);
  }
} 