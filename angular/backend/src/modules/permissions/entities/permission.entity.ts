import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  ManyToMany,
  Unique,
  JoinTable,
} from 'typeorm';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { GroupPermission } from './group-permission.entity';
import { UserPermission } from './user-permission.entity';
import { Action } from './action.entity';
import { FrontendRoute } from './frontend-route.entity';
import { ApiEndpoint } from './api-endpoint.entity';
import { UiComponent } from './ui-component.entity';

/**
 * Permission entity representing access control for resources
 */
@Entity('permissions')
@Unique(['resourceName', 'actionId'])
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The name of the permission
   * Format: [resource]:[action]
   * Example: 'users:create'
   */
  @Column({ length: 100, unique: true })
  name: string;

  /**
   * A description of what this permission allows
   */
  @Column({ length: 255, nullable: true })
  description: string;

  /**
   * The name of the resource this permission applies to
   * Example: 'users', 'groups', 'reports'
   */
  @Column({ length: 50 })
  resourceName: string;


  /**
   * Reference to the Action entity (foreign key)
   */
  @Column()
  actionId: number;


  @ManyToOne(() => Action, { nullable: true, eager: true })
  @JoinColumn({ name: 'action_id' })
  actionEntity: Action;



  /**
   * Relationships with RolePermission join entity
   */
  @OneToMany(
    () => RolePermission,
    (rolePermission) => rolePermission.permission,
  )
  rolePermissions: RolePermission[];

  /**
   * Relationships with GroupPermission join entity
   */
  @OneToMany(
    () => GroupPermission,
    (groupPermission) => groupPermission.permission,
  )
  groupPermissions: GroupPermission[];

  /**
   * Relationships with UserPermission join entity
   */
  @OneToMany(
    () => UserPermission,
    (userPermission) => userPermission.permission,
  )
  userPermissions: UserPermission[];

  /**
   * Relationships with routes
   * Used in permission-based routing
   */
  @ManyToMany(() => FrontendRoute, (route) => route.requiredPermissions, {
    eager: false,
  })
  @JoinTable({
    name: 'frontend_route_permissions',
    joinColumn: { name: 'permission_id', referencedColumnName: 'id' },
    inverseJoinColumn: {
      name: 'frontend_route_id',
      referencedColumnName: 'id',
    },
  })
  routes: FrontendRoute[];

  /**
   * Relationships with API endpoints
   * Used in permission-based API access control
   */
  @ManyToMany(() => ApiEndpoint, (endpoint) => endpoint.requiredPermissions)
  endpoints: ApiEndpoint[];

  /**
   * Relationships with UI components
   * Used in permission-based UI rendering
   */
  @ManyToMany(() => UiComponent, (component) => component.requiredPermissions)
  components: UiComponent[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
