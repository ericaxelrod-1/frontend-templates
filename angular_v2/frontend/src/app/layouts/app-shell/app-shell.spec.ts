import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { vi } from 'vitest';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session.service';
import { AppShell } from './app-shell';

/**
 * A stub `Session`. Permitted here and only here (AGENTS.md §2.2): the shell needs
 * the role to display and a `logout` to call, and the real service would open an
 * HTTP resource. `Session`'s own behaviour is asserted in `session.service.spec.ts`.
 */
class SessionStub {
  readonly databaseRole = signal<string | null>('app_admin');
  readonly logout = vi.fn();
}

/**
 * Every path the application can actually serve: routes carrying a `loadComponent`,
 * with child segments folded into the parent path.
 */
function pagePaths(config: Routes, prefix = ''): string[] {
  const served: string[] = [];
  for (const route of config) {
    const full = join(prefix, route.path ?? '');
    if (route.loadComponent !== undefined) {
      served.push(full);
    }
    served.push(...pagePaths(route.children ?? [], full));
  }
  return served;
}

function join(prefix: string, segment: string): string {
  const path = `${prefix}/${segment}`.replace(/\/{2,}/g, '/');
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

describe('AppShell', () => {
  let fixture: ComponentFixture<AppShell>;
  let session: SessionStub;

  beforeEach(async () => {
    session = new SessionStub();
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideRouter(routes), { provide: Session, useValue: session }],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders the brand, the navigation and an outlet for the routed page', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.shell__brand')?.textContent).toBe('angular_v2');
    expect(element.querySelector('mat-nav-list')).not.toBeNull();
    expect(element.querySelector('.shell__content router-outlet')).not.toBeNull();
  });

  it('shows one link per navigation item, each pointing where it says it does', () => {
    const element = fixture.nativeElement as HTMLElement;
    const links = Array.from(element.querySelectorAll('a[mat-list-item]'));

    expect(links.length).toBe(fixture.componentInstance['navItems'].length);
    for (const link of links) {
      expect(link.textContent?.trim()).not.toBe('');
      expect(link.getAttribute('href')).toMatch(/^\//);
    }
  });

  /**
   * The reason `NAV_ITEMS` is checked against the route table rather than left to
   * review: a link to a route nobody built renders an empty page that looks fine,
   * which is the failure AGENTS.md §2.1 warns about. This fails if a navigation
   * entry is added before its page exists.
   */
  it('links only to routes the application actually serves', () => {
    const served = pagePaths(routes);

    for (const item of fixture.componentInstance['navItems']) {
      expect(served).toContain(item.path);
    }
  });

  it('offers sign-out, and delegates the session teardown to the session', () => {
    const element = fixture.nativeElement as HTMLElement;
    const signOut = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Sign out'),
    );

    expect(signOut).toBeDefined();
    signOut?.click();
    expect(session.logout).toHaveBeenCalledOnce();
  });

  it('shows the database role the token carries', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.shell__role')?.textContent).toBe('app_admin');
  });
});