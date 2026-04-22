import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PermissionInspectorService, PermissionInspection } from '../../../services/permission-inspector.service';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';
import { SidePanelRef } from '../../../shared/components/side-panel';

@Component({
  selector: 'app-permission-inspector',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatListModule,
    MatProgressBarModule
  ],
  template: `
    <div class="inspector-panel">
      <header class="sidebar-header">
        <div class="header-title">
          <h2>Permission Inspector</h2>
          <p class="subtitle">Analyze effective permissions and inheritance</p>
        </div>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <mat-divider></mat-divider>

      <div class="sidebar-body">
        <div class="selection-controls">
          <div class="form-group">
            <label>Select User or Group</label>
            <select [(ngModel)]="selectedId" (change)="onTargetChange()">
              <option [ngValue]="null">Select a target...</option>
              <optgroup label="Groups">
                @for (group of groups; track group.id) {
                  <option [value]="'group:' + group.id">Group: {{ group.name }}</option>
                }
              </optgroup>
            </select>
          </div>
        </div>

        @if (loading) {
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
        }

        @if (inspection) {
          <div class="inspection-results">
            <div class="result-header">
              <h3>Effective Permissions for {{ inspection.user?.email || inspection.role?.name || inspection.group?.name }}</h3>
            </div>

            <div class="permissions-list">
              @for (perm of inspection.effectivePermissions; track perm.permission) {
                <div class="permission-item" [class.granted]="perm.isGranted" [class.denied]="!perm.isGranted">
                  <div class="perm-status">
                    <mat-icon>{{ perm.isGranted ? 'check_circle' : 'cancel' }}</mat-icon>
                  </div>
                  <div class="perm-details">
                    <div class="perm-name">{{ perm.permission }}</div>
                    <div class="perm-source">
                      Source: <strong>{{ perm.inheritedFrom || 'Direct' }}</strong>
                    </div>
                  </div>
                </div>
              } @empty {
                <div class="empty-state">No permissions found for this target.</div>
              }
            </div>
          </div>
        } @else if (!loading && selectedId) {
          <div class="empty-state">Select a valid target to begin inspection.</div>
        }
      </div>
    </div>
  `,
  styles: [`
    .inspector-panel { display: flex; flex-direction: column; height: 100%; background: white; }
    .sidebar-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.5rem; }
    .header-title h2 { margin: 0; font-size: 1.25rem; font-weight: 500; }
    .subtitle { margin: 0.25rem 0 0 0; font-size: 0.875rem; color: #64748b; }
    .sidebar-body { flex: 1; overflow-y: auto; padding: 1.5rem; }
    .selection-controls { margin-bottom: 1.5rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.5rem; }
    .form-group label { font-size: 0.875rem; font-weight: 500; color: #475569; }
    .form-group select { padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 0.375rem; background: white; }
    .inspection-results { margin-top: 1.5rem; }
    .result-header h3 { font-size: 1rem; margin-bottom: 1rem; color: #1e293b; }
    .permissions-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .permission-item { display: flex; gap: 1rem; padding: 0.75rem; border-radius: 0.5rem; border: 1px solid #e2e8f0; }
    .permission-item.granted { border-left: 4px solid #22c55e; background: #f0fdf4; }
    .permission-item.denied { border-left: 4px solid #ef4444; background: #fef2f2; }
    .perm-status mat-icon { font-size: 1.25rem; width: 1.25rem; height: 1.25rem; }
    .granted .perm-status { color: #16a34a; }
    .denied .perm-status { color: #dc2626; }
    .perm-name { font-weight: 600; font-size: 0.875rem; color: #1e293b; }
    .perm-source { font-size: 0.75rem; color: #64748b; margin-top: 0.125rem; }
    .empty-state { text-align: center; padding: 3rem 1rem; color: #94a3b8; }
  `]
})
export class PermissionInspectorComponent implements OnInit {
  groups: Group[] = [];
  selectedId: string | null = null;
  inspection?: PermissionInspection;
  loading = false;

  constructor(
    private groupService: GroupService,
    private inspectorService: PermissionInspectorService,
    private sidePanelRef: SidePanelRef
  ) {}

  ngOnInit(): void {
    this.loadGroups();
  }

  loadGroups(): void {
    this.groupService.getGroups({ pageSize: 100 }).subscribe({
      next: (response: any) => this.groups = response.items,
      error: (err: any) => console.error('Failed to load groups:', err)
    });
  }

  onTargetChange(): void {
    if (!this.selectedId) {
      this.inspection = undefined;
      return;
    }

    const [type, id] = this.selectedId.split(':');
    this.loading = true;
    
    if (type === 'group') {
      this.inspectorService.inspectGroup(parseInt(id, 10)).subscribe({
        next: (result) => {
          this.inspection = result;
          this.loading = false;
        },
        error: (err) => {
          console.error('Inspection failed:', err);
          this.loading = false;
        }
      });
    }
  }

  close(): void {
    this.sidePanelRef.close();
  }
}
