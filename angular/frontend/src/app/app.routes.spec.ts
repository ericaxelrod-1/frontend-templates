import { Route, Router, Routes } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { routes } from './app.routes';

interface Match {
  route: Route;
  wildcard: boolean;
}

type LazyRouteLoader = () => Promise<Routes>;

/**
 * Resolve every `loadChildren` in the table so the matcher sees the real tree.
 * `app.routes.ts` mounts `auth.routes` and `profile.routes` this way, and
 * `/login` only exists inside one of them.
 */
async function expand(table: Routes): Promise<Routes> {
  const out: Routes = [];

  for (const route of table) {
    const expanded: Route = { ...route };

    if (route.children?.length) {
      expanded.children = await expand(route.children);
    }

    if (typeof route.loadChildren === 'function') {
      const loaded = (await (route.loadChildren as unknown as LazyRouteLoader)()) as Routes;
      expanded.children = [...(expanded.children ?? []), ...(await expand(loaded))];
      expanded.loadChildren = undefined;
    }

    out.push(expanded);
  }

  return out;
}

/**
 * Walk the route table the way Angular does: one candidate at a time, consuming
 * as many segments as the route's (possibly compound) path declares, and
 * backtracking when a child level cannot complete the URL. `**` is a last
 * resort, never an early match.
 */
function search(table: Routes, segments: string[]): Route | null {
  let catchAll: Route | null = null;

  for (const route of table) {
    const path = String(route.path ?? '');

    if (path === '**') {
      catchAll = route;
      continue;
    }

    const declared = path.split('/').filter((s) => s.length > 0);

    const matches = declared.every(
      (part, i) => part.startsWith(':') || part === segments[i],
    );

    if (!matches) {
      continue;
    }

    const rest = segments.slice(declared.length);

    if (rest.length === 0) {
      return route;
    }

    const nested = search((route.children ?? []) as Routes, rest);
    if (nested) {
      return nested;
    }
  }

  return catchAll;
}

/**
 * Every one of these was a dead navigation target: no route declared the path,
 * so it fell through to the `**` catch-all, which redirects to '/'. A signed-in
 * user hitting an auth failure or a stale link was ejected to the public
 * marketing page instead of the login, denial or feature screen.
 */
const REPAIRED = [
  { url: '/login', why: '401 target from PermissionInterceptor (was /auth/login)' },
  { url: '/access-denied', why: '403 target from PermissionInterceptor (route did not exist)' },
  { url: '/app/dashboard', why: 'bare /dashboard fell through to the catch-all' },
  { url: '/app/users', why: 'bare /users fell through to the catch-all' },
  { url: '/app/profile/change-password', why: 'bare /profile/change-password fell through' },
  { url: '/app/admin/login-monitoring', why: 'bare /admin/login-monitoring fell through' },
];

const DEAD = [
  '/auth/login',
  '/dashboard',
  '/users',
  '/profile/change-password',
  '/admin/login-monitoring',
  '/app/settings',
  '/app/notifications',
  '/app/admin/login-monitoring/attempt/1',
];

describe('app routes', () => {
  let table: Routes;

  beforeAll(async () => {
    table = await expand(routes);
  });

  const match = (url: string): Match => {
    const segments = url.split('/').filter((s) => s.length > 0);
    const route = search(table, segments);
    return { route: route ?? { path: '**', redirectTo: '/' }, wildcard: route === null || route.path === '**' };
  };

  describe('repaired navigation targets resolve to a real route', () => {
    for (const { url, why } of REPAIRED) {
      it(`'${url}' is a declared route, not the catch-all (${why})`, () => {
        expect(match(url).wildcard).toBe(false);
      });
    }
  });

  describe('the paths these replaced still fall through, so they cannot creep back unnoticed', () => {
    for (const url of DEAD) {
      it(`'${url}' still hits the catch-all`, () => {
        expect(match(url).wildcard).toBe(true);
      });
    }
  });

  describe('/access-denied', () => {
    it('lazily loads AccessDeniedComponent, which must therefore be standalone', async () => {
      const { route } = match('/access-denied');

      expect(typeof route.loadComponent).toBe('function');

      const loaded = await (route.loadComponent as unknown as () => Promise<{ name: string }>)();
      expect(loaded.name).toBe('AccessDeniedComponent');
    });

    it('carries no guard, so a 403 raised during session teardown cannot redirect-loop', () => {
      const { route } = match('/access-denied');

      expect(route.canActivate).toBeUndefined();
    });

    it('resolves through the real Angular router, not only the matcher above', async () => {
      TestBed.configureTestingModule({
        imports: [
          RouterTestingModule.withRoutes([
            {
              path: 'access-denied',
              loadComponent: async () =>
                (await import('./shared/components/access-denied/access-denied.component'))
                  .AccessDeniedComponent,
            },
          ]),
        ],
      });
      await TestBed.compileComponents();

      const router = TestBed.inject(Router);
      const result = await router.navigateByUrl('/access-denied');

      expect(result).toBe(true);
      expect(router.url).toBe('/access-denied');
    });
  });
});
