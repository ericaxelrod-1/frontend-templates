import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export type LogicalOperator = 'AND' | 'OR';
export type ComparisonOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

export interface ScopeCondition {
  column: string;
  operator: ComparisonOperator;
  value: any;
}

export interface ScopeGroup {
  logicalOperator: LogicalOperator;
  conditions: (ScopeCondition | ScopeGroup)[];
}

export interface SchemaColumn {
  name: string;
  dataType: string;
}

@Component({
  selector: 'app-scope-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="scope-builder">
      <div class="scope-group-header">
        <select 
          [ngModel]="group.logicalOperator" 
          (ngModelChange)="updateGroupOperator($event)"
          class="operator-select"
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
        <span class="group-label">Group</span>
        <button class="btn-remove-group" (click)="removeGroup.emit()" *ngIf="canRemove">
          Remove Group
        </button>
      </div>

      <div class="scope-conditions">
        @for (item of group.conditions; track $index; let i = $index) {
          <div class="condition-row" [class.is-group]="isGroup(item)">
            @if ($index > 0) {
              <span class="between-operator">{{ group.logicalOperator }}</span>
            }
            
            @if (isGroup(item)) {
              <div class="nested-group">
                <app-scope-builder 
                  [group]="asGroup(item)" 
                  [columns]="columns"
                  [depth]="depth + 1"
                  [canRemove]="true"
                  (removeGroup)="removeNestedGroup(i)"
                  (scopeChange)="emitChange()"
                  (testScope)="testScope.emit($event)"
                ></app-scope-builder>
              </div>
            } @else {
              <div class="condition">
                <select 
                  [ngModel]="asCondition(item).column" 
                  (ngModelChange)="updateConditionColumn(i, $event)"
                  class="column-select"
                >
                  <option value="">Select column...</option>
                  @for (col of columns; track col.name) {
                    <option [value]="col.name">{{ col.name }}</option>
                  }
                </select>
                
                <select 
                  [ngModel]="asCondition(item).operator" 
                  (ngModelChange)="updateConditionOperator(i, $event)"
                  class="operator-select-sm"
                >
                  @for (op of operators; track op) {
                    <option [value]="op">{{ op }}</option>
                  }
                </select>
                
                @if (!isNullOperator(asCondition(item).operator)) {
                  <input 
                    [type]="getInputType(asCondition(item).operator)"
                    [ngModel]="asCondition(item).value"
                    (ngModelChange)="updateConditionValue(i, $event)"
                    placeholder="Value..."
                    class="value-input"
                  />
                }
                
                <button class="btn-remove" (click)="removeCondition(i)">×</button>
              </div>
            }
          </div>
        }
      </div>

      <div class="scope-actions">
        <button class="btn-add" (click)="addCondition()">+ Condition</button>
        @if (depth < maxDepth) {
          <button class="btn-add-group" (click)="addNestedGroup()">+ Add Group</button>
        }
      </div>

      @if (showTestResult) {
        <div class="test-result" [class.success]="(testResultCount ?? 0) > 0" [class.empty]="testResultCount === 0">
          <strong>Test Result:</strong> {{ testResultCount }} row(s) match this scope
        </div>
      }
    </div>
  `,
  styles: [`
    .scope-builder {
      border: 1px solid #cbd5e1;
      border-radius: 0.5rem;
      padding: 1rem;
      background: #f8fafc;
    }
    .scope-group-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .operator-select {
      padding: 0.375rem 0.75rem;
      border: 1px solid #3b82f6;
      border-radius: 0.25rem;
      background: #3b82f6;
      color: white;
      font-weight: 600;
      font-size: 0.875rem;
    }
    .operator-select option {
      background: white;
      color: #1e293b;
    }
    .group-label {
      font-size: 0.75rem;
      color: #64748b;
      text-transform: uppercase;
    }
    .btn-remove-group {
      margin-left: auto;
      padding: 0.25rem 0.5rem;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.75rem;
    }
    .scope-conditions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-left: 1rem;
      border-left: 2px solid #e2e8f0;
      margin-left: 0.5rem;
    }
    .condition-row {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .condition-row.is-group {
      margin: 0.5rem 0;
    }
    .between-operator {
      font-size: 0.75rem;
      color: #3b82f6;
      font-weight: 600;
      text-align: center;
      padding: 0.25rem 0;
    }
    .nested-group {
      width: 100%;
    }
    .condition {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .column-select,
    .operator-select-sm,
    .value-input {
      padding: 0.375rem;
      border: 1px solid #cbd5e1;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
    .column-select {
      min-width: 150px;
    }
    .operator-select-sm {
      min-width: 120px;
    }
    .value-input {
      flex: 1;
      min-width: 120px;
    }
    .btn-remove {
      width: 1.5rem;
      height: 1.5rem;
      border: none;
      background: #ef4444;
      color: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 1rem;
      line-height: 1;
      padding: 0;
    }
    .scope-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .btn-add,
    .btn-add-group {
      padding: 0.375rem 0.75rem;
      border: 1px dashed #cbd5e1;
      background: transparent;
      border-radius: 0.25rem;
      cursor: pointer;
      font-size: 0.875rem;
      color: #64748b;
    }
    .btn-add:hover,
    .btn-add-group:hover {
      border-color: #3b82f6;
      color: #3b82f6;
    }
    .btn-add-group {
      border-color: #8b5cf6;
      color: #8b5cf6;
    }
    .btn-add-group:hover {
      background: #f5f3ff;
    }
    .test-result {
      margin-top: 1rem;
      padding: 0.75rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
    .test-result.success {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #86efac;
    }
    .test-result.empty {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
  `]
})
export class ScopeBuilderComponent implements OnInit {
  @Input() group: ScopeGroup = { logicalOperator: 'AND', conditions: [] };
  @Input() columns: SchemaColumn[] = [];
  @Input() depth = 0;
  @Input() canRemove = false;
  @Input() targetTable = '';

  @Output() scopeChange = new EventEmitter<ScopeGroup>();
  @Output() testScope = new EventEmitter<{ scope: ScopeGroup; table: string }>();
  @Output() removeGroup = new EventEmitter<void>();

  operators: ComparisonOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
  maxDepth = 3;

  testResultCount: number | null = null;
  showTestResult = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (this.columns.length === 0 && this.targetTable) {
      this.loadColumns();
    }
  }

  loadColumns(): void {
    this.http.get<SchemaColumn[]>(`${environment.apiUrl}/schema/tables/${this.targetTable}/columns`)
      .subscribe({
        next: (response) => {
          this.columns = response;
        },
        error: () => {
          this.columns = [
            { name: 'id', dataType: 'integer' },
            { name: 'created_at', dataType: 'timestamp' },
            { name: 'updated_at', dataType: 'timestamp' },
            { name: 'group_id', dataType: 'integer' },
            { name: 'owner_id', dataType: 'integer' },
            { name: 'name', dataType: 'string' },
            { name: 'status', dataType: 'string' }
          ];
        }
      });
  }

  isGroup(item: ScopeCondition | ScopeGroup): boolean {
    return 'logicalOperator' in item;
  }

  asGroup(item: ScopeCondition | ScopeGroup): ScopeGroup {
    return item as ScopeGroup;
  }

  asCondition(item: ScopeCondition | ScopeGroup): ScopeCondition {
    return item as ScopeCondition;
  }

  isNullOperator(op: ComparisonOperator): boolean {
    return op === 'IS NULL' || op === 'IS NOT NULL';
  }

  getInputType(operator: ComparisonOperator): string {
    if (operator === 'IN') return 'text';
    if (['>', '<', '>=', '<='].includes(operator)) return 'number';
    return 'text';
  }

  updateGroupOperator(op: LogicalOperator): void {
    this.group.logicalOperator = op;
    this.emitChange();
  }

  addCondition(): void {
    const newCondition: ScopeCondition = {
      column: '',
      operator: '=',
      value: ''
    };
    this.group.conditions.push(newCondition);
    this.emitChange();
  }

  addNestedGroup(): void {
    const newGroup: ScopeGroup = {
      logicalOperator: this.group.logicalOperator === 'AND' ? 'OR' : 'AND',
      conditions: []
    };
    this.group.conditions.push(newGroup);
    this.emitChange();
  }

  removeCondition(index: number): void {
    this.group.conditions.splice(index, 1);
    this.emitChange();
  }

  removeNestedGroup(index: number): void {
    this.group.conditions.splice(index, 1);
    this.emitChange();
  }

  updateConditionColumn(index: number, column: string): void {
    const item = this.group.conditions[index] as ScopeCondition;
    item.column = column;
    this.emitChange();
  }

  updateConditionOperator(index: number, operator: ComparisonOperator): void {
    const item = this.group.conditions[index] as ScopeCondition;
    item.operator = operator;
    if (this.isNullOperator(operator)) {
      item.value = null;
    }
    this.emitChange();
  }

  updateConditionValue(index: number, value: any): void {
    const item = this.group.conditions[index] as ScopeCondition;
    item.value = value;
    this.emitChange();
  }

  emitChange(): void {
    this.scopeChange.emit(this.group);
  }

  testScopeScope(): void {
    this.testScope.emit({ scope: this.group, table: this.targetTable });
    this.http.post<{ count: number }>(`${environment.apiUrl}/rls-rules/test-scope`, {
      scope: this.group,
      table: this.targetTable
    }).subscribe({
      next: (response) => {
        this.testResultCount = response.count;
        this.showTestResult = true;
      },
      error: () => {
        this.testResultCount = -1;
        this.showTestResult = true;
      }
    });
  }
}
