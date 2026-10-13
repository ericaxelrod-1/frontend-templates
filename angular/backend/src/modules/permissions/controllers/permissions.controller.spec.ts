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

    /**
     * Either a flat held-set, which is how every caller in this file states
     * "this caller holds exactly these", or a per-user map. The map exists for
     * one reason: a test about *whose* permissions get read needs two users
     * with different answers, and a flat set cannot distinguish them.
     */
    type HeldSet = Held | Record<number, Held>;

    interface Harness {
      app: NestFastifyApplication;
      moduleRef: TestingModule;
      checkUserPermission: jest.Mock;
      permissionsService: Record<string, jest.Mock>;
    }

    const CALLER = { id: 42, email: 'member@example.com' };

    /** The victim of the disclosure tests: a different user, different grants. */
    const SUBJECT = { id: 7, email: 'other@example.com' };

    /**
     * A real Nest application around the real controller and the real
     * PermissionGuard. Only the collaborators below the controller are stubbed,
     * and the one answer that matters — "does this caller hold this
     * permission?" — comes from an explicit held-set, so "this member can do
     * this" is a fact the test states rather than an assumption it inherits.
     */
    async function appFor(held: HeldSet): Promise<Harness> {
      const holds = (userId: number): Held =>
        Array.isArray(held) ? held : (held[userId] ?? []);

      const checkUserPermission = jest.fn(
        async (userId: number, resource: string, action: string) =>
          holds(userId).includes(`${resource}:${action}`),
      );

      const permissionsService: Record<string, jest.Mock> = {
        checkUserPermission,
        findAll: jest.fn().mockResolvedValue([]),
        findById: jest.fn().mockResolvedValue({ id: 1, name: 'reports:view' }),
        getUserRoles: jest.fn().mockResolvedValue([]),
        seedDefaultPermissions: jest.fn().mockResolvedValue(undefined),
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

    async function withApp<T>(held: HeldSet, body: (h: Harness) => Promise<T>) {
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

    describe('GET /permissions/check — the permission-existence oracle', () => {
      /**
       * This handler used to take a caller-supplied `?userId=`. `resource` and
       * `action` were already caller-controlled, so with the subject also
       * caller-controlled, sweeping `(userId, resource, action)` recovered the
       * entire permission matrix of the user table — one boolean per cell, and
       * no 403 anywhere in the sweep to hint that it was not intended.
       *
       * Every test below puts the caller and the subject on *different* answers,
       * so a handler that answered about the caller and one that answered about
       * the subject cannot both pass.
       */
      async function sweepHeld(): Promise<HeldSet> {
        return {
          // The caller holds nothing. Anything the route reports true for is
          // therefore information it could not have obtained legitimately.
          [CALLER.id]: [],
          // The subject holds exactly one permission — enough to prove the
          // route would answer differently about them.
          [SUBJECT.id]: ['users:delete'],
        };
      }

      it('answers about the CALLER when handed another user’s id', async () => {
        await withApp(await sweepHeld(), async ({ app, checkUserPermission }) => {
          const response = await app.inject({
            method: 'GET',
            url: `/permissions/check/users/delete?userId=${SUBJECT.id}`,
          });

          // The subject HOLDS users:delete. The caller does not. A route that
          // honoured ?userId= would answer true here and leak it.
          expect(response.statusCode).toBe(200);
          expect(JSON.parse(response.payload)).toEqual({ hasPermission: false });

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'users',
            'delete',
          );
          expect(checkUserPermission).not.toHaveBeenCalledWith(
            SUBJECT.id,
            'users',
            'delete',
          );
        });
      });

      it('leaks nothing for any id, so the matrix cannot be swept', async () => {
        // The shape of the original attack: enumerate subjects × permissions.
        // With the subject pinned to the caller, every cell of the sweep
        // returns the caller's own answer and the victim's column is constant.
        await withApp(await sweepHeld(), async ({ app }) => {
          for (const resource of ['users', 'roles', 'permissions']) {
            for (const action of ['read', 'update', 'delete', 'manage']) {
              for (const targetId of [SUBJECT.id, 1, 999]) {
                const response = await app.inject({
                  method: 'GET',
                  url: `/permissions/check/${resource}/${action}?userId=${targetId}`,
                });

                expect(response.statusCode).toBe(200);
                expect(JSON.parse(response.payload)).toEqual({
                  hasPermission: false,
                });
              }
            }
          }
        });
      });

      it('still answers truthfully about the caller’s own permissions', async () => {
        // Self-only is not "always false". A member who holds a capability
        // must still be able to ask about it — otherwise the fix is a denial of
        // service dressed up as a security fix.
        await withApp(['reports:view'], async ({ app }) => {
          const held = await app.inject({
            method: 'GET',
            url: '/permissions/check/reports/view',
          });
          const notHeld = await app.inject({
            method: 'GET',
            url: '/permissions/check/reports/delete',
          });

          expect(JSON.parse(held.payload)).toEqual({ hasPermission: true });
          expect(JSON.parse(notHeld.payload)).toEqual({ hasPermission: false });
        });
      });

      it('ignores a junk userId rather than failing, so it is not a user-existence oracle', async () => {
        // `?userId=not-a-number` used to flow through ParseIntPipe. It must not
        // now produce a 400-vs-200 difference keyed on whether the id exists.
        await withApp([], async ({ app }) => {
          const response = await app.inject({
            method: 'GET',
            url: '/permissions/check/users/read?userId=not-a-number',
          });

          expect(response.statusCode).toBe(200);
          expect(JSON.parse(response.payload)).toEqual({ hasPermission: false });
        });
      });

      it('advertises no userId parameter at all', async () => {
        // Structural, so the parameter cannot reappear quietly. The Swagger
        // @ApiQuery that documented it was removed with the parameter — and
        // the OpenAPI spec the frontend client is generated from would
        // otherwise keep advertising a parameter the server ignores.
        const parameters = (
          Reflect.getMetadata(
            'swagger/apiParameters',
            (
              PermissionsController.prototype as unknown as Record<string, object>
            ).checkPermission,
          ) as Array<{ name?: string; in?: string }> | undefined
        ) ?? [];

        expect(parameters.map((parameter) => parameter.name)).not.toContain(
          'userId',
        );
        expect(
          parameters.filter((parameter) => parameter.in === 'query'),
        ).toEqual([]);
      });

      it('takes no userId from anywhere in the source', () => {
        // The belt to the braces above: the handler's own text mentions no
        // userId parameter, so a future edit that reintroduces one shows up as
        // a diff against this test rather than as a working route.
        const source = readFileSync(
          join(__dirname, 'permissions.controller.ts'),
          'utf8',
        );
        const handler = source.slice(
          source.indexOf('async checkPermission('),
          source.indexOf('// Get all permissions'),
        );

        expect(handler).not.toContain('userId?:');
        expect(handler).not.toContain("@Query('userId'");
      });
    });

    describe('POST /permissions/seed — no authorization by role-name string', () => {
      /**
       * This handler used to read `req.user`'s roles and match the role NAME
       * against `['admin','administrator','superadmin']` inside the handler
       * body — a second mechanism for a concern the permission model owns
       * (§2.4), and one that could not be granted, revoked or audited the way
       * a permission row can.
       *
       * It was also wrong in the shipped database. `Super Administrator`
       * lowercases to `super administrator`, which is not in that list, so the
       * single most privileged account in `db.sqlite` was refused; and `ADMIN`
       * lowercases to `admin`, which IS in the list, so a role holding no
       * permissions at all would have been let through.
       */
      it('REFUSES a plain member with 403', async () => {
        await withApp(['users:view', 'dashboard:view'], async ({ app }) => {
          const response = await app.inject({
            method: 'POST',
            url: '/permissions/seed',
          });

          expect(response.statusCode).toBe(403);
        });
      });

      it('never reaches the service on a refusal', async () => {
        // A 403 raised after the fact would still be an escalation if the
        // permission table had already been written.
        await withApp(['users:view'], async ({ app, permissionsService }) => {
          await app.inject({ method: 'POST', url: '/permissions/seed' });

          expect(permissionsService.seedDefaultPermissions).not.toHaveBeenCalled();
        });
      });

      it('REFUSES a member holding only permissions:view', async () => {
        // `permissions:view` is what the read handlers on this controller
        // require, so it is the most likely thing to be mistaken for sufficient
        // here. Seeding writes the permission table; reading it must not imply
        // that.
        await withApp(['permissions:view', 'permissions:list'], async ({ app }) => {
          expect(
            (await app.inject({ method: 'POST', url: '/permissions/seed' }))
              .statusCode,
          ).toBe(403);
        });
      });

      it('ALLOWS a member holding permissions:refresh, and the seed runs', async () => {
        // `permissions:refresh` is the capability already required by
        // `POST /permissions/sync`, the sibling operation that also writes the
        // permission table from code. Requiring the same capability is what
        // "one mechanism per concern" means here, and it is why this handler
        // needs no bespoke rule of its own.
        await withApp(['permissions:refresh'], async ({ app, permissionsService }) => {
          const response = await app.inject({
            method: 'POST',
            url: '/permissions/seed',
          });

          expect(response.statusCode).toBe(201);
          expect(permissionsService.seedDefaultPermissions).toHaveBeenCalledTimes(1);
        });
      });

      it('asks the permission service about the caller, not a role name', async () => {
        await withApp(['permissions:refresh'], async ({ app, checkUserPermission }) => {
          await app.inject({ method: 'POST', url: '/permissions/seed' });

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'permissions',
            'refresh',
          );
        });
      });

      it('does not consult the caller’s role names at all', () => {
        // The hand-rolled check is gone, not merely outranked: getUserRoles
        // was the only reader of role names in this handler, and the literal
        // list is gone with it.
        const source = readFileSync(
          join(__dirname, 'permissions.controller.ts'),
          'utf8',
        );
        const handler = source.slice(
          source.indexOf('async seedDefaultPermissions'),
        );

        expect(handler).not.toContain('getUserRoles');
        expect(handler).not.toContain("'superadmin'");
        expect(handler).not.toContain('toLowerCase()');
      });

      it('states the requirement on the handler, not only in the body', () => {
        const handler = (
          PermissionsController.prototype as unknown as Record<string, object>
        ).seedDefaultPermissions;

        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBe(
          'permissions:refresh',
        );
        expect(Reflect.getOwnMetadata('__guards__', handler)).toContain(
          PermissionGuard,
        );
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
      // Handlers carrying no requirement are scoped to the caller's own
      // identity. Enumerating them means a new route cannot slip in as "no
      // requirement, therefore open".
      //
      // The backend-wide allow-list, covering every controller, lives in
      // src/permission-wiring.spec.ts. This entry is the local subset, kept so
      // that a new handler on THIS controller names itself here.
      const withoutMetadata = {
        checkPermission:
          'self-only: the subject is forced to req.user.id and the caller-supplied userId is gone',
        getUserPermissions: 'reads only the calling user',
        testRouteAccess: 'reads only the calling user',
        testEndpointAccess: 'reads only the calling user',
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