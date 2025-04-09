import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description: string;
  granted: boolean;
}

/**
 * @deprecated Use Permission interface instead
 */
export interface PermissionObject {
  [key: string]: boolean;
}

/**
 * @deprecated Roles are being phased out in favor of direct permission assignments
 */
export interface Role {
  id: number;
  name: string;
  description: string;
  permissions: PermissionObject | Permission[];
  userCount?: number;
  isSystemRole?: boolean;
}

/**
 * @deprecated This service is being phased out in favor of PermissionService.
 * Use PermissionService for all new code. This service is maintained only for backward compatibility.
 */
@Injectable({
  providedIn: 'root'
})
export class RoleService {
  private apiUrl = `${environment.apiUrl}/roles`;

  constructor(private http: HttpClient) {
    console.warn('RoleService is deprecated. Use PermissionService for all new code.');
  }

  /**
   * @deprecated Use PermissionService.getPermissionSets() instead
   */
  getRoles(): Observable<Role[]> {
    console.warn('getRoles() is deprecated. Use PermissionService.getPermissionSets() instead');
    return this.http.get<Role[]>(this.apiUrl).pipe(
      map(roles => this.convertToNewFormat(roles)),
      catchError(error => {
        console.error('Error in deprecated getRoles():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.getPermissionSet() instead
   */
  getRole(id: number): Observable<Role> {
    console.warn('getRole() is deprecated. Use PermissionService.getPermissionSet() instead');
    return this.http.get<Role>(`${this.apiUrl}/${id}`).pipe(
      map(role => this.convertToNewFormat([role])[0]),
      catchError(error => {
        console.error('Error in deprecated getRole():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.createPermissionSet() instead
   */
  createRole(role: Partial<Role>): Observable<Role> {
    console.warn('createRole() is deprecated. Use PermissionService.createPermissionSet() instead');
    return this.http.post<Role>(this.apiUrl, role).pipe(
      map(role => this.convertToNewFormat([role])[0]),
      catchError(error => {
        console.error('Error in deprecated createRole():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.updatePermissionSet() instead
   */
  updateRole(id: number, role: Partial<Role>): Observable<Role> {
    console.warn('updateRole() is deprecated. Use PermissionService.updatePermissionSet() instead');
    return this.http.put<Role>(`${this.apiUrl}/${id}`, role).pipe(
      map(role => this.convertToNewFormat([role])[0]),
      catchError(error => {
        console.error('Error in deprecated updateRole():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.deletePermissionSet() instead
   */
  deleteRole(id: number): Observable<void> {
    console.warn('deleteRole() is deprecated. Use PermissionService.deletePermissionSet() instead');
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(
      catchError(error => {
        console.error('Error in deprecated deleteRole():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.getAvailablePermissions() instead
   */
  getPermissions(): Observable<Permission[]> {
    console.warn('getPermissions() is deprecated. Use PermissionService.getAvailablePermissions() instead');
    return this.http.get<Permission[]>(`${this.apiUrl}/permissions/available`).pipe(
      catchError(error => {
        console.error('Error in deprecated getPermissions():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.assignPermission() instead
   */
  assignPermission(roleId: number, permissionId: number): Observable<void> {
    console.warn('assignPermission() is deprecated. Use PermissionService.assignPermission() instead');
    return this.http.post<void>(`${this.apiUrl}/${roleId}/permissions/${permissionId}`, {}).pipe(
      catchError(error => {
        console.error('Error in deprecated assignPermission():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.removePermission() instead
   */
  removePermission(roleId: number, permissionId: number): Observable<void> {
    console.warn('removePermission() is deprecated. Use PermissionService.removePermission() instead');
    return this.http.delete<void>(`${this.apiUrl}/${roleId}/permissions/${permissionId}`).pipe(
      catchError(error => {
        console.error('Error in deprecated removePermission():', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * @deprecated Use PermissionService.getUsersWithPermissionSet() instead
   */
  getUsersWithRole(roleId: number): Observable<any[]> {
    console.warn('getUsersWithRole() is deprecated. Use PermissionService.getUsersWithPermissionSet() instead');
    return this.http.get<any[]>(`${this.apiUrl}/${roleId}/users`).pipe(
      catchError(error => {
        console.error('Error in deprecated getUsersWithRole():', error);
        return throwError(() => error);
      })
    );
  }

  private convertToNewFormat(roles: Role[]): Role[] {
    return roles.map(role => ({
      ...role,
      permissions: Array.isArray(role.permissions) 
        ? role.permissions 
        : Object.entries(role.permissions as PermissionObject).map(([name, granted]) => ({
            id: name,
            name,
            resource: name.split(':')[0],
            action: name.split(':')[1] || 'access',
            description: `Permission to ${name.split(':')[1] || 'access'} ${name.split(':')[0]}`,
            granted
          }))
    }));
  }
} 