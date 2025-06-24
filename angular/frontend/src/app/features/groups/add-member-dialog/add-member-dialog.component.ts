import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { Group } from '../../../models/group.model';
import { User } from '../../../models/user.model';
import { UserService } from '../../../services/user.service';

@Component({
  selector: 'app-add-member-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule
  ],
  template: `
    <h2 mat-dialog-title>Add Member to {{ data.group.name }}</h2>
    <mat-dialog-content>
      <mat-form-field>
        <mat-label>Select User</mat-label>
        <mat-select [(ngModel)]="selectedUserId">
          <mat-option *ngFor="let user of availableUsers" [value]="user.id">
            {{ user.firstName || user.email }}
          </mat-option>
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" [disabled]="!selectedUserId" (click)="onAdd()">Add</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-form-field {
      width: 100%;
      margin-bottom: 20px;
    }
    mat-dialog-actions {
      justify-content: flex-end;
      gap: 8px;
    }
  `]
})
export class AddMemberDialogComponent implements OnInit {
  availableUsers: User[] = [];
  selectedUserId: number | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { group: Group },
    private dialogRef: MatDialogRef<AddMemberDialogComponent>,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.loadAvailableUsers();
  }

  loadAvailableUsers(): void {
    this.userService.getUsers().subscribe({
      next: (users) => {
        this.availableUsers = users.filter(user => 
          !this.data.group.users.some(groupUser => groupUser.id === user.id)
        );
      },
      error: (error) => {
        console.error('Error loading users:', error);
      }
    });
  }

  onAdd(): void {
    if (this.selectedUserId) {
      this.dialogRef.close(this.selectedUserId);
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
} 