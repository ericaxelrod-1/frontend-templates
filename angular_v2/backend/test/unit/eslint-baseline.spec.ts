import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_ROOT, FRONTEND_ROOT, REPOSITORY_ROOT } from '../support/paths.js';

const BACKEND_CONFIG = readFileSync(join(BACKEND_ROOT, 'eslint.config.js'), 'utf8');
const FRONTEND_CONFIG = readFileSync(join(FRONTEND_ROOT, 'eslint.config.js'), 'utf8');

const ANGULAR_RULES = [
  '@angular-eslint/prefer-on-push-component-change-detection',
  '@angular-eslint/prefer-standalone',
  '@angular-eslint/template/prefer-control-flow',
  '@angular-eslint/template/conditional-complexity',
  '@angular-eslint/no-empty-lifecycle-method',
] as const;

const CROSS_CUTTING_RULES = ['@typescript-eslint/no-explicit-any'] as const;

/**
 * Rules of the `AGENTS.md` §3 baseline that no released tool can enforce, each
 * with the evidence and the substitute in force. Same contract as the doc-claims
 * ledger: an entry that stops being true fails this suite, so the gap cannot be
 * forgotten once upstream ships a fix.
 */
const UNAVAILABLE_RULES: ReadonlyArray<{
  readonly rule: string;
  readonly requestedAs: string;
  readonly reason: string;
  readonly substitute: string;
}> = [
  {
    rule: 'rxjs-angular/prefer-takeuntil-destroyed',
    requestedAs: 'rxjs-angular/prefer-takeuntil-destroyed',
    reason:
      'no rule by that name exists: eslint-plugin-rxjs-angular@2.0.1 ships prefer-async-pipe, prefer-composition and prefer-takeuntil only. Its nearest rule, prefer-takeuntil, cannot be enabled at all: the plugin reads type information through @typescript-eslint/experimental-utils@5 and context.parserServices, and ESLint removed context.parserServices in v9. Loading it aborts the run on the first linted file. angular-eslint@22, which Angular 22 needs, requires ESLint ^9 || ^10, so there is no version of ESLint that satisfies both.',
    substitute:
      'frontend only: @angular-eslint/no-implicit-take-until-destroyed. The backend has no working substitute — @typescript-eslint/no-floating-promises catches an unhandled promise, not a missing takeUntil.',
  },
];

function sourceFiles(root: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.angular') {
          walk(path);
        }
      } else if (extensions.some((extension) => entry.endsWith(extension))) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

describe('ESLint baseline (AGENTS.md §3)', () => {
  it('enables every enforceable cross-cutting rule in both projects', () => {
    for (const rule of CROSS_CUTTING_RULES) {
      expect(BACKEND_CONFIG, `backend/eslint.config.js is missing ${rule}`).toContain(`'${rule}'`);
      expect(FRONTEND_CONFIG, `frontend/eslint.config.js is missing ${rule}`).toContain(`'${rule}'`);
    }
  });

  it('enables every Angular rule in the frontend', () => {
    for (const rule of ANGULAR_RULES) {
      expect(FRONTEND_CONFIG, `frontend/eslint.config.js is missing ${rule}`).toContain(`'${rule}'`);
    }
  });

  it('declares an unavailable rule rather than dropping it silently', () => {
    const requested = ['rxjs-angular/prefer-takeuntil-destroyed', ...ANGULAR_RULES, ...CROSS_CUTTING_RULES];
    const unrecorded = requested.filter(
      (rule) =>
        !BACKEND_CONFIG.includes(`'${rule}'`) &&
        !FRONTEND_CONFIG.includes(`'${rule}'`) &&
        !UNAVAILABLE_RULES.some((entry) => entry.requestedAs === rule),
    );

    expect(unrecorded).toEqual([]);
  });

  it('keeps the unavailable-rule ledger honest', () => {
    const nowEnforceable = UNAVAILABLE_RULES.filter(
      (entry) => BACKEND_CONFIG.includes(`'${entry.rule}'`) || FRONTEND_CONFIG.includes(`'${entry.rule}'`),
    ).map((entry) => `${entry.rule} (recorded as unavailable but is now enabled, so remove the entry)`);
    const withoutEvidence = UNAVAILABLE_RULES.filter(
      (entry) => entry.reason.trim().length < 40 || entry.substitute.trim().length === 0,
    ).map((entry) => `${entry.rule} (no reason or no substitute recorded)`);

    expect([...nowEnforceable, ...withoutEvidence]).toEqual([]);
  });

  it('reports the unenforced rules on every run', () => {
    const report = UNAVAILABLE_RULES.map(
      (entry) => `  - ${entry.rule}: ${entry.reason} In force instead: ${entry.substitute}`,
    ).join('\n');

    console.warn(`${UNAVAILABLE_RULES.length} baseline rule(s) are not enforceable:\n${report}`);

    expect(report).toContain('prefer-takeuntil');
  });

  it('uses one config format only', () => {
    const legacy = ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml', '.eslintrc.yaml']
      .map((name) => join(REPOSITORY_ROOT, name))
      .filter((path) => existsSync(path));

    expect(legacy).toEqual([]);
    expect(existsSync(join(BACKEND_ROOT, 'eslint.config.js'))).toBe(true);
    expect(existsSync(join(FRONTEND_ROOT, 'eslint.config.js'))).toBe(true);
  });

  it('contains no lint-suppression comment in either project', () => {
    // Assembled at runtime: this file has to name the marker it looks for, and a
    // literal would make the scan match itself.
    const marker = ['eslint', 'disable'].join('-');

    const suppressed = [...sourceFiles(BACKEND_ROOT, ['.ts', '.js', '.mjs']), ...sourceFiles(FRONTEND_ROOT, ['.ts'])]
      .filter((path) => readFileSync(path, 'utf8').includes(marker))
      .map((path) => path.slice(REPOSITORY_ROOT.length + 1));

    expect(suppressed).toEqual([]);
  });
});
