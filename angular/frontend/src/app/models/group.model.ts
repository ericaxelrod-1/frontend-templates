export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  granted: boolean;
}

export interface Member {
  id: number;
  name: string;
  /**
   * @deprecated Use permissions instead. Member roles are being phased out in favor of group-specific permissions.
   */
  role?: string;
  permissions: Permission[];
}

export interface Group {
  id: number;
  name: string;
  description: string;
  owner: string;
  members: Member[];
  permissions: Permission[];
}

export const GROUP_PERMISSION_SETS: { [key: string]: Permission[] } = {
  'OWNER': [
    { id: 'group:manage', name: 'Manage Group', resource: 'group', action: 'manage', granted: true },
    { id: 'group:delete', name: 'Delete Group', resource: 'group', action: 'delete', granted: true },
    { id: 'member:manage', name: 'Manage Members', resource: 'member', action: 'manage', granted: true }
  ],
  'ADMIN': [
    { id: 'group:manage', name: 'Manage Group', resource: 'group', action: 'manage', granted: true },
    { id: 'member:manage', name: 'Manage Members', resource: 'member', action: 'manage', granted: true }
  ],
  'MEMBER': [
    { id: 'group:read', name: 'View Group', resource: 'group', action: 'read', granted: true },
    { id: 'member:read', name: 'View Members', resource: 'member', action: 'read', granted: true }
  ]
}; 