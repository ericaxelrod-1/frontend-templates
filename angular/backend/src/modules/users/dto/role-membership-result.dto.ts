import { ApiProperty } from '@nestjs/swagger';

export class RoleMembershipResultDto {
  @ApiProperty({ description: 'Whether the operation was successful' })
  success: boolean;

  @ApiProperty({ description: 'Type of operation performed', enum: ['added', 'removed'] })
  operation: 'added' | 'removed';

  @ApiProperty({ description: 'User information' })
  user: {
    id: number;
    email: string;
    firstName?: string;
    lastName?: string;
  };

  @ApiProperty({ description: 'Role information' })
  role: {
    id: number;
    name: string;
    description?: string;
  };

  @ApiProperty({ description: 'Operation timestamp' })
  timestamp: Date;

  @ApiProperty({ description: 'Human-readable message about the operation' })
  message: string;

  @ApiProperty({ description: 'Previous state information', required: false })
  previousState?: {
    wasAlreadyMember: boolean;
    memberSince?: Date;
  };

  @ApiProperty({ description: 'Current state information' })
  currentState: {
    isMember: boolean;
    memberSince?: Date;
    totalRoleMembers: number;
  };
}

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