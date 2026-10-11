import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRONTEND_ROOT, BACKEND_ROOT, REPOSITORY_ROOT } from '../../support/paths.js';

const DEVELOPMENT_DOC = join(REPOSITORY_ROOT, 'docs', 'development.md');

const NPM_RUN = /npm run ([a-zA-Z0-9:_-]+)/g;
const NPM_LIFECYCLE = /npm (test|start|restart|stop|ci)\b/g;

/**
 * Commands `docs/development.md` documents that belong to a later phase and
 * therefore have no script yet. Each entry is a claim that is currently false,
 * so it is a machine-checked debt list rather than a silent gap:
 *
 * - a name here that is *not* documented fails (the doc changed, the ledger did not);
 * - a name here that *is* implemented fails (the work landed, the ledger is stale);
 * - an entry without a work item fails;
 * - the whole list is printed on every `npm run verify`.
 *
 * Remove an entry in the same change that adds the script. An entry whose script
 * has landed is not inert — it turns `verify` red on the assertion above, and the
 * fix is the deletion, never a skip or a relaxed comparison.
 */
const DEFERRED_COMMANDS: ReadonlyArray<{ readonly command: string; readonly workItem: string; readonly reason: string }> = [];

export function documentedCommands(source: string): Set<string> {
  const commands = new Set<string>();
  for (const match of source.matchAll(NPM_RUN)) {
    const name = match[1];
    if (name !== undefined) {
      commands.add(name);
    }
  }
  for (const match of source.matchAll(NPM_LIFECYCLE)) {
    const name = match[1];
    if (name !== undefined) {
      commands.add(name);
    }
  }
  return commands;
}

export function implementedCommands(): Map<string, string> {
  const scripts = new Map<string, string>();
  for (const [project, root] of [
    ['backend', BACKEND_ROOT],
    ['frontend', FRONTEND_ROOT],
  ] as const) {
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || !('scripts' in manifest)) {
      throw new TypeError(`${project}/package.json has no scripts object`);
    }
    const declared: unknown = manifest.scripts;
    if (typeof declared !== 'object' || declared === null) {
      throw new TypeError(`${project}/package.json scripts is not an object`);
    }
    for (const [name, command] of Object.entries(declared)) {
      if (typeof command !== 'string') {
        throw new TypeError(`${project} script '${name}' is not a string`);
      }
      scripts.set(name, `${project}: ${command}`);
    }
  }
  return scripts;
}

const documented = documentedCommands(readFileSync(DEVELOPMENT_DOC, 'utf8'));
const implemented = implementedCommands();
const deferred = new Set(DEFERRED_COMMANDS.map((entry) => entry.command));

describe('npm commands documented in docs/development.md', () => {
  it('finds documented commands, so the checks below are not vacuous', () => {
    expect(documented.size).toBeGreaterThan(0);
    expect(documented.has('verify')).toBe(true);
  });

  it('implements every documented command, except the ones deferred below', () => {
    const unbacked = [...documented]
      .filter((command) => !implemented.has(command) && !deferred.has(command))
      .sort()
      .map((command) => `${command} (documented in docs/development.md, absent from every package.json)`);

    expect(unbacked).toEqual([]);
  });

  it('keeps the deferral ledger honest', () => {
    const notDocumentedAnymore = DEFERRED_COMMANDS.filter((entry) => !documented.has(entry.command)).map(
      (entry) => `${entry.command} (deferred to ${entry.workItem} but no longer documented)`,
    );
    const alreadyImplemented = DEFERRED_COMMANDS.filter((entry) => implemented.has(entry.command)).map(
      (entry) => `${entry.command} (deferred to ${entry.workItem} but implemented as '${implemented.get(entry.command) ?? ''}')`,
    );
    const withoutProvenance = DEFERRED_COMMANDS.filter(
      (entry) => entry.workItem.trim() === '' || entry.reason.trim() === '',
    ).map((entry) => `${entry.command} (no work item or reason recorded)`);

    expect([...notDocumentedAnymore, ...alreadyImplemented, ...withoutProvenance]).toEqual([]);
  });

  it('reports the outstanding debt on every run', () => {
    const report = DEFERRED_COMMANDS.map(
      (entry) => `  - npm run ${entry.command} — deferred to ${entry.workItem}: ${entry.reason}`,
    ).join('\n');

    console.warn(
      `docs/development.md documents ${DEFERRED_COMMANDS.length} command(s) with no script yet:\n${report}`,
    );

    if (DEFERRED_COMMANDS.length === 0) {
      expect(report).toBe('');
    } else {
      expect(report).toContain('npm run');
    }
  });
});
