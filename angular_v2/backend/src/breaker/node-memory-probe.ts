import { readFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import type { MemoryProbeDeps } from './memory-reading.js';

/**
 * The DI token for the probe. One registered implementation, one consumer shape:
 * a token rather than the concrete class because the *shape* (`MemoryProbeDeps`)
 * is what the meter needs and the production binding is `nodeMemoryProbeDeps`.
 */
export const MEMORY_PROBE = 'MEMORY_PROBE_DEPS';

/**
 * The only place in the breaker that touches the filesystem or `os`.
 *
 * Everything downstream takes a `MemoryProbeDeps`, which is what lets the cgroup
 * v2 path, the cgroup v1 path, the v1 sentinel rejection and the bare-metal
 * fallback be unit-tested on a machine that is none of those things at once.
 *
 * `readTextFile` swallows `ENOENT`, `EACCES` and `EISDIR` into `undefined`: a
 * cgroup file this process may not read is indistinguishable, for this purpose,
 * from one that does not exist, and both mean "fall through to the next source".
 * Any OTHER error is rethrown — swallowing an unexpected `EIO` would be §2.3's
 * silent degradation with an extra step.
 */
export function nodeMemoryProbeDeps(): MemoryProbeDeps {
  return {
    readTextFile(path: string): string | undefined {
      try {
        return readFileSync(path, 'utf8');
      } catch (error) {
        if (isMissingFileError(error)) {
          return undefined;
        }
        throw error;
      }
    },
    totalMemBytes(): number {
      return totalmem();
    },
    freeMemBytes(): number {
      return freemem();
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EISDIR')
  );
}