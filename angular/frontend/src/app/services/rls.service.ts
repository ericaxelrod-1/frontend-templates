import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ScopeGroup } from '../components/scope-builder/scope-builder.component';

export interface RlsRule {
  id?: number;
  groupId: number;
  group?: any;
  targetTable: string;
  scope: ScopeGroup;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SchemaColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
}

export interface TestScopeResult {
  count: number;
  sampleRows?: any[];
  valid: boolean;
  errors: string[];
  warnings: string[];
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

  getTableColumns(tableName: string): Observable<SchemaColumn[]> {
    return this.http.get<SchemaColumn[]>(`${environment.apiUrl}/schema/tables/${tableName}/columns`);
  }

  getTables(): Observable<{ items: { name: string }[], total: number }> {
    return this.http.get<{ items: { name: string }[], total: number }>(`${environment.apiUrl}/schema/tables`);
  }

  testScope(groupId: number, tableName: string, scope: ScopeGroup): Observable<TestScopeResult> {
    return this.http.post<TestScopeResult>(`${this.apiUrl}/test-scope`, {
      groupId,
      targetTable: tableName,
      scope: scope
    });
  }
}
