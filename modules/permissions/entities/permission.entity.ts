import { Entity, Column, PrimaryGeneratedColumn, ManyToMany, JoinTable, OneToMany, JoinColumn, ManyToOne, AfterLoad } from 'typeorm';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { UserPermission } from './user-permission.entity';
import { GroupPermission } from './group-permission.entity';
import { UiComponent } from './ui-component.entity';
import { FrontendRoute } from './frontend-route.entity';
import { ApiEndpoint } from './api-endpoint.entity';
import { Action } from './action.entity';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, nullable: false })
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'resource_name', nullable: true })
  resourceName: string;

  @Column({ name: 'action', nullable: true })
  action: string;

  @Column({ name: 'action_id', nullable: true })
  actionId: number;

  @ManyToOne(() => Action, { nullable: true })
  @JoinColumn({ name: 'action_id' })
  actionEntity: Action;

  @Column({ name: 'created_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @OneToMany(() => RolePermission, rolePermission => rolePermission.permission)
  rolePermissions: RolePermission[];

  @OneToMany(() => UserPermission, userPermission => userPermission.permission)
  userPermissions: UserPermission[];

  @OneToMany(() => GroupPermission, groupPermission => groupPermission.permission)
  groupPermissions: GroupPermission[];

  @ManyToMany(() => UiComponent, component => component.requiredPermissions)
  components: UiComponent[];

  @ManyToMany(() => FrontendRoute, route => route.requiredPermissions)
  routes: FrontendRoute[];

  @ManyToMany(() => ApiEndpoint, endpoint => endpoint.requiredPermissions)
  endpoints: ApiEndpoint[];

  // Virtual property for backward compatibility
  private _actionName: string;

  @AfterLoad()
  updateActionName() {
    this._actionName = this.action;
  }

  get actionName(): string {
    return this.action || this._actionName;
  }

  set actionName(value: string) {
    this._actionName = value;
    this.action = value;
  }
} 