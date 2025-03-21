import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { Location } from '@angular/common';

@Component({
  selector: 'app-error',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    RouterModule
  ],
  templateUrl: './error.component.html',
  styleUrl: './error.component.scss'
})
export class ErrorComponent {
  @Input() errorTitle: string = 'An error occurred';
  @Input() errorMessage: string = 'Something went wrong. Please try again later.';
  @Input() showHomeButton: boolean = true;
  @Input() showBackButton: boolean = true;
  
  constructor(private location: Location) {}
  
  goBack(): void {
    this.location.back();
  }
}
