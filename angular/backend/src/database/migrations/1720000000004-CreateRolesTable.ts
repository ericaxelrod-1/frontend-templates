import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateRolesTable1720000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create roles table
    await queryRunner.createTable(
      new Table({
        name: 'roles',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'description',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'is_system_role',
            type: 'boolean',
            default: false,
          },
          {
            name: 'is_default',
            type: 'boolean',
            default: false,
          },
          {
            name: 'parent_id',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add self-reference foreign key for parent_id
    await queryRunner.createForeignKey(
      'roles',
      new TableForeignKey({
        columnNames: ['parent_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'roles',
        onDelete: 'SET NULL',
      }),
    );

    // Create role_permissions junction table
    await queryRunner.createTable(
      new Table({
        name: 'role_permissions',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'role_id',
            type: 'integer',
          },
          {
            name: 'permission_id',
            type: 'integer',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Add foreign keys to role_permissions table
    await queryRunner.createForeignKey(
      'role_permissions',
      new TableForeignKey({
        columnNames: ['role_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'roles',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'role_permissions',
      new TableForeignKey({
        columnNames: ['permission_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'permissions',
        onDelete: 'CASCADE',
      }),
    );

    // Create default system roles
    await queryRunner.query(`
      INSERT INTO roles (name, description, is_system_role, is_default)
      VALUES 
        ('SUPER_ADMIN', 'Super Administrator with all privileges', true, false),
        ('ADMIN', 'Administrator with administrative privileges', true, false),
        ('USER', 'Regular user with basic privileges', true, true);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys from role_permissions table
    const rolePermissionsTable = await queryRunner.getTable('role_permissions');
    const roleIdForeignKey = rolePermissionsTable.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('role_id') !== -1,
    );
    const permissionIdForeignKey = rolePermissionsTable.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('permission_id') !== -1,
    );

    await queryRunner.dropForeignKey('role_permissions', roleIdForeignKey);
    await queryRunner.dropForeignKey(
      'role_permissions',
      permissionIdForeignKey,
    );

    // Drop role_permissions table
    await queryRunner.dropTable('role_permissions');

    // Drop parent_id foreign key from roles table
    const rolesTable = await queryRunner.getTable('roles');
    const parentIdForeignKey = rolesTable.foreignKeys.find(
      (fk) => fk.columnNames.indexOf('parent_id') !== -1,
    );
    await queryRunner.dropForeignKey('roles', parentIdForeignKey);

    // Drop roles table
    await queryRunner.dropTable('roles');
  }
}
