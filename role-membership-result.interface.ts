export interface RoleMembershipResult {
  success: boolean;
  operation: 'added' | 'removed';
  user: {
    id: number;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  role: {
    id: number;
    name: string;
    description?: string;
  };
  timestamp: Date;
  message: string;
  previousState?: {
    wasAlreadyMember: boolean;
    memberSince?: Date;
  };
  currentState: {
    isMember: boolean;
    memberSince?: Date;
    totalRoleMembers: number;
  };
} 