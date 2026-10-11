import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { PrivacyService, PrivacyTicket } from '../../privacy/privacy.service';

@Component({
  selector: 'app-privacy-admin',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    <div class="privacy-admin">
      <header class="page-header">
        <div class="title-section">
          <h1>Privacy Requests Management</h1>
          <p>Global view of all user data requests and privacy compliance tickets</p>
        </div>
        <div class="header-actions">
          <button mat-stroked-button (click)="loadTickets()">
            <mat-icon>refresh</mat-icon> Refresh
          </button>
        </div>
      </header>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User / Email</th>
              <th>Request Type</th>
              <th>Status</th>
              <th>Regulation</th>
              <th>Created At</th>
              <th>SLA Deadline</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (ticket of tickets; track ticket.id) {
              <tr>
                <td>#{{ ticket.id }}</td>
                <td>
                  <div class="user-info">
                    @if (ticket.user) {
                      <span class="username">{{ ticket.user.username }}</span>
                      <span class="email">{{ ticket.user.email }}</span>
                    } @else {
                      <span class="email">{{ ticket.email }}</span>
                      <mat-chip-set>
                        <mat-chip class="public-chip">Public</mat-chip>
                      </mat-chip-set>
                    }
                  </div>
                </td>
                <td>
                  <mat-chip-set>
                    <mat-chip [class]="'type-' + ticket.requestType.toLowerCase()">
                      {{ formatRequestType(ticket.requestType) }}
                    </mat-chip>
                  </mat-chip-set>
                </td>
                <td>
                  <span class="status-badge" [class]="'status-' + ticket.status.toLowerCase()">
                    {{ ticket.status }}
                  </span>
                </td>
                <td>{{ ticket.regulation || 'N/A' }}</td>
                <td>{{ ticket.createdAt | date:'short' }}</td>
                <td>
                  @if (ticket.slaDeadline) {
                    <span [class.overdue]="isOverdue(ticket.slaDeadline)">
                      {{ ticket.slaDeadline | date:'shortDate' }}
                    </span>
                  } @else {
                    -
                  }
                </td>
                <td>
                  <button mat-icon-button color="primary" title="View Details">
                    <mat-icon>visibility</mat-icon>
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="empty-state">
                  <mat-icon>inbox</mat-icon>
                  <p>No privacy requests found</p>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .privacy-admin { padding: var(--fluid-spacing-md); }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--fluid-spacing-lg); border-bottom: 1px solid var(--mat-sys-outline-variant); padding-bottom: 1rem; }
    .title-section h1 { font-size: var(--fluid-text-lg); font-weight: 600; color: var(--mat-sys-on-surface); margin: 0 0 4px 0; }
    .title-section p { font-size: var(--fluid-text-sm); color: var(--mat-sys-on-surface-variant); margin: 0; }
    
    .table-container { background: var(--mat-sys-surface); border-radius: 12px; border: 1px solid var(--mat-sys-outline-variant); overflow: hidden; box-shadow: var(--mat-sys-shadow); }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td { padding: 1rem; text-align: left; border-bottom: 1px solid var(--mat-sys-outline-variant); font-size: var(--fluid-text-sm); }
    .data-table th { background: var(--mat-sys-surface-container-high); font-weight: 600; color: var(--mat-sys-on-surface); }
    
    .user-info { display: flex; flex-direction: column; gap: 2px; }
    .username { font-weight: 600; color: var(--mat-sys-on-surface); }
    .email { font-size: 11px; color: var(--mat-sys-on-surface-variant); }
    
    .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .status-pending { background: #fef9c3; color: #854d0e; }
    .status-completed { background: #dcfce7; color: #166534; }
    .status-unverified { background: #f1f5f9; color: #475569; }
    
    .public-chip { --mdc-chip-label-text-size: 10px; height: 20px; }
    .overdue { color: var(--mat-sys-error); font-weight: 600; }
    
    .empty-state { text-align: center; padding: 4rem 2rem; color: var(--mat-sys-on-surface-variant); }
    .empty-state mat-icon { font-size: 3rem; width: 3rem; height: 3rem; margin-bottom: 1rem; opacity: 0.5; }
  `]
})
export class PrivacyAdminComponent implements OnInit {
  tickets: PrivacyTicket[] = [];

  constructor(private privacyService: PrivacyService) {}

  ngOnInit(): void {
    this.loadTickets();
  }

  loadTickets(): void {
    this.privacyService.getAllTickets().subscribe({
      next: (tickets) => this.tickets = tickets,
      error: (err) => console.error('Failed to load tickets:', err)
    });
  }

  formatRequestType(type: string): string {
    return type.replace(/_/g, ' ');
  }

  isOverdue(deadline: Date): boolean {
    return new Date(deadline) < new Date();
  }
}
