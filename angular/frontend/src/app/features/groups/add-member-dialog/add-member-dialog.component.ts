import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { Group } from '../../../services/group.service';

interface User {
  id: number;
  name: string;
  email: string;
}

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
      <form #memberForm="ngForm">
        <mat-form-field appearance="fill" class="full-width">
          <mat-label>Select User</mat-label>
          <mat-select [(ngModel)]="selectedUserId" name="user" required>
            <mat-option *ngFor="let user of availableUsers" [value]="user.id">
              {{ user.name }} ({{ user.email }})
            </mat-option>
          </mat-select>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onAdd()" [disabled]="!memberForm.form.valid">
        Add Member
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    mat-dialog-content {
      min-width: 400px;
    }
  `]
})
export class AddMemberDialogComponent implements OnInit {
  availableUsers: User[] = [];
  selectedUserId: number | null = null;

  constructor(
    public dialogRef: MatDialogRef<AddMemberDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { group: Group }
  ) {}

  ngOnInit(): void {
    // TODO: Load available users from UserService
    // For now, using mock data
    this.availableUsers = [
      { id: 1, name: 'John Doe', email: 'john@example.com' },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
      { id: 3, name: 'Bob Johnson', email: 'bob@example.com' }
    ].filter(user => !this.data.group.members.some(member => member.id === user.id));
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onAdd(): void {
    if (this.selectedUserId) {
      this.dialogRef.close(this.selectedUserId);
    }
  }
} 