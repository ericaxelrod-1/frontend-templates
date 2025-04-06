import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { User } from './user.service';

export interface Member {
  id: number;
  name: string;
  role: string;
}

export interface Group {
  id: number;
  name: string;
  description: string;
  owner: string;
  members: Member[];
}

@Injectable({
  providedIn: 'root'
})
export class GroupService {
  private apiUrl = `${environment.apiUrl}/groups`;

  constructor(private http: HttpClient) {}

  getGroups(): Observable<Group[]> {
    return this.http.get<Group[]>(this.apiUrl);
  }

  getGroup(id: number): Observable<Group> {
    return this.http.get<Group>(`${this.apiUrl}/${id}`);
  }

  createGroup(group: Partial<Group>): Observable<Group> {
    return this.http.post<Group>(this.apiUrl, group);
  }

  updateGroup(id: number, group: Partial<Group>): Observable<Group> {
    return this.http.put<Group>(`${this.apiUrl}/${id}`, group);
  }

  deleteGroup(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  addMember(groupId: number, userId: number, role: string = 'Member'): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${groupId}/members`, { userId, role });
  }

  removeMember(groupId: number, userId: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${groupId}/members/${userId}`);
  }

  updateMemberRole(groupId: number, userId: number, role: string): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/${groupId}/members/${userId}`, { role });
  }
  
  // Try different endpoints to get group members
  getGroupMembers(groupId: number): Observable<User[]> {
    // First try the /users endpoint
    return this.http.get<User[]>(`${this.apiUrl}/${groupId}/users`).pipe(
      catchError(() => {
        // If that fails, try the /members endpoint
        return this.http.get<Member[]>(`${this.apiUrl}/${groupId}/members`).pipe(
          map(members => {
            // Convert Member objects to User objects
            return members.map(member => ({
              id: member.id,
              name: member.name,
              email: '', // We don't have this info from members endpoint
              role: member.role,
              groups: [] // We don't have this info from members endpoint
            }));
          }),
          catchError(() => {
            // If both fail, try getting the group and accessing its members
            return this.getGroup(groupId).pipe(
              map(group => {
                if (group.members && group.members.length > 0) {
                  return group.members.map(member => ({
                    id: member.id,
                    name: member.name,
                    email: '', 
                    role: member.role,
                    groups: []
                  }));
                }
                return [];
              }),
              catchError(() => {
                console.error(`Could not get members for group ${groupId} from any endpoint`);
                return of([]);
              })
            );
          })
        );
      })
    );
  }
} 