import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RlsService, RlsRule } from '../../../services/rls.service';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';
import { SidePanelService } from '../../../shared/components/side-panel';
import { PermissionInspectorComponent } from './permission-inspector.component';
import { RlsEditorDialogComponent, RlsRuleForm } from './rls-editor-dialog.component';

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
          <button mat-raised-button color="primary" (click)="showCreateDialog()">
            <mat-icon>add</mat-icon> Add Rule
          </button>
        </div>
      </header>

      <div class="filters">
        <div class="filter-group">
          <label>Filter by Group</label>
          <select [(ngModel)]="selectedGroupId" (change)="loadRules()">
            <option [ngValue]="undefined">All Groups</option>
            @for (group of groups; track group.id) {
              <option [value]="group.id">{{ group.name }}</option>
            }
          </select>
        </div>
        <div class="filter-group">
          <label>Filter by Table</label>
          <input 
            type="text" 
            [(ngModel)]="selectedTable" 
            (input)="loadRules()"
            placeholder="e.g. users, orders..."
          />
        </div>
      </div>

      <div class="table-container">
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
                <td class="group-cell">
                  <mat-icon class="cell-icon">group</mat-icon>
                  {{ rule.group?.name || rule.groupId }}
                </td>
                <td><code>{{ rule.targetTable }}</code></td>
                <td class="scope-cell">
                  <code class="scope-preview">{{ truncateScope(rule.scope, 60) }}</code>
                  <button mat-icon-button (click)="viewScopeJson(rule)" title="View JSON">
                    <mat-icon>visibility</mat-icon>
                  </button>
                </td>
                <td class="actions">
                  <button mat-icon-button color="primary" (click)="editRule(rule)" title="Edit">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button color="warn" (click)="deleteRule(rule)" title="Delete">
                    <mat-icon>delete</mat-icon>
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="empty-state">
                  <mat-icon>shield_off</mat-icon>
                  <p>No RLS rules configured</p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- Scope JSON Viewer Overlay (Internal Modal) -->
      @if (showJsonViewer) {
        <div class="dialog-overlay" (click)="showJsonViewer = false">
          <div class="json-dialog" (click)="$event.stopPropagation()">
            <div class="dialog-header">
              <h2>Scope Definition JSON</h2>
              <button mat-icon-button (click)="showJsonViewer = false">
                <mat-icon>close</mat-icon>
              </button>
            </div>
            <pre class="json-viewer">{{ jsonViewerContent }}</pre>
            <div class="dialog-actions">
              <button mat-button (click)="showJsonViewer = false">Close</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .rls-admin { padding: var(--fluid-spacing-md); }
    .rls-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--fluid-spacing-md); border-bottom: 1px solid var(--mat-sys-outline-variant); padding-bottom: 1rem; }
    .rls-header h1 { font-size: var(--fluid-text-lg); font-weight: 600; color: var(--mat-sys-on-surface); margin: 0; }
    .header-actions { display: flex; gap: var(--mat-sys-spacing-sm); align-items: center; }
    
    .filters { display: flex; gap: var(--mat-sys-spacing-md); margin-bottom: var(--fluid-spacing-md); background: var(--mat-sys-surface-container-low); padding: 1rem; border-radius: 8px; }
    .filter-group { display: flex; flex-direction: column; gap: 4px; }
    .filter-group label { font-size: var(--fluid-text-xs); color: var(--mat-sys-on-surface-variant); font-weight: 600; text-transform: uppercase; }
    .filter-group select, .filter-group input { padding: 0.5rem; border: 1px solid var(--mat-sys-outline); border-radius: 4px; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); font-size: var(--fluid-text-sm); }
    
    .table-container { background: var(--mat-sys-surface); border-radius: 8px; border: 1px solid var(--mat-sys-outline-variant); overflow: hidden; box-shadow: var(--mat-sys-shadow); }
    .rls-table { width: 100%; border-collapse: collapse; }
    .rls-table th, .rls-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--mat-sys-outline-variant); font-size: var(--fluid-text-sm); }
    .rls-table th { background: var(--mat-sys-surface-container-high); font-weight: 600; color: var(--mat-sys-on-surface); }
    .group-cell { display: flex; align-items: center; gap: 8px; }
    .cell-icon { font-size: 1.25rem; width: 1.25rem; height: 1.25rem; color: var(--mat-sys-primary); }
    .scope-cell { display: flex; align-items: center; gap: 8px; }
    .scope-preview { font-size: 11px; background: var(--mat-sys-surface-container-highest); padding: 4px 8px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px; color: var(--mat-sys-on-surface-variant); }
    .actions { display: flex; gap: 4px; }
    
    .empty-state { text-align: center; padding: 4rem 2rem; color: var(--mat-sys-on-surface-variant); }
    .empty-state mat-icon { font-size: 3rem; width: 3rem; height: 3rem; margin-bottom: 1rem; opacity: 0.5; }
    
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .json-dialog { background: var(--mat-sys-surface); padding: 1.5rem; border-radius: 12px; width: 800px; max-width: 95vw; box-shadow: var(--mat-sys-shadow); }
    .dialog-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .dialog-header h2 { font-size: 1.25rem; margin: 0; color: var(--mat-sys-on-surface); }
    .json-viewer { background: #1e293b; color: #a5f3fc; padding: 1rem; border-radius: 8px; overflow-x: auto; max-height: 500px; font-family: monospace; font-size: 12px; line-height: 1.5; }
    .dialog-actions { display: flex; justify-content: flex-end; margin-top: 1rem; }
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
      width: '850px',
      maxWidth: '95vw'
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
