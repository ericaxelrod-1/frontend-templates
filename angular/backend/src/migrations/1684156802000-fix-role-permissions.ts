import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class FixRolePermissions1684156802000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if role_permissions table exists
    const rolePermissionsTable = await queryRunner.getTable('role_permissions');
    if (!rolePermissionsTable) {
      // Create the role_permissions table if it doesn't exist
      await queryRunner.query(`
        CREATE TABLE role_permissions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          role_id INT NOT NULL,
          permission_id INT NOT NULL,
          granted BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_role_permission (role_id, permission_id),
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
          FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
        )
      `);
    } else {
      // Check if role_id column is already the right type (INT)
      const roleIdColumn = rolePermissionsTable.findColumnByName('role_id');
      if (roleIdColumn && (roleIdColumn.type === 'varchar' || roleIdColumn.type === 'uuid')) {
        // First, drop foreign keys if they exist
        const foreignKeys = rolePermissionsTable.foreignKeys;
        for (const foreignKey of foreignKeys) {
          if (foreignKey.columnNames.includes('role_id')) {
            await queryRunner.dropForeignKey('role_permissions', foreignKey);
          }
        }

        // Alter the column type from UUID to INT
        await queryRunner.changeColumn(
          'role_permissions',
          'role_id',
          new TableColumn({
            name: 'role_id',
            type: 'int',
            isNullable: false,
          }),
        );

        // Add back the foreign key
        await queryRunner.query(`
          ALTER TABLE role_permissions 
          ADD CONSTRAINT FK_role_permissions_role
          FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
        `);
      }

      // Make sure we have the granted column
      if (!rolePermissionsTable.findColumnByName('granted')) {
        await queryRunner.addColumn(
          'role_permissions',
          new TableColumn({
            name: 'granted',
            type: 'boolean',
            default: true,
            isNullable: false,
          }),
        );
      }
    }

    // Update roles table to ensure it has isSystemRole and isDefault fields
    const rolesTable = await queryRunner.getTable('roles');
    if (rolesTable) {
      if (!rolesTable.findColumnByName('is_system_role')) {
        await queryRunner.addColumn(
          'roles',
          new TableColumn({
            name: 'is_system_role',
            type: 'boolean',
            default: false,
            isNullable: false,
          }),
        );
      }

      if (!rolesTable.findColumnByName('is_default')) {
        await queryRunner.addColumn(
          'roles',
          new TableColumn({
            name: 'is_default',
            type: 'boolean',
            default: false,
            isNullable: false,
          }),
        );
      }

      if (!rolesTable.findColumnByName('parent_id')) {
        await queryRunner.addColumn(
          'roles',
          new TableColumn({
            name: 'parent_id',
            type: 'int',
            isNullable: true,
          }),
        );

        // Add parent-child relationship foreign key
        await queryRunner.query(`
          ALTER TABLE roles 
          ADD CONSTRAINT FK_roles_parent
          FOREIGN KEY (parent_id) REFERENCES roles(id) ON DELETE SET NULL
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This is a fixing migration, so down() doesn't revert to the broken state
    // Instead, we'll only remove the newly added columns if needed

    const rolesTable = await queryRunner.getTable('roles');
    if (rolesTable) {
      // Remove parent_id foreign key and column
      const parentForeignKey = rolesTable.foreignKeys.find(
        (fk) => fk.columnNames.includes('parent_id'),
      );
      if (parentForeignKey) {
        await queryRunner.dropForeignKey('roles', parentForeignKey);
      }
      
      if (rolesTable.findColumnByName('parent_id')) {
        await queryRunner.dropColumn('roles', 'parent_id');
      }

      // Remove is_default column
      if (rolesTable.findColumnByName('is_default')) {
        await queryRunner.dropColumn('roles', 'is_default');
      }

      // Remove is_system_role column
      if (rolesTable.findColumnByName('is_system_role')) {
        await queryRunner.dropColumn('roles', 'is_system_role');
      }
    }
  }
} 