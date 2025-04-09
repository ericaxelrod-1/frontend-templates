import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Location } from '@angular/common';

@Component({
  selector: 'app-not-found',
  templateUrl: './not-found.component.html',
  styleUrls: ['./not-found.component.scss']
})
export class NotFoundComponent {
  constructor(
    private router: Router,
    private location: Location
  ) {}

  goBack(): void {
    this.location.back();
  }

  goToHome(): void {
    this.router.navigate(['/']);
  }
} 