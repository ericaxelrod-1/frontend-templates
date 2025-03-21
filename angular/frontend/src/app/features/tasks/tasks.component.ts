import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule
  ],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss'
})
export class TasksComponent {
  displayedColumns: string[] = ['id', 'title', 'assignee', 'dueDate', 'status', 'actions'];
  
  tasks = [
    { 
      id: 1, 
      title: 'Implement login feature', 
      assignee: 'John Doe',
      dueDate: '2023-04-15',
      status: 'In Progress'
    },
    { 
      id: 2, 
      title: 'Design homepage', 
      assignee: 'Jane Smith',
      dueDate: '2023-04-10',
      status: 'Completed'
    },
    { 
      id: 3, 
      title: 'Fix navigation bug', 
      assignee: 'Bob Johnson',
      dueDate: '2023-04-20',
      status: 'Pending'
    },
    { 
      id: 4, 
      title: 'Update documentation', 
      assignee: 'Alice Brown',
      dueDate: '2023-04-25',
      status: 'Not Started'
    },
    { 
      id: 5, 
      title: 'Create user guide', 
      assignee: 'Charlie Davis',
      dueDate: '2023-05-01',
      status: 'In Progress'
    }
  ];
  
  getStatusColor(status: string): string {
    switch(status) {
      case 'Completed': return 'primary';
      case 'In Progress': return 'accent';
      case 'Pending': return 'warn';
      default: return '';
    }
  }
}
