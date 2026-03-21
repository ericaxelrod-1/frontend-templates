import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RlsRule {
  id?: number;
  groupId: number;
  group?: any;
  targetTable: string;
  sql: string;
  parameters?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class RlsService {
  private apiUrl = `${environment.apiUrl}/rls-rules`;

  constructor(private http: HttpClient) { }

  getRules(params: {
    groupId?: number;
    targetTable?: string;
  } = {}): Observable<RlsRule[]> {
    let httpParams = new HttpParams();

    if (params.groupId !== undefined) {
      httpParams = httpParams.append('groupId', params.groupId.toString());
    }
    if (params.targetTable) {
      httpParams = httpParams.append('targetTable', params.targetTable);
    }

    return this.http.get<RlsRule[]>(this.apiUrl, { params: httpParams });
  }

  getRule(id: number): Observable<RlsRule> {
    return this.http.get<RlsRule>(`${this.apiUrl}/${id}`);
  }

  createRule(rule: Partial<RlsRule>): Observable<RlsRule> {
    return this.http.post<RlsRule>(this.apiUrl, rule);
  }

  updateRule(id: number, rule: Partial<RlsRule>): Observable<RlsRule> {
    return this.http.put<RlsRule>(`${this.apiUrl}/${id}`, rule);
  }

  deleteRule(id: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/${id}`);
  }

  invalidateCache(tableName?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.apiUrl}/invalidate-cache`, { tableName });
  }
}
