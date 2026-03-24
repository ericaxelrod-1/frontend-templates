import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { RlsService, RlsRule, SchemaColumn } from '../../../services/rls.service';
import { Group } from '../../../models/group.model';
import { ScopeBuilderComponent, ScopeGroup } from '../../../components/scope-builder/scope-builder.component';

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
    .scope-section h3 { margin: 1rem 0 0.5rem 0; font-size: 1rem; font-weight: 500; color: var(--mat-sys-on-surface); }
    .hint { font-size: var(--fluid-text-xs); color: var(--mat-sys-on-surface-variant); margin-top: 0.5rem; }
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
