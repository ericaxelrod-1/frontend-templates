import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { RlsService, SchemaColumn } from '../../../services/rls.service';

interface RlsJoinPath {
  id?: number;
  name: string;
  targetTable: string;
}

interface RlsScopeTemplate {
  id?: number;
  name: string;
  joinPathId: number;
  joinPath?: RlsJoinPath;
  targetTable: string;
  availableColumns: string[];
}

@Component({
  selector: 'app-scope-template-editor-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>{{ data.editingTemplate ? 'Edit Template' : 'Create Scope Template' }}</h2>
    <mat-dialog-content>
      <div class="form-container">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="formData.name" required placeholder="e.g., Department Filter" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Target Table</mat-label>
          <mat-select [(ngModel)]="formData.targetTable" (selectionChange)="onTableChange($event.value)" required>
            @for (table of data.tables; track table.name) {
              <mat-option [value]="table.name">{{ table.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Join Path</mat-label>
          <mat-select [(ngModel)]="formData.joinPathId" required>
            @for (path of data.joinPaths; track path.id) {
              <mat-option [value]="path.id">{{ path.name }} ({{ path.targetTable }})</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="columns-section">
          <h3>Available Columns</h3>
          <p class="hint">Select columns that can be used for filtering</p>
          <div class="columns-grid">
            @for (col of availableDbColumns; track col) {
              <mat-checkbox 
                [checked]="selectedColumns.includes(col)" 
                (change)="toggleColumn(col)"
                class="column-checkbox"
              >
                {{ col }}
              </mat-checkbox>
            } @empty {
              <p class="empty-hint">Select a target table to see available columns</p>
            }
          </div>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!isFormValid()">
        {{ data.editingTemplate ? 'Save Changes' : 'Create' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form-container { display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem; min-width: 500px; }
    .full-width { width: 100%; }
    .columns-section h3 { margin: 1rem 0 0.25rem 0; font-size: 1rem; font-weight: 600; color: var(--mat-sys-on-surface); }
    .hint { font-size: var(--fluid-text-xs); color: var(--mat-sys-on-surface-variant); margin-bottom: 0.75rem; }
    .columns-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; max-height: 200px; overflow-y: auto; padding: 0.5rem; border: 1px solid var(--mat-sys-outline-variant); border-radius: 8px; }
    .column-checkbox { font-size: var(--fluid-text-sm); }
    .empty-hint { color: var(--mat-sys-on-surface-variant); font-size: var(--fluid-text-sm); font-style: italic; opacity: 0.7; }
  `]
})
export class ScopeTemplateEditorDialogComponent implements OnInit {
  formData: Partial<RlsScopeTemplate>;
  availableDbColumns: string[] = [];
  selectedColumns: string[] = [];

  constructor(
    public dialogRef: MatDialogRef<ScopeTemplateEditorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { 
      tables: { name: string }[], 
      joinPaths: RlsJoinPath[],
      editingTemplate: RlsScopeTemplate | null 
    },
    private rlsService: RlsService
  ) {
    if (data.editingTemplate) {
      this.formData = {
        name: data.editingTemplate.name,
        targetTable: data.editingTemplate.targetTable,
        joinPathId: data.editingTemplate.joinPathId
      };
      this.selectedColumns = this.parseColumns(data.editingTemplate.availableColumns);
    } else {
      this.formData = { name: '', targetTable: '', joinPathId: 0 };
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
        next: (columns) => this.availableDbColumns = columns.map(c => c.name),
        error: () => this.availableDbColumns = []
      });
    }
  }

  toggleColumn(column: string): void {
    const index = this.selectedColumns.indexOf(column);
    if (index === -1) {
      this.selectedColumns.push(column);
    } else {
      this.selectedColumns.splice(index, 1);
    }
  }

  parseColumns(columns: string | string[]): string[] {
    if (Array.isArray(columns)) return columns;
    try {
      return JSON.parse(columns);
    } catch {
      return columns ? columns.split(',').map((c: string) => c.trim()) : [];
    }
  }

  isFormValid(): boolean {
    return !!(this.formData.name && this.formData.targetTable && this.formData.joinPathId && this.selectedColumns.length > 0);
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.isFormValid()) {
      this.dialogRef.close({ ...this.formData, availableColumns: this.selectedColumns });
    }
  }
}

@Component({
  selector: 'app-scope-templates-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="scope-templates">
      <header class="header">
        <h1>RLS Scope Templates</h1>
        <button mat-raised-button color="primary" (click)="showCreateDialog()">
          <mat-icon>add</mat-icon> Add Template
        </button>
      </header>

      <p class="description">
        Scope templates define reusable data filters that can be applied to multiple groups.
      </p>

      <div class="table-container">
        <table class="templates-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Target Table</th>
              <th>Join Path</th>
              <th>Available Columns</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (template of templates; track template.id) {
              <tr>
                <td>{{ template.id }}</td>
                <td class="name-cell">{{ template.name }}</td>
                <td><code>{{ template.targetTable }}</code></td>
                <td>{{ template.joinPath?.name || 'N/A' }}</td>
                <td>
                  <div class="chip-container">
                    @for (col of parseColumns(template.availableColumns); track col) {
                      <span class="column-chip">{{ col }}</span>
                    }
                  </div>
                </td>
                <td class="actions">
                  <button mat-icon-button color="primary" (click)="editTemplate(template)" title="Edit">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button color="warn" (click)="deleteTemplate(template)" title="Delete">
                    <mat-icon>delete</mat-icon>
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty-state">
                  <mat-icon>description_off</mat-icon>
                  <p>No scope templates configured</p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .scope-templates { padding: var(--fluid-spacing-md); }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .header h1 { margin: 0; font-size: var(--fluid-text-lg); font-weight: 600; color: var(--mat-sys-on-surface); }
    .description { color: var(--mat-sys-on-surface-variant); margin-bottom: var(--fluid-spacing-md); font-size: var(--fluid-text-sm); }
    
    .table-container { background: var(--mat-sys-surface); border-radius: 8px; border: 1px solid var(--mat-sys-outline-variant); overflow: hidden; box-shadow: var(--mat-sys-shadow); }
    .templates-table { width: 100%; border-collapse: collapse; }
    .templates-table th, .templates-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--mat-sys-outline-variant); font-size: var(--fluid-text-sm); }
    .templates-table th { background: var(--mat-sys-surface-container-high); font-weight: 600; color: var(--mat-sys-on-surface); }
    
    .name-cell { font-weight: 500; color: var(--mat-sys-primary); }
    .chip-container { display: flex; flex-wrap: wrap; gap: 4px; }
    .column-chip { background: var(--mat-sys-surface-container-highest); padding: 2px 8px; border-radius: 4px; font-size: 11px; color: var(--mat-sys-on-surface-variant); }
    .actions { display: flex; gap: 4px; }
    
    .empty-state { text-align: center; color: var(--mat-sys-on-surface-variant); padding: 4rem 2rem; }
    .empty-state mat-icon { font-size: 3rem; width: 3rem; height: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  `]
})
export class ScopeTemplatesAdminComponent implements OnInit {
  templates: RlsScopeTemplate[] = [];
  joinPaths: RlsJoinPath[] = [];
  tables: { name: string }[] = [];

  constructor(
    private http: HttpClient, 
    private rlsService: RlsService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadTemplates();
    this.loadJoinPaths();
    this.loadTables();
  }

  loadTemplates(): void {
    this.http.get<RlsScopeTemplate[]>(`${environment.apiUrl}/rls/scope-templates`).subscribe({
      next: (templates) => this.templates = templates,
      error: (err) => console.error('Failed to load templates:', err)
    });
  }

  loadJoinPaths(): void {
    this.http.get<RlsJoinPath[]>(`${environment.apiUrl}/rls/join-paths`).subscribe({
      next: (paths) => this.joinPaths = paths,
      error: (err) => console.error('Failed to load join paths:', err)
    });
  }

  loadTables(): void {
    this.rlsService.getTables().subscribe({
      next: (response) => this.tables = response.items,
      error: (err) => console.error('Failed to load tables:', err)
    });
  }

  parseColumns(columns: string | string[]): string[] {
    if (Array.isArray(columns)) return columns;
    try {
      return JSON.parse(columns);
    } catch {
      return columns ? columns.split(',').map((c: string) => c.trim()) : [];
    }
  }

  showCreateDialog(): void {
    this.openEditor(null);
  }

  editTemplate(template: RlsScopeTemplate): void {
    this.openEditor(template);
  }

  private openEditor(template: RlsScopeTemplate | null): void {
    const dialogRef = this.dialog.open(ScopeTemplateEditorDialogComponent, {
      data: {
        tables: this.tables,
        joinPaths: this.joinPaths,
        editingTemplate: template
      },
      width: '600px',
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.saveTemplate(result, template?.id);
      }
    });
  }

  saveTemplate(formData: any, id?: number): void {
    const observable = id
      ? this.http.put(`${environment.apiUrl}/rls/scope-templates/${id}`, formData)
      : this.http.post(`${environment.apiUrl}/rls/scope-templates`, formData);

    observable.subscribe({
      next: () => { this.loadTemplates(); },
      error: (err) => console.error('Failed to save template:', err)
    });
  }

  deleteTemplate(template: RlsScopeTemplate): void {
    if (!template.id || !confirm('Delete this template?')) return;
    this.http.delete(`${environment.apiUrl}/rls/scope-templates/${template.id}`).subscribe({
      next: () => this.loadTemplates(),
      error: (err) => console.error('Failed to delete template:', err)
    });
  }
}
