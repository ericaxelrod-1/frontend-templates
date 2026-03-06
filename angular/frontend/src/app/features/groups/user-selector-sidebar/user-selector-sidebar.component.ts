import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { User } from '../../../models/user.model';
import { Group } from '../../../models/group.model';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface UserSelectorPanelData {
  group: Group;
  availableUsers: User[];
}

@Component({
  selector: 'app-user-selector-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <div class="sidebar-header">
      <div class="header-content">
        <h2>Add Member to Group</h2>
        <p class="subtitle" *ngIf="group">Select a user to add to "{{ group.name }}"</p>
      </div>
      <button mat-icon-button (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    
    <mat-divider></mat-divider>
    
    <div class="item-list-container">
      <mat-nav-list>
        <a mat-list-item *ngFor="let user of availableUsers" 
           (click)="selectUser(user)"
           class="selector-item">
          <mat-icon matListItemIcon>person</mat-icon>
          <div matListItemTitle>{{ ((user.firstName || '') + ' ' + (user.lastName || '')).trim() }}</div>
          <div matListItemLine class="item-email">{{ user.email }}</div>
        </a>
      </mat-nav-list>
      
      <div *ngIf="availableUsers.length === 0" class="no-items-message">
        <mat-icon>person_off</mat-icon>
        <p>No available users to add to this group</p>
      </div>
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
      align-items: flex-start;
      padding: 24px;
      background-color: var(--mat-sys-primary, #6750a4);
      color: var(--mat-sys-on-primary, #ffffff);
    }

    .header-content {
      flex: 1;
    }

    .header-content h2 {
      margin: 0 0 8px 0;
      font-size: 1.5rem;
      font-weight: 500;
    }

    .subtitle {
      margin: 0;
      opacity: 0.9;
      font-size: 0.9rem;
    }

    .item-list-container {
      flex: 1;
      overflow-y: auto;
    }

    .selector-item {
      cursor: pointer;
    }

    .item-email {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant, #49454f);
    }

    .no-items-message {
      text-align: center;
      padding: 48px 24px;
      color: var(--mat-sys-on-surface-variant, #49454f);
    }

    .no-items-message mat-icon {
      font-size: 48px;
      height: 48px;
      width: 48px;
      margin-bottom: 16px;
    }

    .no-items-message p {
      margin: 0;
      font-size: 16px;
    }
    
    .close-button {
      color: var(--mat-sys-on-primary, #ffffff);
    }
  `]
})
export class UserSelectorSidebarComponent implements OnInit {
  group: Group;
  availableUsers: User[];

  constructor(
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public panelData: UserSelectorPanelData
  ) {
    this.group = panelData.group;
    this.availableUsers = panelData.availableUsers;
  }

  ngOnInit(): void { }

  selectUser(user: User): void {
    this.sidePanelRef.close({ user, group: this.group });
  }

  close(): void {
    this.sidePanelRef.close();
  }
}