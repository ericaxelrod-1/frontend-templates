export interface GroupMembershipResult {
  success: boolean;
  operation: 'added' | 'removed';
  user: {
    id: number;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  group: {
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
    totalGroupMembers: number;
  };
}

export class GroupMembershipResultDto implements GroupMembershipResult {
  success: boolean;
  operation: 'added' | 'removed';
  user: {
    id: number;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  group: {
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
    totalGroupMembers: number;
  };
} 