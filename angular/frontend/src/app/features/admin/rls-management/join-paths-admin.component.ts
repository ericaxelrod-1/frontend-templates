import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { RlsService, SchemaColumn } from '../../../services/rls.service';
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
  selector: 'app-join-path-editor-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatInputModule, JoinPathDiagramComponent],
  template: `
    <div class="dialog-container">
      <h2 mat-dialog-title>{{ data.editingPath ? 'Edit' : 'Create' }} Join Path</h2>
      
      <mat-dialog-content>
        <div class="form-row">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="formData.name" required placeholder="e.g., Orders via Users" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Target Table</mat-label>
            <mat-select [(ngModel)]="formData.targetTable" required>
              @for (table of data.tables; track table.name) {
                <mat-option [value]="table.name">{{ table.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <div class="diagram-section">
          <label class="section-label">Visual Join Builder</label>
          <p class="hint">Connect tables to define the join path. The target table must be the end of the chain.</p>
          <app-join-path-diagram 
            [targetTable]="formData.targetTable || ''"
            [initialConditions]="diagramConditions"
            (conditionsChange)="onDiagramConditionsChange($event)"
            (diagramChange)="onDiagramChange($event)"
          ></app-join-path-diagram>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()">Cancel</button>
        <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!isFormValid()">
          {{ data.editingPath ? 'Save Changes' : 'Create Path' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container { display: flex; flex-direction: column; height: 100%; }
    .form-row { display: flex; gap: var(--mat-sys-spacing-md); margin-top: 0.5rem; }
    .flex-1 { flex: 1; }
    .diagram-section { flex: 1; display: flex; flex-direction: column; min-height: 500px; margin-top: 1rem; }
    .section-label { font-weight: 600; margin-bottom: 0.25rem; display: block; color: var(--mat-sys-on-surface); font-size: var(--fluid-text-sm); }
    .hint { color: var(--mat-sys-on-surface-variant); font-size: var(--fluid-text-xs); margin-bottom: 1rem; }
    mat-dialog-content { flex: 1; overflow-y: auto; }
  `]
})
export class JoinPathEditorDialogComponent {
  formData: Partial<RlsJoinPath> & { conditions?: RlsJoinCondition[] };
  diagramConditions: any[] = [];

  constructor(
    public dialogRef: MatDialogRef<JoinPathEditorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { 
      tables: { name: string }[], 
      editingPath: RlsJoinPath | null 
    }
  ) {
    if (data.editingPath) {
      const chain = Array.isArray(data.editingPath.chain) 
        ? [...data.editingPath.chain] 
        : (data.editingPath.chain as string).split(',').map(s => s.trim());
        
      this.formData = {
        name: data.editingPath.name,
        targetTable: data.editingPath.targetTable,
        chain: chain,
        conditions: [...(data.editingPath.conditions || [])]
      };
      this.diagramConditions = (data.editingPath.conditions || []).map((c, i) => ({
        id: `c_${i}`,
        fromTable: c.fromTable,
        fromColumn: c.fromColumn,
        toTable: c.toTable,
        toColumn: c.toColumn,
        operator: c.operator || '='
      }));
    } else {
      this.formData = { name: '', targetTable: '', chain: [], conditions: [] };
    }
  }

  onDiagramConditionsChange(conditions: any[]): void {
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
  selector: 'app-join-paths-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="join-paths">
      <header class="header">
        <h1>RLS Join Paths</h1>
        <button mat-raised-button color="primary" (click)="showCreateDialog()">
          <mat-icon>add</mat-icon> Add Join Path
        </button>
      </header>

      <div class="table-container">
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
                <td class="name-cell">{{ path.name }}</td>
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
                  <button mat-icon-button color="primary" (click)="editPath(path)" title="Edit">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button color="warn" (click)="deletePath(path)" title="Delete">
                    <mat-icon>delete</mat-icon>
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty-state">
                  <mat-icon>link_off</mat-icon>
                  <p>No join paths configured</p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .join-paths { padding: var(--fluid-spacing-md); }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--fluid-spacing-md); }
    .header h1 { margin: 0; font-size: var(--fluid-text-lg); font-weight: 600; color: var(--mat-sys-on-surface); }
    
    .table-container { background: var(--mat-sys-surface); border-radius: 8px; border: 1px solid var(--mat-sys-outline-variant); overflow: hidden; box-shadow: var(--mat-sys-shadow); }
    .paths-table { width: 100%; border-collapse: collapse; }
    .paths-table th, .paths-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--mat-sys-outline-variant); font-size: var(--fluid-text-sm); }
    .paths-table th { background: var(--mat-sys-surface-container-high); font-weight: 600; color: var(--mat-sys-on-surface); }
    
    .name-cell { font-weight: 500; color: var(--mat-sys-primary); }
    .condition-chip { background: var(--mat-sys-surface-container-highest); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 11px; margin: 2px 0; color: var(--mat-sys-on-surface-variant); display: inline-block; }
    .actions { display: flex; gap: 4px; }
    
    .empty-state { text-align: center; color: var(--mat-sys-on-surface-variant); padding: 4rem 2rem; }
    .empty-state mat-icon { font-size: 3rem; width: 3rem; height: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  `]
})
export class JoinPathsAdminComponent implements OnInit {
  paths: RlsJoinPath[] = [];
  tables: { name: string }[] = [];

  constructor(
    private http: HttpClient, 
    private rlsService: RlsService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.loadPaths();
    this.loadTables();
  }

  loadPaths(): void {
    this.http.get<RlsJoinPath[]>(`${environment.apiUrl}/rls/join-paths`).subscribe({
      next: (paths: RlsJoinPath[]) => this.paths = paths,
      error: (err: any) => console.error('Failed to load join paths:', err)
    });
  }

  loadTables(): void {
    this.rlsService.getTables().subscribe({
      next: (tables: { name: string }[]) => {
        this.tables = tables;
      },
      error: (err: any) => console.error('Failed to load tables:', err)
    });
  }

  formatChain(chain: string | string[]): string {
    return Array.isArray(chain) ? chain.join(' → ') : chain;
  }

  showCreateDialog(): void {
    this.openEditor(null);
  }

  editPath(path: RlsJoinPath): void {
    this.openEditor(path);
  }

  private openEditor(path: RlsJoinPath | null): void {
    const dialogRef = this.dialog.open(JoinPathEditorDialogComponent, {
      data: {
        tables: this.tables,
        editingPath: path
      },
      width: '1200px',
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.savePath(result, path?.id);
      }
    });
  }

  savePath(formData: any, id?: number): void {
    const observable = id
      ? this.http.put(`${environment.apiUrl}/rls/join-paths/${id}`, formData)
      : this.http.post(`${environment.apiUrl}/rls/join-paths`, formData);

    observable.subscribe({
      next: () => this.loadPaths(),
      error: (err: any) => console.error('Failed to save join path:', err)
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
