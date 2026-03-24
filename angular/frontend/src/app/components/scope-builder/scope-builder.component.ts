import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
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
  type: string;
  isPrimary?: boolean;
}

@Component({
  selector: 'app-scope-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule],
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
        <span class="group-label">Condition Group</span>
        <button mat-icon-button color="warn" (click)="removeGroup.emit()" *ngIf="canRemove" title="Remove Group">
          <mat-icon>delete</mat-icon>
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
                
                <button mat-icon-button color="warn" (click)="removeCondition(i)" class="btn-remove">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>
        }
      </div>

      <div class="scope-actions">
        <button mat-stroked-button (click)="addCondition()">
          <mat-icon>add</mat-icon> Add Condition
        </button>
        @if (depth < maxDepth) {
          <button mat-stroked-button color="accent" (click)="addNestedGroup()">
            <mat-icon>library_add</mat-icon> Add Group
          </button>
        }
      </div>

      @if (showTestResult) {
        <div class="test-result" [class.success]="(testResultCount ?? 0) > 0" [class.empty]="testResultCount === 0">
          <strong>Test Result:</strong> {{ testResultCount === -1 ? 'Error' : testResultCount }} row(s) match this scope
        </div>
      }
    </div>
  `,
  styles: [`
    .scope-builder { 
      border: 1px solid var(--mat-sys-outline-variant); 
      border-radius: var(--mat-sys-spacing-sm); 
      padding: var(--fluid-spacing-sm); 
      background: var(--mat-sys-surface-container); 
    }
    .scope-group-header { display: flex; align-items: center; gap: var(--mat-sys-spacing-sm); margin-bottom: var(--mat-sys-spacing-sm); }
    .operator-select { 
      padding: var(--mat-sys-spacing-xs) var(--mat-sys-spacing-sm); 
      border: 1px solid var(--mat-sys-tertiary); 
      border-radius: 4px; 
      background: var(--mat-sys-tertiary); 
      color: var(--mat-sys-on-tertiary); 
      font-weight: 600; 
      font-size: var(--fluid-text-xs); 
    }
    .operator-select option { background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); }
    .group-label { font-size: var(--fluid-text-xs); color: var(--mat-sys-on-surface-variant); text-transform: uppercase; letter-spacing: 0.05em; }
    
    .scope-conditions { 
      display: flex; 
      flex-direction: column; 
      gap: var(--mat-sys-spacing-sm); 
      padding-left: var(--mat-sys-spacing-md); 
      border-left: 2px solid var(--mat-sys-outline-variant); 
      margin-left: var(--mat-sys-spacing-sm); 
    }
    .condition-row { display: flex; flex-direction: column; gap: var(--mat-sys-spacing-xs); }
    .condition-row.is-group { margin: var(--mat-sys-spacing-sm) 0; }
    .between-operator { 
      font-size: var(--fluid-text-xs); 
      color: var(--mat-sys-tertiary); 
      font-weight: 700; 
      text-align: left; 
      padding: var(--mat-sys-spacing-xs) 0; 
    }
    .nested-group { width: 100%; }
    .condition { display: flex; gap: var(--mat-sys-spacing-sm); align-items: center; flex-wrap: wrap; }
    .column-select, .operator-select-sm, .value-input { 
      padding: var(--mat-sys-spacing-sm); 
      border: 1px solid var(--mat-sys-outline-variant); 
      border-radius: 4px; 
      font-size: var(--fluid-text-sm); 
      background: var(--mat-sys-surface); 
      color: var(--mat-sys-on-surface); 
    }
    .column-select { min-width: 150px; }
    .operator-select-sm { min-width: 120px; }
    .value-input { flex: 1; min-width: 120px; }
    .scope-actions { display: flex; gap: var(--mat-sys-spacing-sm); margin-top: var(--mat-sys-spacing-md); }
    
    .test-result { 
      margin-top: var(--mat-sys-spacing-md); 
      padding: var(--mat-sys-spacing-sm); 
      border-radius: 4px; 
      font-size: var(--fluid-text-sm); 
    }
    .test-result.success { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .test-result.empty { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
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
            { name: 'id', type: 'integer', isPrimary: true },
            { name: 'created_at', type: 'timestamp' },
            { name: 'updated_at', type: 'timestamp' },
            { name: 'group_id', type: 'integer' },
            { name: 'owner_id', type: 'integer' },
            { name: 'name', type: 'string' },
            { name: 'status', type: 'string' }
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
