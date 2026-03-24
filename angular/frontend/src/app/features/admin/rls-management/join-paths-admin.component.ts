import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { RlsService } from '../../../services/rls.service';
import { JoinPathDiagramComponent, DiagramJoinCondition, DiagramOutput } from '../../../components/join-path-diagram/join-path-diagram.component';

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
  chain: string | string[];
  conditions?: RlsJoinCondition[];
}

@Component({
  selector: 'app-join-paths-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, JoinPathDiagramComponent],
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
              <td>{{ formatChain(path.chain) }}</td>
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
          <div class="dialog dialog-full" (click)="$event.stopPropagation()">
            <div class="dialog-header">
              <h2>{{ editingPath ? 'Edit' : 'Create' }} Join Path</h2>
              <div class="header-actions">
                <button class="btn-secondary" (click)="closeDialog()">Cancel</button>
                <button class="btn-primary" (click)="savePath()" [disabled]="!isFormValid()">
                  {{ editingPath ? 'Save Changes' : 'Create Path' }}
                </button>
              </div>
            </div>
            
            <div class="dialog-content">
              <div class="form-row">
                <div class="form-group">
                  <label>Name *</label>
                  <input type="text" [(ngModel)]="formData.name" required placeholder="e.g., Orders via Users" />
                </div>

                <div class="form-group">
                  <label>Target Table *</label>
                  <select [(ngModel)]="formData.targetTable" required>
                    <option value="">Select a table</option>
                    @for (table of tables; track table.name) {
                      <option [value]="table.name">{{ table.name }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="diagram-section">
                <label>Visual Join Builder</label>
                <p class="hint">Connect tables to define the join path. The target table must be the end of the chain.</p>
                <app-join-path-diagram 
                  [targetTable]="formData.targetTable || ''"
                  [initialConditions]="diagramConditions"
                  (conditionsChange)="onDiagramConditionsChange($event)"
                  (diagramChange)="onDiagramChange($event)"
                ></app-join-path-diagram>
              </div>
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
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .dialog-full { background: white; padding: 1.5rem; border-radius: 0.5rem; width: 1200px; height: 90vh; max-width: 95vw; display: flex; flex-direction: column; }
    .dialog-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #e2e8f0; }
    .header-actions { display: flex; gap: 0.5rem; }
    .dialog-content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
    .form-row { display: flex; gap: 1.5rem; }
    .form-group { margin-bottom: 1rem; flex: 1; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input, .form-group select { width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.375rem; }
    .hint { color: #64748b; font-size: 0.75rem; margin: -0.25rem 0 1rem 0; }
    .diagram-section { flex: 1; display: flex; flex-direction: column; min-height: 500px; }
    .diagram-section label { font-weight: 500; margin-bottom: 0.5rem; display: block; }
    .empty-state { text-align: center; color: #94a3b8; padding: 2rem; }
  `]
})
export class JoinPathsAdminComponent implements OnInit {
  paths: RlsJoinPath[] = [];
  tables: { name: string }[] = [];
  showDialog = false;
  editingPath?: RlsJoinPath;
  formData: Partial<RlsJoinPath> & { conditions?: RlsJoinCondition[] } = {};
  diagramConditions: DiagramJoinCondition[] = [];

  constructor(private http: HttpClient, private rlsService: RlsService) {}

  ngOnInit(): void {
    this.loadPaths();
    this.loadTables();
  }

  loadPaths(): void {
    this.http.get<RlsJoinPath[]>(`${environment.apiUrl}/rls/join-paths`).subscribe({
      next: (paths) => this.paths = paths,
      error: (err) => console.error('Failed to load join paths:', err)
    });
  }

  loadTables(): void {
    this.rlsService.getTables().subscribe({
      next: (tables) => {
        this.tables = tables;
      },
      error: (err) => console.error('Failed to load tables:', err)
    });
  }

  formatChain(chain: string | string[]): string {
    return Array.isArray(chain) ? chain.join(', ') : chain;
  }

  showCreateDialog(): void {
    this.editingPath = undefined;
    this.formData = { name: '', targetTable: '', chain: [], conditions: [] };
    this.diagramConditions = [];
    this.showDialog = true;
  }

  editPath(path: RlsJoinPath): void {
    this.editingPath = path;
    const chain = Array.isArray(path.chain) ? path.chain : (path.chain as string).split(',').map(s => s.trim());
    this.formData = {
      name: path.name,
      targetTable: path.targetTable,
      chain: chain,
      conditions: [...(path.conditions || [])]
    };
    this.diagramConditions = (path.conditions || []).map((c, i) => ({
      id: `c_${i}`,
      fromTable: c.fromTable,
      fromColumn: c.fromColumn,
      toTable: c.toTable,
      toColumn: c.toColumn,
      operator: c.operator || '='
    }));
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingPath = undefined;
  }

  onDiagramConditionsChange(conditions: DiagramJoinCondition[]): void {
    this.formData.conditions = conditions.map(c => ({
      fromTable: c.fromTable,
      fromColumn: c.fromColumn,
      toTable: c.toTable,
      toColumn: c.toColumn,
      operator: c.operator
    }));
  }

  onDiagramChange(output: DiagramOutput): void {
    this.formData.chain = Array.from(new Set(output.tables.map(t => t.tableName)));
  }

  isFormValid(): boolean {
    return !!(this.formData.name && this.formData.targetTable && 
             Array.isArray(this.formData.chain) && this.formData.chain.length > 0 &&
             this.formData.conditions && this.formData.conditions.length > 0);
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
