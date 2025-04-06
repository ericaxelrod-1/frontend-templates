import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { LoggerService } from './logging/logger.service';

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  groups: { id: number; name: string }[];
  requiresPasswordChange?: boolean;
  lastPasswordChange?: Date;
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  requiresPasswordChange: boolean;
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

  // Try to get user groups from the user profile if the groups endpoint is not available
  getUserGroups(id: number): Observable<{ id: number; name: string }[]> {
    return this.getUser(id).pipe(
      map(user => user.groups || []),
      catchError(error => {
        console.error('Error getting user groups from profile:', error);
        return of([]);
      })
    );
  }

  // Method to add a user to a group
  addUserToGroup(userId: number, groupId: number): Observable<void> {
    this.logger.debug(`Adding user ${userId} to group ${groupId}`);
    return this.http.post<void>(`${this.apiUrl}/${userId}/groups/${groupId}`, {});
  }

  // Method to remove a user from a group
  removeUserFromGroup(userId: number, groupId: number): Observable<void> {
    this.logger.debug(`Removing user ${userId} from group ${groupId}`);
    return this.http.delete<void>(`${this.apiUrl}/${userId}/groups/${groupId}`);
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
  getPasswordRequirements(): Observable<{
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    preventCommonPasswords: boolean;
    preventPasswordReuse: boolean;
  }> {
    return this.http.get<any>(`${this.apiUrl}/password-requirements`);
  }

  // Get login attempt status
  getLoginAttemptStatus(email: string): Observable<{
    remainingAttempts: number;
    blockDuration?: number;
    isBlocked: boolean;
  }> {
    return this.http.get<any>(`${this.apiUrl}/login-attempt-status`, {
      params: { email }
    });
  }
} 