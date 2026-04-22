import { Component, OnInit, Inject, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { A11yModule } from '@angular/cdk/a11y';
import { take } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { RlsService } from '../../../services/rls.service';
import { JoinPathDiagramComponent, DiagramJoinCondition, DiagramOutput, DiagramTableNode, DiagramColumn } from '../../../components/join-path-diagram/join-path-diagram.component';

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

interface ExistingPath {
  id: number;
  name: string;
}

@Component({
  selector: 'app-join-path-editor-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatIconModule, MatSnackBarModule, A11yModule, JoinPathDiagramComponent],
  template: `
    <div class="dialog-container">
      <div class="dialog-header-compact">
        <h2 class="dialog-title">{{ data.editingPath ? 'Edit' : 'Create' }} Join Path</h2>
        
        <div class="header-form">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Path Name</mat-label>
            <input matInput [(ngModel)]="formData.name" required placeholder="e.g., Orders via Users" cdkFocusInitial />
          </mat-form-field>
          
          <div class="target-info" *ngIf="formData.targetTable">
            <span class="label">Target:</span>
            <code class="value">{{ formData.targetTable }}</code>
          </div>
        </div>

        <div class="header-actions">
          <button mat-button (click)="onCancel()">Cancel</button>
          <button mat-raised-button color="primary" (click)="onSave()" [disabled]="!isFormValid()">
            <mat-icon>save</mat-icon> {{ data.editingPath ? 'Save Changes' : 'Create Path' }}
          </button>
        </div>
      </div>
      
      <mat-dialog-content>
        <div class="diagram-section">
          <app-join-path-diagram #diagramComponent
            *ngIf="diagramReady"
            [targetTable]="formData.targetTable || ''"
            [initialConditions]="diagramConditions"
            [initialTables]="initialDiagramTables"
            [availableTablesFromParent]="data.tables"
            [existingPaths]="data.existingPaths"
            (conditionsChange)="onDiagramConditionsChange($event)"
            (diagramChange)="onDiagramChange($event)"
            (targetTableChange)="onTargetTableChange($event)"
            (pathSelected)="onPathSelected($event)"
            (addJoin)="onAddJoin($event)"
          ></app-join-path-diagram>
        </div>
      </mat-dialog-content>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; width: 100%; }
    .dialog-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--mat-sys-surface); flex: 1; }
    .dialog-header-compact { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1.5rem; background: var(--mat-sys-surface-container); border-bottom: 1px solid var(--mat-sys-outline-variant); gap: 2rem; flex-shrink: 0; }
    .dialog-title { font-size: var(--fluid-text-base); font-weight: 600; margin: 0; color: var(--mat-sys-on-surface); white-space: nowrap; }
    .header-form { flex: 1; display: flex; align-items: center; gap: 1.5rem; }
    .header-form mat-form-field { width: 300px; }
    .target-info { display: flex; align-items: center; gap: 0.5rem; font-size: var(--fluid-text-xs); color: var(--mat-sys-on-surface-variant); }
    .target-info .value { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .header-actions { display: flex; gap: 0.5rem; }
    .diagram-section { flex: 1 1 100%; display: flex; flex-direction: column; min-height: 0; overflow: hidden; height: 100%; }
    mat-dialog-content { flex: 1 1 100% !important; padding: 0 !important; margin: 0 !important; overflow: hidden !important; min-height: 0 !important; display: flex !important; flex-direction: column !important; height: 100% !important; max-height: 100vh !important; }
  `]
})
export class JoinPathEditorDialogComponent implements OnInit {
  @ViewChild('diagramComponent') diagramComponent: any;
  
  diagramReady = false;
  formData: Partial<RlsJoinPath> & { conditions?: RlsJoinCondition[] };
  diagramConditions: DiagramJoinCondition[] = [];
  private _formValid = false;
  initialDiagramTables: DiagramTableNode[] = [];
  pendingJoins: RlsJoinCondition[] = [];

  constructor(
    public dialogRef: MatDialogRef<JoinPathEditorDialogComponent>,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) public data: { 
      tables: { name: string; columns: DiagramColumn[] }[], 
      editingPath: RlsJoinPath | null,
      existingPaths: ExistingPath[]
    }
  ) {
    console.log('[JoinPathEditor] CONSTRUCTOR - data.editingPath:', JSON.stringify(data.editingPath, null, 2));
    console.log('[JoinPathEditor] CONSTRUCTOR - data.tables:', data.tables?.map(t => t.name));
    
    if (data.editingPath) {
      // Parse chain - it comes as JSON string from backend
      let chain: string[] = [];
      if (Array.isArray(data.editingPath.chain)) {
        chain = [...data.editingPath.chain];
      } else if (typeof data.editingPath.chain === 'string') {
        try {
          chain = JSON.parse(data.editingPath.chain);
        } catch (e) {
          console.error('[JoinPathEditor] Failed to parse chain:', e);
          chain = [];
        }
      }
      
      console.log('[JoinPathEditor] CONSTRUCTOR - parsed chain:', chain);
      console.log('[JoinPathEditor] CONSTRUCTOR - raw targetTable:', data.editingPath.targetTable, 'type:', typeof data.editingPath.targetTable);
      console.log('[JoinPathEditor] CONSTRUCTOR - raw conditions:', JSON.stringify(data.editingPath.conditions));
      
      // Determine targetTable - use explicit value or derive from last table in chain
      const targetTable = data.editingPath.targetTable || (chain.length > 0 ? chain[chain.length - 1] : '');
      
      // Deduplicate conditions by fromTable+fromColumn+toTable+toColumn
      const rawConditions = data.editingPath.conditions || [];
      const uniqueConditions = rawConditions.filter((c: RlsJoinCondition, idx: number, arr: RlsJoinCondition[]) => {
        const key = `${c.fromTable}.${c.fromColumn}.${c.toTable}.${c.toColumn}`;
        return arr.findIndex((x: RlsJoinCondition) => 
          `${x.fromTable}.${x.fromColumn}.${x.toTable}.${x.toColumn}` === key
        ) === idx;
      });
      
      console.log('[JoinPathEditor] CONSTRUCTOR - unique conditions:', uniqueConditions.length, 'vs original:', rawConditions.length);
        
      this.formData = {
        name: data.editingPath.name,
        targetTable: targetTable,
        chain: chain,
        conditions: uniqueConditions
      };
      
      console.log('[JoinPathEditor] CONSTRUCTOR - formData after set:', JSON.stringify(this.formData));
      
      this.diagramConditions = uniqueConditions.map((c: RlsJoinCondition, i: number) => ({
        id: `c_${i}`,
        fromTable: c.fromTable,
        fromColumn: c.fromColumn,
        toTable: c.toTable,
        toColumn: c.toColumn,
        operator: c.operator || '='
      }));
      
      console.log('[JoinPathEditor] CONSTRUCTOR - diagramConditions:', JSON.stringify(this.diagramConditions));
      
      // Initialize nodes based on chain - use table name as ID for proper edge mapping
      this.initialDiagramTables = chain.map((tableName: string, i: number) => {
        const tableMeta = data.tables.find((t: { name: string; columns: DiagramColumn[] }) => t.name === tableName);
        console.log('[JoinPathEditor] CONSTRUCTOR - looking for table:', tableName, 'found:', !!tableMeta);
        return {
          id: tableName, // Use table name as ID directly
          data: {
            tableName,
            columns: tableMeta?.columns || []
          },
          position: { x: 100 + (i * 300), y: 150 }
        };
      });
      
      console.log('[JoinPathEditor] CONSTRUCTOR - initialDiagramTables:', JSON.stringify(this.initialDiagramTables.map(t => ({ id: t.id, tableName: t.data.tableName }))));
    } else {
      this.formData = { name: '', targetTable: '', chain: [], conditions: [] };
    }
  }

  ngOnInit(): void {
    console.log('[JoinPathEditor] ngOnInit - formData.targetTable:', this.formData.targetTable);
    console.log('[JoinPathEditor] ngOnInit - diagramConditions count:', this.diagramConditions.length);
    console.log('[JoinPathEditor] ngOnInit - initialDiagramTables count:', this.initialDiagramTables.length);
    console.log('[JoinPathEditor] ngOnInit - initialDiagramTables:', JSON.stringify(this.initialDiagramTables.map(t => ({ id: t.id, tableName: t.data.tableName }))));
    this.dialogRef.afterOpened()
      .pipe(take(1))
      .subscribe(() => {
        // Wait for dialog animation to complete before rendering the diagram
        setTimeout(() => {
          this.diagramReady = true;
          console.log('[JoinPathEditor] diagramReady=true, formData.targetTable:', this.formData.targetTable);
        }, 200);
      });
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
    this.formData.chain = Array.from(new Set(output.tables.map(t => t.data.tableName)));
  }

  onTargetTableChange(table: string): void {
    this.formData.targetTable = table;
    this._formValid = !!(this.formData.name && this.formData.targetTable);
    this.cdr.detectChanges();
  }

  onPathSelected(pathId: number): void {
    const path = this.data.existingPaths?.find(p => p.id === pathId);
    if (path) {
      this.dialogRef.close({ switchToPath: path });
    }
  }

  onAddJoin(joinData: { conditions: DiagramJoinCondition[], chain: string[], targetTable: string }): void {
    console.log('[JoinPathEditor] onAddJoin called - saving locally, keeping dialog open');
    
    // Convert diagram conditions to RlsJoinCondition format and add to pending
    const newConditions: RlsJoinCondition[] = joinData.conditions.map(c => ({
      fromTable: c.fromTable,
      fromColumn: c.fromColumn,
      toTable: c.toTable,
      toColumn: c.toColumn,
      operator: c.operator
    }));
    
    this.pendingJoins.push(...newConditions);
    
    // Update formData.chain with all chains (existing + new)
    const newChain = joinData.chain || [];
    const existingChain = this.formData.chain as string[] || [];
    this.formData.chain = [...new Set([...existingChain, ...newChain])];
    
    // Don't clear the diagram - keep showing all joins on canvas
    // Just save the data locally
    
    this.snackBar.open('Join added. Total: ' + this.pendingJoins.length, 'Close', { duration: 2000 });
    
    console.log('[JoinPathEditor] pendingJoins count:', this.pendingJoins.length);
    this.cdr.detectChanges();
  }

  isFormValid(): boolean {
    // Enable Create Path if: name entered AND (targetTable set OR pendingJoins exist)
    this._formValid = !!(this.formData.name && (this.formData.targetTable || this.pendingJoins.length > 0));
    console.log('[JoinPathEditor] isFormValid called, result:', this._formValid, 'name:', !!this.formData.name, 'targetTable:', !!this.formData.targetTable, 'pendingJoins:', this.pendingJoins.length);
    return this._formValid;
  }

  onCancel(): void {
    console.log('[JoinPathEditor] onCancel called - closing dialog without data');
    this.pendingJoins = [];
    this.dialogRef.close();
  }

  onSave(): void {
    console.log('[JoinPathEditor] onSave called, formData:', JSON.stringify(this.formData));
    if (this.isFormValid()) {
      // Use diagram's current conditions as source of truth (formData.conditions)
      // pendingJoins are already reflected in the diagram, so don't duplicate
      const saveData = {
        ...this.formData,
        conditions: this.formData.conditions || []
      };
      
      // Clear pending joins after save
      this.pendingJoins = [];
      
      console.log('[JoinPathEditor] onSave - conditions from diagram:', saveData.conditions.length);
      this.dialogRef.close(saveData);
    }
  }
}

@Component({
  selector: 'app-join-paths-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, A11yModule],
  template: `
    <div class="join-paths">
      <header class="header">
        <h1>RLS Join Paths</h1>
        <button #addPathButton mat-raised-button color="primary" type="button" (click)="showCreateDialog()">
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
                  <div class="chip-row">
                    @for (cond of path.conditions; track cond.id) {
                      <div class="condition-chip">
                        {{ cond.fromTable }}.{{ cond.fromColumn }} {{ cond.operator || '=' }} {{ cond.toTable }}.{{ cond.toColumn }}
                      </div>
                    }
                  </div>
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
    .chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
    .condition-chip { background: var(--mat-sys-surface-container-highest); padding: 2px 8px; border-radius: 4px; font-size: 11px; color: var(--mat-sys-on-surface-variant); }
    .actions { display: flex; gap: 4px; }
    
    .empty-state { text-align: center; color: var(--mat-sys-on-surface-variant); padding: 4rem 2rem; }
    .empty-state mat-icon { font-size: 3rem; width: 3rem; height: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  `]
})
export class JoinPathsAdminComponent implements OnInit {
  paths: RlsJoinPath[] = [];
  tables: { name: string; columns: DiagramColumn[] }[] = [];
  @ViewChild('addPathButton', { read: ElementRef }) addPathButton!: ElementRef<HTMLButtonElement>;

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
      error: (err: unknown) => console.error('Failed to load join paths:', err)
    });
  }

  loadTables(): void {
    this.http.get<{ items: { name: string; columns: DiagramColumn[] }[], total: number }>(`${environment.apiUrl}/schema/tables`).subscribe({
      next: (response: { items: { name: string; columns: DiagramColumn[] }[], total: number }) => {
        this.tables = response.items;
      },
      error: (err: unknown) => console.error('Failed to load tables:', err)
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
    const existingPaths: ExistingPath[] = this.paths.map(p => ({ id: p.id!, name: p.name }));
    const dialogRef = this.dialog.open(JoinPathEditorDialogComponent, {
      data: {
        tables: this.tables,
        editingPath: path,
        existingPaths
      },
      panelClass: 'fullscreen-dialog',
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      autoFocus: false,
      restoreFocus: true
    });

    dialogRef.afterClosed().pipe(take(1)).subscribe(result => {
      console.log('[JoinPathEditor] Dialog closed, result:', result);
      if (result?.switchToPath) {
        console.log('[JoinPathEditor] Switching to path:', result.switchToPath.id);
        this.editPath(this.paths.find(p => p.id === result.switchToPath.id)!);
      } else if (result?.createNew) {
        console.log('[JoinPathEditor] Creating new path');
        this.showCreateDialog();
      } else if (result) {
        console.log('[JoinPathEditor] Saving path, id:', path?.id);
        this.savePath(result, path?.id);
      } else {
        console.log('[JoinPathEditor] Dialog closed with no result');
      }
    });
  }

  savePath(formData: RlsJoinPath, id?: number): void {
    console.log('[JoinPathAdmin] savePath called, id:', id, 'formData:', JSON.stringify(formData));
    const observable = id
      ? this.http.put(`${environment.apiUrl}/rls/join-paths/${id}`, formData)
      : this.http.post(`${environment.apiUrl}/rls/join-paths`, formData);

    observable.pipe(take(1)).subscribe({
      next: () => {
        console.log('[JoinPathAdmin] savePath successful');
        this.loadPaths();
      },
      error: (err: unknown) => console.error('[JoinPathAdmin] Failed to save join path:', err)
    });
  }

  deletePath(path: RlsJoinPath): void {
    console.log('[JoinPathAdmin] deletePath called, id:', path.id);
    if (!path.id || !confirm('Delete this join path?')) return;
    this.http.delete(`${environment.apiUrl}/rls/join-paths/${path.id}`).subscribe({
      next: () => {
        console.log('[JoinPathAdmin] deletePath successful');
        this.loadPaths();
      },
      error: (err: unknown) => console.error('[JoinPathAdmin] Failed to delete join path:', err)
    });
  }
}
