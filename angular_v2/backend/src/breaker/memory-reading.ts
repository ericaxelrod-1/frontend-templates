/**
 * "90 % of WHAT" — the denominator, the numerator, and the four ways both can be
 * wrong (rebase.md §9B.2).
 *
 * A percentage threshold means nothing until the thing it is a percentage OF is
 * named, and Node offers two candidates that are wrong in opposite directions:
 *
 *   - `os.totalmem()` is correct on bare metal and **fatal in a container** — it
 *     reads the host's memory, because there is no cgroup translation on that
 *     path. On a 256 MB container on a 128 GB host the process can exhaust its
 *     whole limit and `used / totalmem` never exceeds 0.195 %. The breaker is not
 *     wrong at any instant; it is structurally incapable of tripping.
 *   - a cgroup limit with a **host-wide** numerator is the same mistake with more
 *     steps. So the limit AND the numerator always come from the same source.
 *
 * Resolution order, first hit wins: cgroup v2, cgroup v1, `os.totalmem()`.
 *
 * **The sentinel, and it is the reason this file exists.** Measured on this host
 * (cgroup v1 only, verified): `/sys/fs/cgroup/memory.max` does not exist, and
 * both `/sys/fs/cgroup/memory/memory.limit_in_bytes` and this process's own leaf
 * path read `9223372036854771712` — the v1 "no limit" sentinel, `2^63` rounded
 * down to a page. Accepting it makes the ratio `usage / 9223372036854771712` =
 * ~0.0000000253 %, which is arithmetically correct and operationally useless: the
 * meter reports a healthy machine all the way down. An unrecognised sentinel is
 * the same defect as a wrong denominator, which is why the acceptance condition
 * is "finite, positive, and the percentage lands in 0–100" and NEVER "greater
 * than zero" — zero passes that one and divides by zero.
 *
 * Everything here is PURE. `MemoryProbeDeps` is the whole world this module can
 * see, so both the cgroup v2 path, the cgroup v1 path, the sentinel rejection and
 * the host fallback are exercised on a developer machine with neither a container
 * nor a cgroup fixture directory.
 */

/**
 * Where the reading came from. Reported on every snapshot, because "90 %" is
 * meaningless to an operator who does not know what the 90 % is of.
 *
 * `host_totalmem` is the NORMAL case for this template — §0 states local
 * Postgres on bare metal, no containers — so the cgroup paths are the ones a
 * forker running under systemd or a scheduler actually gets.
 */
export type MemorySource = 'cgroup_v2' | 'cgroup_v1' | 'host_totalmem';

/** One measurement. `percent` is finite and within 0–100 by construction. */
export type MemoryReading = {
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly percent: number;
  readonly source: MemorySource;
};

/**
 * Everything the resolver is allowed to know about the outside world.
 *
 * `readTextFile` answers `undefined` for "absent or unreadable" — the caller
 * turns an `EACCES` into that, so this module never has to catch, and a read that
 * fails is indistinguishable from a file that is not there, which is exactly the
 * truth on every platform that matters here.
 */
export type MemoryProbeDeps = {
  readonly readTextFile: (path: string) => string | undefined;
  readonly totalMemBytes: () => number;
  readonly freeMemBytes: () => number;
};

export const CGROUP_V2_ROOT = '/sys/fs/cgroup';
export const CGROUP_V2_LIMIT_FILE = `${CGROUP_V2_ROOT}/memory.max`;
export const CGROUP_V2_USAGE_FILE = `${CGROUP_V2_ROOT}/memory.current`;
export const CGROUP_V1_ROOT = `${CGROUP_V2_ROOT}/memory`;
export const CGROUP_V1_USAGE_FILE = `${CGROUP_V1_ROOT}/memory.usage_in_bytes`;
export const PROC_SELF_CGROUP = '/proc/self/cgroup';

/** One page. The granularity every cgroup byte count is reported at. */
export const CGROUP_V1_PAGE_BYTES = 4096;

/**
 * `2^63` rounded DOWN to a page — the exact number cgroup v1 writes for "no
 * limit", and the value measured on this host (`9223372036854771712`).
 *
 * Written as arithmetic rather than as a literal because a double cannot hold
 * `2^63 - 1` exactly and this constant must be the number the kernel writes, not
 * the nearest representable neighbour of it. `2^63 - 4096` **is** exactly
 * representable, which is the same reason the kernel rounds down to a page.
 */
export const CGROUP_V1_UNLIMITED_BYTES = 2 ** 63 - CGROUP_V1_PAGE_BYTES;

export function isCgroupV1Unlimited(bytes: number): boolean {
  // A page of slack, so the comparison is a range rather than an equality: no real
  // limit is anywhere near 9.2 exabytes, and reading "within a page of the
  // ceiling" as "unlimited" costs nothing if one ever were.
  return bytes >= CGROUP_V1_UNLIMITED_BYTES - CGROUP_V1_PAGE_BYTES;
}

/**
 * A cgroup byte count, or `undefined`.
 *
 * Deliberately strict: `/^\d+$/` and not `parseInt`, because cgroup v2 spells
 * "no limit" as the literal string `max` and `parseInt('max')` is `NaN` — §2.3's
 * silent degradation wearing a number. `Number('max')` is also `NaN`, and this
 * rejects it by shape instead, which is the check that has teeth.
 */
export function parseByteCount(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = raw.trim();
  if (!/^\d+$/.test(text)) {
    return undefined;
  }
  const value = Number(text);
  // 0 is rejected with the rest: it is a legal cgroup value meaning "no memory at
  // all", and every percentage computed against it is a division by zero.
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readingFrom(usedBytes: number, limitBytes: number, source: MemorySource): MemoryReading | undefined {
  const percent = (usedBytes / limitBytes) * 100;
  if (!Number.isFinite(percent) || percent < 0) {
    return undefined;
  }
  return { usedBytes, limitBytes, percent, source };
}

/** cgroup v2. Rejected when absent, when it reads `max`, or when the usage file disagrees. */
function cgroupV2Reading(deps: MemoryProbeDeps): MemoryReading | undefined {
  const limit = parseByteCount(deps.readTextFile(CGROUP_V2_LIMIT_FILE));
  if (limit === undefined) {
    return undefined;
  }
  const used = parseByteCount(deps.readTextFile(CGROUP_V2_USAGE_FILE));
  if (used === undefined) {
    // A limit with no usable numerator is not a measurement. Falling through keeps
    // the limit and the numerator from coming from different worlds.
    return undefined;
  }
  return readingFrom(used, limit, 'cgroup_v2');
}

/**
 * THIS PROCESS's cgroup, read from `/proc/self/cgroup` rather than assumed.
 *
 * Assuming the root is the defect: on this host the root limit is the sentinel
 * while the leaf's usage figure is the one that describes this process, so a
 * root-only probe measures a different cgroup than the one being run in.
 */
export function cgroupV1MemoryFiles(readTextFile: (path: string) => string | undefined):
  | { readonly limitFile: string; readonly usageFile: string }
  | undefined {
  const cgroup = readTextFile(PROC_SELF_CGROUP);
  if (cgroup === undefined) {
    return undefined;
  }
  const mount = cgroup
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^\d+:memory:/.test(line));
  if (mount === undefined) {
    return undefined;
  }
  const relative = /^\d+:memory:(.*)$/.exec(mount)?.[1]?.trim() ?? '';
  if (relative === '' || relative === '/') {
    return { limitFile: `${CGROUP_V1_ROOT}/memory.limit_in_bytes`, usageFile: CGROUP_V1_USAGE_FILE };
  }
  // `relative` is absolute within the hierarchy (`/user.slice/…`), so this is a
  // concatenation and not a `join` — joining would drop the leading slash.
  return {
    limitFile: `${CGROUP_V1_ROOT}${relative}/memory.limit_in_bytes`,
    usageFile: `${CGROUP_V1_ROOT}${relative}/memory.usage_in_bytes`,
  };
}

/** cgroup v1, for the memory controller only, with the sentinel rejected. */
function cgroupV1Reading(deps: MemoryProbeDeps): MemoryReading | undefined {
  const files = cgroupV1MemoryFiles(deps.readTextFile);
  if (files === undefined) {
    return undefined;
  }
  const limit = parseByteCount(deps.readTextFile(files.limitFile));
  // The sentinel is the whole point of this branch: it is a number, it is finite,
  // it is positive, and dividing by it yields a percentage that can never reach
  // any threshold a human would configure.
  if (limit === undefined || isCgroupV1Unlimited(limit)) {
    return undefined;
  }
  const used = parseByteCount(deps.readTextFile(files.usageFile));
  if (used === undefined) {
    return undefined;
  }
  return readingFrom(used, limit, 'cgroup_v1');
}

/** Bare metal. The normal case for this template, per §0. */
function hostReading(deps: MemoryProbeDeps): MemoryReading | undefined {
  const total = deps.totalMemBytes();
  const free = deps.freeMemBytes();
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0 || free > total) {
    return undefined;
  }
  return readingFrom(total - free, total, 'host_totalmem');
}

/**
 * The one measurement, or `null`.
 *
 * `null` is NOT a safe default and must never become one — it means *no usable
 * figure exists*, and the meter's response to it is to publish an unusable
 * sample, which the gate treats as **stopped**. Homegrown-etl's equivalent is
 * `return 50; // Return safe default value` (`job-queue.service.ts:1481-1484`):
 * 50 is below its green zone, so an unreadable memory figure **opens the gate
 * and dispatches at full concurrency**. 50 is the unsafe direction and the
 * comment calls it safe; this returns nothing at all instead.
 */
export function resolveMemoryReading(deps: MemoryProbeDeps): MemoryReading | null {
  return cgroupV2Reading(deps) ?? cgroupV1Reading(deps) ?? hostReading(deps) ?? null;
}