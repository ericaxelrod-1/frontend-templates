import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ServerResponse } from '../models/server-response.model';

export interface Permission {
  id: number;
  name: string;
  description: string;
  resourceName: string;
  actionName: string;
}

export interface Role {
  id?: number;
  name: string;
  description: string;
  permissions: Permission[];
  createdAt?: Date;
  updatedAt?: Date;
  userCount?: number;
}

@Injectable({
  providedIn: 'root'
})
export class RoleService {
  private apiUrl = `${environment.apiUrl}/roles`;

  constructor(private http: HttpClient) { }

  getRoles(params: {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDirection?: string;
    search?: string;
  } = {}): Observable<ServerResponse<Role>> {
    let httpParams = new HttpParams();

    if (params.page !== undefined) httpParams = httpParams.append('page', params.page.toString());
    if (params.pageSize !== undefined) httpParams = httpParams.append('pageSize', params.pageSize.toString());
    if (params.sortBy) httpParams = httpParams.append('sortBy', params.sortBy);
    if (params.sortDirection) httpParams = httpParams.append('sortDirection', params.sortDirection);
    if (params.search) httpParams = httpParams.append('search', params.search);

    return this.http.get<ServerResponse<Role>>(this.apiUrl, { params: httpParams });
  }

  getRole(id: number): Observable<Role> {
    return this.http.get<Role>(`${this.apiUrl}/${id}`);
  }

  createRole(role: Partial<Role>): Observable<Role> {
    return this.http.post<Role>(this.apiUrl, role);
  }

  updateRole(id: number, role: Partial<Role>): Observable<Role> {
    return this.http.patch<Role>(`${this.apiUrl}/${id}`, role);
  }

  deleteRole(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }

  getPermissions(): Observable<Permission[]> {
    return this.http.get<Permission[]>(`${environment.apiUrl}/permissions`);
  }
} 