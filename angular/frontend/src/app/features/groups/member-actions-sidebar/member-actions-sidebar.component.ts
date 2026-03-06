import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { Group } from '../../../models/group.model';
import { User } from '../../../models/user.model';
import { SidePanelRef, SIDE_PANEL_DATA } from '../../../shared/components/side-panel';

export interface MemberAction {
  id: string;
  label: string;
  icon: string;
  color?: 'primary' | 'accent' | 'warn';
  description?: string;
}

export interface MemberActionsPanelData {
  member: User;
  group: Group;
}

@Component({
  selector: 'app-member-actions-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatDividerModule
  ],
  template: `
    <div class="sidebar-content">
      <!-- Header -->
      <div class="sidebar-header">
        <div class="header-content">
          <h2>Member Actions</h2>
          <p *ngIf="member">{{ (member.firstName || '') + ' ' + (member.lastName || '') || member.email }}</p>
          <p *ngIf="group" class="group-name">{{ group.name }}</p>
        </div>
        <button mat-icon-button (click)="onCloseSidebar()" class="close-button">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <mat-divider></mat-divider>
      
      <!-- Member Info -->
      <div class="member-info" *ngIf="member">
        <div class="member-details">
          <mat-icon class="member-icon">person</mat-icon>
          <div class="member-text">
            <div class="member-name">{{ (member.firstName || '') + ' ' + (member.lastName || '') || member.email }}</div>
            <div class="member-role">{{ member.roles?.[0]?.name || 'Member' }}</div>
          </div>
        </div>
      </div>
      
      <mat-divider></mat-divider>
      
      <!-- Actions List -->
      <div class="actions-section">
        <h3>Available Actions</h3>
        <mat-list class="actions-list">
          <mat-list-item 
            *ngFor="let action of availableActions" 
            (click)="onActionSelected(action)"
            class="action-item"
            [class.action-warn]="action.color === 'warn'">
            <mat-icon matListItemIcon [color]="action.color">{{ action.icon }}</mat-icon>
            <div matListItemTitle>{{ action.label }}</div>
            <div matListItemLine *ngIf="action.description">{{ action.description }}</div>
          </mat-list-item>
        </mat-list>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    
    .sidebar-content {
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
      
      .header-content {
        flex: 1;
        
        h2 {
          margin: 0 0 8px 0;
          font-size: 1.5rem;
          font-weight: 500;
        }
        
        p {
          margin: 0;
          opacity: 0.9;
          font-size: 0.9rem;
        }
        
        .group-name {
          font-size: 0.8rem;
          opacity: 0.7;
        }
      }
      
      .close-button {
        color: var(--mat-sys-on-primary, #ffffff);
        margin-left: 16px;
      }
    }
    
    .member-info {
      padding: 20px 24px;
      
      .member-details {
        display: flex;
        align-items: center;
        gap: 16px;
        
        .member-icon {
          font-size: 2rem;
          width: 2rem;
          height: 2rem;
          color: var(--mat-sys-primary, #6750a4);
        }
        
        .member-text {
          flex: 1;
          
          .member-name {
            font-size: 1.1rem;
            font-weight: 500;
            margin-bottom: 4px;
          }
          
          .member-role {
            font-size: 0.9rem;
            color: var(--mat-sys-on-surface-variant, #49454f);
          }
        }
      }
    }
    
    .actions-section {
      flex: 1;
      padding: 20px 24px;
      
      h3 {
        margin: 0 0 16px 0;
        font-size: 1.1rem;
        font-weight: 500;
        color: var(--mat-sys-on-surface, #1d1b20);
      }
      
      .actions-list {
        .action-item {
          cursor: pointer;
          border-radius: 8px;
          margin-bottom: 8px;
          transition: background-color 0.2s ease;
          
          &:hover {
            background-color: var(--mat-sys-surface-container-high, #ece6f0);
          }
          
          &.action-warn {
            &:hover {
              background-color: rgba(244, 67, 54, 0.1);
            }
            
            mat-icon {
              color: var(--mat-sys-error, #b3261e) !important;
            }
          }
        }
      }
    }
  `]
})
export class MemberActionsSidebarComponent implements OnInit {
  member: User;
  group: Group;
  availableActions: MemberAction[] = [];

  constructor(
    private sidePanelRef: SidePanelRef,
    @Inject(SIDE_PANEL_DATA) public panelData: MemberActionsPanelData
  ) {
    this.member = panelData.member;
    this.group = panelData.group;
    this.updateAvailableActions();
  }

  ngOnInit(): void {
    this.updateAvailableActions();
  }

  private updateAvailableActions(): void {
    if (!this.member || !this.group) {
      this.availableActions = [];
      return;
    }

    this.availableActions = [
      {
        id: 'make-admin',
        label: 'Make Admin',
        icon: 'admin_panel_settings',
        color: 'primary',
        description: 'Grant administrative privileges to this member'
      },
      {
        id: 'remove-member',
        label: 'Remove from Group',
        icon: 'remove_circle',
        color: 'warn',
        description: 'Remove this member from the group'
      }
    ];
  }

  onCloseSidebar(): void {
    this.sidePanelRef.close();
  }

  onActionSelected(action: MemberAction): void {
    this.sidePanelRef.close({ action, member: this.member, group: this.group });
  }
}