export interface Permission {
  id: string;
  name: string;
  resourceName: string;
  actionName: string;
  granted: boolean;
}

export interface Member {
  id: number;
  name: string;
  permissions: Permission[];
  role?: string;
}

export interface Group {
  id: number;
  name: string;
  description: string;
  owner: string;
  members: Member[];
  permissions: Permission[];
}

export const GROUP_PERMISSION_SETS: Record<string, Permission[]> = {
  'OWNER': [
    { id: 'group:manage', name: 'Manage Group', resourceName: 'group', actionName: 'manage', granted: true },
    { id: 'group:delete', name: 'Delete Group', resourceName: 'group', actionName: 'delete', granted: true },
    { id: 'member:manage', name: 'Manage Members', resourceName: 'member', actionName: 'manage', granted: true }
  ],
  'ADMIN': [
    { id: 'group:manage', name: 'Manage Group', resourceName: 'group', actionName: 'manage', granted: true },
    { id: 'member:manage', name: 'Manage Members', resourceName: 'member', actionName: 'manage', granted: true }
  ],
  'MEMBER': [
    { id: 'group:read', name: 'View Group', resourceName: 'group', actionName: 'read', granted: true },
    { id: 'member:read', name: 'View Members', resourceName: 'member', actionName: 'read', granted: true }
  ]
}; 