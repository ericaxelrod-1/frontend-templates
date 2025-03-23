import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, NavigationEnd, Event } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { HeaderComponent } from '../header/header.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { FooterComponent } from '../footer/footer.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MatSidenavModule,
    HeaderComponent,
    SidebarComponent,
    FooterComponent
  ],
  templateUrl: './main-layout.component.html',
  styleUrl: './main-layout.component.scss'
})
export class MainLayoutComponent implements OnInit {
  sidebarOpened = true;
  isAuthPage = false;

  constructor(private router: Router) {}

  ngOnInit() {
    // Check initial route
    this.checkIfAuthPage(this.router.url);

    // Subscribe to route changes
    this.router.events.pipe(
      filter((event: Event): event is NavigationEnd => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      this.checkIfAuthPage(event.url);
    });
  }

  toggleSidebar() {
    this.sidebarOpened = !this.sidebarOpened;
  }

  private checkIfAuthPage(url: string): void {
    // Check if current route is an auth page
    this.isAuthPage = url.includes('/login') || 
                      url.includes('/register') || 
                      url.includes('/forgot-password') || 
                      url.includes('/reset-password') ||
                      url.includes('/verify-email');
  }
}
