@Injectable()
export class PermissionsService {
  // ... existing code ...

  // Update this method to use raw query instead of TypeORM's findOne
  async ensurePermissionExists(
    resourceName: string,
    actionName: string,
  ): Promise<Permission> {
    try {
      // First check if the permission table exists, if not, this is the first run
      const tableQuery = `SELECT name FROM sqlite_master WHERE type='table' AND name='permissions'`;
      const tables = await this.entityManager.query(tableQuery);
      
      if (!tables.length) {
        // No permissions table yet - probably first run
        this.logger.warn('Permissions table does not exist yet - will be created');
        const permission = new Permission();
        permission.name = `${resourceName}:${actionName}`;
        permission.resourceName = resourceName;
        permission.action = actionName;
        permission.description = `Permission for ${resourceName}:${actionName}`;
        return permission;
      }
      
      // Get all columns in the permissions table to determine how to query
      const columnsQuery = `PRAGMA table_info(permissions)`;
      const columns = await this.entityManager.query(columnsQuery);
      const columnNames = columns.map(col => col.name);
      
      // Different query strategies based on available columns
      let permission: Permission;
      
      // Check if we have resource_name and action columns
      if (columnNames.includes('resource_name') && columnNames.includes('action')) {
        const query = `
          SELECT * FROM permissions
          WHERE resource_name = ? AND action = ?
          LIMIT 1
        `;
        
        const [result] = await this.entityManager.query(query, [resourceName, actionName]);
        
        if (result) {
          // Create a Permission object from the result
          permission = this.mapRawResultToPermission(result);
        }
      } else {
        // Fall back to using the name column only
        const permissionName = `${resourceName}:${actionName}`;
        const query = `
          SELECT * FROM permissions
          WHERE name = ?
          LIMIT 1
        `;
        
        const [result] = await this.entityManager.query(query, [permissionName]);
        
        if (result) {
          // Create a Permission object from the result
          permission = this.mapRawResultToPermission(result);
        }
      }
      
      // Create a new permission if it doesn't exist
      if (!permission) {
        this.logger.log(`Creating new permission: ${resourceName}:${actionName}`);
        
        // Check if we need to create resource_name and action columns
        if (!columnNames.includes('resource_name')) {
          await this.entityManager.query(
            `ALTER TABLE permissions ADD COLUMN resource_name VARCHAR(50)`
          );
          this.logger.log('Added resource_name column to permissions table');
        }
        
        if (!columnNames.includes('action')) {
          await this.entityManager.query(
            `ALTER TABLE permissions ADD COLUMN action VARCHAR(50)`
          );
          this.logger.log('Added action column to permissions table');
        }
        
        // Insert the new permission
        const permissionName = `${resourceName}:${actionName}`;
        const insertQuery = `
          INSERT INTO permissions (name, description, resource_name, action)
          VALUES (?, ?, ?, ?)
        `;
        
        const description = `Permission for ${resourceName}:${actionName}`;
        await this.entityManager.query(insertQuery, [
          permissionName, 
          description, 
          resourceName, 
          actionName
        ]);
        
        // Retrieve the newly created permission
        const getQuery = `
          SELECT * FROM permissions
          WHERE name = ?
          LIMIT 1
        `;
        
        const [result] = await this.entityManager.query(getQuery, [permissionName]);
        permission = this.mapRawResultToPermission(result);
      }
      
      return permission;
    } catch (error) {
      this.logger.error(
        `Error ensuring permission ${resourceName}:${actionName} exists: ${error.message}`,
        error.stack,
      );
      throw new Error(`Failed to ensure permission exists: ${error.message}`);
    }
  }

  // Helper method to map raw SQL result to a Permission entity
  private mapRawResultToPermission(rawResult: any): Permission {
    if (!rawResult) return null;
    
    const permission = new Permission();
    permission.id = rawResult.id;
    permission.name = rawResult.name;
    permission.description = rawResult.description;
    
    // Handle legacy tables vs. new tables
    if ('resource_name' in rawResult) {
      permission.resourceName = rawResult.resource_name;
    } else if (rawResult.name && rawResult.name.includes(':')) {
      // Parse from the name if stored in format "resource:action"
      permission.resourceName = rawResult.name.split(':')[0];
    }
    
    if ('action' in rawResult) {
      permission.action = rawResult.action;
    } else if (rawResult.name && rawResult.name.includes(':')) {
      // Parse from the name if stored in format "resource:action"
      permission.action = rawResult.name.split(':')[1];
    }
    
    if ('created_at' in rawResult) {
      permission.createdAt = rawResult.created_at;
    }
    
    if ('updated_at' in rawResult) {
      permission.updatedAt = rawResult.updated_at;
    }
    
    return permission;
  }

  // ... existing code ...
} 