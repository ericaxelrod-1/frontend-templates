import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RlsService, RlsRule } from '../../../services/rls.service';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';
import { ScopeBuilderComponent, ScopeGroup, SchemaColumn } from '../../../components/scope-builder/scope-builder.component';

export interface RlsRuleForm {
  id?: number;
  groupId: number;
  targetTable: string;
  scope: ScopeGroup;
}

@Component({
  selector: 'app-rls-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, ScopeBuilderComponent],
  template: `
    <div class="rls-admin">
      <header class="rls-header">
        <h1>Row-Level Security Rules</h1>
        <button class="btn-primary" (click)="showCreateDialog()">
          + Add Rule
        </button>
      </header>

      <div class="filters">
        <div class="filter-group">
          <label>Group:</label>
          <select [(ngModel)]="selectedGroupId" (change)="loadRules()">
            <option [ngValue]="undefined">All Groups</option>
            @for (group of groups; track group.id) {
              <option [value]="group.id">{{ group.name }}</option>
            }
          </select>
        </div>
        <div class="filter-group">
          <label>Table:</label>
          <input 
            type="text" 
            [(ngModel)]="selectedTable" 
            (input)="loadRules()"
            placeholder="Filter by table name"
          />
        </div>
      </div>

      <table class="rls-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Group</th>
            <th>Target Table</th>
            <th>Scope (JSON)</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (rule of rules; track rule.id) {
            <tr>
              <td>{{ rule.id }}</td>
              <td>{{ rule.group?.name || rule.groupId }}</td>
              <td><code>{{ rule.targetTable }}</code></td>
              <td class="scope-cell">
                <code class="scope-preview">{{ truncateScope(rule.scope, 60) }}</code>
                <button class="btn-small" (click)="viewScopeJson(rule)">View</button>
              </td>
              <td class="actions">
                <button class="btn-small" (click)="editRule(rule)">Edit</button>
                <button class="btn-small btn-danger" (click)="deleteRule(rule)">Delete</button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="5" class="empty-state">No RLS rules configured</td>
            </tr>
          }
        </tbody>
      </table>

      @if (showDialog) {
        <div class="dialog-overlay" (click)="closeDialog()">
          <div class="dialog dialog-wide" (click)="$event.stopPropagation()">
            <h2>{{ editingRule ? 'Edit Rule' : 'Create RLS Rule' }}</h2>
            
            <div class="form-group">
              <label>Group *</label>
              <select [(ngModel)]="formData.groupId" required>
                <option value="">Select a group</option>
                @for (group of groups; track group.id) {
                  <option [value]="group.id">{{ group.name }}</option>
                }
              </select>
            </div>

            <div class="form-group">
              <label>Target Table *</label>
              <input 
                type="text" 
                [(ngModel)]="formData.targetTable" 
                required
                placeholder="e.g., tasks, projects, invoices"
                (ngModelChange)="onTableChange($event)"
              />
            </div>

            <div class="form-group">
              <label>Scope Definition *</label>
              <div class="scope-builder-wrapper">
                <app-scope-builder 
                  [group]="formData.scope" 
                  [columns]="availableColumns"
                  [targetTable]="formData.targetTable || ''"
                  [depth]="0"
                  (scopeChange)="onScopeChange($event)"
                  (testScope)="onTestScope($event)"
                ></app-scope-builder>
              </div>
              <small>Build conditions using the interface above. No raw SQL allowed.</small>
            </div>

            <div class="dialog-actions">
              <button class="btn-secondary" (click)="closeDialog()">Cancel</button>
              <button class="btn-primary" (click)="saveRule()" [disabled]="!isFormValid()">
                {{ editingRule ? 'Update' : 'Create' }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (showJsonViewer) {
        <div class="dialog-overlay" (click)="showJsonViewer = false">
          <div class="dialog dialog-wide" (click)="$event.stopPropagation()">
            <h2>Scope JSON</h2>
            <pre class="json-viewer">{{ jsonViewerContent }}</pre>
            <div class="dialog-actions">
              <button class="btn-secondary" (click)="showJsonViewer = false">Close</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .rls-admin {
      padding: 1.5rem;
    }
    .rls-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }
    .filters {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .filter-group label {
      font-size: 0.875rem;
      color: #64748b;
    }
    .filter-group select,
    .filter-group input {
      padding: 0.5rem;
      border: 1px solid #cbd5e1;
      border-radius: 0.375rem;
    }
    .rls-table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 0.5rem;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .rls-table th,
    .rls-table td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    .rls-table th {
      background: #f8fafc;
      font-weight: 600;
      color: #475569;
    }
    .scope-cell {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      max-width: 300px;
    }
    .scope-preview {
      font-size: 0.75rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
      display: inline-block;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
    .btn-primary {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      cursor: pointer;
    }
    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-secondary {
      background: #e2e8f0;
      color: #475569;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      cursor: pointer;
    }
    .btn-small {
      padding: 0.25rem 0.5rem;
      border-radius: 0.25rem;
      border: none;
      cursor: pointer;
      background: #e2e8f0;
      font-size: 0.75rem;
    }
    .btn-danger {
      background: #ef4444;
      color: white;
    }
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .dialog {
      background: white;
      padding: 1.5rem;
      border-radius: 0.5rem;
      width: 500px;
      max-width: 90vw;
    }
    .dialog-wide {
      width: 800px;
      max-width: 95vw;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    .form-group label {
      display: block;
      margin-bottom: 0.25rem;
      font-weight: 500;
    }
    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #cbd5e1;
      border-radius: 0.375rem;
    }
    .scope-builder-wrapper {
      margin: 0.5rem 0;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1.5rem;
    }
    .empty-state {
      text-align: center;
      color: #94a3b8;
      padding: 2rem;
    }
    .json-viewer {
      background: #1e293b;
      color: #e2e8f0;
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      max-height: 400px;
      overflow-y: auto;
    }
  `]
})
export class RlsAdminComponent implements OnInit {
  rules: RlsRule[] = [];
  groups: Group[] = [];
  selectedGroupId?: number;
  selectedTable = '';
  showDialog = false;
  editingRule: RlsRule | null = null;
  formData: RlsRuleForm = {
    groupId: undefined as any,
    targetTable: '',
    scope: { logicalOperator: 'AND', conditions: [] }
  };
  availableColumns: SchemaColumn[] = [];
  showJsonViewer = false;
  jsonViewerContent = '';

  constructor(
    private rlsService: RlsService,
    private groupService: GroupService
  ) {}

  ngOnInit(): void {
    this.loadGroups();
    this.loadRules();
  }

  loadGroups(): void {
    this.groupService.getGroups({ pageSize: 100 }).subscribe({
      next: (response: any) => {
        this.groups = response.items;
      },
      error: (err: any) => console.error('Failed to load groups:', err)
    });
  }

  loadRules(): void {
    this.rlsService.getRules({
      groupId: this.selectedGroupId,
      targetTable: this.selectedTable || undefined
    }).subscribe({
      next: (rules: RlsRule[]) => {
        this.rules = rules;
      },
      error: (err: any) => console.error('Failed to load rules:', err)
    });
  }

  showCreateDialog(): void {
    this.editingRule = null;
    this.formData = {
      groupId: undefined as any,
      targetTable: '',
      scope: { logicalOperator: 'AND', conditions: [] }
    };
    this.availableColumns = [];
    this.showDialog = true;
  }

  editRule(rule: RlsRule): void {
    this.editingRule = rule;
    const scope = rule.scope || { logicalOperator: 'AND', conditions: [] };
    this.formData = {
      id: rule.id,
      groupId: rule.groupId,
      targetTable: rule.targetTable,
      scope: scope
    };
    this.availableColumns = [];
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingRule = null;
  }

  onTableChange(table: string): void {
    this.formData.targetTable = table;
    if (table) {
      this.rlsService.getTableColumns(table).subscribe({
        next: (columns) => {
          this.availableColumns = columns;
        },
        error: () => {
          this.availableColumns = [
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
    } else {
      this.availableColumns = [];
    }
  }

  onScopeChange(scope: ScopeGroup): void {
    this.formData.scope = scope;
  }

  onTestScope(event: { scope: ScopeGroup; table: string }): void {
    this.rlsService.testScope(event.table, event.scope).subscribe({
      next: (result) => {
        console.log(`Scope test result: ${result.count} rows match`);
      },
      error: (err) => console.error('Scope test failed:', err)
    });
  }

  isFormValid(): boolean {
    const hasConditions = this.formData.scope.conditions.length > 0;
    return !!this.formData.groupId && !!this.formData.targetTable && hasConditions;
  }

  saveRule(): void {
    if (!this.isFormValid()) return;

    const ruleData: Partial<RlsRule> = {
      groupId: this.formData.groupId,
      targetTable: this.formData.targetTable,
      scope: this.formData.scope
    };

    const observable = this.editingRule?.id
      ? this.rlsService.updateRule(this.editingRule.id, ruleData)
      : this.rlsService.createRule(ruleData);

    observable.subscribe({
      next: () => {
        this.closeDialog();
        this.loadRules();
      },
      error: (err: any) => console.error('Failed to save rule:', err)
    });
  }

  deleteRule(rule: RlsRule): void {
    if (!rule.id || !confirm('Are you sure you want to delete this rule?')) return;

    this.rlsService.deleteRule(rule.id).subscribe({
      next: () => this.loadRules(),
      error: (err: any) => console.error('Failed to delete rule:', err)
    });
  }

  truncateScope(scope: any, length: number): string {
    if (!scope) return '';
    const json = JSON.stringify(scope);
    return json.length > length ? json.substring(0, length) + '...' : json;
  }

  viewScopeJson(rule: RlsRule): void {
    this.jsonViewerContent = JSON.stringify(rule.scope, null, 2);
    this.showJsonViewer = true;
  }
}
