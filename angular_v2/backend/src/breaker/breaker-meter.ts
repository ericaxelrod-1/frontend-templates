import { statfs } from 'node:fs/promises';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { DiskSample } from './breaker-health.js';
import { buildHealthSnapshot } from './breaker-health.js';
import { BreakerRegistry } from './breaker-registry.js';
import type { MemorySample } from './breaker-state.js';
import { applySample } from './breaker-state.js';
import { BREAKER_METER } from './dispatch-token.js';
import type { MemoryProbeDeps } from './memory-reading.js';
import { resolveMemoryReading } from './memory-reading.js';
import { MEMORY_PROBE } from './node-memory-probe.js';

/**
 * `breaker.meter` — the measurement. It runs on its own interval and it is in
 * `BREAKER_PROTECTED`, which is the whole point of this class existing separately
 * from the gate.
 *
 * **A breaker that lives inside the thing it gates stops being able to observe
 * when that thing stops.** If this measurement were taken on the way to dispatch,
 * then stopping dispatch would stop the measurement; and if the measurement were
 * merely the last value the gate happened to compute, then a meter that had
 * stopped would leave the gate reading a stale `closed` forever — the system
 * latching open at full concurrency with nothing anywhere checking whether the
 * reading is current. So: the meter ticks whether or not anything is running, it
 * never consults the gate, and a reading it fails to produce is published as
 * *unusable* rather than as a safe number.
 *
 * `breaker.meter` and `breaker.gate` are also registered with `SchedulerRegistry`
 * on **separate intervals**, not through `@Cron`. `@Cron` binds its handler during
 * `OnModuleInit`, which Nest runs *before* `OnApplicationBootstrap`; registering
 * explicitly keeps both jobs strictly after the breaker configuration has been
 * asserted at module-evaluation time, which is the ordering a control whose value
 * proposition is refusing bad configuration needs.
 */
@Injectable()
export class BreakerMeter implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BreakerMeter.name);
  private timer: NodeJS.Timeout | undefined;
  /** Self-overlap latch. See `tick()`. */
  private ticking = false;

  constructor(
    private readonly registry: BreakerRegistry,
    @Inject(MEMORY_PROBE) private readonly probe: MemoryProbeDeps,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * **The first reading is taken here, before the interval exists.**
   *
   * This is the cold-start fix, and it is here rather than in the gate because of
   * where the work is allowed to happen. `BREAKER_POLL_SECONDS` defaults to 30,
   * and a meter's first publication was one whole poll interval away, so between
   * process start and the first tick the breaker had no reading at all — and a
   * gate that treats "no reading" as "unknown, stop" refuses every non-protected
   * dispatch with `202` for that half-minute, on a machine under no pressure. That
   * is not a near miss: it is what turned a committed, previously-green
   * `test/e2e/email.e2e-spec.ts` red, because a request arriving 300 ms after
   * boot found a gate that had measured nothing.
   *
   * **Why here and not at gate time.** Sampling on the way to dispatch is the
   * exact defect this class exists to avoid: the gate would then measure, and a
   * gate that measures is a gate that can only observe what it lets through. This
   * job takes its reading whether or not anything is being dispatched, and the
   * reading is published before a listener exists, so no request can be answered
   * from an unmeasured state.
   *
   * **Why this is cheap.** It is one call to `tick()`, once per process, before
   * `listen()`. `resolveMemoryReading` is synchronous and reads at most four
   * small files through `readTextSync` (`node-memory-probe.ts`); `statfs` is one
   * asynchronous syscall on a path Node has already opened. There is no `statfs`
   * plus directory walk on the request path, because nothing here is on the
   * request path — it is all of the work the meter does in the 30 seconds after
   * boot, moved to before them.
   *
   * **And why it is `tick()` and not a second, cheaper publication.** A separate
   * "just the sample" path would be a second mechanism for the same job (§2.4),
   * and it would drift from the one that runs every 30 s after it. Calling
   * `tick()` means the first reading and the four-hundred-and-first are the same
   * code, and the snapshot line an operator greps for exists from boot.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.tick();
    const periodMs = this.registry.runtime.pollSeconds * 1000;
    const timer = setInterval(() => {
      void this.tick();
    }, periodMs);
    // `unref()` so a suspended process does not hold the event loop open at
    // shutdown; the registry still owns the handle so it can be cleared.
    timer.unref();
    this.timer = timer;
    this.scheduler.addInterval(BREAKER_METER, timer);
    this.logger.log(
      `breaker.meter took its first reading at bootstrap and now ticks every ${this.registry.runtime.pollSeconds}s`,
    );
  }

  onModuleDestroy(): void {
    const timer = this.timer;
    // Cleared BEFORE anything can await, so a second destroy hook cannot find a
    // handle it already deleted — Nest calls the hook on both app-close and
    // module-close, and the second `deleteInterval` would throw.
    this.timer = undefined;
    if (timer === undefined) {
      return;
    }
    clearInterval(timer);
    if (this.scheduler.doesExist('interval', BREAKER_METER)) {
      this.scheduler.deleteInterval(BREAKER_METER);
    }
  }

  /**
   * One measurement, published.
   *
   * **Measured once, at the top, before anything else** — a measurement taken
   * after work has been admitted measures the wrong thing.
   *
   * The latch is the second half of the legacy's self-overlap defect: its
   * `@Cron` handler contained a `while (true)` drain loop, so a slow tick ran
   * concurrently with the next tick and two of them claimed the same work. The
   * latch is released in `finally` rather than on the success path, because a
   * failed tick that wedges the meter is the same bug pointing the other way —
   * and a meter that has stopped is a gate that has stopped seeing anything.
   */
  async tick(nowMs: number = Date.now()): Promise<void> {
    if (this.ticking) {
      this.logger.warn('breaker.meter tick skipped: the previous tick is still running');
      return;
    }
    this.ticking = true;
    try {
      const sample = this.sample(nowMs);
      const state = applySample(this.registry.get(), sample, this.registry.runtime, nowMs);
      this.registry.publish(state);

      const snapshot = buildHealthSnapshot(state, this.registry.runtime, await this.diskSample(), nowMs);
      // One line per tick, every tick. A resource metric nobody sees is a metric
      // nobody acts on, and this line is the health surface this build ships.
      this.logger.log(
        `breaker snapshot memory percent=${String(snapshot.memory.percent)} source=${String(snapshot.memory.source)} ` +
          `zone=${String(snapshot.memory.zone)} usable=${snapshot.memory.usable} ` +
          `disk_free_bytes=${snapshot.disk.free_bytes} disk_free_ratio=${snapshot.disk.free_ratio} ` +
          `breaker=${snapshot.breaker.state} stale=${snapshot.breaker.stale_reading} ` +
          `gated=${snapshot.breaker.gated_dispatches} stopped=${snapshot.breaker.stopped_dispatches}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The reading, or an explicitly unusable sample.
   *
   * `resolveMemoryReading` returns `null` for "no usable figure exists" and that
   * is carried through as `usable: false` — never as a substituted number. The
   * reference implementation this came from ends its measurement failure path
   * with `return 50; // Return safe default value`; 50 sits below its green zone of
   * 60, so an unreadable memory figure **opened the gate and dispatched at full
   * concurrency**. The comment called it safe and it was the unsafe direction.
   */
  private sample(nowMs: number): MemorySample {
    let reading = null;
    try {
      reading = resolveMemoryReading(this.probe);
    } catch (error) {
      this.logger.error(
        `breaker.meter could not read memory: ${error instanceof Error ? error.message : String(error)}. ` +
          'Publishing an unusable sample, which gates dispatch.',
      );
    }
    if (reading === null) {
      this.logger.error(
        'breaker.meter found no usable memory figure (cgroup v2 and v1 limits absent or unlimited, ' +
          'and os.totalmem() unusable). Publishing an unusable sample, which gates dispatch.',
      );
      return { measuredAtMs: nowMs, usable: false, reading: null };
    }
    return { measuredAtMs: nowMs, usable: true, reading };
  }

  /** Reported, never a trip input. See `DiskHealth`. */
  private async diskSample(): Promise<DiskSample> {
    try {
      const stats = await statfs('.');
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      return {
        freeBytes,
        freeRatio: totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0,
      };
    } catch (error) {
      this.logger.error(
        `breaker.meter could not statfs the working filesystem: ${error instanceof Error ? error.message : String(error)}. ` +
          'Disk is reported and never a trip input, so this does not gate anything.',
      );
      return { freeBytes: 0, freeRatio: 0 };
    }
  }
}