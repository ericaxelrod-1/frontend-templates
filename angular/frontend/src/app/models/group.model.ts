export interface Permission {
  id: number;
  name: string;
  resourceName: string;
  actionName: string;
  isGranted: boolean;
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
  users: any[];  // Use any[] to avoid circular dependency, will be typed as User[] in components
  permissions: Permission[];
}

export const GROUP_PERMISSION_SETS: Record<string, Permission[]> = {
  'OWNER': [
    { id: 1, name: 'group:manage', resourceName: 'group', actionName: 'manage', isGranted: true },
    { id: 2, name: 'group:delete', resourceName: 'group', actionName: 'delete', isGranted: true },
    { id: 3, name: 'member:manage', resourceName: 'member', actionName: 'manage', isGranted: true }
  ],
  'ADMIN': [
    { id: 1, name: 'group:manage', resourceName: 'group', actionName: 'manage', isGranted: true },
    { id: 3, name: 'member:manage', resourceName: 'member', actionName: 'manage', isGranted: true }
  ],
  'MEMBER': [
    { id: 4, name: 'group:view', resourceName: 'group', actionName: 'view', isGranted: true },
    { id: 5, name: 'member:view', resourceName: 'member', actionName: 'view', isGranted: true }
  ]
}; 