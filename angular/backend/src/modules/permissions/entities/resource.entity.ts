/**
 * This file is deprecated. The Permission entity now uses resourceName and actionName
 * string fields directly instead of relationships to Resource and Action entities.
 */

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Resource entity represents a system resource that can have permissions assigned to it
 * Examples: users, groups, roles, reports, dashboard, etc.
 * Aligned with database schema as of 2025-05-23
 */
@Entity('resources')
export class Resource {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;


  // This relation is no longer valid since Permission doesn't have a resource property
  // @OneToMany(() => Permission, permission => permission.resource)
  // permissions: Permission[];
}
