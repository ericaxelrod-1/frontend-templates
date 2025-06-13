import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GenericSelectorSidebarComponent, SelectorItem, SelectorConfig } from '../../../shared/components/generic-selector-sidebar/generic-selector-sidebar.component';
import { User } from '../../../models/user.model';
import { Group } from '../../../models/group.model';

interface UserSelectorItem extends SelectorItem {
  id: number;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
}

@Component({
  selector: 'app-user-selector-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    GenericSelectorSidebarComponent
  ],
  template: `
    <app-generic-selector-sidebar
      [isOpen]="isOpen"
      [items]="userItems"
      [config]="selectorConfig"
      (closeSidebar)="onCloseSidebar()"
      (itemSelected)="onUserSelected($event)">
    </app-generic-selector-sidebar>
  `
})
export class UserSelectorSidebarComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() group: Group | null = null;
  @Input() availableUsers: User[] = [];
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() userSelected = new EventEmitter<{ user: User; group: Group }>();
  
  userItems: UserSelectorItem[] = [];
  selectorConfig: SelectorConfig = {
    headerTitle: 'Add Member to Group',
    headerSubtitle: '',
    itemIcon: 'person',
    emptyMessage: 'No available users to add to this group',
    emptyIcon: 'person_off'
  };
  
  ngOnInit(): void {
    this.updateConfig();
    this.updateUserItems();
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['group']) {
      this.updateConfig();
    }
    if (changes['availableUsers']) {
      this.updateUserItems();
    }
  }
  
  private updateConfig(): void {
    if (this.group) {
      this.selectorConfig = {
        ...this.selectorConfig,
        headerTitle: 'Add Member to Group',
        headerSubtitle: `Select a user to add to "${this.group.name}"`
      };
    }
  }
  
  private updateUserItems(): void {
    this.userItems = this.availableUsers.map(user => ({
      id: user.id,
      name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      email: user.email,
      firstName: user.firstName || '',
      lastName: user.lastName || ''
    }));
  }
  
  onCloseSidebar(): void {
    this.closeSidebar.emit();
  }
  
  onUserSelected(userItem: UserSelectorItem): void {
    if (this.group) {
      // Find the original user object
      const user = this.availableUsers.find(u => u.id === userItem.id);
      if (user) {
        this.userSelected.emit({ user, group: this.group });
      }
    }
  }
} 