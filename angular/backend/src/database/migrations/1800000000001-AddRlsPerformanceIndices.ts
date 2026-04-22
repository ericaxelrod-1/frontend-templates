import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddRlsPerformanceIndices1800000000001
  implements MigrationInterface
{
  private async createIndexIfNotExists(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName);
    const exists = table?.indices.some((i) => i.name === index.name);
    if (!exists) {
      await queryRunner.createIndex(tableName, index);
    }
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createIndexIfNotExists(
      queryRunner,
      'rls_join_paths',
      new TableIndex({
        name: 'idx_rls_join_paths_chain',
        columnNames: ['chain'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'rls_rules',
      new TableIndex({
        name: 'idx_rls_rules_group_target',
        columnNames: ['group_id', 'target_table'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'user_groups',
      new TableIndex({
        name: 'idx_user_groups_user_id',
        columnNames: ['user_id'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'user_groups',
      new TableIndex({
        name: 'idx_user_groups_group_id',
        columnNames: ['group_id'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'roles',
      new TableIndex({
        name: 'idx_roles_parent_id',
        columnNames: ['parent_id'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'groups',
      new TableIndex({
        name: 'idx_groups_priority',
        columnNames: ['priority'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'role_permissions',
      new TableIndex({
        name: 'idx_role_permissions_role_id',
        columnNames: ['role_id'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'role_permissions',
      new TableIndex({
        name: 'idx_role_permissions_permission_id',
        columnNames: ['permission_id'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'group_permissions',
      new TableIndex({
        name: 'idx_group_permissions_group_id',
        columnNames: ['group_id'],
      }),
    );

    await this.createIndexIfNotExists(
      queryRunner,
      'group_permissions',
      new TableIndex({
        name: 'idx_group_permissions_permission_id',
        columnNames: ['permission_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dropIfExists = async (table: string, indexName: string) => {
      const tableObj = await queryRunner.getTable(table);
      const exists = tableObj?.indices.some((i) => i.name === indexName);
      if (exists) {
        await queryRunner.dropIndex(table, indexName);
      }
    };

    await dropIfExists('rls_join_paths', 'idx_rls_join_paths_chain');
    await dropIfExists('rls_rules', 'idx_rls_rules_group_target');
    await dropIfExists('user_groups', 'idx_user_groups_user_id');
    await dropIfExists('user_groups', 'idx_user_groups_group_id');
    await dropIfExists('roles', 'idx_roles_parent_id');
    await dropIfExists('groups', 'idx_groups_priority');
    await dropIfExists('role_permissions', 'idx_role_permissions_role_id');
    await dropIfExists(
      'role_permissions',
      'idx_role_permissions_permission_id',
    );
    await dropIfExists('group_permissions', 'idx_group_permissions_group_id');
    await dropIfExists(
      'group_permissions',
      'idx_group_permissions_permission_id',
    );
  }
}
