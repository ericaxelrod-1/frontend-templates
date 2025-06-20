import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { Group, Member, Permission, GROUP_PERMISSION_SETS } from '../models/group.model';
import { User } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class GroupService {
  private apiUrl = `${environment.apiUrl}/groups`;

  constructor(private http: HttpClient) {}

  getGroups(): Observable<Group[]> {
    return this.http.get<Group[]>(this.apiUrl).pipe(
      catchError(error => {
        console.error('Error getting groups:', error);
        return throwError(() => error);
      })
    );
  }

  getGroup(id: number): Observable<Group> {
    return this.http.get<Group>(`${this.apiUrl}/${id}`).pipe(
      catchError(error => {
        console.error(`Error getting group ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  createGroup(group: Partial<Group>): Observable<Group> {
    return this.http.post<Group>(this.apiUrl, group).pipe(
      catchError(error => {
        console.error('Error creating group:', error);
        return throwError(() => error);
      })
    );
  }

  updateGroup(id: number, group: Partial<Group>): Observable<Group> {
    return this.http.put<Group>(`${this.apiUrl}/${id}`, group).pipe(
      catchError(error => {
        console.error(`Error updating group ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  deleteGroup(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      catchError(error => {
        console.error(`Error deleting group ${id}:`, error);
        return throwError(() => error);
      })
    );
  }

  getGroupMembers(groupId: number): Observable<User[]> {
    return this.http.get<User[]>(`${this.apiUrl}/${groupId}/users`).pipe(
      catchError(() => {
        // Fallback to getting group and extracting users
        return this.getGroup(groupId).pipe(
          map(group => group.users || []),
          catchError(() => {
            console.error(`Could not get members for group ${groupId} from any endpoint`);
            return of([]);
          })
        );
      })
    );
  }

  /**
   * @deprecated Use addMemberWithPermissions instead
   */
  addMember(groupId: number, userId: number, role = 'Member'): Observable<void> {
    console.warn('addMember() is deprecated. Use addMemberWithPermissions() instead');
    const permissions = GROUP_PERMISSION_SETS['MEMBER'];
    return this.addMemberWithPermissions(groupId, userId, permissions);
  }

  addMemberWithPermissions(groupId: number, userId: number, permissions: Permission[]): Observable<void> {
    // Backend expects: POST /groups/{groupId}/members/{userId}
    // No request body needed - backend uses URL parameters only
    return this.http.post<void>(`${this.apiUrl}/${groupId}/members/${userId}`, {}).pipe(
      catchError(error => {
        console.error(`Error adding member to group ${groupId}:`, error);
        return throwError(() => error);
      })
    );
  }

  removeMember(groupId: number, userId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${groupId}/members/${userId}`).pipe(
      catchError(error => {
        console.error(`Error removing member from group ${groupId}:`, error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use updateMemberPermissions instead
   */
  updateMemberRole(groupId: number, userId: number, role: string): Observable<void> {
    console.warn('updateMemberRole() is deprecated. Use updateMemberPermissions() instead');
    const permissions = GROUP_PERMISSION_SETS['MEMBER'];
    return this.updateMemberPermissions(groupId, userId, permissions);
  }

  updateMemberPermissions(groupId: number, userId: number, permissions: Permission[]): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/${groupId}/members/${userId}`, { 
      permissions 
    }).pipe(
      catchError(error => {
        console.error(`Error updating member permissions in group ${groupId}:`, error);
        return throwError(() => error);
      })
    );
  }


} 