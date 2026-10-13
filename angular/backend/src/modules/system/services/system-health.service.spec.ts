import { Test } from '@nestjs/testing';
import { SystemHealthService, HealthStatus } from './system-health.service';
import { SentinelConfigService } from '../config/sentinel.config';

type StatFsLike = {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
};

describe('SystemHealthService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeService(env: Record<string, string> = {}): SystemHealthService {
    const previous = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    const service = new SystemHealthService(new SentinelConfigService());
    process.env = previous;
    return service;
  }

  async function withStatfs(
    stats: StatFsLike | Error,
    body: () => Promise<void>,
  ): Promise<void> {
    jest
      .spyOn(require('fs/promises'), 'statfs')
      .mockImplementation(() =>
        stats instanceof Error ? Promise.reject(stats) : Promise.resolve(stats),
      );
    await body();
  }

  const GIGABYTE = 1024 * 1024 * 1024;
  const usage = (usedPercent: number): StatFsLike => {
    const totalBlocks = 1000;
    const freeBlocks = Math.round(totalBlocks * (1 - usedPercent / 100));
    return {
      bsize: GIGABYTE,
      blocks: totalBlocks,
      bfree: freeBlocks,
      bavail: freeBlocks,
    };
  };

  it('reports real disk totals from statfs rather than zeros', async () => {
    const service = makeService();

    await withStatfs(usage(40), () => service.checkDiskSpace());

    const snapshot = service.getSnapshot();
    expect(snapshot.disk.total).toBe(1000 * GIGABYTE);
    expect(snapshot.disk.free).toBe(600 * GIGABYTE);
    expect(snapshot.disk.used).toBe(400 * GIGABYTE);
    expect(snapshot.disk.percentage).toBeCloseTo(40);
  });

  it('counts blocks available to this process (bavail), not blocks reserved for root (bfree)', async () => {
    const service = makeService();

    await withStatfs(
      { bsize: GIGABYTE, blocks: 1000, bfree: 600, bavail: 550 },
      () => service.checkDiskSpace(),
    );

    const snapshot = service.getSnapshot();
    expect(snapshot.disk.free).toBe(550 * GIGABYTE);
    expect(snapshot.disk.used).toBe(450 * GIGABYTE);
  });

  it('reports host memory from os, not process.memoryUsage()', async () => {
    const service = makeService();

    await withStatfs(usage(10), () => service.checkDiskSpace());

    const snapshot = service.getSnapshot();
    expect(snapshot.memory.total).toBe(require('os').totalmem());
    expect(snapshot.memory.free).toBe(require('os').freemem());
    expect(snapshot.memory.total).toBeGreaterThan(snapshot.memory.process.rss);
  });

  it('classifies against the configured thresholds, not literals', async () => {
    const service = makeService({
      SENTINEL_WARNING_PERCENT: '50',
      SENTINEL_CRITICAL_PERCENT: '60',
      SENTINEL_PANIC_PERCENT: '70',
    });

    await withStatfs(usage(55), () => service.checkDiskSpace());
    expect(service.getHealthStatus()).toBe(HealthStatus.WARNING);

    await withStatfs(usage(65), () => service.checkDiskSpace());
    expect(service.getHealthStatus()).toBe(HealthStatus.CRITICAL);

    await withStatfs(usage(75), () => service.checkDiskSpace());
    expect(service.getHealthStatus()).toBe(HealthStatus.PANIC);
  });

  describe('when the measurement fails', () => {
    it('sets UNKNOWN instead of leaving the previous status in place', async () => {
      const service = makeService();

      await withStatfs(usage(99), () => service.checkDiskSpace());
      expect(service.getHealthStatus()).toBe(HealthStatus.PANIC);

      await withStatfs(new Error('EIO'), () => service.checkDiskSpace());

      // A failed statfs is not evidence that the disk is fine. Leaving PANIC
      // here would keep blocking traffic on a measurement bug; leaving NORMAL
      // would silently disarm the Sentinel.
      expect(service.getHealthStatus()).toBe(HealthStatus.UNKNOWN);
    });

    it('records the failure reason on the snapshot rather than swallowing it', async () => {
      const service = makeService();

      await withStatfs(new Error('EIO: i/o error'), () =>
        service.checkDiskSpace(),
      );

      expect(service.getSnapshot().lastError).toContain('EIO: i/o error');
      expect(service.getSnapshot().lastCheckedAt).not.toBeNull();
    });

    it('clears lastError once a later check succeeds', async () => {
      const service = makeService();

      await withStatfs(new Error('EIO'), () => service.checkDiskSpace());
      expect(service.getSnapshot().lastError).not.toBeNull();

      await withStatfs(usage(10), () => service.checkDiskSpace());
      expect(service.getSnapshot().lastError).toBeNull();
      expect(service.getHealthStatus()).toBe(HealthStatus.NORMAL);
    });
  });

  describe('tier predicates', () => {
    it('isResourceCritical() is the 95% tier only, so PANIC is distinguishable', async () => {
      const service = makeService();

      await withStatfs(usage(96), () => service.checkDiskSpace());
      expect(service.isResourceCritical()).toBe(true);
      expect(service.isPanic()).toBe(false);

      await withStatfs(usage(99), () => service.checkDiskSpace());
      expect(service.isResourceCritical()).toBe(false);
      expect(service.isPanic()).toBe(true);
    });

    it('reports no block for UNKNOWN, so a broken monitor cannot halt traffic', async () => {
      const service = makeService();

      await withStatfs(new Error('EIO'), () => service.checkDiskSpace());

      expect(service.isResourceCritical()).toBe(false);
      expect(service.isPanic()).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('has completed a measurement before the first request is served', async () => {
      const service = makeService();

      await withStatfs(usage(97), async () => {
        await service.onModuleInit();
      });

      expect(service.getSnapshot().lastCheckedAt).not.toBeNull();
      expect(service.getSnapshot().status).toBe(HealthStatus.CRITICAL);
    });
  });

  it('is resolvable through the Nest injector', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SentinelConfigService, SystemHealthService],
    }).compile();

    await moduleRef.init();

    const service = moduleRef.get(SystemHealthService);
    expect(service.getSnapshot().thresholds.panicPercent).toBe(98);
    await moduleRef.close();
  });
});
