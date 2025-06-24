import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Group } from '../../../models/group.model';
import { User } from '../../../models/user.model';

export interface GroupSelectorData {
  user: User;
  availableGroups: Group[];
}

@Component({
  selector: 'app-group-selector-sheet',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatButtonModule
  ],
  template: `
    <div class="group-selector-container">
      <div class="sheet-header">
        <h2>Add {{ user.firstName || user.email }} to Group</h2>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <div class="group-list-container">
        <mat-selection-list #groupList [multiple]="false">
          <mat-list-option *ngFor="let group of availableGroups" 
                          [value]="group"
                          (click)="selectGroup(group)">
            <mat-icon matListItemIcon>group</mat-icon>
            <div matListItemTitle>{{ group.name }}</div>
            <div matListItemLine *ngIf="group.description">{{ group.description }}</div>
          </mat-list-option>
        </mat-selection-list>
        
        <div *ngIf="availableGroups.length === 0" class="no-groups-message">
          <mat-icon>info</mat-icon>
          <p>No available groups for this user</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .group-selector-container {
      max-height: 60vh;
      display: flex;
      flex-direction: column;
    }
    
    .sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 16px 8px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      
      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
      }
    }
    
    .group-list-container {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      
      mat-selection-list {
        padding: 0;
      }
      
      mat-list-option {
        cursor: pointer;
        
        &:hover {
          background-color: rgba(0, 0, 0, 0.04);
        }
      }
    }
    
    .no-groups-message {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      color: rgba(0, 0, 0, 0.54);
      
      mat-icon {
        font-size: 48px;
        height: 48px;
        width: 48px;
        margin-bottom: 16px;
      }
      
      p {
        margin: 0;
        font-size: 16px;
      }
    }
  `]
})
export class GroupSelectorSheetComponent {
  user: User;
  availableGroups: Group[];
  
  constructor(
    private bottomSheetRef: MatBottomSheetRef<GroupSelectorSheetComponent>,
    @Inject(MAT_BOTTOM_SHEET_DATA) public data: GroupSelectorData
  ) {
    this.user = data.user;
    this.availableGroups = data.availableGroups;
  }
  
  selectGroup(group: Group): void {
    this.bottomSheetRef.dismiss(group);
  }
  
  close(): void {
    this.bottomSheetRef.dismiss();
  }
}
