import { describe, expect, it } from 'vitest';
import {
  CGROUP_V1_ROOT,
  CGROUP_V1_UNLIMITED_BYTES,
  CGROUP_V1_USAGE_FILE,
  CGROUP_V2_LIMIT_FILE,
  CGROUP_V2_USAGE_FILE,
  PROC_SELF_CGROUP,
  isCgroupV1Unlimited,
  parseByteCount,
  resolveMemoryReading,
} from '../../../src/breaker/memory-reading.js';
import type { MemoryProbeDeps } from '../../../src/breaker/memory-reading.js';

/**
 * "90 % of WHAT" — rebase.md §9B.2.
 *
 * These run against a **fixture**, not against this machine's cgroup, because the
 * point of each one is a shape this host does not have: a cgroup v2 root, a cgroup
 * v1 root with a *real* limit, and a leaf limit that is not the unlimited
 * sentinel. This machine has cgroup v1 only and reads
 * `9223372036854771712` for the limit, which is the one value asserted verbatim
 * below.
 */

/** A probe whose filesystem is a map, so every cgroup path is constructible. */
function fixture(
  files: Readonly<Record<string, string>>,
  host: { readonly totalMem: number; readonly freeMem: number } = { totalMem: 0, freeMem: 0 },
): MemoryProbeDeps {
  return {
    readTextFile: (path) => files[path],
    totalMemBytes: () => host.totalMem,
    freeMemBytes: () => host.freeMem,
  };
}

const MIB = 1024 * 1024;

describe('the memory denominator', () => {
  it('uses the cgroup v2 limit and usage when both are present', () => {
    const reading = resolveMemoryReading(
      fixture({
        [CGROUP_V2_LIMIT_FILE]: String(256 * MIB),
        [CGROUP_V2_USAGE_FILE]: String(200 * MIB),
      }),
    );

    expect(reading).toEqual({
      usedBytes: 200 * MIB,
      limitBytes: 256 * MIB,
      percent: (200 / 256) * 100,
      source: 'cgroup_v2',
    });
    // 78.125 % — the number that trips a 60/80/90 breaker into the yellow band,
    // which `os.totalmem()` on a 128 GB host could never have produced.
    expect(reading?.percent).toBeCloseTo(78.125, 6);
  });

  it('falls through when cgroup v2 spells "no limit" as the literal string max, because parseInt("max") is NaN', () => {
    const reading = resolveMemoryReading(
      fixture({
        [CGROUP_V2_LIMIT_FILE]: 'max',
        [CGROUP_V2_USAGE_FILE]: String(200 * MIB),
      }, { totalMem: 1000 * MIB, freeMem: 250 * MIB }),
    );

    expect(reading?.source).toBe('host_totalmem');
    expect(reading?.percent).toBeCloseTo(75, 6);
  });

  it('falls through when the v2 limit exists but its usage file does not, rather than pairing a limit with a host-wide figure', () => {
    const reading = resolveMemoryReading(
      fixture({ [CGROUP_V2_LIMIT_FILE]: String(256 * MIB) }, { totalMem: 1000 * MIB, freeMem: 250 * MIB }),
    );

    expect(reading?.source).toBe('host_totalmem');
  });

  it("resolves cgroup v1 through THIS process's own cgroup path from /proc/self/cgroup, not the controller root", () => {
    const leaf = `${CGROUP_V1_ROOT}/user.slice/user-1000.slice/user@1000.service`;
    const reading = resolveMemoryReading(
      fixture({
        [PROC_SELF_CGROUP]: [
          '0::/',
          '7:memory:/user.slice/user-1000.slice/user@1000.service',
          '1:blkio:/user.slice',
        ].join('\n'),
        [`${leaf}/memory.limit_in_bytes`]: String(512 * MIB),
        [`${leaf}/memory.usage_in_bytes`]: String(384 * MIB),
        // The controller ROOT reads the sentinel, so a probe that assumed the root
        // would fall through to os.totalmem() and measure the wrong world.
        [`${CGROUP_V1_ROOT}/memory.limit_in_bytes`]: String(CGROUP_V1_UNLIMITED_BYTES),
        [CGROUP_V1_USAGE_FILE]: String(2_336_964_608),
      }),
    );

    expect(reading).toEqual({
      usedBytes: 384 * MIB,
      limitBytes: 512 * MIB,
      percent: 75,
      source: 'cgroup_v1',
    });
  });

  it('uses the controller root when /proc/self/cgroup names the memory controller at the root', () => {
    const reading = resolveMemoryReading(
      fixture({
        [PROC_SELF_CGROUP]: '7:memory:/\n1:blkio:/',
        [`${CGROUP_V1_ROOT}/memory.limit_in_bytes`]: String(1024 * MIB),
        [CGROUP_V1_USAGE_FILE]: String(512 * MIB),
      }),
    );

    expect(reading?.source).toBe('cgroup_v1');
    expect(reading?.percent).toBeCloseTo(50, 6);
  });

  it('rejects the cgroup v1 unlimited sentinel, which is the value this host actually reports', () => {
    // VERIFIED on this machine: `/sys/fs/cgroup/memory/memory.limit_in_bytes` and
    // this process's own leaf both read 9223372036854771712 = 2^63 rounded down to a
    // page. Accepting it yields 2.18 GiB / 9223372036854771712 = 0.0000000253 %,
    // which is arithmetically correct and operationally useless: the meter reports
    // a healthy machine all the way down and the breaker can never trip.
    expect(isCgroupV1Unlimited(9_223_372_036_854_771_712)).toBe(true);
    expect(isCgroupV1Unlimited(536_870_912_000)).toBe(false);

    const leaf = `${CGROUP_V1_ROOT}/user.slice/user-1000.slice/user@1000.service`;
    const reading = resolveMemoryReading(
      fixture({
        [PROC_SELF_CGROUP]: '7:memory:/user.slice/user-1000.slice/user@1000.service',
        [`${leaf}/memory.limit_in_bytes`]: '9223372036854771712',
        [`${leaf}/memory.usage_in_bytes`]: '2336964608',
      }, { totalMem: 6_784_069_632, freeMem: 6_784_069_632 - 2_336_964_608 }),
    );

    // Not the 0.0000000253 % the sentinel produces: the host fallback, at 34.45 %.
    expect(reading?.source).toBe('host_totalmem');
    expect(reading?.percent).toBeCloseTo(34.4478, 3);
    expect(reading?.percent).toBeGreaterThan(1);
  });

  it('falls back to os.totalmem() on bare metal, which is this template\'s stated deployment', () => {
    const reading = resolveMemoryReading(fixture({}, { totalMem: 6_784_069_632, freeMem: 5_100_941_312 }));

    expect(reading).toEqual({
      usedBytes: 1_683_128_320,
      limitBytes: 6_784_069_632,
      percent: (1_683_128_320 / 6_784_069_632) * 100,
      source: 'host_totalmem',
    });
  });

  it('rejects a cgroup limit of zero, which is legal and divides by zero', () => {
    const reading = resolveMemoryReading(
      fixture({
        [CGROUP_V2_LIMIT_FILE]: '0',
        [CGROUP_V2_USAGE_FILE]: '0',
      }, { totalMem: 1000, freeMem: 500 }),
    );

    expect(reading?.source).toBe('host_totalmem');
  });

  it('reports NO reading rather than a safe default when nothing is measurable', () => {
    // This is the inverse of homegrown-etl's `return 50; // Return safe default
    // value` (`job-queue.service.ts:1481-1484`): 50 sits below its green zone of 60,
    // so an unreadable figure OPENED the gate and dispatched at full concurrency.
    // The comment called it safe and it was the unsafe direction.
    expect(resolveMemoryReading(fixture({}, { totalMem: 0, freeMem: 0 }))).toBeNull();
    expect(resolveMemoryReading(fixture({}, { totalMem: 100, freeMem: 200 }))).toBeNull();
    expect(resolveMemoryReading(fixture({}, { totalMem: Number.NaN, freeMem: 0 }))).toBeNull();
  });

  it('parses byte counts by shape, so no spelling of "no limit" can become a number', () => {
    expect(parseByteCount('1024')).toBe(1024);
    expect(parseByteCount('  1024\n')).toBe(1024);
    expect(parseByteCount('max')).toBeUndefined();
    expect(parseByteCount('9223372036854771712')).toBeUndefined(); // beyond Number.MAX_SAFE_INTEGER
    expect(parseByteCount('0')).toBeUndefined();
    expect(parseByteCount('-1')).toBeUndefined();
    expect(parseByteCount('1e9')).toBeUndefined();
    expect(parseByteCount(undefined)).toBeUndefined();
  });
});