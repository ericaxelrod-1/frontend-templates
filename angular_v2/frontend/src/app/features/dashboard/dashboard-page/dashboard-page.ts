import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Session } from '../../../core/auth/session.service';
import { ConsentApi } from '../../../core/consent/consent-api.service';
import { AuthorizationApi } from '../../authorization/authorization-api.service';
import { BlockedApi } from '../../blocked/blocked-api.service';
import { NotificationApi } from '../../notifications/notification-api.service';
import { ProfileApi } from '../../profile/profile-api.service';
import type { ProfileMe } from '../../profile/profile-me';
import { SecurityTelemetryApi } from '../../security/security-telemetry-api.service';
import { UsersApi, columnScopeFor } from '../../users/users-api.service';

interface MetricState {
  readonly count: number | null;
  readonly notReadable: boolean;
}

export interface DashboardSummaryCard {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly count: number | null;
  readonly notReadable: boolean;
  readonly description: string;
  readonly icon: string;
}

/**
 * Landing dashboard: real-state summary linked directly to the application's pages.
 *
 * ## THE RULES THIS COMPONENT OBSERVES
 *
 * 1. A page that shows a number shows the REAL number from the same source the linked
 *    page uses. No hardcoded counts, no placeholder metrics, and no second copy of the data.
 * 2. Frontend permission checks are UX affordance only (AGENTS.md §F7). The backend is
 *    authoritative: queries are executed and errors (e.g. HTTP 403 on column- or table-level
 *    grant boundaries) surface as "not readable for this role", matching what the linked
 *    pages show to a non-administrator.
 * 3. No component may inject `HttpClient` — domain services are injected exclusively.
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressBarModule,
    RouterLink,
  ],
  templateUrl: './dashboard-page.html',
  styles: `
    :host {
      display: block;
      max-width: 72rem;
      margin: 0 auto;
      padding: 1rem;
    }

    .welcome-header {
      margin-bottom: 1.5rem;
    }

    .welcome-title {
      font: var(--mat-sys-headline-medium);
      font-weight: 600;
      margin: 0 0 0.5rem 0;
    }

    .welcome-sub {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-large);
      margin: 0;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: 1.25rem;
      margin-top: 1.5rem;
    }

    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      border: 1px solid var(--mat-sys-outline-variant);
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }

    .card:hover {
      box-shadow: var(--mat-sys-level2);
      transform: translateY(-2px);
    }

    .card-header-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
    }

    .card-metric {
      font-size: 2.25rem;
      font-weight: 700;
      color: var(--mat-sys-primary);
      line-height: 1.2;
      margin: 0.75rem 0 0.25rem 0;
    }

    .card-metric--blocked {
      font: var(--mat-sys-body-medium);
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }

    .card-description {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
      flex: 1 1 auto;
      margin-bottom: 1rem;
    }

    .card-actions {
      padding: 0 1rem 1rem 1rem;
      display: flex;
      justify-content: flex-end;
    }
  `,
})
export class DashboardPage {
  private readonly session = inject(Session);
  private readonly profileApi = inject(ProfileApi);
  private readonly usersApi = inject(UsersApi);
  private readonly blockedApi = inject(BlockedApi);
  private readonly authzApi = inject(AuthorizationApi);
  private readonly notificationApi = inject(NotificationApi);
  private readonly telemetryApi = inject(SecurityTelemetryApi);
  private readonly consentApi = inject(ConsentApi);

  protected readonly profile = signal<ProfileMe | null>(null);
  protected readonly myLoginAttempts = signal<MetricState>({ count: null, notReadable: false });
  protected readonly consentPurposes = signal<MetricState>({ count: null, notReadable: false });
  protected readonly usersMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly blockedMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly groupsMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly rolesMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly alertsMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly ipReputationMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly patternsMetric = signal<MetricState>({ count: null, notReadable: false });
  protected readonly loginAttemptsMetric = signal<MetricState>({ count: null, notReadable: false });

  protected readonly cards = computed<readonly DashboardSummaryCard[]>(() => {
    return [
      {
        id: 'profile',
        title: 'My Profile & Logins',
        path: '/profile',
        count: this.myLoginAttempts().count,
        notReadable: this.myLoginAttempts().notReadable,
        description: 'Account settings, personal credentials, and recent login history.',
        icon: 'person',
      },
      {
        id: 'consent',
        title: 'Consent & Privacy',
        path: '/profile',
        count: this.consentPurposes().count,
        notReadable: this.consentPurposes().notReadable,
        description: 'Configured consent purposes and data privacy preferences.',
        icon: 'privacy_tip',
      },
      {
        id: 'users',
        title: 'Users Administration',
        path: '/users',
        count: this.usersMetric().count,
        notReadable: this.usersMetric().notReadable,
        description: 'Members registered in the database within your authorization grant.',
        icon: 'group',
      },
      {
        id: 'blocked',
        title: 'Blocked & Disabled',
        path: '/blocked',
        count: this.blockedMetric().count,
        notReadable: this.blockedMetric().notReadable,
        description: 'Disabled accounts, temporary suspensions, and administrative actions.',
        icon: 'block',
      },
      {
        id: 'groups',
        title: 'Groups (Scope Axis)',
        path: '/admin/groups',
        count: this.groupsMetric().count,
        notReadable: this.groupsMetric().notReadable,
        description: 'Organization group hierarchy governing data access scopes.',
        icon: 'domain',
      },
      {
        id: 'roles',
        title: 'Roles (Capability Axis)',
        path: '/admin/roles',
        count: this.rolesMetric().count,
        notReadable: this.rolesMetric().notReadable,
        description: 'Role permissions and capability assignments.',
        icon: 'admin_panel_settings',
      },
      {
        id: 'security-alerts',
        title: 'Security Alerts',
        path: '/admin/security-alerts',
        count: this.alertsMetric().count,
        notReadable: this.alertsMetric().notReadable,
        description: 'Admin notifications and system security alerts requiring attention.',
        icon: 'notifications_active',
      },
      {
        id: 'ip-reputation',
        title: 'IP Reputation',
        path: '/admin/ip-reputation',
        count: this.ipReputationMetric().count,
        notReadable: this.ipReputationMetric().notReadable,
        description: 'Monitored IP addresses with reputation scores and automated blocks.',
        icon: 'public',
      },
      {
        id: 'pattern-detection',
        title: 'Pattern Detection',
        path: '/admin/pattern-detection',
        count: this.patternsMetric().count,
        notReadable: this.patternsMetric().notReadable,
        description: 'Attack pattern telemetry identifying coordinated credential pressure.',
        icon: 'psychology',
      },
      {
        id: 'login-attempts',
        title: 'Login Monitoring',
        path: '/admin/login-attempts',
        count: this.loginAttemptsMetric().count,
        notReadable: this.loginAttemptsMetric().notReadable,
        description: 'Recorded login ledger entries for brute-force tracking.',
        icon: 'history',
      },
    ];
  });

  constructor() {
    this.loadAllMetrics();
  }

  loadAllMetrics(): void {
    // 1. Profile & user login attempts
    this.profileApi.me().subscribe({
      next: (me) => this.profile.set(me),
      error: () => this.profile.set(null),
    });

    this.profileApi.loginAttempts().subscribe({
      next: (attempts) => this.myLoginAttempts.set({ count: attempts.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.myLoginAttempts, err),
    });

    // 2. Consent purposes
    this.consentApi.purposes().subscribe({
      next: (purposes) => this.consentPurposes.set({ count: purposes.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.consentPurposes, err),
    });

    // 3. Users count
    const scope = columnScopeFor(this.session.databaseRole());
    this.usersApi.users(scope).subscribe({
      next: (users) => this.usersMetric.set({ count: users.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.usersMetric, err),
    });

    // 4. Blocked users
    this.blockedApi.blockedUsers().subscribe({
      next: (blocked) => this.blockedMetric.set({ count: blocked.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.blockedMetric, err),
    });

    // 5. Groups
    this.authzApi.scope().subscribe({
      next: (scopeData) => this.groupsMetric.set({ count: scopeData.groups.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.groupsMetric, err),
    });

    // 6. Roles
    this.authzApi.capability().subscribe({
      next: (cap) => this.rolesMetric.set({ count: cap.roles.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.rolesMetric, err),
    });

    // 7. Security alerts / notifications
    this.notificationApi.notifications().subscribe({
      next: (alerts) => this.alertsMetric.set({ count: alerts.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.alertsMetric, err),
    });

    // 8. IP Reputation
    this.telemetryApi.ipReputation().subscribe({
      next: (ips) => this.ipReputationMetric.set({ count: ips.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.ipReputationMetric, err),
    });

    // 9. Detected patterns
    this.telemetryApi.detectedPatterns().subscribe({
      next: (patterns) => this.patternsMetric.set({ count: patterns.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.patternsMetric, err),
    });

    // 10. Login attempts
    this.telemetryApi.loginAttempts().subscribe({
      next: (attempts) => this.loginAttemptsMetric.set({ count: attempts.length, notReadable: false }),
      error: (err: unknown) => this.handleError(this.loginAttemptsMetric, err),
    });
  }

  private handleError(target: { set: (v: MetricState) => void }, err: unknown): void {
    if (err instanceof HttpErrorResponse && (err.status === 403 || err.status === 401)) {
      target.set({ count: null, notReadable: true });
    } else {
      target.set({ count: null, notReadable: true });
    }
  }
}
