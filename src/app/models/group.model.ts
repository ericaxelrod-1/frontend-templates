import { User } from './user.model';

export interface Group {
  id: number;
  name: string;
  description?: string;
  owner: User | number;
  members?: GroupMember[];
  permissions?: {
    id: string;
    name: string;
    resource: string;
    action: string;
    granted: boolean;
  }[];
}

export interface GroupMember {
  id: number;
  user: User | number;
  group: Group | number;
  /**
   * @deprecated Use permissions instead. Member roles are being phased out in favor of group-specific permissions.
   */
  role?: 'admin' | 'member' | 'viewer';
  permissions: {
    id: string;
    name: string;
    resource: string;
    action: string;
    granted: boolean;
  }[];
  joinedAt: Date;
}

// Common permission sets that replace the old role-based system
export const GROUP_PERMISSION_SETS = {
  ADMIN: [
    { resource: 'group', action: 'manage' },
    { resource: 'group', action: 'delete' },
    { resource: 'members', action: 'manage' },
    { resource: 'permissions', action: 'manage' },
    { resource: 'content', action: 'manage' }
  ],
  MEMBER: [
    { resource: 'group', action: 'read' },
    { resource: 'members', action: 'read' },
    { resource: 'content', action: 'read' },
    { resource: 'content', action: 'create' },
    { resource: 'content', action: 'update' }
  ],
  VIEWER: [
    { resource: 'group', action: 'read' },
    { resource: 'members', action: 'read' },
    { resource: 'content', action: 'read' }
  ]
} as const; 