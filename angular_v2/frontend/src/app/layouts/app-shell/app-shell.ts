import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule, type MatDrawerMode } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs/operators';
import { Session } from '../../core/auth/session.service';

/**
 * Who an entry is FOR, not whether the route exists.
 *
 * `'every-member'` is for a destination every signed-in user can act on;
 * `'app_admin'` is for one that answers a question only an administrator is asking.
 * The route behind either exists either way — this decides who is OFFERED it, and
 * nothing else. `UsersPage` is reachable by a member who types the URL, and it
 * renders what their grant allows plus "not readable for this role" for the rest
 * (AGENTS.md §F7: a hidden link is not access control, and the database is the
 * authority).
 */
type NavAudience = 'every-member' | 'app_admin';

/**
 * One entry per route that exists. `app-shell.spec.ts` resolves every one of
 * these against the router configuration, so a nav link to a route nobody built
 * fails a test instead of rendering an empty page (AGENTS.md §2.1).
 *
 * The audience is declared HERE, on the one list, rather than by maintaining two
 * lists. A second copy is a second thing to forget to update: the failure mode is
 * a nav that offers `/users` to a member, or hides it from an administrator, and
 * neither is caught by a test that only checks the links resolve.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { label: 'My profile', path: '/profile', audience: 'every-member' },
  { label: 'Users', path: '/users', audience: 'app_admin' },
  { label: 'Groups', path: '/admin/groups', audience: 'app_admin' },
  { label: 'Roles', path: '/admin/roles', audience: 'app_admin' },
  { label: 'Security alerts', path: '/admin/security-alerts', audience: 'app_admin' },
  { label: 'IP reputation', path: '/admin/ip-reputation', audience: 'app_admin' },
  { label: 'Pattern detection', path: '/admin/pattern-detection', audience: 'app_admin' },
  { label: 'Login monitoring', path: '/admin/login-monitoring', audience: 'app_admin' },
  { label: 'Login attempts', path: '/admin/login-attempts', audience: 'app_admin' },
];

/** One destination in the sidenav. */
interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly audience: NavAudience;
}

/**
 * The application shell: a sidenav holding the destinations, a toolbar, and the
 * outlet the authenticated area renders into.
 *
 * The sidenav is permanent above Material's handset breakpoint and an overlay
 * below it. That is the only responsive behaviour here, and it is worth having
 * for one reason: a fixed 15rem drawer on a 360px viewport leaves nothing for
 * content.
 *
 * There is no drawer state in this component. `[opened]` is derived from the
 * breakpoint and the user's own toggle goes through `MatSidenav`, so there is no
 * second copy of "is the drawer open" that could disagree with the drawer.
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app-shell.html',
  styles: `
    :host {
      display: block;
      height: 100%;
    }

    .shell__brand {
      display: flex;
      align-items: center;
      height: 4rem;
      padding: 0 1rem;
      font: var(--mat-sys-title-medium);
    }

    .shell__toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
    }

    .shell__spacer {
      flex: 1 1 auto;
    }

    .shell__role {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }

    .shell__content {
      padding: 1rem;
    }
  `,
})
export class AppShell {
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);

  /**
   * The whole list. It is what `app-shell.spec.ts` checks against the route table,
   * and it is kept complete on purpose: a nav entry is removed from here by
   * removing its route, never by narrowing this field.
   */
  protected readonly navItems = NAV_ITEMS;

  /**
   * The subset this session is offered, derived rather than configured.
   *
   * `databaseRole()` is `null` until `/auth/me` resolves, and `null` matches
   * neither `'every-member'` by identity nor `'app_admin'`, so the sidenav starts
   * with the one destination everyone can reach and gains the administrator's once
   * the role is known. That ordering is the reason the profile entry is marked
   * `'every-member'`: the first render is the same for every session.
   */
  protected readonly visibleNavItems = computed(() => {
    const role = this.session.databaseRole();
    return NAV_ITEMS.filter((item) => item.audience === 'every-member' || item.audience === role);
  });

  /**
   * `toSignal` rather than a `BehaviorSubject`: the subscription is created and
   * torn down by the signal, so there is no subscription on this component to
   * forget. `initialValue: false` is the server's answer — `BreakpointObserver`
   * cannot measure a viewport that does not exist, and the shell is only ever
   * client-rendered anyway (`app.routes.server.ts`).
   */
  private readonly isHandset = toSignal(
    this.breakpoints.observe('(max-width: 839px)').pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  protected readonly navMode = computed<MatDrawerMode>(() => (this.isHandset() ? 'over' : 'side'));
  protected readonly databaseRole = this.session.databaseRole;

  /**
   * `Session.logout` clears the local session before it revokes the refresh
   * token, so the navigation that follows always lands on a signed-out page even
   * if the revocation request fails.
   */
  protected signOut(): void {
    this.session.logout();
    void this.router.navigateByUrl('/login');
  }
}