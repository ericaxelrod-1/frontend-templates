import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';

@Component({
  selector: 'app-group-selector-sidebar',
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
        <h3>Select Groups</h3>
        <button mat-icon-button (click)="close()" class="close-button">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <mat-divider></mat-divider>

      <div class="sidebar-content">
        <div class="selection-info">
          <p>{{ selectedGroupIds.length }} group(s) selected</p>
        </div>

        <div class="groups-list">
          <div 
            *ngFor="let group of availableGroups" 
            class="group-item"
            [class.selected]="isGroupSelected(group.id)"
          >
            <mat-checkbox 
              [checked]="isGroupSelected(group.id)"
              (change)="toggleGroup(group.id)"
              class="group-checkbox"
            >
              <div class="group-info">
                <div class="group-name">{{ group.name }}</div>
                <div class="group-description" *ngIf="group.description">
                  {{ group.description }}
                </div>
              </div>
            </mat-checkbox>
          </div>
        </div>

        <div class="empty-state" *ngIf="availableGroups.length === 0">
          <mat-icon>group</mat-icon>
          <p>No groups available</p>
        </div>
      </div>

      <mat-divider></mat-divider>

      <div class="sidebar-actions">
        <button mat-button (click)="clearAll()" [disabled]="selectedGroupIds.length === 0">
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

    .groups-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .group-item {
      padding: 12px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .group-item:hover {
      background-color: #f5f5f5;
      border-color: #ccc;
    }

    .group-item.selected {
      background-color: #e8f5e8;
      border-color: #4caf50;
    }

    .group-checkbox {
      width: 100%;
    }

    .group-info {
      margin-left: 8px;
    }

    .group-name {
      font-weight: 500;
      color: #333;
      margin-bottom: 4px;
    }

    .group-description {
      font-size: 12px;
      color: #666;
      line-height: 1.4;
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #666;
    }

    .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
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
export class GroupSelectorSidebarComponent implements OnInit {
  @Input() isOpen = false;
  @Input() selectedGroupIds: number[] = [];
  @Output() groupSelectionChange = new EventEmitter<number[]>();
  @Output() closeSidebar = new EventEmitter<void>();

  availableGroups: Group[] = [];

  constructor(private groupService: GroupService) {}

  ngOnInit(): void {
    this.loadGroups();
  }

  loadGroups(): void {
    this.groupService.getGroups().subscribe({
      next: (groups) => {
        this.availableGroups = groups;
      },
      error: (error) => {
        console.error('Error loading groups:', error);
      }
    });
  }

  isGroupSelected(groupId: number): boolean {
    return this.selectedGroupIds.includes(groupId);
  }

  toggleGroup(groupId: number): void {
    const currentSelection = [...this.selectedGroupIds];
    const index = currentSelection.indexOf(groupId);
    
    if (index > -1) {
      currentSelection.splice(index, 1);
    } else {
      currentSelection.push(groupId);
    }
    
    this.groupSelectionChange.emit(currentSelection);
  }

  clearAll(): void {
    this.groupSelectionChange.emit([]);
  }

  apply(): void {
    this.close();
  }

  close(): void {
    this.closeSidebar.emit();
  }
} 