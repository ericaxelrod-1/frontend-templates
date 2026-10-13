import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsController } from './permissions.controller';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from '../guards/permission.guard';
import { PermissionsService } from '../services/permissions.service';
import { ManifestService } from '../scanners/manifest.service';
import { ComponentScannerService } from '../scanners/component-scanner.service';
import { RouteScannerService } from '../scanners/route-scanner.service';
import { EndpointScannerService } from '../scanners/endpoint-scanner.service';
import { CacheSyncService } from '../../cache/cache-sync.service';

/**
 * Why this file drives real HTTP requests instead of calling the guard directly.
 *
 * `@RequirePermission` writes metadata; `PermissionGuard` reads it. Neither is
 * the wiring that connects them. A handler can carry a correct, present,
 * inert requirement and be reachable by any authenticated user — which is
 * exactly how `create`, `update` and `remove` shipped open. Calling
 * `guard.canActivate(context)` by hand bypasses Nest's guard resolution
 * entirely and therefore passes whether or not the guard is wired; a spec built
 * that way cannot fail for the defect it is meant to catch.
 *
 * So the tests below stand up the real controller behind the real Fastify
 * adapter and let Nest resolve the guard chain itself. Reverting the wiring
 * turns these red.
 */
describe('PermissionsController', () => {
  describe('authorization', () => {
    type Held = string[];

    interface Harness {
      app: NestFastifyApplication;
      moduleRef: TestingModule;
      checkUserPermission: jest.Mock;
      permissionsService: Record<string, jest.Mock>;
    }

    const CALLER = { id: 42, email: 'member@example.com' };

    /**
     * A real Nest application around the real controller and the real
     * PermissionGuard. Only the collaborators below the controller are stubbed,
     * and the one answer that matters — "does this caller hold this
     * permission?" — comes from an explicit held-set, so "this member can do
     * this" is a fact the test states rather than an assumption it inherits.
     */
    async function appFor(held: Held): Promise<Harness> {
      const checkUserPermission = jest.fn(
        async (_userId: number, resource: string, action: string) =>
          held.includes(`${resource}:${action}`),
      );

      const permissionsService: Record<string, jest.Mock> = {
        checkUserPermission,
        findAll: jest.fn().mockResolvedValue([]),
        findById: jest.fn().mockResolvedValue({ id: 1, name: 'reports:view' }),
        create: jest.fn().mockImplementation(async (dto: object) => ({
          id: 99,
          ...dto,
        })),
        update: jest
          .fn()
          .mockImplementation(async (id: number, dto: object) => ({
            id,
            ...dto,
          })),
        delete: jest.fn().mockResolvedValue(undefined),
        updateUserPermission: jest.fn().mockResolvedValue({ granted: true }),
        getRolePermissions: jest.fn().mockResolvedValue([]),
        getAllComponents: jest.fn().mockResolvedValue([]),
        getAllRoutes: jest.fn().mockResolvedValue([]),
        getAllEndpoints: jest.fn().mockResolvedValue([]),
        findAllResources: jest.fn().mockResolvedValue([]),
        findAllActions: jest.fn().mockResolvedValue([]),
        getComponentById: jest.fn().mockResolvedValue({ id: 'c1' }),
        getRouteById: jest.fn().mockResolvedValue({ id: 'r1' }),
        getEndpointById: jest.fn().mockResolvedValue({ id: 'e1' }),
        updateComponentPermissions: jest
          .fn()
          .mockImplementation(async (id: string, permissions: string[]) => ({
            id,
            permissions,
          })),
        updateRoutePermissions: jest
          .fn()
          .mockImplementation(async (id: string, permissions: string[]) => ({
            id,
            permissions,
          })),
        updateEndpointPermissions: jest
          .fn()
          .mockImplementation(async (id: string, permissions: string[]) => ({
            id,
            permissions,
          })),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [PermissionsController],
        providers: [
          // The real guard, wired by Nest exactly as the decorator asks.
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: permissionsService },
          { provide: ManifestService, useValue: { getManifest: jest.fn() } },
          {
            provide: ComponentScannerService,
            useValue: { scanComponents: jest.fn() },
          },
          { provide: RouteScannerService, useValue: { scanRoutes: jest.fn() } },
          {
            provide: EndpointScannerService,
            useValue: { scanEndpoints: jest.fn() },
          },
          {
            provide: CacheSyncService,
            useValue: { syncAllPermissions: jest.fn() },
          },
        ],
      })
        // Authentication is out of scope here and is exercised elsewhere; what
        // matters is that the guard chain runs with an authenticated caller.
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = CALLER;
            return true;
          },
        })
        .compile();

      const app =
        moduleRef.createNestApplication<NestFastifyApplication>(
          new FastifyAdapter(),
        );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      return { app, moduleRef, checkUserPermission, permissionsService };
    }

    let harness: Harness | undefined;

    async function withApp<T>(held: Held, body: (h: Harness) => Promise<T>) {
      harness = await appFor(held);
      try {
        return await body(harness);
      } finally {
        await harness.app.close();
        harness = undefined;
      }
    }

    afterEach(async () => {
      if (harness) {
        await harness.app.close();
        harness = undefined;
      }
    });

    describe('the defect this file exists for', () => {
      it('REFUSES a plain member on create, update and remove with 403', async () => {
        await withApp(['users:view', 'dashboard:view'], async ({ app }) => {
          const create = await app.inject({
            method: 'POST',
            url: '/permissions',
            payload: { resourceName: 'reports', actionName: 'export' },
          });
          const update = await app.inject({
            method: 'PUT',
            url: '/permissions/1',
            payload: { description: 'renamed by a member' },
          });
          const remove = await app.inject({
            method: 'DELETE',
            url: '/permissions/1',
          });

          expect(create.statusCode).toBe(403);
          expect(update.statusCode).toBe(403);
          expect(remove.statusCode).toBe(403);
        });
      });

      it('never reaches the service on a refused write', async () => {
        // A 403 raised after the fact would still be a privilege escalation if
        // the row had already been written. The service must not be called.
        await withApp(['users:view'], async ({ app, permissionsService }) => {
          await app.inject({
            method: 'POST',
            url: '/permissions',
            payload: { resourceName: 'reports', actionName: 'export' },
          });
          await app.inject({
            method: 'PUT',
            url: '/permissions/1',
            payload: { description: 'renamed' },
          });
          await app.inject({ method: 'DELETE', url: '/permissions/1' });

          expect(permissionsService.create).not.toHaveBeenCalled();
          expect(permissionsService.update).not.toHaveBeenCalled();
          expect(permissionsService.delete).not.toHaveBeenCalled();
        });
      });

      it('ALLOWS a member holding permissions:create on create, and the row is written', async () => {
        await withApp(['permissions:create'], async ({ app, permissionsService }) => {
          const response = await app.inject({
            method: 'POST',
            url: '/permissions',
            payload: { resourceName: 'reports', actionName: 'export' },
          });

          expect(response.statusCode).toBe(201);
          expect(permissionsService.create).toHaveBeenCalledTimes(1);
        });
      });

      it('ALLOWS a member holding permissions:update on update only', async () => {
        await withApp(['permissions:update'], async ({ app }) => {
          const update = await app.inject({
            method: 'PUT',
            url: '/permissions/1',
            payload: { description: 'renamed' },
          });
          const remove = await app.inject({
            method: 'DELETE',
            url: '/permissions/1',
          });

          expect(update.statusCode).toBe(200);
          expect(remove.statusCode).toBe(403);
        });
      });

      it('ALLOWS a member holding permissions:delete on delete only', async () => {
        await withApp(['permissions:delete'], async ({ app }) => {
          const remove = await app.inject({
            method: 'DELETE',
            url: '/permissions/1',
          });
          const create = await app.inject({
            method: 'POST',
            url: '/permissions',
            payload: { resourceName: 'reports', actionName: 'export' },
          });

          expect(remove.statusCode).toBe(200);
          expect(create.statusCode).toBe(403);
        });
      });

      it('REFUSES a member holding only the read capability on every write', async () => {
        // Read and write are separate capabilities. `permissions:view` must not
        // imply write, least of all on the permission table itself.
        await withApp(
          ['permissions:view', 'permissions:list'],
          async ({ app }) => {
            expect(
              (
                await app.inject({
                  method: 'POST',
                  url: '/permissions',
                  payload: { resourceName: 'reports', actionName: 'export' },
                })
              ).statusCode,
            ).toBe(403);
            expect(
              (
                await app.inject({
                  method: 'PUT',
                  url: '/permissions/1',
                  payload: { description: 'renamed' },
                })
              ).statusCode,
            ).toBe(403);
            expect(
              (await app.inject({ method: 'DELETE', url: '/permissions/1' }))
                .statusCode,
            ).toBe(403);
          },
        );
      });

      it('asks the permission service about the handler’s own capability', async () => {
        // Proof the denial came from the requirement on the handler rather than
        // from an unrelated failure.
        await withApp(['users:view'], async ({ app, checkUserPermission }) => {
          await app.inject({ method: 'DELETE', url: '/permissions/1' });

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'permissions',
            'delete',
          );
        });
      });
    });

    describe('the read handlers', () => {
      it('gates findAll on permissions:list and findOne on permissions:view', async () => {
        await withApp(['permissions:list'], async ({ app }) => {
          expect((await app.inject({ method: 'GET', url: '/permissions' })).statusCode).toBe(200);
          expect(
            (await app.inject({ method: 'GET', url: '/permissions/1' })).statusCode,
          ).toBe(403);
        });

        await withApp(['permissions:view'], async ({ app }) => {
          expect(
            (await app.inject({ method: 'GET', url: '/permissions/1' })).statusCode,
          ).toBe(200);
          expect((await app.inject({ method: 'GET', url: '/permissions' })).statusCode).toBe(403);
        });
      });

      it('REFUSES an unrelated capability on both', async () => {
        await withApp(['users:view'], async ({ app }) => {
          expect((await app.inject({ method: 'GET', url: '/permissions' })).statusCode).toBe(403);
          expect(
            (await app.inject({ method: 'GET', url: '/permissions/1' })).statusCode,
          ).toBe(403);
        });
      });
    });

    describe('the component, route and endpoint handlers', () => {
      // These carried the same defect: a `@RequirePermission` that nothing
      // enforced, so any authenticated user could rewrite the permission set
      // attached to a UI component, a frontend route or an API endpoint.
      const writes: Array<[string, string]> = [
        ['PUT', '/permissions/components/c1/permissions'],
        ['PUT', '/permissions/routes/r1/permissions'],
        ['PUT', '/permissions/endpoints/e1/permissions'],
      ];
      const reads: Array<[string, string]> = [
        ['GET', '/permissions/components'],
        ['GET', '/permissions/routes'],
        ['GET', '/permissions/endpoints'],
      ];

      it('REFUSES a member holding only permissions:view on every write', async () => {
        await withApp(['permissions:view'], async ({ app }) => {
          for (const [method, url] of writes) {
            expect(
              (await app.inject({ method: method as 'PUT', url, payload: { permissions: ['a'] } }))
                .statusCode,
            ).toBe(403);
          }
        });
      });

      it('ALLOWS a member holding permissions:update on every write', async () => {
        await withApp(['permissions:update'], async ({ app }) => {
          for (const [method, url] of writes) {
            expect(
              (await app.inject({ method: method as 'PUT', url, payload: { permissions: ['a'] } }))
                .statusCode,
            ).toBe(200);
          }
        });
      });

      it('leaves the already-wired read handlers reachable for permissions:view', async () => {
        // Control group: these carried `@UseGuards(PermissionGuard)` before this
        // change and must not have regressed.
        await withApp(['permissions:view'], async ({ app }) => {
          for (const [method, url] of [
            ...reads,
            ['GET', '/permissions/resources/all'],
            ['GET', '/permissions/actions/all'],
          ] as Array<[string, string]>) {
            expect(
              (await app.inject({ method: method as 'GET', url })).statusCode,
            ).toBe(200);
          }
        });
      });

      it('still refuses the already-wired read handlers to a member without the capability', async () => {
        await withApp(['users:view'], async ({ app }) => {
          for (const [method, url] of [
            ...reads,
            ['GET', '/permissions/resources/all'],
            ['GET', '/permissions/actions/all'],
          ] as Array<[string, string]>) {
            expect(
              (await app.inject({ method: method as 'GET', url })).statusCode,
            ).toBe(403);
          }
        });
      });
    });

    describe('AND requirements survive the wiring', () => {
      it('requires both capabilities on updateUserPermission', async () => {
        await withApp(['permissions:manage'], async ({ app }) => {
          expect(
            (
              await app.inject({
                method: 'PUT',
                url: '/permissions/user/7/permission/1',
                payload: { granted: true },
              })
            ).statusCode,
          ).toBe(403);
        });

        await withApp(['permissions:manage', 'users:manage'], async ({ app }) => {
          expect(
            (
              await app.inject({
                method: 'PUT',
                url: '/permissions/user/7/permission/1',
                payload: { granted: true },
              })
            ).statusCode,
          ).toBe(200);
        });
      });

      it('requires roles:manage to read a role’s permissions', async () => {
        await withApp(['permissions:view'], async ({ app }) => {
          expect(
            (await app.inject({ method: 'GET', url: '/permissions/role/1' }))
              .statusCode,
          ).toBe(403);
        });
      });
    });
  });

  describe('wiring', () => {
    /**
     * Structural assertions about the wiring itself, kept alongside the
     * behavioural ones so a future edit that un-wires a handler names the
     * handler instead of producing one anonymous 403.
     */
    const handlerNames = () =>
      Object.getOwnPropertyNames(PermissionsController.prototype).filter(
        (name) => name !== 'constructor',
      );

    const handlerOf = (name: string) =>
      (
        PermissionsController.prototype as unknown as Record<string, unknown>
      )[name];

    const requirementOf = (name: string) =>
      Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(name));

    const guardsOf = (name: string) =>
      Reflect.getOwnMetadata('__guards__', handlerOf(name)) as
        | unknown[]
        | undefined;

    it('wires PermissionGuard onto every handler that carries permission metadata', () => {
      const unguarded = handlerNames()
        .filter((name) => requirementOf(name) !== undefined)
        .filter((name) => !(guardsOf(name) ?? []).includes(PermissionGuard))
        .map((name) => ({
          handler: name,
          requirement: requirementOf(name),
          guards: guardsOf(name) ?? [],
        }));

      expect(unguarded).toEqual([]);
    });

    it('wires PermissionGuard exactly once per guarded handler', () => {
      const doubled = handlerNames()
        .filter((name) => requirementOf(name) !== undefined)
        .map((name) => ({
          handler: name,
          occurrences: (guardsOf(name) ?? []).filter(
            (guard) => guard === PermissionGuard,
          ).length,
        }))
        .filter((entry) => entry.occurrences !== 1);

      expect(doubled).toEqual([]);
    });

    it('still authenticates every route', () => {
      expect(
        Reflect.getMetadata('__guards__', PermissionsController),
      ).toContain(JwtAuthGuard);
    });

    it('carries no class-level permission, because the guard OR-merges it with the handler permission', () => {
      // A class-level @RequirePermission is concatenated with the handler's and
      // evaluated with OR, so a broad gate up here would make every narrow
      // requirement below it meaningless. The requirement has to live on the
      // handler, where it is the only thing the guard evaluates.
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, PermissionsController),
      ).toBeUndefined();
    });

    it('gives every handler a deliberate permission posture', () => {
      // Handlers carrying no requirement are either scoped to the caller's own
      // identity or make their own decision. Enumerating them means a new route
      // cannot slip in as "no requirement, therefore open".
      const withoutMetadata = {
        checkPermission:
          'exposure not closed here: it answers one boolean per (caller-supplied userId, permission) pair',
        getUserPermissions: 'reads only the calling user',
        testRouteAccess: 'reads only the calling user',
        testEndpointAccess: 'reads only the calling user',
        seedDefaultPermissions: 'hand-rolled admin check in the handler body',
      } as const;

      expect(
        handlerNames().filter((name) => requirementOf(name) === undefined).sort(),
      ).toEqual(Object.keys(withoutMetadata).sort());
    });

    it('uses the non-deprecated @RequirePermission spelling everywhere', () => {
      // `@RequirePermissions` writes the same metadata key and is marked
      // @deprecated. Two spellings for one concept is how the two drift apart,
      // and the deprecated one has no other caller in the backend.
      const source = readFileSync(join(__dirname, 'permissions.controller.ts'), 'utf8');

      expect(source).not.toContain('require-permissions.decorator');
      expect(source).toContain(
        "from '../decorators/require-permission.decorator'",
      );
    });
  });

  describe('guard semantics over the real metadata', () => {
    /**
     * These call the guard directly, so they prove the OR/AND evaluation over
     * the controller's real metadata rather than the wiring. They complement,
     * and do not replace, the HTTP-level tests above: on their own they would
     * still pass with the guard un-wired.
     */
    async function guardFor(held: string[]) {
      const checkUserPermission = jest.fn(
        async (_userId: number, resource: string, action: string) =>
          held.includes(`${resource}:${action}`),
      );
      const moduleRef = await Test.createTestingModule({
        providers: [
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: { checkUserPermission } },
        ],
      }).compile();

      return { guard: moduleRef.get(PermissionGuard), checkUserPermission, moduleRef };
    }

    function contextFor(handlerName: string): ExecutionContext {
      return {
        getHandler: () =>
          (
            PermissionsController.prototype as unknown as Record<string, unknown>
          )[handlerName],
        getClass: () => PermissionsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 42, email: 'member@example.com' },
          }),
        }),
      } as unknown as ExecutionContext;
    }

    it('keeps create, update and delete as three independent capabilities', async () => {
      const routes = ['create', 'update', 'remove'] as const;
      const heldFor = (route: (typeof routes)[number]) =>
        `permissions:${route === 'create' ? 'create' : route === 'update' ? 'update' : 'delete'}`;

      for (const route of routes) {
        for (const other of routes) {
          const { guard, moduleRef } = await guardFor([heldFor(other)]);
          const outcome = guard.canActivate(contextFor(route));

          if (other === route) {
            await expect(outcome).resolves.toBe(true);
          } else {
            await expect(outcome).rejects.toBeInstanceOf(ForbiddenException);
          }

          await moduleRef.close();
        }
      }
    });

    it('throws Forbidden rather than returning false, so Nest emits 403', async () => {
      const { guard, moduleRef } = await guardFor([]);

      await expect(guard.canActivate(contextFor('create'))).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await moduleRef.close();
    });
  });
});