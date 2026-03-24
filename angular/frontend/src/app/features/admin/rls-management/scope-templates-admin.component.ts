import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  selector: 'app-scope-templates-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="scope-templates">
      <header class="header">
        <h1>RLS Scope Templates</h1>
        <button class="btn-primary" (click)="showCreateDialog()">
          + Add Template
        </button>
      </header>

      <p class="description">
        Scope templates define reusable data filters that can be applied to multiple groups.
      </p>

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
              <td>{{ template.name }}</td>
              <td><code>{{ template.targetTable }}</code></td>
              <td>{{ template.joinPath?.name || 'N/A' }}</td>
              <td>
                @for (col of parseColumns(template.availableColumns); track col) {
                  <span class="column-chip">{{ col }}</span>
                }
              </td>
              <td class="actions">
                <button class="btn-small" (click)="editTemplate(template)">Edit</button>
                <button class="btn-small btn-danger" (click)="deleteTemplate(template)">Delete</button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="empty-state">No scope templates configured</td>
            </tr>
          }
        </tbody>
      </table>

      @if (showDialog) {
        <div class="dialog-overlay" (click)="closeDialog()">
          <div class="dialog" (click)="$event.stopPropagation()">
            <h2>{{ editingTemplate ? 'Edit' : 'Create' }} Scope Template</h2>
            
            <div class="form-group">
              <label>Name *</label>
              <input type="text" [(ngModel)]="formData.name" required placeholder="e.g., Department Filter" />
            </div>

            <div class="form-group">
              <label>Target Table *</label>
              <select [(ngModel)]="formData.targetTable" (change)="onTableChange(formData.targetTable || '')" required>
                <option value="">Select a table</option>
                @for (table of tables; track table.name) {
                  <option [value]="table.name">{{ table.name }}</option>
                }
              </select>
            </div>

            <div class="form-group">
              <label>Join Path *</label>
              <select [(ngModel)]="formData.joinPathId" required>
                <option value="">Select a join path...</option>
                @for (path of joinPaths; track path.id) {
                  <option [value]="path.id">{{ path.name }} ({{ path.targetTable }})</option>
                }
              </select>
            </div>

            <div class="form-group">
              <label>Available Columns *</label>
              <p class="hint">Select columns that can be used for filtering</p>
              <div class="columns-grid">
                @for (col of availableDbColumns; track col) {
                  <label class="checkbox-label">
                    <input type="checkbox" [checked]="selectedColumns.includes(col)" (change)="toggleColumn(col)" />
                    {{ col }}
                  </label>
                } @empty {
                  <p class="empty-hint">Select a target table to see available columns</p>
                }
              </div>
            </div>

            <div class="dialog-actions">
              <button class="btn-secondary" (click)="closeDialog()">Cancel</button>
              <button class="btn-primary" (click)="saveTemplate()" [disabled]="!isFormValid()">
                {{ editingTemplate ? 'Update' : 'Create' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .scope-templates { padding: 1.5rem; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .description { color: #64748b; margin-bottom: 1rem; font-size: 0.875rem; }
    .templates-table { width: 100%; border-collapse: collapse; background: white; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .templates-table th, .templates-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .templates-table th { background: #f8fafc; font-weight: 600; color: #475569; }
    .column-chip { display: inline-block; background: #f1f5f9; padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; margin: 0.125rem; }
    .actions { display: flex; gap: 0.5rem; }
    .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.375rem; cursor: pointer; }
    .btn-secondary { background: #e2e8f0; color: #475569; border: none; padding: 0.5rem 1rem; border-radius: 0.375rem; cursor: pointer; }
    .btn-small { padding: 0.25rem 0.5rem; border-radius: 0.25rem; border: none; cursor: pointer; background: #e2e8f0; }
    .btn-danger { background: #ef4444; color: white; }
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .dialog { background: white; padding: 1.5rem; border-radius: 0.5rem; width: 500px; max-width: 90vw; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input, .form-group select { width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.375rem; }
    .hint { color: #64748b; font-size: 0.75rem; margin: 0.25rem 0; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; }
    .empty-state { text-align: center; color: #94a3b8; padding: 2rem; }
    .columns-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; max-height: 200px; overflow-y: auto; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 0.375rem; }
    .checkbox-label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer; }
    .empty-hint { color: #94a3b8; font-size: 0.875rem; font-style: italic; }
  `]
})
export class ScopeTemplatesAdminComponent implements OnInit {
  templates: RlsScopeTemplate[] = [];
  joinPaths: RlsJoinPath[] = [];
  tables: { name: string }[] = [];
  availableDbColumns: string[] = [];
  showDialog = false;
  editingTemplate?: RlsScopeTemplate;
  formData: Partial<RlsScopeTemplate> = {};
  selectedColumns: string[] = [];

  constructor(private http: HttpClient, private rlsService: RlsService) {}

  ngOnInit(): void {
    this.loadTemplates();
    this.loadJoinPaths();
    this.loadTables();
  }

  loadTemplates(): void {
    this.http.get<RlsScopeTemplate[]>(`${environment.apiUrl}/rls/scope-templates`).subscribe({
      next: (templates: RlsScopeTemplate[]) => this.templates = templates,
      error: (err: any) => console.error('Failed to load templates:', err)
    });
  }

  loadJoinPaths(): void {
    this.http.get<RlsJoinPath[]>(`${environment.apiUrl}/rls/join-paths`).subscribe({
      next: (paths: RlsJoinPath[]) => this.joinPaths = paths,
      error: (err: any) => console.error('Failed to load join paths:', err)
    });
  }

  loadTables(): void {
    this.rlsService.getTables().subscribe({
      next: (tables: { name: string }[]) => this.tables = tables,
      error: (err: any) => console.error('Failed to load tables:', err)
    });
  }

  onTableChange(table: string): void {
    if (table) {
      this.rlsService.getTableColumns(table).subscribe({
        next: (columns: SchemaColumn[]) => {
          this.availableDbColumns = columns.map(c => c.name);
        },
        error: (err: any) => {
          console.error('Failed to load columns:', err);
          this.availableDbColumns = [];
        }
      });
    } else {
      this.availableDbColumns = [];
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

  showCreateDialog(): void {
    this.editingTemplate = undefined;
    this.formData = { name: '', targetTable: '', joinPathId: undefined as any };
    this.selectedColumns = [];
    this.availableDbColumns = [];
    this.showDialog = true;
  }

  editTemplate(template: RlsScopeTemplate): void {
    this.editingTemplate = template;
    this.formData = {
      name: template.name,
      targetTable: template.targetTable,
      joinPathId: template.joinPathId
    };
    this.selectedColumns = this.parseColumns(template.availableColumns);
    if (template.targetTable) {
      this.onTableChange(template.targetTable);
    }
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingTemplate = undefined;
  }

  isFormValid(): boolean {
    return !!(this.formData.name && this.formData.targetTable && this.formData.joinPathId && this.selectedColumns.length > 0);
  }

  saveTemplate(): void {
    if (!this.isFormValid()) return;

    const data = {
      ...this.formData,
      availableColumns: this.selectedColumns
    };

    const observable = this.editingTemplate?.id
      ? this.http.put(`${environment.apiUrl}/rls/scope-templates/${this.editingTemplate.id}`, data)
      : this.http.post(`${environment.apiUrl}/rls/scope-templates`, data);

    observable.subscribe({
      next: () => { this.closeDialog(); this.loadTemplates(); },
      error: (err: any) => console.error('Failed to save template:', err)
    });
  }

  deleteTemplate(template: RlsScopeTemplate): void {
    if (!template.id || !confirm('Delete this template?')) return;
    this.http.delete(`${environment.apiUrl}/rls/scope-templates/${template.id}`).subscribe({
      next: () => this.loadTemplates(),
      error: (err: any) => console.error('Failed to delete template:', err)
    });
  }
}
