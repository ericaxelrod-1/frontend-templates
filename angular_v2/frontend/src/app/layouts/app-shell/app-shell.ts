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
 * One entry per route that exists. `app-shell.spec.ts` resolves every one of
 * these against the router configuration, so a nav link to a route nobody built
 * fails a test instead of rendering an empty page (AGENTS.md §2.1).
 */
const NAV_ITEMS = [{ label: 'Users', path: '/users' }] as const;

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

  protected readonly navItems = NAV_ITEMS;

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