import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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

describe('SystemHealthController', () => {
  let health: SystemHealthSnapshot;
  let countActiveJobs: jest.Mock;
  let countPendingTickets: jest.Mock;
  let purgeExpiredExports: jest.Mock;
  let controller: SystemHealthController;

  beforeEach(async () => {
    health = snapshot();
    countActiveJobs = jest.fn().mockResolvedValue(7);
    countPendingTickets = jest.fn().mockResolvedValue(3);
    purgeExpiredExports = jest.fn().mockResolvedValue({
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
          useValue: { getSnapshot: () => health },
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

    controller = moduleRef.get(SystemHealthController);
  });

  describe('GET /admin/system-health', () => {
    it('reports measured disk totals instead of zeros', async () => {
      const body = await controller.getHealth();

      expect(body.disk).toEqual({
        total: 1000,
        used: 400,
        free: 600,
        percentage: 40,
      });
    });

    it('reports the host memory figure, not this process heap', async () => {
      const body = await controller.getHealth();

      expect(body.memory.total).toBe(800);
      expect(body.memory.used).toBe(320);
      expect(body.process).toEqual({
        rss: 100,
        heapTotal: 80,
        heapUsed: 50,
      });
    });

    it('counts the real job queue rather than querying user 0', async () => {
      const body = await controller.getHealth();

      expect(countActiveJobs).toHaveBeenCalledTimes(1);
      expect(countPendingTickets).toHaveBeenCalledTimes(1);
      expect(body.activeJobs).toBe(7);
      expect(body.pendingTickets).toBe(3);
    });

    it('returns when the Sentinel last looked, not the response time', async () => {
      const body = await controller.getHealth();

      expect(body.lastCheck).toBe('2026-10-12T00:00:00.000Z');
    });

    it('returns null when no check has completed yet', async () => {
      health = snapshot({ lastCheckedAt: null, status: HealthStatus.UNKNOWN });

      const body = await controller.getHealth();

      expect(body.lastCheck).toBeNull();
    });

    it('surfaces the measurement failure instead of reporting a healthy disk', async () => {
      health = snapshot({
        status: HealthStatus.UNKNOWN,
        lastError: 'Disk check failed: EIO',
      });

      const body = await controller.getHealth();

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
        health = snapshot({ status });
        const body = await controller.getHealth();
        expect(body.status).toBe(label);
      }
    });

    it('publishes the thresholds and the override state so the operator can see them', async () => {
      health = snapshot({ guardDisabled: true });

      const body = await controller.getHealth();

      expect(body.thresholds).toEqual(THRESHOLDS);
      expect(body.guardDisabled).toBe(true);
    });
  });

  describe('POST /admin/system-health/clear-temp', () => {
    it('runs the real purge and reports what it actually did', async () => {
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
      // system:health is granted to the Administrator role and is described as a
      // read capability. It must never reach a handler that deletes files.
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
      // system:manage is the stronger permission and does not imply the read
      // one, so the two routes are genuinely independent capabilities.
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

    it('requires system:manage for the destructive route, not system:health', () => {
      const handler = SystemHealthController.prototype.clearTemp;

      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBe(
        'system:manage',
      );
    });

    it('carries no class-level permission, because the guard OR-merges it with the handler permission', async () => {
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

    it('gives every handler its own permission, so adding a route cannot default to open', () => {
      const handlers = Object.getOwnPropertyNames(
        SystemHealthController.prototype,
      ).filter((name) => name !== 'constructor');

      expect(handlers.length).toBeGreaterThan(0);

      for (const name of handlers) {
        expect({
          handler: name,
          permission: Reflect.getMetadata(
            PERMISSIONS_KEY,
            SystemHealthController.prototype[name],
          ),
        }).toEqual({
          handler: name,
          permission: expect.stringContaining(':'),
        });
      }
    });

    it('wires both guards so the endpoint is not merely authenticated', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        SystemHealthController,
      ) as unknown[];

      expect(guards).toContain(PermissionGuard);
      expect(guards).toContain(AuthGuard('jwt'));
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
