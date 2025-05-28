import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixRoleSchema1684156805000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('Starting role schema fix migration');
    
    // Check if columns exist before adding them
    try {
      // Check if roles table exists
      const table = await queryRunner.getTable('roles');
      
      if (table) {
        // Add is_system_role column if it doesn't exist
        const hasSystemRole = table.columns.some(column => column.name === 'is_system_role');
        if (!hasSystemRole) {
          await queryRunner.query(`ALTER TABLE roles ADD COLUMN is_system_role BOOLEAN DEFAULT FALSE`);
          console.log('Added is_system_role column to roles table');
        }
        
        // Add is_default column if it doesn't exist
        const hasDefault = table.columns.some(column => column.name === 'is_default');
        if (!hasDefault) {
          await queryRunner.query(`ALTER TABLE roles ADD COLUMN is_default BOOLEAN DEFAULT FALSE`);
          console.log('Added is_default column to roles table');
        }
        
        // Add parent_id column if it doesn't exist
        const hasParentId = table.columns.some(column => column.name === 'parent_id');
        if (!hasParentId) {
          await queryRunner.query(`ALTER TABLE roles ADD COLUMN parent_id INTEGER NULL`);
          console.log('Added parent_id column to roles table');
        }
        
        // Add priority column if it doesn't exist
        const hasPriority = table.columns.some(column => column.name === 'priority');
        if (!hasPriority) {
          await queryRunner.query(`ALTER TABLE roles ADD COLUMN priority INTEGER NULL`);
          console.log('Added priority column to roles table');
        }
        
        // Add created_at column if it doesn't exist
        const hasCreatedAt = table.columns.some(column => column.name === 'created_at');
        if (!hasCreatedAt) {
          await queryRunner.query(`ALTER TABLE roles ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
          console.log('Added created_at column to roles table');
        }
        
        // Add updated_at column if it doesn't exist
        const hasUpdatedAt = table.columns.some(column => column.name === 'updated_at');
        if (!hasUpdatedAt) {
          await queryRunner.query(`ALTER TABLE roles ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
          console.log('Added updated_at column to roles table');
        }
      } else {
        console.log('Roles table not found, skipping column additions');
      }
    } catch (error) {
      console.error('Error during role schema migration:', error);
    }
    
    console.log('Role schema fix migration completed');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // We won't implement a down migration for this fix as it's adding required columns
    console.log('Note: No down migration implemented for role schema fix');
  }
} 