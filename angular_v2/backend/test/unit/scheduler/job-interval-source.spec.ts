import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * **Every interval a JOB runs on comes from configuration, asserted against the
 * source.**
 *
 * The claim this file holds is not "the two retention jobs read their intervals from
 * the environment" — that is true today and could stop being true with a one-line
 * edit nobody notices. It is the stronger property: **the only place a job can get a
 * repeating timer is `JobRunner.schedule()`, and no call site hands it a literal.**
 * That is what makes a future job's interval a configuration decision by construction
 * rather than by the reader's memory.
 *
 * A source scanner rather than a runtime assertion because the thing that must be
 * caught is a NUMBER in a source file, and no runtime observation can see one.
 */

/** Comments are stripped: this file's claim is about executable text. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('//');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

function tsFilesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort();
}

/** Every `setInterval(` call site in `src/`, by path. */
function setIntervalCallSites(): readonly string[] {
  return tsFilesUnder(join(BACKEND_ROOT, 'src')).filter((path) =>
    stripComments(readFileSync(path, 'utf8')).includes('setInterval('),
  );
}

/** Every `jobs.schedule(` call site in `src/`, by path. */
function scheduleCallSites(): ReadonlyArray<{ readonly path: string; readonly argument: string }> {
  return tsFilesUnder(join(BACKEND_ROOT, 'src')).flatMap((path) => {
    const source = stripComments(readFileSync(path, 'utf8'));
    return [...source.matchAll(/\.schedule\(\s*([A-Z_]+)\s*,\s*([^,)]+?)\s*[,)]/g)].map((match) => ({
      path: relative(BACKEND_ROOT, path).replaceAll('\\', '/'),
      argument: match[2] ?? '',
    }));
  });
}

describe("there is exactly one setInterval for a JOB, and it is the runner's", () => {
  it('is the runner plus the two breaker instruments, and nothing else', () => {
    // One mechanism per concern (§2.4). A fourth `setInterval` anywhere in `src/` is a
    // timer that does not go through `JobRunner`, which means a job that does not take
    // an advisory lock — the exact gap this whole unit exists to close.
    //
    // **The breaker's two are named here rather than counted away**, because they must
    // stay where they are: the memory meter and the gate are per-instance instruments
    // and are SUPPOSED to run on every instance at once. Routing them through the
    // runner would take an advisory lock per poll, which serialises the breaker across
    // instances — the opposite of what a breaker is — and spends a database connection
    // every poll. What is forbidden is a THIRD file growing a timer.
    expect(setIntervalCallSites().map((path) => relative(BACKEND_ROOT, path).replaceAll('\\', '/'))).toEqual([
      'src/breaker/breaker-gate.ts',
      'src/breaker/breaker-meter.ts',
      'src/scheduler/job-runner.service.ts',
    ]);
  });

  it('passes an interval derived from its parameter, not a number written in the file', () => {
    const source = stripComments(
      readFileSync(join(BACKEND_ROOT, 'src', 'scheduler', 'job-runner.service.ts'), 'utf8'),
    );

    // The interval is `intervalSeconds * 1000`, and `intervalSeconds` is a required
    // parameter of `schedule()` with no default anywhere: a job that forgets to supply
    // one gets a compile error rather than a default cadence nobody chose.
    expect(source).toContain('const intervalMs = intervalSeconds * 1000;');
    expect(source).toContain('schedule(name: DispatchToken, intervalSeconds: number, body: () => Promise<unknown>): void');
    expect(source.match(/setInterval\([\s\S]*?\n {4}\}, intervalMs\);/)).not.toBeNull();
  });
});

describe('every job registers its interval from a validated configuration value', () => {
  it('passes an injected environment field at every call site, never a literal', () => {
    const sites = scheduleCallSites();
    // Non-vacuous: a scanner that found nothing would pass every assertion below.
    expect(sites.length, 'no job registers an interval; this file would be vacuous').toBeGreaterThanOrEqual(2);

    const offenders = sites
      .filter((site) => !/^this\.env\.\w+$/.test(site.argument))
      .map((site) => `${site.path} registers ${site.argument}`);

    expect(offenders, 'a job registered an interval that is not a configuration value').toEqual([]);
  });

  it('names the two retention jobs, and both read a boot-validated namespace', () => {
    // Spelled out rather than derived from the scanner's output, because the scanner
    // says "every site obeys the rule" and this says "the rule is applied to the jobs
    // that exist" — a pair that together cannot both be true while a job is missing.
    const argumentsByPath = new Map(scheduleCallSites().map((site) => [site.path, site.argument]));

    expect(argumentsByPath.get('src/purge/purge-sweeper.service.ts')).toBe('this.env.purgePollSeconds');
    expect(argumentsByPath.get('src/purge/purge-enqueuer.service.ts')).toBe('this.env.enqueueIntervalSeconds');
  });
});