import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Permission {
  id: string;
  resourceName: string;
  actionName: string;
  name: string;
  description?: string;
}

export interface Resource {
  id: string;
  name: string;
  description?: string;
}

export interface Action {
  id: string;
  name: string;
  description?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions?: Permission[];
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  permissions?: Permission[];
}

export interface UiComponent {
  id: string;
  selector: string;
  description?: string;
  requiredPermissions: Permission[];
  overridePermissions: boolean;
  lastSynced?: Date;
}

export interface FrontendRoute {
  id: string;
  path: string;
  description?: string;
  component?: string;
  requiredPermissions: Permission[];
  overridePermissions: boolean;
  lastSynced?: Date;
}

export interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  description?: string;
  controllerName?: string;
  handlerName?: string;
  requiredPermissions: Permission[];
  overridePermissions: boolean;
  lastSynced?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class PermissionManagementService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  // Permission endpoints
  getAllPermissions(): Observable<Permission[]> {
    return this.http.get<Permission[]>(`${this.apiUrl}/permissions`);
  }

  getUserPermissions(): Observable<string[]> {
    return this.http.get<string[]>(`${this.apiUrl}/permissions/user-permissions`);
  }

  // Role endpoints
  getAllRoles(): Observable<Role[]> {
    return this.http.get<Role[]>(`${this.apiUrl}/roles`);
  }

  getRoleById(id: string): Observable<Role> {
    return this.http.get<Role>(`${this.apiUrl}/roles/${id}`);
  }

  createRole(role: Partial<Role>): Observable<Role> {
    return this.http.post<Role>(`${this.apiUrl}/roles`, role);
  }

  updateRole(id: string, role: Partial<Role>): Observable<Role> {
    return this.http.put<Role>(`${this.apiUrl}/roles/${id}`, role);
  }

  deleteRole(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/roles/${id}`);
  }

  // Group endpoints
  getAllGroups(): Observable<Group[]> {
    return this.http.get<Group[]>(`${this.apiUrl}/groups`);
  }

  getGroupById(id: string): Observable<Group> {
    return this.http.get<Group>(`${this.apiUrl}/groups/${id}`);
  }

  createGroup(group: Partial<Group>): Observable<Group> {
    return this.http.post<Group>(`${this.apiUrl}/groups`, group);
  }

  updateGroup(id: string, group: Partial<Group>): Observable<Group> {
    return this.http.put<Group>(`${this.apiUrl}/groups/${id}`, group);
  }

  deleteGroup(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/groups/${id}`);
  }

  // Component permissions
  getAllComponents(): Observable<UiComponent[]> {
    return this.http.get<UiComponent[]>(`${this.apiUrl}/permissions/components`);
  }

  getComponentById(id: string): Observable<UiComponent> {
    return this.http.get<UiComponent>(`${this.apiUrl}/permissions/components/${id}`);
  }

  updateComponentPermissions(id: string, requiredPermissions: string[], overridePermissions: boolean): Observable<UiComponent> {
    return this.http.patch<UiComponent>(`${this.apiUrl}/permissions/components/${id}`, {
      requiredPermissions,
      overridePermissions
    });
  }

  // Route permissions
  getAllRoutes(): Observable<FrontendRoute[]> {
    return this.http.get<FrontendRoute[]>(`${this.apiUrl}/permissions/routes`);
  }

  getRouteById(id: string): Observable<FrontendRoute> {
    return this.http.get<FrontendRoute>(`${this.apiUrl}/permissions/routes/${id}`);
  }

  updateRoutePermissions(id: string, requiredPermissions: string[], overridePermissions: boolean): Observable<FrontendRoute> {
    return this.http.patch<FrontendRoute>(`${this.apiUrl}/permissions/routes/${id}`, {
      requiredPermissions,
      overridePermissions
    });
  }

  testRouteAccess(id: string): Observable<{ hasAccess: boolean }> {
    return this.http.get<{ hasAccess: boolean }>(`${this.apiUrl}/permissions/route-access-test/${id}`);
  }

  // Endpoint permissions
  getAllEndpoints(): Observable<ApiEndpoint[]> {
    return this.http.get<ApiEndpoint[]>(`${this.apiUrl}/permissions/endpoints`);
  }

  getEndpointById(id: string): Observable<ApiEndpoint> {
    return this.http.get<ApiEndpoint>(`${this.apiUrl}/permissions/endpoints/${id}`);
  }

  updateEndpointPermissions(id: string, requiredPermissions: string[], overridePermissions: boolean): Observable<ApiEndpoint> {
    return this.http.patch<ApiEndpoint>(`${this.apiUrl}/permissions/endpoints/${id}`, {
      requiredPermissions,
      overridePermissions
    });
  }

  testEndpointAccess(id: string): Observable<{ hasAccess: boolean }> {
    return this.http.get<{ hasAccess: boolean }>(`${this.apiUrl}/permissions/endpoint-access-test/${id}`);
  }

  // Role permissions
  getRolePermissions(roleId: string): Observable<Permission[]> {
    return this.http.get<Permission[]>(`${this.apiUrl}/permissions/role/${roleId}`);
  }

  updateRolePermission(roleId: string, permissionId: string, granted: boolean): Observable<any> {
    return this.http.put(`${this.apiUrl}/permissions/role/${roleId}/permission/${permissionId}`, { granted });
  }

  // Group permissions
  getGroupPermissions(groupId: string): Observable<Permission[]> {
    return this.http.get<Permission[]>(`${this.apiUrl}/permissions/group/${groupId}`);
  }

  updateGroupPermission(groupId: string, permissionId: string, granted: boolean): Observable<any> {
    return this.http.put(`${this.apiUrl}/permissions/group/${groupId}/permission/${permissionId}`, { granted });
  }

  // Sync permissions
  syncPermissions(type: 'components' | 'routes' | 'endpoints' | 'all' = 'all'): Observable<any> {
    return this.http.post(`${this.apiUrl}/permissions/sync`, { type });
  }
} 