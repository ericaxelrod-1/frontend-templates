import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { vi } from 'vitest';
import { routes } from '../../app.routes';
import { Session } from '../../core/auth/session.service';
import { AppShell } from './app-shell';

/**
 * A stub `Session`. Permitted here and only here (AGENTS.md §2.2): the shell needs
 * the role to display and to decide which destinations to offer, and a `logout` to
 * call, and the real service would open an HTTP resource. `Session`'s own behaviour
 * is asserted in `session.service.spec.ts`.
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

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [provideRouter(routes), { provide: Session, useValue: session }],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function hrefs(): (string | null)[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a[mat-list-item]')).map(
      (link) => link.getAttribute('href'),
    );
  }

  beforeEach(async () => {
    session = new SessionStub();
    await render();
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

  /**
   * ONE list of destinations, filtered by audience — not two lists. A second copy is
   * a second thing to forget to update, and the failure is a nav that offers
   * `/users` to a member or hides it from an administrator, which no route-resolution
   * test would catch.
   */
  it('offers the administrator both destinations', () => {
    expect(hrefs()).toEqual(['/profile', '/users']);
  });

  it('offers a member only their own profile, and keeps the route itself reachable', () => {
    session.databaseRole.set('app_member');
    fixture.detectChanges();

    // Hidden from the nav because it answers an administrator's question...
    expect(hrefs()).toEqual(['/profile']);
    // ...and still a real route, because a hidden link is not access control and the
    // database is the authority (AGENTS.md §F7).
    expect(pagePaths(routes)).toContain('/users');
  });

  /**
   * `databaseRole()` is `null` until `/auth/me` resolves, so the first render is the
   * same for every session — which is the reason the profile entry is the one marked
   * for everybody rather than the Users entry.
   */
  it('offers the profile destination before the role is known', () => {
    session.databaseRole.set(null);
    fixture.detectChanges();

    expect(hrefs()).toEqual(['/profile']);
  });
});