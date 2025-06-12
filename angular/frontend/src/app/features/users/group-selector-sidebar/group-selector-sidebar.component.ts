import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { Group } from '../../../models/group.model';
import { User } from '../../../models/user.model';

@Component({
  selector: 'app-group-selector-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <div class="group-selector-sidebar" [class.sidebar-open]="isOpen">
      <div class="sidebar-header">
        <div class="header-content">
          <h2>Add to Group</h2>
          <p class="user-info">{{ user?.firstName || user?.email }}</p>
        </div>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <mat-divider></mat-divider>
      
      <div class="group-list-container">
        <mat-nav-list>
          <a mat-list-item *ngFor="let group of availableGroups" 
             (click)="selectGroup(group)"
             class="group-item">
            <mat-icon matListItemIcon>group</mat-icon>
            <div matListItemTitle>{{ group.name }}</div>
            <div matListItemLine *ngIf="group.description" class="group-description">
              {{ group.description }}
            </div>
          </a>
        </mat-nav-list>
        
        <div *ngIf="availableGroups.length === 0" class="no-groups-message">
          <mat-icon>info</mat-icon>
          <p>No available groups for this user</p>
        </div>
      </div>
    </div>
    
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="close()"></div>
  `,
  styleUrls: ['./group-selector-sidebar.component.scss']
})
export class GroupSelectorSidebarComponent implements OnInit {
  @Input() isOpen = false;
  @Input() user: User | null = null;
  @Input() availableGroups: Group[] = [];
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() groupSelected = new EventEmitter<Group>();
  
  ngOnInit(): void {
    // Additional initialization if needed
  }
  
  close(): void {
    this.closeSidebar.emit();
  }
  
  selectGroup(group: Group): void {
    this.groupSelected.emit(group);
    this.close();
  }
} 