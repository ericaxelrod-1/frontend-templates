import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule
  ],
  templateUrl: './groups.component.html',
  styleUrl: './groups.component.scss'
})
export class GroupsComponent {
  groups = [
    { 
      id: 1, 
      name: 'Development Team', 
      description: 'Software development team',
      members: 8,
      owner: 'John Doe'
    },
    { 
      id: 2, 
      name: 'Marketing', 
      description: 'Marketing team',
      members: 5,
      owner: 'Jane Smith'
    },
    { 
      id: 3, 
      name: 'Sales', 
      description: 'Sales team',
      members: 10,
      owner: 'Bob Johnson'
    },
    { 
      id: 4, 
      name: 'HR', 
      description: 'Human Resources team',
      members: 3,
      owner: 'Alice Brown'
    }
  ];
}
