import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { LoggerService } from './logging/logger.service';
import { User } from '../models/user.model';
import { Group, Member, Permission } from '../models/group.model';

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  roleId?: number;
  requiresPasswordChange: boolean;
}

export interface GroupMembershipResponse {
  success: boolean;
  message: string;
  group?: Group;
}

export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  preventCommonPasswords: boolean;
  preventPasswordReuse: boolean;
}

export interface LoginAttemptStatus {
  remainingAttempts: number;
  blockDuration?: number;
  isBlocked: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private apiUrl = `${environment.apiUrl}/users`;

  constructor(
    private http: HttpClient,
    private logger: LoggerService
  ) {}

  getUsers(): Observable<User[]> {
    this.logger.debug('Fetching all users');
    return this.http.get<User[]>(this.apiUrl);
  }

  getUser(id: number): Observable<User> {
    this.logger.debug(`Fetching user with id ${id}`);
    return this.http.get<User>(`${this.apiUrl}/${id}`);
  }

  createUser(user: CreateUserRequest): Observable<User> {
    this.logger.debug('Creating new user', { email: user.email, requiresPasswordChange: user.requiresPasswordChange });
    return this.http.post<User>(this.apiUrl, user);
  }

  updateUser(id: number, user: Partial<User>): Observable<User> {
    this.logger.debug(`Updating user with id ${id}`, user);
    return this.http.put<User>(`${this.apiUrl}/${id}`, user);
  }

  deleteUser(id: number): Observable<void> {
    this.logger.debug(`Deleting user with id ${id}`);
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getUserGroups(id: number): Observable<Group[]> {
    return this.getUser(id).pipe(
      map(user => {
        if (!user.groups || user.groups.length === 0) {
          this.logger.warn(`No groups found for user ${id}`);
          return [];
        }
        // Ensure we have complete Group objects
        return user.groups.filter((group): group is Group => {
          const isValid = group && typeof group.id === 'number' && 
                         typeof group.name === 'string';
          if (!isValid) {
            this.logger.warn(`Invalid group data found for user ${id}`, group);
          }
          return isValid;
        });
      }),
      catchError(error => {
        this.logger.error('Error getting user groups from profile:', error);
        return of([]);
      })
    );
  }

  addUserToGroup(userId: number, groupId: number): Observable<GroupMembershipResponse> {
    this.logger.debug(`Adding user ${userId} to group ${groupId}`);
    return this.http.post<any>(`${environment.apiUrl}/groups/${groupId}/members/${userId}`, {}).pipe(
      map((userGroup: any) => {
        this.logger.debug(`Successfully added user ${userId} to group ${groupId}`);
        // Transform UserGroup response to expected GroupMembershipResponse format
        return {
          success: true,
          message: 'User added to group successfully',
          group: userGroup.group
        } as GroupMembershipResponse;
      }),
      catchError(error => {
        this.logger.error(`Failed to add user ${userId} to group ${groupId}:`, error);
        // Handle error properly with fallback message
        const errorMessage = error.error?.message || error.message || 'Failed to add user to group';
        throw { message: errorMessage };
      })
    );
  }

  removeUserFromGroup(userId: number, groupId: number): Observable<GroupMembershipResponse> {
    this.logger.debug(`Removing user ${userId} from group ${groupId}`);
    return this.http.delete<any>(`${environment.apiUrl}/groups/${groupId}/members/${userId}`).pipe(
      map(() => {
        this.logger.debug(`Successfully removed user ${userId} from group ${groupId}`);
        // Transform void response to expected GroupMembershipResponse format
        return {
          success: true,
          message: 'User removed from group successfully'
        } as GroupMembershipResponse;
      }),
      catchError(error => {
        this.logger.error(`Failed to remove user ${userId} from group ${groupId}:`, error);
        // Handle error properly with fallback message
        const errorMessage = error.error?.message || error.message || 'Failed to remove user from group';
        throw { message: errorMessage };
      })
    );
  }

  // Method to change user password with enhanced security requirements
  changePassword(id: number, passwordData: PasswordChange): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${id}/change-password`, passwordData);
  }

  // Check if password change is required (for first login)
  checkPasswordChangeRequired(id: number): Observable<{ required: boolean }> {
    return this.http.get<{ required: boolean }>(`${this.apiUrl}/${id}/password-change-required`);
  }

  // Get password requirements
  getPasswordRequirements(): Observable<PasswordRequirements> {
    return this.http.get<PasswordRequirements>(`${this.apiUrl}/password-requirements`);
  }

  // Get login attempt status
  getLoginAttemptStatus(email: string): Observable<LoginAttemptStatus> {
    return this.http.get<LoginAttemptStatus>(`${this.apiUrl}/login-attempt-status`, {
      params: { email }
    });
  }
} 