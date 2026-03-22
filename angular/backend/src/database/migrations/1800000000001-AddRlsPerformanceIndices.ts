import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class AddRlsPerformanceIndices1800000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Performance indices for RLS join paths
    await queryRunner.createIndex(
      'rls_join_paths',
      new TableIndex({
        name: 'idx_rls_join_paths_target_table',
        columnNames: ['target_table'],
      }),
    );

    await queryRunner.createIndex(
      'rls_join_paths',
      new TableIndex({
        name: 'idx_rls_join_paths_chain',
        columnNames: ['chain'],
      }),
    );

    await queryRunner.createIndex(
      'rls_join_conditions',
      new TableIndex({
        name: 'idx_rls_join_conditions_join_path_id',
        columnNames: ['join_path_id'],
      }),
    );

    // Performance indices for RLS rules
    await queryRunner.createIndex(
      'rls_rules',
      new TableIndex({
        name: 'idx_rls_rules_group_id',
        columnNames: ['group_id'],
      }),
    );

    await queryRunner.createIndex(
      'rls_rules',
      new TableIndex({
        name: 'idx_rls_rules_target_table',
        columnNames: ['target_table'],
      }),
    );

    await queryRunner.createIndex(
      'rls_rules',
      new TableIndex({
        name: 'idx_rls_rules_group_target',
        columnNames: ['group_id', 'target_table'],
      }),
    );

    // Performance indices for user-group relationships (common RLS join paths)
    await queryRunner.createIndex(
      'user_groups',
      new TableIndex({
        name: 'idx_user_groups_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_groups',
      new TableIndex({
        name: 'idx_user_groups_group_id',
        columnNames: ['group_id'],
      }),
    );

    // Performance indices for role hierarchy
    await queryRunner.createIndex(
      'roles',
      new TableIndex({
        name: 'idx_roles_parent_id',
        columnNames: ['parent_id'],
      }),
    );

    // Performance indices for group hierarchy
    await queryRunner.createIndex(
      'groups',
      new TableIndex({
        name: 'idx_groups_parent_id',
        columnNames: ['parent_id'],
      }),
    );

    await queryRunner.createIndex(
      'groups',
      new TableIndex({
        name: 'idx_groups_priority',
        columnNames: ['priority'],
      }),
    );

    // Performance indices for permission assignments
    await queryRunner.createIndex(
      'role_permissions',
      new TableIndex({
        name: 'idx_role_permissions_role_id',
        columnNames: ['role_id'],
      }),
    );

    await queryRunner.createIndex(
      'role_permissions',
      new TableIndex({
        name: 'idx_role_permissions_permission_id',
        columnNames: ['permission_id'],
      }),
    );

    await queryRunner.createIndex(
      'group_permissions',
      new TableIndex({
        name: 'idx_group_permissions_group_id',
        columnNames: ['group_id'],
      }),
    );

    await queryRunner.createIndex(
      'group_permissions',
      new TableIndex({
        name: 'idx_group_permissions_permission_id',
        columnNames: ['permission_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('rls_join_paths', 'idx_rls_join_paths_target_table');
    await queryRunner.dropIndex('rls_join_paths', 'idx_rls_join_paths_chain');
    await queryRunner.dropIndex('rls_join_conditions', 'idx_rls_join_conditions_join_path_id');
    await queryRunner.dropIndex('rls_rules', 'idx_rls_rules_group_id');
    await queryRunner.dropIndex('rls_rules', 'idx_rls_rules_target_table');
    await queryRunner.dropIndex('rls_rules', 'idx_rls_rules_group_target');
    await queryRunner.dropIndex('user_groups', 'idx_user_groups_user_id');
    await queryRunner.dropIndex('user_groups', 'idx_user_groups_group_id');
    await queryRunner.dropIndex('roles', 'idx_roles_parent_id');
    await queryRunner.dropIndex('groups', 'idx_groups_parent_id');
    await queryRunner.dropIndex('groups', 'idx_groups_priority');
    await queryRunner.dropIndex('role_permissions', 'idx_role_permissions_role_id');
    await queryRunner.dropIndex('role_permissions', 'idx_role_permissions_permission_id');
    await queryRunner.dropIndex('group_permissions', 'idx_group_permissions_group_id');
    await queryRunner.dropIndex('group_permissions', 'idx_group_permissions_permission_id');
  }
}
