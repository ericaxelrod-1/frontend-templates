import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

interface RlsJoinCondition {
  id?: number;
  joinPathId?: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  operator?: string;
}

interface RlsJoinPath {
  id?: number;
  name: string;
  targetTable: string;
  chain: string;
  conditions?: RlsJoinCondition[];
}

@Component({
  selector: 'app-join-paths-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="join-paths">
      <header class="header">
        <h1>RLS Join Paths</h1>
        <button class="btn-primary" (click)="showCreateDialog()">
          + Add Join Path
        </button>
      </header>

      <table class="paths-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Target Table</th>
            <th>Chain</th>
            <th>Conditions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (path of paths; track path.id) {
            <tr>
              <td>{{ path.id }}</td>
              <td>{{ path.name }}</td>
              <td><code>{{ path.targetTable }}</code></td>
              <td>{{ path.chain }}</td>
              <td>
                @for (cond of path.conditions; track cond.id) {
                  <div class="condition-chip">
                    {{ cond.fromTable }}.{{ cond.fromColumn }} {{ cond.operator || '=' }} {{ cond.toTable }}.{{ cond.toColumn }}
                  </div>
                }
              </td>
              <td class="actions">
                <button class="btn-small" (click)="editPath(path)">Edit</button>
                <button class="btn-small btn-danger" (click)="deletePath(path)">Delete</button>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="empty-state">No join paths configured</td>
            </tr>
          }
        </tbody>
      </table>

      @if (showDialog) {
        <div class="dialog-overlay" (click)="closeDialog()">
          <div class="dialog" (click)="$event.stopPropagation()">
            <h2>{{ editingPath ? 'Edit' : 'Create' }} Join Path</h2>
            
            <div class="form-group">
              <label>Name *</label>
              <input type="text" [(ngModel)]="formData.name" required placeholder="e.g., Orders via Users" />
            </div>

            <div class="form-group">
              <label>Target Table *</label>
              <input type="text" [(ngModel)]="formData.targetTable" required placeholder="e.g., orders" />
            </div>

            <div class="form-group">
              <label>Join Chain *</label>
              <input type="text" [(ngModel)]="formData.chain" required 
                     placeholder="e.g., groups,users,orders (comma-separated)" />
              <small>Tables in order of joins</small>
            </div>

            <div class="form-group">
              <label>Join Conditions</label>
              @for (cond of formData.conditions || []; track $index; let i = $index) {
                <div class="condition-row">
                  <input type="text" [(ngModel)]="cond.fromTable" placeholder="From table" />
                  <input type="text" [(ngModel)]="cond.fromColumn" placeholder="From column" />
                  <select [(ngModel)]="cond.operator">
                    <option value="=">=</option>
                    <option value="!=">!=</option>
                    <option value=">">></option>
                    <option value="<"><</option>
                  </select>
                  <input type="text" [(ngModel)]="cond.toTable" placeholder="To table" />
                  <input type="text" [(ngModel)]="cond.toColumn" placeholder="To column" />
                  <button class="btn-icon" (click)="removeCondition(i)">×</button>
                </div>
              }
              <button class="btn-small" (click)="addCondition()">+ Add Condition</button>
            </div>

            <div class="dialog-actions">
              <button class="btn-secondary" (click)="closeDialog()">Cancel</button>
              <button class="btn-primary" (click)="savePath()" [disabled]="!isFormValid()">
                {{ editingPath ? 'Update' : 'Create' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .join-paths { padding: 1.5rem; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .paths-table { width: 100%; border-collapse: collapse; background: white; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .paths-table th, .paths-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .paths-table th { background: #f8fafc; font-weight: 600; color: #475569; }
    .condition-chip { background: #f1f5f9; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; margin: 0.125rem 0; }
    .actions { display: flex; gap: 0.5rem; }
    .btn-primary { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.375rem; cursor: pointer; }
    .btn-secondary { background: #e2e8f0; color: #475569; border: none; padding: 0.5rem 1rem; border-radius: 0.375rem; cursor: pointer; }
    .btn-small { padding: 0.25rem 0.5rem; border-radius: 0.25rem; border: none; cursor: pointer; background: #e2e8f0; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-icon { background: transparent; border: none; cursor: pointer; font-size: 1.25rem; color: #ef4444; }
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .dialog { background: white; padding: 1.5rem; border-radius: 0.5rem; width: 600px; max-width: 90vw; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input, .form-group select { width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.375rem; }
    .form-group small { color: #64748b; font-size: 0.75rem; }
    .condition-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
    .condition-row input { flex: 1; }
    .condition-row select { width: 60px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; }
    .empty-state { text-align: center; color: #94a3b8; padding: 2rem; }
  `]
})
export class JoinPathsAdminComponent implements OnInit {
  paths: RlsJoinPath[] = [];
  showDialog = false;
  editingPath?: RlsJoinPath;
  formData: Partial<RlsJoinPath> & { conditions?: RlsJoinCondition[] } = {};

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadPaths();
  }

  loadPaths(): void {
    this.http.get<RlsJoinPath[]>(`${environment.apiUrl}/rls/join-paths`).subscribe({
      next: (paths) => this.paths = paths,
      error: (err) => console.error('Failed to load join paths:', err)
    });
  }

  showCreateDialog(): void {
    this.editingPath = undefined;
    this.formData = { name: '', targetTable: '', chain: '', conditions: [] };
    this.showDialog = true;
  }

  editPath(path: RlsJoinPath): void {
    this.editingPath = path;
    this.formData = {
      name: path.name,
      targetTable: path.targetTable,
      chain: path.chain,
      conditions: [...(path.conditions || [])]
    };
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingPath = undefined;
  }

  addCondition(): void {
    if (!this.formData.conditions) {
      this.formData.conditions = [];
    }
    this.formData.conditions.push({ fromTable: '', fromColumn: '', toTable: '', toColumn: '', operator: '=' });
  }

  removeCondition(index: number): void {
    this.formData.conditions?.splice(index, 1);
  }

  isFormValid(): boolean {
    return !!(this.formData.name && this.formData.targetTable && this.formData.chain);
  }

  savePath(): void {
    if (!this.isFormValid()) return;

    const observable = this.editingPath?.id
      ? this.http.put(`${environment.apiUrl}/rls/join-paths/${this.editingPath.id}`, this.formData)
      : this.http.post(`${environment.apiUrl}/rls/join-paths`, this.formData);

    observable.subscribe({
      next: () => { this.closeDialog(); this.loadPaths(); },
      error: (err) => console.error('Failed to save join path:', err)
    });
  }

  deletePath(path: RlsJoinPath): void {
    if (!path.id || !confirm('Delete this join path?')) return;
    this.http.delete(`${environment.apiUrl}/rls/join-paths/${path.id}`).subscribe({
      next: () => this.loadPaths(),
      error: (err) => console.error('Failed to delete join path:', err)
    });
  }
}
