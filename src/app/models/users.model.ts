import { User } from './user.model';

export interface UsersState {
  users: User[];
  selectedUser: User | null;
  loading: boolean;
  error: string | null;
}

export interface UsersFilter {
  search?: string;
  role?: number;
  limit?: number;
  offset?: number;
}

export interface UserCreateRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  roleId: number;
}

export interface UserUpdateRequest {
  id: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  roleId?: number;
  preferences?: Record<string, any>;
} 