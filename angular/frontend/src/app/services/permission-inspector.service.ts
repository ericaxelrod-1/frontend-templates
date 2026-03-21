import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RlsJoinPath {
  id?: number;
  name: string;
  targetTable: string;
  chain: string;
  conditions?: RlsJoinCondition[];
}

export interface RlsJoinCondition {
  id?: number;
  joinPathId?: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  operator?: string;
}

export interface RlsScopeTemplate {
  id?: number;
  name: string;
  joinPathId: number;
  joinPath?: RlsJoinPath;
  targetTable: string;
  availableColumns: string[];
}

export interface PermissionInspection {
  user?: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
  };
  role?: {
    id: number;
    name: string;
    description: string;
    isSystemRole: boolean;
  };
  group?: {
    id: number;
    name: string;
    description: string;
    isSystemGroup: boolean;
  };
  directRoles?: { id: number; name: string }[];
  directGroups?: { id: number; name: string }[];
  hierarchy?: {
    ancestors: { id: number; name: string }[];
    descendants: { id: number; name: string }[];
  };
  directPermissions?: { permission: string; isGranted: boolean; source?: string }[];
  effectivePermissions?: { permission: string; isGranted: boolean; inheritedFrom?: string }[];
  effectiveMemberCount?: number;
}

@Injectable({
  providedIn: 'root'
})
export class PermissionInspectorService {
  private apiUrl = `${environment.apiUrl}`;

  constructor(private http: HttpClient) { }

  inspectUser(userId: number): Observable<PermissionInspection> {
    return this.http.get<PermissionInspection>(`${this.apiUrl}/permissions/inspector/user/${userId}`);
  }

  inspectRole(roleId: number): Observable<PermissionInspection> {
    return this.http.get<PermissionInspection>(`${this.apiUrl}/permissions/inspector/role/${roleId}`);
  }

  inspectGroup(groupId: number): Observable<PermissionInspection> {
    return this.http.get<PermissionInspection>(`${this.apiUrl}/permissions/inspector/group/${groupId}`);
  }
}
