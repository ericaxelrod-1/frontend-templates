import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { Session } from '../../../core/auth/session.service';
import { ConsentApi } from '../../../core/consent/consent-api.service';
import { AuthorizationApi } from '../../authorization/authorization-api.service';
import { BlockedApi } from '../../blocked/blocked-api.service';
import { NotificationApi } from '../../notifications/notification-api.service';
import { ProfileApi } from '../../profile/profile-api.service';
import { SecurityTelemetryApi } from '../../security/security-telemetry-api.service';
import { UsersApi } from '../../users/users-api.service';
import { DashboardPage } from './dashboard-page';

class SessionStub {
  readonly databaseRole = signal<string | null>('app_admin');
}

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let session: SessionStub;

  let profileApi: { me: ReturnType<typeof vi.fn>; loginAttempts: ReturnType<typeof vi.fn> };
  let consentApi: { purposes: ReturnType<typeof vi.fn> };
  let usersApi: { users: ReturnType<typeof vi.fn> };
  let blockedApi: { blockedUsers: ReturnType<typeof vi.fn> };
  let authzApi: { scope: ReturnType<typeof vi.fn>; capability: ReturnType<typeof vi.fn> };
  let notificationApi: { notifications: ReturnType<typeof vi.fn> };
  let telemetryApi: {
    ipReputation: ReturnType<typeof vi.fn>;
    detectedPatterns: ReturnType<typeof vi.fn>;
    loginAttempts: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    session = new SessionStub();

    profileApi = {
      me: vi.fn().mockReturnValue(
        of({ id: 'u1', username: 'admin', email: 'admin@example.org', first_name: 'Admin' }),
      ),
      loginAttempts: vi.fn().mockReturnValue(of([{ id: 'la1' }, { id: 'la2' }])),
    };

    consentApi = {
      purposes: vi.fn().mockReturnValue(of([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])),
    };

    usersApi = {
      users: vi.fn().mockReturnValue(of([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }])),
    };

    blockedApi = {
      blockedUsers: vi.fn().mockReturnValue(of([{ id: 'b1' }])),
    };

    authzApi = {
      scope: vi.fn().mockReturnValue(of({ groups: [{ id: 'g1' }, { id: 'g2' }] })),
      capability: vi.fn().mockReturnValue(of({ roles: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] })),
    };

    notificationApi = {
      notifications: vi.fn().mockReturnValue(of([{ id: 'n1' }, { id: 'n2' }])),
    };

    telemetryApi = {
      ipReputation: vi.fn().mockReturnValue(of([{ id: 'ip1' }, { id: 'ip2' }, { id: 'ip3' }, { id: 'ip4' }, { id: 'ip5' }])),
      detectedPatterns: vi.fn().mockReturnValue(of([{ id: 'pat1' }])),
      loginAttempts: vi.fn().mockReturnValue(of([{ id: 'att1' }, { id: 'att2' }, { id: 'att3' }])),
    };

    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
        { provide: Session, useValue: session },
        { provide: ProfileApi, useValue: profileApi },
        { provide: ConsentApi, useValue: consentApi },
        { provide: UsersApi, useValue: usersApi },
        { provide: BlockedApi, useValue: blockedApi },
        { provide: AuthorizationApi, useValue: authzApi },
        { provide: NotificationApi, useValue: notificationApi },
        { provide: SecurityTelemetryApi, useValue: telemetryApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders cards with numbers that match what the linked pages services return', () => {
    const root = fixture.nativeElement as HTMLElement;

    // Profile & login attempts: 2
    expect(profileApi.loginAttempts).toHaveBeenCalled();
    // Consent purposes: 3
    expect(consentApi.purposes).toHaveBeenCalled();
    // Users: 4
    expect(usersApi.users).toHaveBeenCalled();
    // Blocked: 1
    expect(blockedApi.blockedUsers).toHaveBeenCalled();
    // Groups: 2
    expect(authzApi.scope).toHaveBeenCalled();
    // Roles: 3
    expect(authzApi.capability).toHaveBeenCalled();
    // Notifications: 2
    expect(notificationApi.notifications).toHaveBeenCalled();
    // IP reputation: 5
    expect(telemetryApi.ipReputation).toHaveBeenCalled();
    // Pattern detection: 1
    expect(telemetryApi.detectedPatterns).toHaveBeenCalled();
    // Login attempts: 3
    expect(telemetryApi.loginAttempts).toHaveBeenCalled();

    // Check that card titles exist
    expect(root.textContent).toContain('My Profile & Logins');
    expect(root.textContent).toContain('Consent & Privacy');
    expect(root.textContent).toContain('Users Administration');
    expect(root.textContent).toContain('Blocked & Disabled');
    expect(root.textContent).toContain('Groups (Scope Axis)');
    expect(root.textContent).toContain('Roles (Capability Axis)');
    expect(root.textContent).toContain('Security Alerts');
    expect(root.textContent).toContain('IP Reputation');
    expect(root.textContent).toContain('Pattern Detection');
    expect(root.textContent).toContain('Login Monitoring');
  });

  it('links each card to its corresponding real application route', () => {
    const root = fixture.nativeElement as HTMLElement;
    const links = Array.from(root.querySelectorAll('a[mat-button]')).map((a) =>
      a.getAttribute('href'),
    );

    expect(links).toContain('/profile');
    expect(links).toContain('/users');
    expect(links).toContain('/blocked');
    expect(links).toContain('/admin/groups');
    expect(links).toContain('/admin/roles');
    expect(links).toContain('/admin/security-alerts');
    expect(links).toContain('/admin/ip-reputation');
    expect(links).toContain('/admin/pattern-detection');
    expect(links).toContain('/admin/login-attempts');
  });

  it('shows "not readable for this role" for a non-administrator when backend grants are withheld', async () => {
    // Non-admin member role
    session.databaseRole.set('app_member');

    // Simulate 403 Forbidden from PostgREST for admin-only endpoints
    const forbidden = throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' }));
    blockedApi.blockedUsers.mockReturnValue(forbidden);
    authzApi.capability.mockReturnValue(forbidden);
    notificationApi.notifications.mockReturnValue(forbidden);
    telemetryApi.ipReputation.mockReturnValue(forbidden);
    telemetryApi.detectedPatterns.mockReturnValue(forbidden);
    telemetryApi.loginAttempts.mockReturnValue(forbidden);

    const nonAdminFixture = TestBed.createComponent(DashboardPage);
    nonAdminFixture.detectChanges();
    await nonAdminFixture.whenStable();

    const root = nonAdminFixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('not readable for this role');
  });
});
