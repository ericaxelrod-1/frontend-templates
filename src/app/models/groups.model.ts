import { Group } from './group.model';

export interface GroupsState {
  groups: Group[];
  selectedGroup: Group | null;
  loading: boolean;
  error: string | null;
}

export interface GroupsFilter {
  search?: string;
  ownerId?: number;
  limit?: number;
  offset?: number;
}

export interface GroupCreateRequest {
  name: string;
  description?: string;
  ownerId: number;
}

export interface GroupUpdateRequest {
  id: number;
  name?: string;
  description?: string;
}

export interface GroupMembershipRequest {
  groupId: number;
  userId: number;
  role?: 'admin' | 'member' | 'viewer';
} 