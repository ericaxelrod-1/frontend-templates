import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SystemHealthController } from './system-health.controller';
import {
  SystemHealthService,
  HealthStatus,
  SystemHealthSnapshot,
} from '../system/services/system-health.service';
import { PrivacyTicketService } from '../privacy/privacy-ticket.service';
import { PrivacyCleanupService } from '../privacy/privacy-cleanup.service';
import {
  PERMISSIONS_KEY,
  PermissionGuard,
} from '../permissions/guards/permission.guard';
import { PermissionsService } from '../permissions/services/permissions.service';

const THRESHOLDS = {
  warningPercent: 90,
  criticalPercent: 95,
  panicPercent: 98,
};

function snapshot(
  overrides: Partial<SystemHealthSnapshot> = {},
): SystemHealthSnapshot {
  return {
    status: HealthStatus.NORMAL,
    disk: { total: 1000, used: 400, free: 600, percentage: 40 },
    memory: {
      total: 800,
      used: 320,
      free: 480,
      percentage: 40,
      process: { rss: 100, heapTotal: 80, heapUsed: 50 },
    },
    lastCheckedAt: '2026-10-12T00:00:00.000Z',
    lastError: null,
    guardDisabled: false,
    thresholds: THRESHOLDS,
    ...overrides,
  };
}

/**
 * `currentHealth` is module-level mutable state so the response-shape tests
 * below and the HTTP tests further down can each set the snapshot without
 * rebuilding a module. It is reset in `beforeEach`.
 */
let currentHealth: SystemHealthSnapshot = snapshot();

const JwtGuard = AuthGuard('jwt');

/**
 * Why the authorization tests drive real HTTP requests instead of calling the
 * guard.
 *
 * `@RequirePermission` writes metadata; `@UseGuards(AuthGuard('jwt'),
 * PermissionGuard)` is the wiring that makes anything read it. Calling
 * `guard.canActivate(context)` by hand bypasses Nest's guard resolution
 * entirely, so it returns the right answer whether the controller is wired or
 * not — it proves the guard's evaluation over real metadata, and nothing about
 * whether Nest will ever call it. A controller with correct decorator metadata
 * and no `@UseGuards` is reachable by any authenticated user, which is exactly
 * the defect that shipped here twice.
 *
 * So the authorization section below stands the real controller up behind the
 * real Fastify adapter and drives it with `app.inject()`, letting Nest resolve
 * the guard chain itself. Removing `@UseGuards` from the controller turns those
 * red. The direct-`canActivate` tests are kept at the bottom under `guard
 * evaluation logic`, scoped to what they actually prove.
 */
describe('SystemHealthController', () => {
  beforeEach(() => {
    currentHealth = snapshot();
  });

  describe('GET /admin/system-health', () => {
    it('reports measured disk totals instead of zeros', async () => {
      const body = await healthBody();

      expect(body.disk).toEqual({
        total: 1000,
        used: 400,
        free: 600,
        percentage: 40,
      });
    });

    it('reports the host memory figure, not this process heap', async () => {
      const body = await healthBody();

      expect(body.memory.total).toBe(800);
      expect(body.memory.used).toBe(320);
      expect(body.process).toEqual({
        rss: 100,
        heapTotal: 80,
        heapUsed: 50,
      });
    });

    it('counts the real job queue rather than querying user 0', async () => {
      const { controller, countActiveJobs, countPendingTickets } =
        await harnessController();

      const body = await controller.getHealth();

      expect(countActiveJobs).toHaveBeenCalledTimes(1);
      expect(countPendingTickets).toHaveBeenCalledTimes(1);
      expect(body.activeJobs).toBe(7);
      expect(body.pendingTickets).toBe(3);
    });

    it('returns when the Sentinel last looked, not the response time', async () => {
      const body = await healthBody();

      expect(body.lastCheck).toBe('2026-10-12T00:00:00.000Z');
    });

    it('returns null when no check has completed yet', async () => {
      currentHealth = snapshot({
        lastCheckedAt: null,
        status: HealthStatus.UNKNOWN,
      });

      const body = await healthBody();

      expect(body.lastCheck).toBeNull();
    });

    it('surfaces the measurement failure instead of reporting a healthy disk', async () => {
      currentHealth = snapshot({
        status: HealthStatus.UNKNOWN,
        lastError: 'Disk check failed: EIO',
      });

      const body = await healthBody();

      expect(body.status).toBe('Unknown');
      expect(body.lastError).toBe('Disk check failed: EIO');
    });

    it('labels the status in the casing the frontend switch matches', async () => {
      const cases: Array<[HealthStatus, string]> = [
        [HealthStatus.NORMAL, 'Healthy'],
        [HealthStatus.WARNING, 'Warning'],
        [HealthStatus.CRITICAL, 'Critical'],
        [HealthStatus.PANIC, 'Panic'],
        [HealthStatus.UNKNOWN, 'Unknown'],
      ];

      for (const [status, label] of cases) {
        currentHealth = snapshot({ status });
        const body = await healthBody();

        expect(body.status).toBe(label);
      }
    });

    it('publishes the thresholds and the override state so the operator can see them', async () => {
      currentHealth = snapshot({ guardDisabled: true });

      const body = await healthBody();

      expect(body.thresholds).toEqual(THRESHOLDS);
      expect(body.guardDisabled).toBe(true);
    });
  });

  describe('POST /admin/system-health/clear-temp', () => {
    it('runs the real purge and reports what it actually did', async () => {
      const { controller, purgeExpiredExports } = await harnessController();

      const body = await controller.clearTemp();

      expect(purgeExpiredExports).toHaveBeenCalledTimes(1);
      expect(body).toEqual({
        message: 'Cleanup complete',
        scannedFiles: 5,
        removedFiles: 2,
        freedBytes: 4096,
        errors: [],
      });
    });

    it('reports per-file failures rather than a bare success', async () => {
      const { controller, purgeExpiredExports } = await harnessController();

      purgeExpiredExports.mockResolvedValue({
        scannedFiles: 3,
        removedFiles: 1,
        freedBytes: 10,
        errors: ['Failed to delete file a.json: EACCES'],
      });

      const body = await controller.clearTemp();

      expect(body.errors).toEqual(['Failed to delete file a.json: EACCES']);
    });
  });

  describe('authorization', () => {
    type Held = string[];

    interface Harness {
      app: NestFastifyApplication;
      moduleRef: TestingModule;
      checkUserPermission: jest.Mock;
      purgeExpiredExports: jest.Mock;
      privacyTicketService: {
        countActiveJobs: jest.Mock;
        countPendingTickets: jest.Mock;
      };
    }

    const CALLER = { id: 42, email: 'user@example.com' };

    const READ = { method: 'GET' as const, url: '/admin/system-health' };
    const CLEAR = { method: 'POST' as const, url: '/admin/system-health/clear-temp' };

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

      const purgeExpiredExports = jest.fn().mockResolvedValue({
        scannedFiles: 5,
        removedFiles: 2,
        freedBytes: 4096,
        errors: [],
      });

      const privacyTicketService = {
        countActiveJobs: jest.fn().mockResolvedValue(7),
        countPendingTickets: jest.fn().mockResolvedValue(3),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [SystemHealthController],
        providers: [
          // The real guard, wired by Nest exactly as the decorator asks.
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: { checkUserPermission } },
          {
            provide: SystemHealthService,
            useValue: { getSnapshot: () => currentHealth },
          },
          {
            provide: PrivacyTicketService,
            useValue: privacyTicketService,
          },
          {
            provide: PrivacyCleanupService,
            useValue: { purgeExpiredExports },
          },
        ],
      })
        // Authentication is out of scope here and is exercised elsewhere; what
        // matters is that the guard chain runs with an authenticated caller.
        .overrideGuard(JwtGuard)
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

      return {
        app,
        moduleRef,
        checkUserPermission,
        purgeExpiredExports,
        privacyTicketService,
      };
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

    describe('the defect this file exists for', () => {
      it('REFUSES a member holding only system:health on the destructive route, and ALLOWS the same member on the read route', async () => {
        // The specific bypass that was fixed. `system:health` is granted to the
        // Administrator role and is described as a read capability; it must never
        // reach a handler that deletes files, while the read page stays
        // reachable.
        await withApp(['system:health'], async ({ app }) => {
          const cleared = await app.inject(CLEAR);
          const read = await app.inject(READ);

          expect({ route: 'clear-temp', statusCode: cleared.statusCode }).toEqual(
            { route: 'clear-temp', statusCode: 403 },
          );
          expect({ route: 'getHealth', statusCode: read.statusCode }).toEqual(
            { route: 'getHealth', statusCode: 200 },
          );
        });
      });

      it('never runs the purge for a member holding only system:health', async () => {
        // A 403 raised after the fact would still be a privilege escalation if
        // the files had already been deleted.
        await withApp(['system:health'], async ({ app, purgeExpiredExports }) => {
          const cleared = await app.inject(CLEAR);

          expect(cleared.statusCode).toBe(403);
          expect(purgeExpiredExports).not.toHaveBeenCalled();
        });
      });

      it('ALLOWS a member holding system:manage on the destructive route, and the purge runs', async () => {
        await withApp(['system:manage'], async ({ app, purgeExpiredExports }) => {
          const cleared = await app.inject(CLEAR);

          expect(cleared.statusCode).toBe(200);
          expect(JSON.parse(cleared.payload)).toEqual({
            message: 'Cleanup complete',
            scannedFiles: 5,
            removedFiles: 2,
            freedBytes: 4096,
            errors: [],
          });
          expect(purgeExpiredExports).toHaveBeenCalledTimes(1);
        });
      });

      it('REFUSES a member holding only system:manage on the read route', async () => {
        // system:manage is the stronger permission and does not imply the read
        // one, so the two routes are genuinely independent capabilities.
        await withApp(['system:manage'], async ({ app }) => {
          expect((await app.inject(READ)).statusCode).toBe(403);
          expect((await app.inject(CLEAR)).statusCode).toBe(200);
        });
      });

      it('REFUSES a member holding only a read permission on the destructive route', async () => {
        // Read and write are separate capabilities; :health must not imply
        // :manage.
        await withApp(['system:health'], async ({ app }) => {
          expect((await app.inject(CLEAR)).statusCode).toBe(403);
        });
      });

      it('REFUSES a member holding an unrelated permission on both routes', async () => {
        await withApp(['users:view'], async ({ app }) => {
          expect({ read: (await app.inject(READ)).statusCode }).toEqual({
            read: 403,
          });
          expect({ clear: (await app.inject(CLEAR)).statusCode }).toEqual({
            clear: 403,
          });
        });
      });

      it('ALLOWS a member holding both permissions on both routes', async () => {
        await withApp(['system:health', 'system:manage'], async ({ app }) => {
          expect((await app.inject(READ)).statusCode).toBe(200);
          expect((await app.inject(CLEAR)).statusCode).toBe(200);
        });
      });

      it('asks the permission service about each handler’s own capability', async () => {
        // Proof the denials came from the requirement on the handler rather than
        // from an unrelated failure.
        await withApp(['system:health'], async ({ app, checkUserPermission }) => {
          await app.inject(READ);
          await app.inject(CLEAR);

          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'system',
            'health',
          );
          expect(checkUserPermission).toHaveBeenCalledWith(
            CALLER.id,
            'system',
            'manage',
          );
        });
      });

      it('discloses the host snapshot to a member holding system:health and nothing else', async () => {
        await withApp(['system:health'], async ({ app }) => {
          const body = JSON.parse((await app.inject(READ)).payload);

          expect(body).toEqual({
            status: 'Healthy',
            disk: { total: 1000, used: 400, free: 600, percentage: 40 },
            memory: { total: 800, used: 320, free: 480, percentage: 40 },
            process: { rss: 100, heapTotal: 80, heapUsed: 50 },
            activeJobs: 7,
            pendingTickets: 3,
            lastCheck: '2026-10-12T00:00:00.000Z',
            lastError: null,
            guardDisabled: false,
            thresholds: THRESHOLDS,
          });
        });
      });

      it('discloses nothing at all to a member without the capability', async () => {
        await withApp([], async ({
          app,
          privacyTicketService,
          purgeExpiredExports,
        }) => {
          const read = await app.inject(READ);
          const cleared = await app.inject(CLEAR);

          expect(read.statusCode).toBe(403);
          expect(read.payload).not.toContain('Healthy');
          expect(cleared.statusCode).toBe(403);
          expect(privacyTicketService.countActiveJobs).not.toHaveBeenCalled();
          expect(privacyTicketService.countPendingTickets).not.toHaveBeenCalled();
          expect(purgeExpiredExports).not.toHaveBeenCalled();
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
        Object.getOwnPropertyNames(SystemHealthController.prototype).filter(
          (name) => name !== 'constructor',
        );

      const handlerOf = (name: string) =>
        (
          SystemHealthController.prototype as unknown as Record<string, unknown>
        )[name];

      const requirementOf = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(name));

      const classGuards = () =>
        (Reflect.getMetadata('__guards__', SystemHealthController) as
          | unknown[]
          | undefined) ?? [];

      it('wires both guards so the endpoint is not merely authenticated', () => {
        expect(classGuards()).toContain(PermissionGuard);
        expect(classGuards()).toContain(JwtGuard);
      });

      it('gives every handler its own permission, so adding a route cannot default to open', () => {
        const withoutRequirement = handlerNames()
          .filter((name) => requirementOf(name) === undefined)
          .map((name) => ({ handler: name }));

        expect(withoutRequirement).toEqual([]);
      });

      it('requires system:manage for the destructive route, not system:health', () => {
        expect(requirementOf('clearTemp')).toBe('system:manage');
        expect(requirementOf('getHealth')).toBe('system:health');
      });

      it('carries no class-level permission, because the guard OR-merges it with the handler permission', () => {
        // A class-level @RequirePermission alongside a handler-level one is
        // concatenated into a single array and evaluated with OR logic, so
        // `system:health` at class level plus `system:manage` at handler level
        // resolves to "system:health OR system:manage" — the exact bypass this
        // controller previously shipped. The requirement therefore has to live on
        // the handler, where it is the only thing the guard sees.
        expect(
          Reflect.getMetadata(PERMISSIONS_KEY, SystemHealthController),
        ).toBeUndefined();
      });
    });
  });

  /**
   * These call the guard directly, so they prove the guard's evaluation over the
   * controller's real metadata rather than the wiring. They complement, and do
   * not replace, the HTTP-level tests above: on their own they would still pass
   * with the guard un-wired, which is the whole reason that section exists.
   */
  describe('guard evaluation logic (direct canActivate — not the wiring)', () => {
    /**
     * Builds the real PermissionGuard over the real controller metadata, backed
     * by a PermissionsService that knows exactly which permissions the subject
     * holds. `checkUserPermission` is the same call the guard makes in
     * production; answering it from a held-set is what makes "this member can do
     * this" a fact rather than an assumption.
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

    function contextFor(handler: () => unknown, userId = 42): ExecutionContext {
      return {
        getHandler: handler,
        getClass: () => SystemHealthController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: userId, email: 'user@example.com' } }),
        }),
      } as unknown as ExecutionContext;
    }

    const readRoute = () => contextFor(() => SystemHealthController.prototype.getHealth);
    const clearRoute = () => contextFor(() => SystemHealthController.prototype.clearTemp);

    it('REFUSES a member holding only the read-only system:health permission on the destructive route', async () => {
      const { guard, checkUserPermission, moduleRef } = await guardFor(['system:health']);

      await expect(guard.canActivate(clearRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Proof the guard actually consulted system:manage, rather than passing or
      // failing on some unrelated cause.
      expect(checkUserPermission).toHaveBeenCalledWith(42, 'system', 'manage');

      await moduleRef.close();
    });

    it('ALLOWS a member holding system:manage on the destructive route', async () => {
      const { guard, checkUserPermission, moduleRef } = await guardFor(['system:manage']);

      await expect(guard.canActivate(clearRoute())).resolves.toBe(true);
      expect(checkUserPermission).toHaveBeenCalledWith(42, 'system', 'manage');

      await moduleRef.close();
    });

    it('ALLOWS a member holding system:health on the read route', async () => {
      const { guard, checkUserPermission, moduleRef } = await guardFor(['system:health']);

      await expect(guard.canActivate(readRoute())).resolves.toBe(true);
      expect(checkUserPermission).toHaveBeenCalledWith(42, 'system', 'health');

      await moduleRef.close();
    });

    it('REFUSES a member holding only system:manage on the read route', async () => {
      const { guard, moduleRef } = await guardFor(['system:manage']);

      await expect(guard.canActivate(readRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await moduleRef.close();
    });

    it('ALLOWS a member holding both permissions on both routes', async () => {
      const { guard, moduleRef } = await guardFor(['system:health', 'system:manage']);

      await expect(guard.canActivate(readRoute())).resolves.toBe(true);
      await expect(guard.canActivate(clearRoute())).resolves.toBe(true);

      await moduleRef.close();
    });

    it('REFUSES a member holding neither permission on both routes', async () => {
      const { guard, moduleRef } = await guardFor(['users:view']);

      await expect(guard.canActivate(readRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(guard.canActivate(clearRoute())).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await moduleRef.close();
    });

    it('a member without system:health is refused by the guard, not merely unauthenticated', async () => {
      const checkUserPermission = jest.fn().mockResolvedValue(false);
      const moduleRef = await Test.createTestingModule({
        providers: [
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: { checkUserPermission } },
        ],
      }).compile();

      const guard = moduleRef.get(PermissionGuard);
      const context = {
        getHandler: () => SystemHealthController.prototype.getHealth,
        getClass: () => SystemHealthController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 42, email: 'member@example.com' } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(checkUserPermission).toHaveBeenCalledWith(42, 'system', 'health');

      await moduleRef.close();
    });

    it('a member holding system:health passes the guard', async () => {
      const checkUserPermission = jest.fn().mockResolvedValue(true);
      const moduleRef = await Test.createTestingModule({
        providers: [
          PermissionGuard,
          Reflector,
          { provide: PermissionsService, useValue: { checkUserPermission } },
        ],
      }).compile();

      const guard = moduleRef.get(PermissionGuard);
      const context = {
        getHandler: () => SystemHealthController.prototype.getHealth,
        getClass: () => SystemHealthController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 7, email: 'admin@example.com' } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);

      await moduleRef.close();
    });
  });
});

/**
 * Builds the controller with its collaborators stubbed, for the response-shape
 * tests that exercise the handler body directly. The guard chain is not part of
 * what those tests assert — the authorization section above covers that.
 */
async function harnessController() {
  const countActiveJobs = jest.fn().mockResolvedValue(7);
  const countPendingTickets = jest.fn().mockResolvedValue(3);
  const purgeExpiredExports = jest.fn().mockResolvedValue({
    scannedFiles: 5,
    removedFiles: 2,
    freedBytes: 4096,
    errors: [],
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [SystemHealthController],
    providers: [
      PermissionGuard,
      Reflector,
      {
        provide: PermissionsService,
        useValue: { checkUserPermission: jest.fn().mockResolvedValue(true) },
      },
      {
        provide: SystemHealthService,
        useValue: { getSnapshot: () => currentHealth },
      },
      {
        provide: PrivacyTicketService,
        useValue: { countActiveJobs, countPendingTickets },
      },
      {
        provide: PrivacyCleanupService,
        useValue: { purgeExpiredExports },
      },
    ],
  }).compile();

  return {
    controller: moduleRef.get(SystemHealthController),
    countActiveJobs,
    countPendingTickets,
    purgeExpiredExports,
  };
}

/**
 * The body `GET /admin/system-health` returns for the current `currentHealth`.
 */
async function healthBody() {
  const { controller } = await harnessController();

  return controller.getHealth();
}