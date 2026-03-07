import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { RoleService, Role } from '../../../services/role.service';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface RoleSelectorPanelData {
  selectedRoleIds: number[];
}

@Component({
  selector: 'app-role-selector-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatDividerModule
  ],
  template: `
    <div class="sidebar-header">
      <h3>Select Roles</h3>
      <button mat-icon-button (click)="close()" class="close-button">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-divider></mat-divider>

    <div class="sidebar-content">
      <div class="selection-info">
        <p>{{ selectedRoleIds.length }} role(s) selected</p>
      </div>

      <div class="roles-list">
        <div 
          *ngFor="let role of availableRoles" 
          class="role-item"
          [class.selected]="role.id && isRoleSelected(role.id)"
        >
          <mat-checkbox 
            [checked]="role.id && isRoleSelected(role.id)"
            (change)="role.id && toggleRole(role.id)"
            class="role-checkbox"
          >
            <div class="role-info">
              <div class="role-name">{{ role.name }}</div>
              <div class="role-description" *ngIf="role.description">
                {{ role.description }}
              </div>
            </div>
          </mat-checkbox>
        </div>
      </div>
    </div>

    <mat-divider></mat-divider>

    <div class="sidebar-actions">
      <button mat-button (click)="clearAll()" [disabled]="selectedRoleIds.length === 0">
        Clear All
      </button>
      <button mat-raised-button color="primary" (click)="apply()">
        Apply Selection
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .sidebar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #e0e0e0;
    }

    .sidebar-header h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
    }

    .close-button { color: #666; }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }

    .selection-info {
      margin-bottom: 16px;
      padding: 12px;
      background-color: #f5f5f5;
      border-radius: 4px;
      font-size: 14px;
      color: #666;
    }

    .roles-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .role-item {
      padding: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .role-item:hover { background-color: #f5f5f5; border-color: #ccc; }
    .role-item.selected { background-color: #e3f2fd; border-color: #2196f3; }

    .role-checkbox { width: 100%; }
    .role-info { margin-left: 8px; }
    .role-name { font-weight: 500; color: #333; margin-bottom: 4px; }
    .role-description { font-size: 12px; color: #666; line-height: 1.4; }

    .sidebar-actions {
      padding: 16px 20px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
  `]
})
export class RoleSelectorSidebarComponent implements OnInit {
  selectedRoleIds: number[] = [];
  availableRoles: Role[] = [];

  constructor(
    private roleService: RoleService,
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public data: RoleSelectorPanelData
  ) {
    this.selectedRoleIds = [...(data.selectedRoleIds || [])];
  }

  ngOnInit(): void {
    this.loadRoles();
  }

  loadRoles(): void {
    this.roleService.getRoles().subscribe({
      next: (response) => { this.availableRoles = response.items; },
      error: (error) => { console.error('Error loading roles:', error); }
    });
  }

  isRoleSelected(roleId: number): boolean {
    return this.selectedRoleIds.includes(roleId);
  }

  toggleRole(roleId: number): void {
    const index = this.selectedRoleIds.indexOf(roleId);
    if (index > -1) {
      this.selectedRoleIds.splice(index, 1);
    } else {
      this.selectedRoleIds.push(roleId);
    }
  }

  clearAll(): void { this.selectedRoleIds = []; }

  apply(): void { this.sidePanelRef.close(this.selectedRoleIds); }

  close(): void { this.sidePanelRef.close(); }
}