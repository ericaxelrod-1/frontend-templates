import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

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
              <input type="text" [(ngModel)]="formData.targetTable" required placeholder="e.g., users" />
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
              <p class="hint">Comma-separated list of columns that can be used for filtering</p>
              <input type="text" [(ngModel)]="columnsInput" required 
                     placeholder="e.g., department, region, status" />
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
  `]
})
export class ScopeTemplatesAdminComponent implements OnInit {
  templates: RlsScopeTemplate[] = [];
  joinPaths: RlsJoinPath[] = [];
  showDialog = false;
  editingTemplate?: RlsScopeTemplate;
  formData: Partial<RlsScopeTemplate> = {};
  columnsInput = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadTemplates();
    this.loadJoinPaths();
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

  parseColumns(columns: string | string[]): string[] {
    if (Array.isArray(columns)) return columns;
    try {
      return JSON.parse(columns);
    } catch {
      return columns.split(',').map((c: string) => c.trim());
    }
  }

  showCreateDialog(): void {
    this.editingTemplate = undefined;
    this.formData = { name: '', targetTable: '', joinPathId: undefined as any };
    this.columnsInput = '';
    this.showDialog = true;
  }

  editTemplate(template: RlsScopeTemplate): void {
    this.editingTemplate = template;
    this.formData = {
      name: template.name,
      targetTable: template.targetTable,
      joinPathId: template.joinPathId
    };
    this.columnsInput = this.parseColumns(template.availableColumns).join(', ');
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingTemplate = undefined;
  }

  isFormValid(): boolean {
    return !!(this.formData.name && this.formData.targetTable && this.formData.joinPathId && this.columnsInput);
  }

  saveTemplate(): void {
    if (!this.isFormValid()) return;

    const data = {
      ...this.formData,
      availableColumns: this.columnsInput.split(',').map((c: string) => c.trim())
    };

    const observable = this.editingTemplate?.id
      ? this.http.put(`${environment.apiUrl}/rls/scope-templates/${this.editingTemplate.id}`, data)
      : this.http.post(`${environment.apiUrl}/rls/scope-templates`, data);

    observable.subscribe({
      next: () => { this.closeDialog(); this.loadTemplates(); },
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
