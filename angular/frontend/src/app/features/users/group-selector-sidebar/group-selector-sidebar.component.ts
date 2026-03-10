import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { GroupService } from '../../../services/group.service';
import { Group } from '../../../models/group.model';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface GroupSelectorPanelData {
  selectedGroupIds: number[];
}

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
  `]
})
export class GroupSelectorSidebarComponent implements OnInit {
  selectedGroupIds: number[] = [];
  availableGroups: Group[] = [];

  constructor(
    private groupService: GroupService,
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public data: GroupSelectorPanelData
  ) {
    this.selectedGroupIds = [...(data.selectedGroupIds || [])];
  }

  ngOnInit(): void {
    this.loadGroups();
  }

  loadGroups(): void {
    this.groupService.getGroups().subscribe({
      next: (response) => {
        this.availableGroups = response.items;
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
    const index = this.selectedGroupIds.indexOf(groupId);
    if (index > -1) {
      this.selectedGroupIds.splice(index, 1);
    } else {
      this.selectedGroupIds.push(groupId);
    }
  }

  clearAll(): void {
    this.selectedGroupIds = [];
  }

  apply(): void {
    this.sidePanelRef.close(this.selectedGroupIds);
  }

  close(): void {
    this.sidePanelRef.close();
  }
}