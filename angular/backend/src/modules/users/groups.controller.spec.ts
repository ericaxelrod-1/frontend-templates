import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from '../permissions/guards/permission.guard';
import { PermissionsService } from '../permissions/services/permissions.service';

/**
 * Why this file drives real HTTP requests instead of calling the guard directly.
 *
 * `GroupsController` shipped with `@UseGuards(JwtAuthGuard)` on the class and no
 * permission requirement on any of its thirteen handlers. `@RequirePermission`
 * writes metadata and `PermissionGuard` reads it, but neither is the wiring that
 * connects them — so the defect being guarded against here is not "the wrong
 * permission name" but "no permission name at all", and a spec that instantiated
 * the guard by hand would pass whether or not the guard was wired to the
 * route. These tests stand the real controller up behind the real Fastify
 * adapter and let Nest resolve the guard chain itself, so reverting the wiring
 * turns them red.
 *
 * The group tree is the scope axis for this application: `rls-context.guard.ts`
 * validates `X-Active-Group-Id` against the caller's groups, so being able to
 * add or remove a member here is being able to choose what a user can see.
 */
describe('GroupsController', () => {
  describe('authorization', () => {
    interface Harness {
      app: NestFastifyApplication;
      moduleRef: TestingModule;
      checkUserPermission: jest.Mock;
      groupsService: Record<string, jest.Mock>;
    }

    /** A plain authenticated member: the account the defects below served. */
    const CALLER = { id: 42, email: 'member@example.com' };

    /**
     * The held-set is stated explicitly per test rather than inherited from a
     * fixture, so "this member can do this" is a claim the test makes instead
     * of a condition it quietly assumes.
     */
    async function appFor(held: string[]): Promise<Harness> {
      const checkUserPermission = jest.fn(
        async (_userId: number, resource: string, action: string) =>
          held.includes(`${resource}:${action}`),
      );

      const groupsService: Record<string, jest.Mock> = {
        findAll: jest
          .fn()
          .mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 10 }),
        findOne: jest.fn().mockResolvedValue({ id: 1, name: 'Engineering' }),
        create: jest.fn().mockImplementation(async (name: string) => ({
          id: 7,
          name,
        })),
        update: jest
          .fn()
          .mockImplementation(async (id: number, name: string) => ({ id, name })),
        delete: jest.fn().mockResolvedValue(undefined),
        getMembers: jest.fn().mockResolvedValue([]),
        addMember: jest.fn().mockResolvedValue({ success: true }),
        removeMember: jest.fn().mockResolvedValue({ success: true }),
        updateSettings: jest
          .fn()
          .mockImplementation(async (id: number) => ({ id, settings: {} })),
        getAncestors: jest.fn().mockResolvedValue([]),
        getDescendants: jest.fn().mockResolvedValue([]),
        getHierarchyPath: jest.fn().mockResolvedValue([]),
        setParent: jest
          .fn()
          .mockImplementation(async (id: number) => ({ id, parentId: 1 })),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [GroupsController],
        providers: [
          // The real guard, wired by Nest exactly as the decorators ask.
          PermissionGuard,
          Reflector,
          { provide: GroupsService, useValue: groupsService },
          { provide: PermissionsService, useValue: { checkUserPermission } },
        ],
      })
        // Authentication is exercised elsewhere; what matters here is that the
        // real guard chain runs against an authenticated caller.
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

      return { app, moduleRef, checkUserPermission, groupsService };
    }

    let harness: Harness | undefined;

    async function withApp<T>(
      held: string[],
      body: (h: Harness) => Promise<T>,
    ): Promise<T> {
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

    /**
     * Every write verb on the controller: the verb, the URL, the capability it
     * now requires, the request body, and the status a PERMITTED caller gets.
     *
     * The body is `null` for the two bodyless verbs rather than `undefined`:
     * passing an explicit `payload: undefined` makes Fastify send
     * `content-type: undefined` and answer 415 before Nest ever resolves the
     * guard chain, which would turn every 403 assertion below into a pass for
     * the wrong reason.
     *
     * The status matters too — Nest answers 201 for `@Post()` by default, so a
     * blanket `toBe(200)` would fail on the two creates rather than on a
     * permission problem.
     */
    interface WriteCase {
      method: 'POST' | 'PUT' | 'DELETE';
      url: string;
      permission: string;
      payload: Record<string, unknown> | null;
      allowedStatus: number;
      serviceMethod: string;
    }

    const WRITES: WriteCase[] = [
      {
        method: 'POST',
        url: '/groups',
        permission: 'groups:create',
        payload: { name: 'Attacker Group' },
        allowedStatus: 201,
        serviceMethod: 'create',
      },
      {
        method: 'PUT',
        url: '/groups/1',
        permission: 'groups:update',
        payload: { name: 'Renamed' },
        allowedStatus: 200,
        serviceMethod: 'update',
      },
      {
        method: 'DELETE',
        url: '/groups/1',
        permission: 'groups:delete',
        payload: null,
        allowedStatus: 200,
        serviceMethod: 'delete',
      },
      {
        method: 'POST',
        url: '/groups/1/members/7',
        permission: 'groups:manage',
        payload: { note: 'escalation' },
        allowedStatus: 201,
        serviceMethod: 'addMember',
      },
      {
        method: 'DELETE',
        url: '/groups/1/members/7',
        permission: 'groups:manage',
        payload: null,
        allowedStatus: 200,
        serviceMethod: 'removeMember',
      },
      {
        method: 'PUT',
        url: '/groups/1/settings',
        permission: 'groups:manage',
        payload: { settings: {} },
        allowedStatus: 200,
        serviceMethod: 'updateSettings',
      },
      {
        method: 'PUT',
        url: '/groups/1/parent',
        permission: 'groups:manage',
        payload: { parentId: 2 },
        allowedStatus: 200,
        serviceMethod: 'setParent',
      },
    ];

    const READS: Array<['GET', string]> = [
      ['GET', '/groups'],
      ['GET', '/groups/1'],
      ['GET', '/groups/1/members'],
      ['GET', '/groups/1/ancestors'],
      ['GET', '/groups/1/descendants'],
      ['GET', '/groups/1/hierarchy-path'],
    ];

    /**
     * Fastify needs the `payload` key ABSENT for a bodyless verb, not present
     * and empty — see the note on `WRITES`.
     */
    const injectWrite = (
      app: NestFastifyApplication,
      write: WriteCase,
    ): ReturnType<NestFastifyApplication['inject']> =>
      app.inject({
        method: write.method,
        url: write.url,
        ...(write.payload === null ? {} : { payload: write.payload }),
      });

    describe('the defect this file exists for', () => {
      it('REFUSES a plain member on all seven write verbs with 403', async () => {
        // The permissions a plain member is likely to hold — `groups:read` is
        // granted to the `user` role in the seed data, so it is included here
        // deliberately: holding the read capability must not imply write.
        await withApp(
          ['users:view', 'groups:read', 'dashboard:view'],
          async ({ app }) => {
            for (const write of WRITES) {
              const response = await injectWrite(app, write);

              expect([write.method, write.url, response.statusCode]).toEqual([
                write.method,
                write.url,
                403,
              ]);
            }
          },
        );
      });

      it('never reaches the service on a refused write', async () => {
        // A 403 raised after the fact would still be an escalation if the row
        // had already been written.
        await withApp(['groups:read'], async ({ app, groupsService }) => {
          for (const write of WRITES) {
            await injectWrite(app, write);
          }

          expect(groupsService.create).not.toHaveBeenCalled();
          expect(groupsService.update).not.toHaveBeenCalled();
          expect(groupsService.delete).not.toHaveBeenCalled();
          expect(groupsService.addMember).not.toHaveBeenCalled();
          expect(groupsService.removeMember).not.toHaveBeenCalled();
          expect(groupsService.updateSettings).not.toHaveBeenCalled();
          expect(groupsService.setParent).not.toHaveBeenCalled();
        });
      });

      it('REFUSES the membership moves specifically, on an unrelated capability', async () => {
        // The highest-value case on this controller: `POST`/`DELETE
        // /groups/:id/members/:userId` move a user between scopes, and the
        // scope is what every RLS policy in the app keys on.
        await withApp(['groups:view'], async ({ app, groupsService }) => {
          const add = await app.inject({
            method: 'POST',
            url: '/groups/1/members/7',
            payload: {},
          });
          const remove = await app.inject({
            method: 'DELETE',
            url: '/groups/1/members/7',
          });

          expect(add.statusCode).toBe(403);
          expect(remove.statusCode).toBe(403);
          expect(groupsService.addMember).not.toHaveBeenCalled();
          expect(groupsService.removeMember).not.toHaveBeenCalled();
        });
      });

      it('does not let the CRUD capability stand in for the membership one', async () => {
        // `groups:update` and `groups:manage` are separately granted in the
        // seed, so a holder of the former must not thereby gain the latter.
        await withApp(['groups:view', 'groups:create', 'groups:update', 'groups:delete'],
          async ({ app }) => {
            expect(
              (
                await app.inject({
                  method: 'PUT',
                  url: '/groups/1',
                  payload: { name: 'Renamed' },
                })
              ).statusCode,
            ).toBe(200);
            expect(
              (await app.inject({ method: 'DELETE', url: '/groups/1' }))
                .statusCode,
            ).toBe(200);
            expect(
              (
                await app.inject({
                  method: 'POST',
                  url: '/groups/1/members/7',
                  payload: {},
                })
              ).statusCode,
            ).toBe(403);
            expect(
              (
                await app.inject({
                  method: 'DELETE',
                  url: '/groups/1/members/7',
                })
              ).statusCode,
            ).toBe(403);
          });
      });
    });

    describe('ALLOWS an appropriately-permissioned holder', () => {
      it.each(WRITES)(
        'allows $method $url for a holder of $permission, and reaches $serviceMethod',
        async (write) => {
          await withApp([write.permission], async ({ app, groupsService }) => {
            const response = await injectWrite(app, write);

            expect(response.statusCode).toBe(write.allowedStatus);
            expect(groupsService[write.serviceMethod]).toHaveBeenCalledTimes(1);
          });
        },
      );

      it.each(READS)('allows %s %s for a holder of groups:view', async (method, url) => {
        await withApp(['groups:view'], async ({ app }) => {
          expect(
            (await app.inject({ method: method as 'GET', url })).statusCode,
          ).toBe(200);
        });
      });

      it('asks the permission service about the handler’s own capability', async () => {
        await withApp(['groups:read'], async ({ app, checkUserPermission }) => {
          await app.inject({
            method: 'POST',
            url: '/groups/1/members/7',
            payload: {},
          });

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'groups',
            'manage',
          );
          expect(checkUserPermission).not.toHaveBeenCalledWith(
            CALLER.id,
            'groups',
            'members',
          );
        });
      });

      it('does not evaluate a three-part name the guard would truncate', async () => {
        // The precise seed rows are `groups:members:add` and friends, but the
        // guard does `const [resource, action] = permission.split(':')` and
        // `checkUserPermission` rebuilds a two-part name, so any three-part
        // requirement silently degrades to `groups:members` and matches nobody.
        // Asserting the guard is asked for exactly `groups` + `manage` is what
        // keeps a future "let's use the accurate row" edit from locking every
        // role out of membership management.
        const write = WRITES.find(
          (entry) => entry.url === '/groups/1/members/7' && entry.method === 'POST',
        ) as WriteCase;

        await withApp(['groups:manage'], async ({ app, checkUserPermission }) => {
          const response = await injectWrite(app, write);

          expect(response.statusCode).toBe(write.allowedStatus);
          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'groups',
            'manage',
          );
          for (const call of checkUserPermission.mock.calls) {
            expect(call.length).toBe(3);
          }
        });
      });
    });

    describe('wiring', () => {
      const handlerNames = () =>
        Object.getOwnPropertyNames(GroupsController.prototype).filter(
          (name) => name !== 'constructor',
        );

      const handlerOf = (name: string) =>
        (
          GroupsController.prototype as unknown as Record<string, unknown>
        )[name];

      const requirementOf = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(name));

      const guardsOf = (name: string) =>
        Reflect.getOwnMetadata('__guards__', handlerOf(name)) as
          | unknown[]
          | undefined;

      it('wires PermissionGuard onto every handler', () => {
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

      it('wires PermissionGuard exactly once per handler', () => {
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
        expect(Reflect.getMetadata('__guards__', GroupsController)).toContain(
          JwtAuthGuard,
        );
      });

      it('carries no class-level permission, because the guard OR-merges it', () => {
        // The guard concatenates class and handler metadata and evaluates with
        // OR (permission.guard.ts:205-226), so a class-level `@RequirePermission`
        // would widen all thirteen handlers rather than narrow them.
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, GroupsController),
        ).toBeUndefined();
      });

      it('leaves no handler without a deliberate permission posture', () => {
        expect(
          handlerNames().filter((name) => requirementOf(name) === undefined),
        ).toEqual([]);
      });

      it('uses only permission rows that already exist in the seed data', async () => {
        // `permission-seeds.service.ts` is the write that creates the rows. If a
        // requirement ever names something outside it, the guard will match it
        // against a permission no role holds and the route becomes unreachable
        // for everybody — including Super Administrator. `groups:members:add`
        // and `groups:settings:update` exist as rows but are deliberately not
        // used; see the controller comment for why.
        const source = readFileSync(
          join(__dirname, '../../database/seeds/permission-seeds.service.ts'),
          'utf8',
        );

        const requirements = handlerNames().map((name) =>
          requirementOf(name),
        ) as string[];

        for (const permission of requirements) {
          expect(permission).toMatch(/^groups:[a-z]+$/);
          expect(permission).not.toMatch(/^groups:(members|settings):/);
        }

        expect(source).toContain("resource: 'groups'");
        expect(source).toContain("resource: 'groups:members'");
        expect(source).toContain("resource: 'groups:settings'");
      });

      it('uses the non-deprecated @RequirePermission spelling everywhere', () => {
        const source = readFileSync(
          join(__dirname, 'groups.controller.ts'),
          'utf8',
        );

        expect(source).not.toContain('require-permissions.decorator');
        expect(source).toContain(
          "from '../permissions/decorators/require-permission.decorator'",
        );
      });
    });

    describe('guard semantics over the real metadata', () => {
      /**
       * These call the guard directly, so they prove the OR evaluation over the
       * controller's real metadata rather than the wiring. They complement, and
       * do not replace, the HTTP tests above.
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

        return {
          guard: moduleRef.get(PermissionGuard),
          checkUserPermission,
          moduleRef,
        };
      }

      function contextFor(handlerName: string): ExecutionContext {
        return {
          getHandler: () =>
            (
              GroupsController.prototype as unknown as Record<string, unknown>
            )[handlerName],
          getClass: () => GroupsController,
          switchToHttp: () => ({
            getRequest: () => ({
              user: { id: CALLER.id, email: CALLER.email },
            }),
          }),
        } as unknown as ExecutionContext;
      }

      it('keeps the seven writes as separately granted capabilities', async () => {
        const handlerFor: Record<string, string> = {
          'POST /groups': 'create',
          'PUT /groups/1': 'update',
          'DELETE /groups/1': 'delete',
          'POST /groups/1/members/7': 'manage',
          'DELETE /groups/1/members/7': 'manage',
          'PUT /groups/1/settings': 'manage',
          'PUT /groups/1/parent': 'manage',
        };
        const handlerNamesFor: Record<string, string> = {
          'POST /groups': 'create',
          'PUT /groups/1': 'update',
          'DELETE /groups/1': 'delete',
          'POST /groups/1/members/7': 'addMember',
          'DELETE /groups/1/members/7': 'removeMember',
          'PUT /groups/1/settings': 'updateSettings',
          'PUT /groups/1/parent': 'setParent',
        };

        for (const [route, capability] of Object.entries(handlerFor)) {
          for (const other of ['create', 'update', 'delete', 'manage', 'view']) {
            const { guard, moduleRef } = await guardFor([
              `groups:${other}`,
            ]);
            const outcome = guard.canActivate(
              contextFor(handlerNamesFor[route]),
            );

            if (other === capability) {
              await expect(outcome).resolves.toBe(true);
            } else {
              await expect(outcome).rejects.toBeInstanceOf(
                ForbiddenException,
              );
            }

            await moduleRef.close();
          }
        }
      });

      it('throws Forbidden rather than returning false, so Nest emits 403', async () => {
        const { guard, moduleRef } = await guardFor([]);

        await expect(
          guard.canActivate(contextFor('addMember')),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await moduleRef.close();
      });
    });
  });
});
