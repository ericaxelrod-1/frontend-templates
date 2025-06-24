import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { RoleService, Role } from '../../../services/role.service';

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
    <div class="sidebar-backdrop" [class.backdrop-visible]="isOpen" (click)="close()"></div>
    
    <div class="sidebar" [class.sidebar-open]="isOpen">
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
    </div>
  `,
  styles: [`
    .sidebar-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease, visibility 0.3s ease;
    }

    .sidebar-backdrop.backdrop-visible {
      opacity: 1;
      visibility: visible;
    }

    .sidebar {
      position: fixed;
      top: 0;
      right: -400px;
      width: 400px;
      height: 100vh;
      background-color: white;
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
      z-index: 1001;
      display: flex;
      flex-direction: column;
      transition: right 0.3s ease;
    }

    .sidebar.sidebar-open {
      right: 0;
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

    .close-button {
      color: #666;
    }

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

    .role-item:hover {
      background-color: #f5f5f5;
      border-color: #ccc;
    }

    .role-item.selected {
      background-color: #e3f2fd;
      border-color: #2196f3;
    }

    .role-checkbox {
      width: 100%;
    }

    .role-info {
      margin-left: 8px;
    }

    .role-name {
      font-weight: 500;
      color: #333;
      margin-bottom: 4px;
    }

    .role-description {
      font-size: 12px;
      color: #666;
      line-height: 1.4;
    }

    .sidebar-actions {
      padding: 16px 20px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }

    @media (max-width: 768px) {
      .sidebar {
        width: 100vw;
        right: -100vw;
      }
    }
  `]
})
export class RoleSelectorSidebarComponent implements OnInit {
  @Input() isOpen = false;
  @Input() selectedRoleIds: number[] = [];
  @Output() roleSelectionChange = new EventEmitter<number[]>();
  @Output() closeSidebar = new EventEmitter<void>();

  availableRoles: Role[] = [];

  constructor(private roleService: RoleService) {}

  ngOnInit(): void {
    this.loadRoles();
  }

  loadRoles(): void {
    this.roleService.getRoles().subscribe({
      next: (roles) => {
        this.availableRoles = roles;
      },
      error: (error) => {
        console.error('Error loading roles:', error);
      }
    });
  }

  isRoleSelected(roleId: number): boolean {
    return this.selectedRoleIds.includes(roleId);
  }

  toggleRole(roleId: number): void {
    const currentSelection = [...this.selectedRoleIds];
    const index = currentSelection.indexOf(roleId);
    
    if (index > -1) {
      currentSelection.splice(index, 1);
    } else {
      currentSelection.push(roleId);
    }
    
    this.roleSelectionChange.emit(currentSelection);
  }

  clearAll(): void {
    this.roleSelectionChange.emit([]);
  }

  apply(): void {
    this.close();
  }

  close(): void {
    this.closeSidebar.emit();
  }
} 