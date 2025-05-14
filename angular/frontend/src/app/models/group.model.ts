export interface Permission {
  id: number;
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
    { id: 1, name: 'group:manage', resourceName: 'group', actionName: 'manage', granted: true },
    { id: 2, name: 'group:delete', resourceName: 'group', actionName: 'delete', granted: true },
    { id: 3, name: 'member:manage', resourceName: 'member', actionName: 'manage', granted: true }
  ],
  'ADMIN': [
    { id: 1, name: 'group:manage', resourceName: 'group', actionName: 'manage', granted: true },
    { id: 3, name: 'member:manage', resourceName: 'member', actionName: 'manage', granted: true }
  ],
  'MEMBER': [
    { id: 4, name: 'group:read', resourceName: 'group', actionName: 'read', granted: true },
    { id: 5, name: 'member:read', resourceName: 'member', actionName: 'read', granted: true }
  ]
}; 