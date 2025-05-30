import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UiComponent } from './ui-component.entity';
import { FrontendRoute } from './frontend-route.entity';
import { ApiEndpoint } from './api-endpoint.entity';
import { Action } from './action.entity';

/**
 * Permission entity
 */
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true, nullable: false })
  @Index('idx_permissions_name')
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'resource_name', length: 50, nullable: true })
  @Index('idx_permissions_resource_name')
  resourceName: string;

  @Column({ name: 'action', length: 50, nullable: true })
  @Index('idx_permissions_action')
  actionName: string;

  @Column({ name: 'action_id', nullable: true })
  actionId: number;

  @ManyToOne(() => Action, { nullable: true })
  @JoinColumn({ name: 'action_id' })
  actionEntity: Action;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Virtual property for backward compatibility
   * Getter for action returns the actionName
   */
  get action(): string {
    return this.actionName;
  }

  /**
   * Virtual property for backward compatibility
   * Setter for action sets the actionName
   */
  set action(value: string) {
    this.actionName = value;
  }

  @ManyToMany(() => UiComponent, (component) => component.requiredPermissions)
  components: UiComponent[];

  @ManyToMany(() => FrontendRoute, (route) => route.requiredPermissions)
  routes: FrontendRoute[];

  @ManyToMany(() => ApiEndpoint, (endpoint) => endpoint.requiredPermissions)
  endpoints: ApiEndpoint[];

  // Getter for backward compatibility
  get getResourceName(): string {
    if (this.resourceName) {
      return this.resourceName;
    }
    
    // Parse from name if resourceName is not set
    const nameParts = this.name?.split(':') || [];
    return nameParts.length > 0 ? nameParts[0] : '';
  }

  // Getter for backward compatibility
  get getActionName(): string {
    if (this.actionName) {
      return this.actionName;
    }
    
    // Parse from name if actionName is not set
    const nameParts = this.name?.split(':') || [];
    return nameParts.length > 1 ? nameParts[1] : '';
  }
} 