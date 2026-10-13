import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ResourcesController } from './resources.controller';
import {
  PermissionGuard,
  PERMISSIONS_KEY,
} from '../guards/permission.guard';
import { PermissionsService } from '../services/permissions.service';

/**
 * Why the tests below drive real HTTP requests instead of calling the guard.
 *
 * `@RequirePermission` writes metadata; `@UseGuards(PermissionGuard)` is the
 * wiring that makes anything read it. Calling `guard.canActivate(context)` by
 * hand bypasses Nest's guard resolution entirely, so it returns the right
 * answer whether the controller is wired or not — it proves the guard's OR/AND
 * evaluation over real metadata, and nothing about whether Nest will ever call
 * it. A controller with correct decorator metadata and no `@UseGuards` is
 * reachable by any authenticated user, which is exactly the defect that
 * shipped here.
 *
 * So `authorization` stands the real controller up behind the real Fastify
 * adapter and drives it with `app.inject()`, letting Nest resolve the guard
 * chain itself. Removing `@UseGuards(JwtAuthGuard, PermissionGuard)` from the
 * controller turns those red. The direct-`canActivate` tests are kept at the
 * bottom under `guard evaluation logic`, scoped to what they actually prove.
 */
type Held = string[];

describe('ResourcesController', () => {
  describe('authorization', () => {
    interface Harness {
      app: NestFastifyApplication;
      moduleRef: TestingModule;
      checkUserPermission: jest.Mock;
      permissionsService: Record<string, jest.Mock>;
    }

    const CALLER = { id: 42, email: 'member@example.com' };

    const RESOURCE = {
      id: 1,
      name: 'reports',
      description: 'Report definitions',
    };

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
        getAllResources: jest.fn().mockResolvedValue([RESOURCE]),
        getResourceById: jest.fn().mockResolvedValue(RESOURCE),
        createResource: jest
          .fn()
          .mockImplementation(async (dto: object) => ({ ...RESOURCE, ...dto })),
        updateResource: jest
          .fn()
          .mockImplementation(async (id: number, dto: object) => ({
            ...RESOURCE,
            id,
            ...dto,
          })),
        deleteResource: jest.fn().mockResolvedValue(undefined),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [ResourcesController],
        providers: [
          // The real guard, wired by Nest exactly as the decorator asks.
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: permissionsService },
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

    let open: Harness | undefined;

    async function withApp<T>(held: Held, body: (h: Harness) => Promise<T>) {
      const harness = await appFor(held);
      open = harness;
      try {
        return await body(harness);
      } finally {
        await harness.app.close();
        open = undefined;
      }
    }

    afterEach(async () => {
      if (open) {
        await open.app.close();
        open = undefined;
      }
    });

    const writes = [
      { method: 'POST' as const, url: '/resources', payload: { name: 'reports' } },
      {
        method: 'PUT' as const,
        url: '/resources/1',
        payload: { description: 'renamed by a member' },
      },
      { method: 'DELETE' as const, url: '/resources/1' },
    ];

    const reads = [
      { method: 'GET' as const, url: '/resources' },
      { method: 'GET' as const, url: '/resources/1' },
    ];

    describe('the defect this file exists for', () => {
      it('REFUSES a member holding only the broad permissions:access gate on create, update and delete', async () => {
        // `permissions:access` is the gate this controller used to carry at
        // class level, which the guard OR-merges into every handler. A member
        // holding only that broad gate must NOT be able to mutate or delete
        // resources.
        await withApp(['permissions:access'], async ({ app }) => {
          for (const request of writes) {
            const response = await app.inject(request);
            expect({ route: request.url, statusCode: response.statusCode }).toEqual(
              { route: request.url, statusCode: 403 },
            );
          }
        });
      });

      it('never reaches the service on a refused write', async () => {
        // A 403 raised after the fact would still be a privilege escalation if
        // the row had already been written. The service must not be called.
        await withApp(['permissions:access'], async ({ app, permissionsService }) => {
          for (const request of writes) {
            await app.inject(request);
          }

          expect(permissionsService.createResource).not.toHaveBeenCalled();
          expect(permissionsService.updateResource).not.toHaveBeenCalled();
          expect(permissionsService.deleteResource).not.toHaveBeenCalled();
        });
      });

      it('REFUSES a member holding only resources:view on create, update and delete', async () => {
        // Read and write are separate capabilities; :view must not imply
        // :delete, and the read side must not leak a write either.
        await withApp(['resources:view'], async ({ app }) => {
          for (const request of writes) {
            const response = await app.inject(request);
            expect({ route: request.url, statusCode: response.statusCode }).toEqual(
              { route: request.url, statusCode: 403 },
            );
          }
        });
      });

      it('REFUSES a member holding an unrelated permission on every route', async () => {
        await withApp(['users:view'], async ({ app }) => {
          for (const request of [...writes, ...reads]) {
            const response = await app.inject(request);
            expect({ route: request.url, statusCode: response.statusCode }).toEqual(
              { route: request.url, statusCode: 403 },
            );
          }
        });
      });

      it('ALLOWS a member holding resources:create on create only', async () => {
        await withApp(['resources:create'], async ({ app, permissionsService }) => {
          const created = await app.inject(writes[0]);
          const updated = await app.inject(writes[1]);
          const removed = await app.inject(writes[2]);

          expect(created.statusCode).toBe(201);
          expect(updated.statusCode).toBe(403);
          expect(removed.statusCode).toBe(403);
          expect(permissionsService.createResource).toHaveBeenCalledTimes(1);
          expect(permissionsService.updateResource).not.toHaveBeenCalled();
          expect(permissionsService.deleteResource).not.toHaveBeenCalled();
        });
      });

      it('ALLOWS a member holding resources:update on update only', async () => {
        await withApp(['resources:update'], async ({ app }) => {
          const updated = await app.inject(writes[1]);
          const removed = await app.inject(writes[2]);

          expect(updated.statusCode).toBe(200);
          expect(removed.statusCode).toBe(403);
        });
      });

      it('ALLOWS a member holding resources:delete on delete only', async () => {
        await withApp(['resources:delete'], async ({ app }) => {
          const removed = await app.inject(writes[2]);
          const created = await app.inject(writes[0]);

          expect(removed.statusCode).toBe(204);
          expect(created.statusCode).toBe(403);
        });
      });

      it('ALLOWS a member holding resources:view on both reads and nothing else', async () => {
        await withApp(['resources:view'], async ({ app }) => {
          expect((await app.inject(reads[0])).statusCode).toBe(200);
          expect((await app.inject(reads[1])).statusCode).toBe(200);
          expect((await app.inject(writes[0])).statusCode).toBe(403);
          expect((await app.inject(writes[1])).statusCode).toBe(403);
          expect((await app.inject(writes[2])).statusCode).toBe(403);
        });
      });

      it('lets a broad permissions:access holder reach nothing at all', async () => {
        // Honest consequence of removing the class decorator: no handler asks
        // for `permissions:access`, so a member holding only that broad gate
        // reaches no resource endpoint. It is a real capability removal and it
        // is what the fix costs.
        await withApp(['permissions:access'], async ({ app }) => {
          for (const request of [...reads, ...writes]) {
            const response = await app.inject(request);
            expect({ route: request.url, statusCode: response.statusCode }).toEqual(
              { route: request.url, statusCode: 403 },
            );
          }
        });
      });

      it('asks the permission service about each handler’s own capability', async () => {
        // Proof the denials came from the requirement on the handler rather than
        // from an unrelated failure.
        await withApp(['permissions:access'], async ({ app, checkUserPermission }) => {
          await app.inject(writes[0]);
          await app.inject(writes[1]);
          await app.inject(writes[2]);

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'resources',
            'create',
          );
          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'resources',
            'update',
          );
          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'resources',
            'delete',
          );
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
        Object.getOwnPropertyNames(ResourcesController.prototype).filter(
          (name) => name !== 'constructor',
        );

      const handlerOf = (name: string) =>
        (
          ResourcesController.prototype as unknown as Record<string, unknown>
        )[name];

      const requirementOf = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(name));

      const classGuards = () =>
        (Reflect.getMetadata('__guards__', ResourcesController) as
          | unknown[]
          | undefined) ?? [];

      it('wires the permission guard, so the endpoints are not merely authenticated', () => {
        expect(classGuards()).toContain(PermissionGuard);
        expect(classGuards()).toContain(JwtAuthGuard);
      });

      it('gives every handler its own permission, so adding a route cannot default to open', () => {
        const withoutRequirement = handlerNames()
          .filter((name) => requirementOf(name) === undefined)
          .map((name) => ({ handler: name }));

        expect(withoutRequirement).toEqual([]);
      });

      it('carries no class-level permission, because the guard OR-merges it with the handler permission', () => {
        // A class-level @RequirePermission alongside a handler-level one is
        // concatenated into a single array and evaluated with OR logic, so
        // `permissions:access` at class level plus `resources:delete` at handler
        // level resolves to "permissions:access OR resources:delete". The
        // requirement has to live on the handler to be the only thing evaluated.
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, ResourcesController),
        ).toBeUndefined();
      });
    });
  });

  /**
   * These call the guard directly, so they prove the OR/AND evaluation over the
   * controller's real metadata rather than the wiring. They complement, and do
   * not replace, the HTTP-level tests above: on their own they would still pass
   * with the guard un-wired, which is the whole reason the section above
   * exists.
   */
  describe('guard evaluation logic (direct canActivate — not the wiring)', () => {
    async function guardFor(held: Held) {
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

    function contextFor(handler: () => unknown, userId = 42): ExecutionContext {
      return {
        getHandler: handler,
        getClass: () => ResourcesController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: userId, email: 'member@example.com' },
          }),
        }),
      } as unknown as ExecutionContext;
    }

    const handlerFor = (name: string) =>
      contextFor(
        () =>
          (
            ResourcesController.prototype as unknown as Record<string, unknown>
          )[name],
      );

    const readAllRoute = () => handlerFor('getAllResources');
    const readOneRoute = () => handlerFor('getResourceById');
    const createRoute = () => handlerFor('createResource');
    const updateRoute = () => handlerFor('updateResource');
    const deleteRoute = () => handlerFor('deleteResource');

    it('REFUSES a member holding only the broad permissions:access gate on a destructive handler', async () => {
      const { guard, checkUserPermission, moduleRef } = await guardFor([
        'permissions:access',
      ]);

      await expect(guard.canActivate(deleteRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(updateRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(createRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Proof the guard consulted the handler's own requirement rather than
      // failing for some unrelated cause.
      expect(checkUserPermission).toHaveBeenCalledWith(
        42,
        'resources',
        'delete',
      );

      await moduleRef.close();
    });

    it('REFUSES a member holding only a read permission on a destructive handler', async () => {
      // Read and write are separate capabilities; :view must not imply :delete.
      const { guard, moduleRef } = await guardFor(['resources:view']);

      await expect(guard.canActivate(deleteRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(updateRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await moduleRef.close();
    });

    it('REFUSES a member holding only a write permission on a read handler', async () => {
      const { guard, moduleRef } = await guardFor(['resources:delete']);

      await expect(guard.canActivate(readAllRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(readOneRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await moduleRef.close();
    });

    it('ALLOWS a member holding the matching permission on each handler', async () => {
      const { guard, checkUserPermission, moduleRef } = await guardFor([
        'resources:view',
        'resources:create',
        'resources:update',
        'resources:delete',
      ]);

      await expect(guard.canActivate(readAllRoute())).resolves.toBe(true);
      await expect(guard.canActivate(readOneRoute())).resolves.toBe(true);
      await expect(guard.canActivate(createRoute())).resolves.toBe(true);
      await expect(guard.canActivate(updateRoute())).resolves.toBe(true);
      await expect(guard.canActivate(deleteRoute())).resolves.toBe(true);
      expect(checkUserPermission).toHaveBeenCalledWith(42, 'resources', 'view');

      await moduleRef.close();
    });

    it('ALLOWS a broad permissions:access holder on nothing at all, since no handler asks for it', async () => {
      const { guard, moduleRef } = await guardFor(['permissions:access']);

      await expect(guard.canActivate(readAllRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(readOneRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await moduleRef.close();
    });

    it('REFUSES a member holding an unrelated permission on every handler', async () => {
      const { guard, moduleRef } = await guardFor(['users:view']);

      for (const route of [
        readAllRoute(),
        readOneRoute(),
        createRoute(),
        updateRoute(),
        deleteRoute(),
      ]) {
        await expect(guard.canActivate(route)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }

      await moduleRef.close();
    });
  });
});