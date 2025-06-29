import { Component, OnInit, AfterViewInit } from '@angular/core';

@Component({
  selector: 'app-login-attempts-table',
  templateUrl: './login-attempts-table.component.html',
  styleUrls: ['./login-attempts-table.component.css']
})
export class LoginAttemptsTableComponent implements OnInit, AfterViewInit {
  private reactivePatternInitialized = false;
  private shouldInitializeReactivePattern = false;
  private currentSort: { active: string; direction: string };

  ngOnInit(): void {
    // Handle async operations - permissions already checked by parent
    if (this.hasPermission) {
      this.shouldInitializeReactivePattern = true;
      
      // Initialize if ViewChild is already available
      if (this.sort) {
        this.initializeReactivePattern();
        // Load initial data AFTER reactive pattern is initialized
        this.loadRecentAttempts();
      }
      // Note: If ViewChild is not available yet, ngAfterViewInit will handle both initialization and initial load
    }
  }

  ngAfterViewInit(): void {
    // Initialize reactive pattern if permissions are ready
    if (this.shouldInitializeReactivePattern && !this.reactivePatternInitialized) {
      this.initializeReactivePattern();
      // Load initial data AFTER reactive pattern is initialized
      this.loadRecentAttempts();
    }
  }

  private initializeReactivePattern(): void {
    // Guard against multiple initialization
    if (this.reactivePatternInitialized || !this.sort || !this.hasPermission) {
      return;
    }
    
    this.reactivePatternInitialized = true;
    
    // ✅ FIX SORT INITIALIZATION RACE CONDITION:
    // Remove conflicting programmatic sort initialization that was causing the race condition
    // The template already has matSortActive="createdAt" and matSortDirection="desc"
    // so we just need to sync our component state with the template state
    
    // Sync component state with template-initialized MatSort state
    if (this.sort.active && this.sort.direction) {
      this.currentSort = {
        active: this.sort.active,
        direction: this.sort.direction
      };
    }
    
    // Set up sort change handler for user interactions
    this.sort.sortChange.subscribe(() => {
      this.currentPage = 0;
      // Update current sort state from MatSort
      if (this.sort.active && this.sort.direction) {
        this.currentSort = {
          active: this.sort.active,
          direction: this.sort.direction
        };
      }
      this.loadRecentAttempts();
    });
  } 
} 