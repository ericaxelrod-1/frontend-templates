import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { Member } from '../../../models/group.model';
import { Group } from '../../../models/group.model';

export interface MemberAction {
  id: string;
  label: string;
  icon: string;
  color?: 'primary' | 'accent' | 'warn';
  description?: string;
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
    <div class="member-actions-sidebar" [class.sidebar-open]="isOpen">
      <!-- Sidebar Content -->
      <div class="sidebar-content">
        <!-- Header -->
        <div class="sidebar-header">
          <div class="header-content">
            <h2>Member Actions</h2>
            <p *ngIf="member">{{ member.name }}</p>
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
              <div class="member-name">{{ member.name }}</div>
              <div class="member-role">{{ member.role || 'Member' }}</div>
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
    </div>
    
    <!-- Backdrop outside sidebar -->
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="onCloseSidebar()"></div>
  `,
  styles: [`
    .member-actions-sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      height: 100vh;
      background-color: var(--mdc-theme-surface);
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
      transform: translateX(100%);
      transition: transform 0.3s ease-in-out;
      z-index: 1100;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      
      &.sidebar-open {
        transform: translateX(0);
      }
    }
    
    .sidebar-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 1099;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease-in-out, visibility 0.3s ease-in-out;
      
      &.backdrop-visible {
        opacity: 1;
        visibility: visible;
      }
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
      background-color: var(--mdc-theme-primary);
      color: var(--mdc-theme-on-primary);
      
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
        color: var(--mdc-theme-on-primary);
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
          color: var(--mdc-theme-primary);
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
            color: var(--mdc-theme-text-secondary);
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
        color: var(--mdc-theme-text-primary);
      }
      
      .actions-list {
        .action-item {
          cursor: pointer;
          border-radius: 8px;
          margin-bottom: 8px;
          transition: background-color 0.2s ease;
          
          &:hover {
            background-color: var(--mdc-theme-action-hover);
          }
          
          &.action-warn {
            &:hover {
              background-color: rgba(244, 67, 54, 0.1);
            }
            
            mat-icon {
              color: var(--mdc-theme-warn) !important;
            }
          }
        }
      }
    }
    
    @media (max-width: 768px) {
      .member-actions-sidebar {
        width: 100vw;
      }
    }
  `]
})
export class MemberActionsSidebarComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() member: Member | null = null;
  @Input() group: Group | null = null;
  
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() actionSelected = new EventEmitter<{ action: MemberAction; member: Member; group: Group }>();
  
  availableActions: MemberAction[] = [];
  
  ngOnInit(): void {
    this.updateAvailableActions();
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['member'] || changes['group']) {
      this.updateAvailableActions();
    }
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
    this.closeSidebar.emit();
  }
  
  onActionSelected(action: MemberAction): void {
    if (this.member && this.group) {
      this.actionSelected.emit({
        action,
        member: this.member,
        group: this.group
      });
    }
  }
} 