import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private apiUrl = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(this.apiUrl);
  }

  getUser(id: number): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/${id}`);
  }

  createUser(user: Partial<User>): Observable<User> {
    return this.http.post<User>(this.apiUrl, user);
  }

  updateUser(id: number, user: Partial<User>): Observable<User> {
    return this.http.put<User>(`${this.apiUrl}/${id}`, user);
  }

  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getUserGroups(id: number): Observable<{ id: number; name: string }[]> {
    return this.http.get<{ id: number; name: string }[]>(`${this.apiUrl}/${id}/groups`);
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