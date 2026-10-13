import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Route, Routes } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { SidebarComponent, NavItem } from './sidebar.component';
import { TestingModule } from '../../tests/test-utils';
import { PermissionService } from '../../core/services/permission.service';
import { routes } from '../../app.routes';

/** The permissions the seeded `Administrator` role actually holds. */
const ADMINISTRATOR_PERMISSIONS = [
  'users:view',
  'users:read',
  'users:create',
  'roles:view',
  'roles:read',
  'groups:view',
  'privacy:read',
  'system:health',
];

function findRoute(configs: Routes, segments: string[]): Route | undefined {
  let current: Route[] = configs;
  let found: Route | undefined;

  for (const segment of segments) {
    found = current.find(route => route.path === segment);
    if (!found) {
      return undefined;
    }
    current = found.children ?? [];
  }

  return found;
}

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;
  let permissions: BehaviorSubject<string[]>;

  async function createWith(perms: string[]): Promise<void> {
    permissions = new BehaviorSubject<string[]>(perms);
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, TestingModule],
      providers: [
        {
          provide: PermissionService,
          useValue: {
            userPermissions$: permissions.asObservable(),
            hasPermission: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  async function visibleAdminItems(): Promise<NavItem[]> {
    return new Promise(resolve => {
      component.filteredAdminItems$.subscribe(items => resolve(items));
    });
  }

  it('should create', async () => {
    await createWith([]);

    expect(component).toBeTruthy();
  });

  describe('FR-014: every admin link resolves to a route that exists', () => {
    let adminRoute: Route;
    let items: NavItem[];

    beforeEach(async () => {
      await createWith(ADMINISTRATOR_PERMISSIONS);
      adminRoute = findRoute(routes, ['app', 'admin'])!;
      items = (component as unknown as { adminItems: NavItem[] }).adminItems;
    });

    it('finds the admin section in the route table', () => {
      expect(adminRoute).toBeDefined();
      expect(adminRoute.children).toBeDefined();
    });

    it('points every admin item at a declared child route', () => {
      const declared = new Set(
        (adminRoute.children ?? []).map(child => `/app/admin/${child.path}`),
      );

      const unresolved = items
        .map(item => item.route)
        .filter(route => !declared.has(route));

      // The old `/admin/health` and `/app/admin/privacy` fell through to the
      // `**` catch-all, which redirects to the public landing page.
      expect(unresolved).toEqual([]);
    });

    it('names the same permission on the link as on the route guard', () => {
      const guardsByPath = new Map(
        (adminRoute.children ?? []).map(child => [
          `/app/admin/${child.path}`,
          child.data?.['permissions'] as string | string[] | undefined,
        ]),
      );

      const mismatched = items
        .filter(item => item.permission)
        .filter(item => {
          const guard = guardsByPath.get(item.route);
          return guard !== item.permission;
        })
        .map(item => ({ route: item.route, link: item.permission, guard: guardsByPath.get(item.route) }));

      // `system:health` on the link against a `system:admin` guard was exactly
      // this bug: the Administrator role holds the former, so it saw the link
      // and was bounced to the dashboard.
      expect(mismatched).toEqual([]);
    });

    it('offers System Health to a user holding only system:health', async () => {
      await createWith(['system:health']);

      const visible = await visibleAdminItems();

      expect(visible.map(item => item.label)).toEqual(['System Health']);
    });

    it('hides System Health from a user without any admin permission', async () => {
      await createWith(['users:view']);

      expect(await visibleAdminItems()).toEqual([]);
    });
  });

  describe('every sidebar link stays inside the authenticated shell', () => {
    it('uses /app/... paths, so the catch-all cannot bounce a signed-in user to the landing page', async () => {
      await createWith(ADMINISTRATOR_PERMISSIONS);

      const all: NavItem[] = [
        ...(component as unknown as { commonNavItems: NavItem[] }).commonNavItems,
        ...(component as unknown as { adminNavItems: NavItem[] }).adminNavItems,
        ...(component as unknown as { adminItems: NavItem[] }).adminItems,
      ];

      expect(all.length).toBeGreaterThan(0);
      expect(all.filter(item => !item.route.startsWith('/app/'))).toEqual([]);
    });
  });
});