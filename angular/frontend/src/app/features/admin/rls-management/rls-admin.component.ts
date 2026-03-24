import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RlsService, RlsRule, SchemaColumn } from '../../../services/rls.service';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';
import { ScopeBuilderComponent, ScopeGroup } from '../../../components/scope-builder/scope-builder.component';
import { SidePanelService } from '../../../shared/components/side-panel';
import { PermissionInspectorComponent } from './permission-inspector.component';

export interface RlsRuleForm {
  id?: number;
  groupId: number;
  targetTable: string;
  scope: ScopeGroup;
}

@Component({
  selector: 'app-rls-editor-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, ScopeBuilderComponent],
  template: `
    <h2 mat-dialog-title>{{ data.editingRule ? 'Edit Rule' : 'Create RLS Rule' }}</h2>
    <mat-dialog-content>
      <div class="form-container">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Group</mat-label>
          <mat-select [(ngModel)]="formData.groupId" required>
            @for (group of data.groups; track group.id) {
              <mat-option [value]="group.id">{{ group.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Target Table</mat-label>
          <mat-select [(ngModel)]="formData.targetTable" (selectionChange)="onTableChange($event.value)" required>
            @for (table of data.tables; track table.name) {
              <mat-option [value]="table.name">{{ table.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="scope-section">
          <h3>Scope Definition</h3>
          <app-scope-builder 
            [group]="formData.scope" 
            [columns]="availableColumns"
            [targetTable]="formData.targetTable || ''"
            [depth]="0"
            (scopeChange)="onScopeChange($event)"
          ></app-scope-builder>
          <p class="hint">Build conditions using the interface above. No raw SQL allowed.</p>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!isFormValid()">
        {{ data.editingRule ? 'Save Changes' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form-container { display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem; min-width: 600px; }
    .full-width { width: 100%; }
    .scope-section h3 { margin: 1rem 0 0.25rem 0; font-size: 1rem; font-weight: 500; }
    .hint { font-size: 0.75rem; color: #64748b; margin-top: 0.5rem; }
  `]
})
export class RlsEditorDialogComponent implements OnInit {
  formData: RlsRuleForm;
  availableColumns: SchemaColumn[] = [];

  constructor(
    public dialogRef: MatDialogRef<RlsEditorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { 
      groups: Group[], 
      tables: { name: string }[], 
      editingRule: RlsRule | null 
    },
    private rlsService: RlsService
  ) {
    if (data.editingRule) {
      this.formData = {
        id: data.editingRule.id,
        groupId: data.editingRule.groupId,
        targetTable: data.editingRule.targetTable,
        scope: JSON.parse(JSON.stringify(data.editingRule.scope))
      };
    } else {
      this.formData = {
        groupId: 0,
        targetTable: '',
        scope: { logicalOperator: 'AND', conditions: [] }
      };
    }
  }

  ngOnInit(): void {
    if (this.formData.targetTable) {
      this.onTableChange(this.formData.targetTable);
    }
  }

  onTableChange(table: string): void {
    if (table) {
      this.rlsService.getTableColumns(table).subscribe({
        next: (columns) => this.availableColumns = columns,
        error: () => this.availableColumns = []
      });
    }
  }

  onScopeChange(scope: ScopeGroup): void {
    this.formData.scope = scope;
  }

  isFormValid(): boolean {
    return !!this.formData.groupId && !!this.formData.targetTable && this.formData.scope.conditions.length > 0;
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.isFormValid()) {
      this.dialogRef.close(this.formData);
    }
  }
}

@Component({
  selector: 'app-rls-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="rls-admin">
      <header class="rls-header">
        <h1>Row-Level Security Rules</h1>
        <div class="header-actions">
          <button mat-stroked-button (click)="showPermissionInspector()">
            <mat-icon>security</mat-icon> Inspect Permissions
          </button>
          <button class="btn-primary" (click)="showCreateDialog()">
            + Add Rule
          </button>
        </div>
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
    .rls-admin { padding: 1.5rem; }
    .rls-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .header-actions { display: flex; gap: 1rem; align-items: center; }
    .filters { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .filter-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .filter-group label { font-size: 0.875rem; color: #64748b; }
    .filter-group select, .filter-group input { padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.375rem; }
    .rls-table { width: 100%; border-collapse: collapse; background: white; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .rls-table th, .rls-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .rls-table th { background: #f8fafc; font-weight: 600; color: #475569; }
    .scope-cell { display: flex; align-items: center; gap: 0.5rem; max-width: 300px; }
    .scope-preview { font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; display: inline-block; }
    .actions { display: flex; gap: 0.5rem; }
    .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.375rem; cursor: pointer; }
    .btn-small { padding: 0.25rem 0.5rem; border-radius: 0.25rem; border: none; cursor: pointer; background: #e2e8f0; font-size: 0.75rem; }
    .btn-danger { background: #ef4444; color: white; }
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1200; }
    .dialog { background: white; padding: 1.5rem; border-radius: 0.5rem; width: 500px; max-width: 90vw; }
    .dialog-wide { width: 800px; max-width: 95vw; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; }
    .empty-state { text-align: center; color: #94a3b8; padding: 2rem; }
    .json-viewer { background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; max-height: 400px; overflow-y: auto; }
  `]
})
export class RlsAdminComponent implements OnInit {
  rules: RlsRule[] = [];
  groups: Group[] = [];
  tables: { name: string }[] = [];
  selectedGroupId?: number;
  selectedTable = '';
  showJsonViewer = false;
  jsonViewerContent = '';

  constructor(
    private rlsService: RlsService,
    private groupService: GroupService,
    private dialog: MatDialog,
    private sidePanelService: SidePanelService
  ) {}

  ngOnInit(): void {
    this.loadGroups();
    this.loadTables();
    this.loadRules();
  }

  loadGroups(): void {
    this.groupService.getGroups({ pageSize: 100 }).subscribe({
      next: (response: any) => this.groups = response.items,
      error: (err: any) => console.error('Failed to load groups:', err)
    });
  }

  loadTables(): void {
    this.rlsService.getTables().subscribe({
      next: (tables) => this.tables = tables,
      error: (err) => console.error('Failed to load tables:', err)
    });
  }

  loadRules(): void {
    this.rlsService.getRules({
      groupId: this.selectedGroupId,
      targetTable: this.selectedTable || undefined
    }).subscribe({
      next: (rules: RlsRule[]) => this.rules = rules,
      error: (err: any) => console.error('Failed to load rules:', err)
    });
  }

  showCreateDialog(): void {
    this.openEditor(null);
  }

  editRule(rule: RlsRule): void {
    this.openEditor(rule);
  }

  showPermissionInspector(): void {
    this.sidePanelService.open(PermissionInspectorComponent, {
      width: '500px'
    });
  }

  private openEditor(rule: RlsRule | null): void {
    const dialogRef = this.dialog.open(RlsEditorDialogComponent, {
      data: {
        groups: this.groups,
        tables: this.tables,
        editingRule: rule
      },
      width: '800px'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.saveRule(result);
      }
    });
  }

  saveRule(formData: RlsRuleForm): void {
    const ruleData: Partial<RlsRule> = {
      groupId: formData.groupId,
      targetTable: formData.targetTable,
      scope: formData.scope
    };

    const observable = formData.id
      ? this.rlsService.updateRule(formData.id, ruleData)
      : this.rlsService.createRule(ruleData);

    observable.subscribe({
      next: () => this.loadRules(),
      error: (err: any) => console.error('Failed to save rule:', err)
    });
  }

  deleteRule(rule: RlsRule): void {
    if (!rule.id || !confirm('Are you sure you want to delete this rule?')) return;
    this.rlsService.deleteRule(rule.id).subscribe({
      next: () => this.loadRules(),
      error: (err) => console.error('Failed to delete rule:', err)
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
