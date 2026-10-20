import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { BlockedApi } from '../blocked-api.service';
import type { DisabledUserRow } from '../blocked.types';
import { BlockedPage } from './blocked-page';

describe('BlockedPage', () => {
  let fixture: ComponentFixture<BlockedPage>;
  let api: {
    blockedUsers: ReturnType<typeof vi.fn>;
    reEnable: ReturnType<typeof vi.fn>;
  };

  const mockUsers: DisabledUserRow[] = [
    {
      id: 'u-perm',
      username: 'carol',
      email: 'carol@example.org',
      created_at: '2026-01-01T00:00:00Z',
      first_name: 'Carol',
      last_name: 'Danvers',
      disabled_at: '2026-06-01T10:00:00Z',
      disabled_by: '0192e210-admin-0000-0000-000000000001',
      disabled_reason: 'admin',
      disabled_until: null, // permanent
    },
    {
      id: 'u-temp-active',
      username: 'dave',
      email: 'dave@example.org',
      created_at: '2026-02-01T00:00:00Z',
      first_name: 'Dave',
      last_name: 'Bowman',
      disabled_at: '2026-06-01T10:00:00Z',
      disabled_by: null, // automated
      disabled_reason: 'security',
      disabled_until: '2099-01-01T00:00:00Z', // future / active
    },
  ];

  beforeEach(async () => {
    api = {
      blockedUsers: vi.fn().mockReturnValue(of(mockUsers)),
      reEnable: vi.fn().mockReturnValue(of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [BlockedPage],
      providers: [{ provide: BlockedApi, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(BlockedPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders disabled accounts with who disabled them and when', () => {
    const root = fixture.nativeElement as HTMLElement;

    expect(api.blockedUsers).toHaveBeenCalled();
    expect(root.textContent).toContain('carol');
    expect(root.textContent).toContain('dave');

    // Who disabled: administrator vs automated
    expect(root.textContent).toContain('0192e210-admin-0000-0000-000000000001');
    expect(root.textContent).toContain('Automated system');

    // Reason
    expect(root.textContent).toContain('administrator action');
    expect(root.textContent).toContain('automated security block');
  });

  it('distinguishes permanent from temporary disables', () => {
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Permanent disable');
    expect(root.textContent).toContain('Temporary suspension (active)');
  });

  it('allows an administrator to re-enable an account', () => {
    const component = fixture.componentInstance;
    component['reEnableAccount'](mockUsers[0]);
    fixture.detectChanges();

    expect(api.reEnable).toHaveBeenCalledWith('u-perm');
    expect(component['feedback']()).toContain('carol');
  });

  it('shows what existing admin pages show a non-administrator ("not readable for this role")', async () => {
    api.blockedUsers.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })),
    );

    const nonAdminFixture = TestBed.createComponent(BlockedPage);
    nonAdminFixture.detectChanges();
    await nonAdminFixture.whenStable();

    const root = nonAdminFixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('not readable for this role');
  });
});
