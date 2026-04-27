import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Store, Select } from '@ngxs/store';
import { Observable } from 'rxjs';
import { PrivacyState, PrivacyStateModel } from '../../store/privacy/privacy.state';
import { PrivacyActions } from '../../store/privacy/privacy.actions';
import { PrivacyTicket, PrivacyPreferences } from './privacy.service';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-privacy-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressBarModule,
    RouterModule
  ],
  template: `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <h1>Privacy Dashboard</h1>
        <p>Overview of your data privacy and active requests</p>
      </header>

      <div class="dashboard-grid">
        <!-- Privacy Score Widget (Placeholder for now) -->
        <mat-card class="widget score-widget">
          <mat-card-header>
            <mat-card-title>Privacy Score</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="score-display">
              <span class="score-value">85</span>
              <span class="score-total">/100</span>
            </div>
            <mat-progress-bar mode="determinate" value="85"></mat-progress-bar>
            <p class="score-hint">Your privacy settings are looking good!</p>
          </mat-card-content>
          <mat-card-actions>
            <button mat-button color="primary" routerLink="settings">MANAGE SETTINGS</button>
          </mat-card-actions>
        </mat-card>

        <!-- Active Tickets Widget -->
        <mat-card class="widget tickets-widget">
          <mat-card-header>
            <mat-card-title>Active Privacy Requests</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div *ngIf="isLoading$ | async" class="loading-spinner">
              <mat-progress-bar mode="indeterminate"></mat-progress-bar>
            </div>

            <div *ngIf="!(isLoading$ | async) && (tickets$ | async) as tickets">
              <div *ngIf="tickets.length === 0" class="no-tickets">
                <p>No active privacy requests.</p>
              </div>

              <div *ngFor="let ticket of tickets" class="ticket-item">
                <div class="ticket-info">
                  <span class="ticket-type">{{ ticket.requestType }}</span>
                  <span class="ticket-date">{{ ticket.createdAt | date:'shortDate' }}</span>
                </div>
                <mat-chip-set>
                  <mat-chip [color]="getStatusColor(ticket.status)" selected>
                    {{ ticket.status }}
                  </mat-chip>
                </mat-chip-set>
              </div>
            </div>
          </mat-card-content>
          <mat-card-actions>
            <button mat-button color="primary">VIEW ALL REQUESTS</button>
          </mat-card-actions>
        </mat-card>

        <!-- Consent Status Widget -->
        <mat-card class="widget consent-widget">
          <mat-card-header>
            <mat-card-title>Quick Preferences</mat-card-title>
          </mat-card-header>
          <mat-card-content *ngIf="preferences$ | async as prefs">
            <div class="consent-item">
              <span>Marketing Emails</span>
              <mat-chip-set>
                <mat-chip [color]="prefs.marketingConsent ? 'primary' : 'warn'" selected>
                  {{ prefs.marketingConsent ? 'ENABLED' : 'DISABLED' }}
                </mat-chip>
              </mat-chip-set>
            </div>
            <div class="consent-item">
              <span>Data Selling</span>
              <mat-chip-set>
                <mat-chip [color]="!prefs.doNotSell ? 'primary' : 'warn'" selected>
                  {{ prefs.doNotSell ? 'RESTRICTED' : 'ALLOWED' }}
                </mat-chip>
              </mat-chip-set>
            </div>
          </mat-card-content>
          <mat-card-actions>
            <button mat-button color="primary" routerLink="settings">UPDATE ALL</button>
          </mat-card-actions>
        </mat-card>
      </div>
    </div>
  `,
  styles: [`
    .dashboard-container {
      padding: 24px;
    }
    .dashboard-header {
      margin-bottom: 32px;
    }
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
    }
    .widget {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .score-display {
      font-size: 3rem;
      font-weight: bold;
      margin: 16px 0;
      text-align: center;
    }
    .score-total {
      font-size: 1.5rem;
      color: #666;
    }
    .score-hint {
      margin-top: 16px;
      text-align: center;
      color: #4caf50;
    }
    .ticket-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .ticket-info {
      display: flex;
      flex-direction: column;
    }
    .ticket-type {
      font-weight: 500;
    }
    .ticket-date {
      font-size: 0.8rem;
      color: #666;
    }
    .consent-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .loading-spinner {
      padding: 24px;
    }
    .no-tickets {
      padding: 24px;
      text-align: center;
      color: #666;
    }
  `]
})
export class PrivacyDashboardComponent implements OnInit {
  @Select(PrivacyState.getActiveTickets) tickets$!: Observable<PrivacyTicket[]>;
  @Select(PrivacyState.getPreferences) preferences$!: Observable<PrivacyPreferences>;
  @Select(PrivacyState.isLoading) isLoading$!: Observable<boolean>;

  constructor(private store: Store) {}

  ngOnInit(): void {
    this.store.dispatch(new PrivacyActions.FetchActiveTickets());
    this.store.dispatch(new PrivacyActions.FetchPreferences());
  }

  getStatusColor(status: string): string {
    switch (status.toLowerCase()) {
      case 'completed': return 'primary';
      case 'in progress': return 'accent';
      case 'pending': return 'warn';
      default: return '';
    }
  }
}
