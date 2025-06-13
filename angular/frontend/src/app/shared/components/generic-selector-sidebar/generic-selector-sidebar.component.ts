import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';

export interface SelectorItem {
  id: number | string;
  name: string;
  description?: string;
  email?: string;
  [key: string]: any;
}

export interface SelectorConfig {
  headerTitle: string;
  headerSubtitle?: string;
  itemIcon: string;
  emptyMessage: string;
  emptyIcon: string;
}

@Component({
  selector: 'app-generic-selector-sidebar',
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
    <div class="generic-selector-sidebar" [class.sidebar-open]="isOpen">
      <div class="sidebar-header">
        <div class="header-content">
          <h2>{{ config.headerTitle }}</h2>
          <p class="subtitle" *ngIf="config.headerSubtitle">{{ config.headerSubtitle }}</p>
        </div>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <mat-divider></mat-divider>
      
      <div class="item-list-container">
        <mat-nav-list>
          <a mat-list-item *ngFor="let item of items" 
             (click)="selectItem(item)"
             class="selector-item">
            <mat-icon matListItemIcon>{{ config.itemIcon }}</mat-icon>
            <div matListItemTitle>{{ item.name }}</div>
            <div matListItemLine *ngIf="item.description" class="item-description">
              {{ item.description }}
            </div>
            <div matListItemLine *ngIf="item.email && !item.description" class="item-email">
              {{ item.email }}
            </div>
          </a>
        </mat-nav-list>
        
        <div *ngIf="items.length === 0" class="no-items-message">
          <mat-icon>{{ config.emptyIcon }}</mat-icon>
          <p>{{ config.emptyMessage }}</p>
        </div>
      </div>
    </div>
    
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="close()"></div>
  `,
  styleUrls: ['./generic-selector-sidebar.component.scss']
})
export class GenericSelectorSidebarComponent<T extends SelectorItem> implements OnInit {
  @Input() isOpen = false;
  @Input() items: T[] = [];
  @Input() config!: SelectorConfig;
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() itemSelected = new EventEmitter<T>();
  
  ngOnInit(): void {
    // Additional initialization if needed
  }
  
  close(): void {
    this.closeSidebar.emit();
  }
  
  selectItem(item: T): void {
    this.itemSelected.emit(item);
    this.close();
  }
} 