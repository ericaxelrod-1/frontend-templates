import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Permission } from './permission.entity';

/**
 * Entity representing an API endpoint with its permissions
 */
@Entity('api_endpoints')
export class ApiEndpoint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  path: string;

  @Column()
  method: string;

  @Column({ nullable: true })
  controllerName: string;

  @Column({ nullable: true })
  description: string;

  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'api_endpoint_permissions',
    joinColumn: { name: 'endpoint_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  requiredPermissions: Permission[];

  @Column({ default: false })
  overridePermissions: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 