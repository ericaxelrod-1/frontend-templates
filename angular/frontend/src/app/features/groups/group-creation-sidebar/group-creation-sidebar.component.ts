import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { Group } from '../../../models/group.model';

@Component({
  selector: 'app-group-creation-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule
  ],
  template: `
    <div class="group-creation-sidebar" [class.sidebar-open]="isOpen">
      <!-- Sidebar Content -->
      <div class="sidebar-content">
        <!-- Header -->
        <div class="sidebar-header">
          <div class="header-content">
            <h2>{{ editMode ? 'Edit Group' : 'Create Group' }}</h2>
            <p *ngIf="editMode && groupData">Editing: {{ groupData.name }}</p>
          </div>
          <button mat-icon-button (click)="onCloseSidebar()" class="close-button">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        
        <mat-divider></mat-divider>
        
        <!-- Form Section -->
        <div class="form-section">
          <form #groupForm="ngForm" class="group-form">
            <mat-form-field appearance="fill" class="full-width">
              <mat-label>Group Name</mat-label>
              <input 
                matInput 
                [(ngModel)]="formData.name" 
                name="name" 
                required
                placeholder="Enter group name"
                #nameInput>
              <mat-icon matSuffix>group</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="fill" class="full-width">
              <mat-label>Description</mat-label>
              <textarea 
                matInput 
                [(ngModel)]="formData.description" 
                name="description"
                rows="4"
                placeholder="Enter group description (optional)"
                #descriptionInput>
              </textarea>
              <mat-icon matSuffix>description</mat-icon>
            </mat-form-field>
            
            <!-- Form Validation -->
            <div class="form-validation" *ngIf="!groupForm.form.valid && groupForm.form.touched">
              <mat-icon class="warning-icon">warning</mat-icon>
              <span>Group name is required</span>
            </div>
            
            <!-- Action Buttons -->
            <div class="action-buttons">
              <button mat-button (click)="onCloseSidebar()" class="cancel-button">
                <mat-icon>cancel</mat-icon>
                Cancel
              </button>
              <button 
                mat-raised-button 
                color="primary" 
                (click)="onSave()" 
                [disabled]="!groupForm.form.valid"
                class="save-button">
                <mat-icon>{{ editMode ? 'save' : 'add' }}</mat-icon>
                {{ editMode ? 'Save Changes' : 'Create Group' }}
              </button>
            </div>
          </form>
        </div>

        <!-- Spacer for better scrolling -->
        <div class="bottom-spacer"></div>
      </div>
    </div>
    
    <!-- Backdrop outside sidebar -->
    <div class="sidebar-backdrop" 
         [class.backdrop-visible]="isOpen" 
         (click)="onCloseSidebar()"></div>
  `,
  styles: [`
    .group-creation-sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: 400px;
      height: 100vh;
      background-color: var(--mdc-theme-surface);
      box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
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
      }
      
      .close-button {
        color: var(--mdc-theme-on-primary);
        margin-left: 16px;
      }
    }
    
    .form-section {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      
      .group-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        
        .full-width {
          width: 100%;
        }
        
        mat-form-field {
          .mat-mdc-form-field {
            margin-bottom: 8px;
          }
        }
        
        textarea {
          resize: vertical;
          min-height: 80px;
        }
        
        .form-validation {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 16px 0;
          padding: 8px 12px;
          background-color: rgba(244, 67, 54, 0.1);
          border-radius: 4px;
          color: #d32f2f;
          font-size: 0.9rem;
          
          .warning-icon {
            font-size: 1.2rem;
            width: 1.2rem;
            height: 1.2rem;
          }
        }
        
        .action-buttons {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          align-items: center;
          margin-top: 24px;
          padding-top: 16px;
          border-top: 1px solid #e0e0e0;
          
          .cancel-button {
            color: #666;
          }
          
          .save-button {
            min-width: 140px;
            height: 40px;
          }
        }
      }
    }
    
    .bottom-spacer {
      height: 40px;
      flex-shrink: 0;
    }
    
    @media (max-width: 768px) {
      .group-creation-sidebar {
        width: 100vw;
      }
    }
  `]
})
export class GroupCreationSidebarComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() groupData: Group | null = null; // For edit mode
  
  @Output() closeSidebar = new EventEmitter<void>();
  @Output() groupSaved = new EventEmitter<Partial<Group>>();
  
  editMode = false;
  formData: Partial<Group> = {
    name: '',
    description: ''
  };
  
  ngOnInit(): void {
    this.resetForm();
  }
  
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['groupData'] || changes['isOpen']) {
      this.editMode = !!this.groupData;
      this.resetForm();
    }
  }
  
  private resetForm(): void {
    if (this.editMode && this.groupData) {
      // Edit mode - populate with existing data
      this.formData = {
        name: this.groupData.name || '',
        description: this.groupData.description || ''
      };
    } else {
      // Create mode - reset to empty
      this.formData = {
        name: '',
        description: ''
      };
    }
  }
  
  onCloseSidebar(): void {
    this.closeSidebar.emit();
  }
  
  onSave(): void {
    if (this.formData.name && this.formData.name.trim()) {
      const groupToSave: Partial<Group> = {
        name: this.formData.name.trim(),
        description: this.formData.description?.trim() || ''
      };
      
      // Include ID if editing
      if (this.editMode && this.groupData?.id) {
        groupToSave.id = this.groupData.id;
      }
      
      this.groupSaved.emit(groupToSave);
    }
  }
} 