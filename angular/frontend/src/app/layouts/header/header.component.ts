import { Component, EventEmitter, Output, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule } from '@angular/router';
import { Store, Select } from '@ngxs/store';
import { AuthState, AuthActions } from '../../store/auth/auth.state';
import { Observable, Subscription } from 'rxjs';
import { User } from '../../models';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    RouterModule
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Output() sidebarToggle = new EventEmitter<void>();
  
  @Select(AuthState.isAuthenticated) isAuthenticated$!: Observable<boolean>;
  @Select(AuthState.user) user$!: Observable<User | null>;
  
  isAuthenticated = false;
  user: User | null = null;
  private subscription = new Subscription();
  
  constructor(private store: Store) {}
  
  ngOnInit(): void {
    this.subscription.add(
      this.isAuthenticated$.subscribe(isAuthenticated => {
        this.isAuthenticated = isAuthenticated;
      })
    );
    
    this.subscription.add(
      this.user$.subscribe(user => {
        this.user = user;
      })
    );
  }
  
  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
  
  toggleSidebar() {
    this.sidebarToggle.emit();
  }
  
  logout() {
    this.store.dispatch(new AuthActions.Logout());
  }
}
