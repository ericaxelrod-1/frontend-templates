import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = resolve(backendRoot, '..', 'frontend');

/**
 * The verification gate (`AGENTS.md` §1). Steps run in the order below and the
 * first failure ends the run with that step's exit code, so a broken step is
 * never reported as a later one. Every step inherits stdio: output is the real
 * output of the real tool, not a summary of it.
 *
 * The row-level security proof is a gating step, not a nicety. It is the only
 * thing in this list that would catch a policy regression: the other seven steps
 * stay green while every row-level security policy in the database is dropped.
 * It needs a live PostgreSQL and a PostgREST binary, and it fails loudly when
 * either is absent — there is no skip, because a security suite that passes
 * without exercising its subject reports a false green (`AGENTS.md` §2.2).
 */
const steps = [
  { name: 'typecheck (backend)', cwd: backendRoot, args: ['run', 'typecheck'] },
  { name: 'typecheck (frontend)', cwd: frontendRoot, args: ['run', 'typecheck'] },
  { name: 'lint (both projects)', cwd: backendRoot, args: ['run', 'lint'] },
  { name: 'unit tests (backend)', cwd: backendRoot, args: ['test'] },
  { name: 'unit tests (frontend)', cwd: frontendRoot, args: ['test', '--', '--watch=false'] },
  { name: 'integration tests', cwd: backendRoot, args: ['run', 'test:e2e'] },
  { name: 'row-level security proof', cwd: backendRoot, args: ['run', 'test:rls'] },
  { name: 'database smoke check', cwd: backendRoot, args: ['run', 'smoke'] },
];

function banner(stepNumber, total, name) {
  const label = `[${stepNumber}/${total}] ${name}`;
  console.log(`\n${label}\n${'-'.repeat(label.length)}`);
}

/**
 * Directories the pipeline owns and that therefore must never be walked as
 * source. `node_modules` and `dist` are build output; `coverage` is a report.
 */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.angular', '.git']);

/** Every `.ts` file in the backend tree, whether or not `tsconfig.json` claims it. */
function backendTypeScriptFiles(directory = backendRoot, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        backendTypeScriptFiles(path, found);
      }
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The set of files the backend TypeScript project actually covers, read through
 * the TypeScript API rather than by re-implementing `include` globbing — the
 * question is "what does `tsc -p tsconfig.json` see", and the compiler is the
 * only authority on that (`AGENTS.md` §3).
 *
 * A file outside `include` is invisible to `typecheck` and unlintable under the
 * typed parser, which is how `database/seed.ts` shipped with a duplicate
 * `const euId` declaration while the gate stayed green.
 */
function filesInBackendProject() {
  const ts = require('typescript');
  const configPath = join(backendRoot, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
  if (error !== undefined) {
    throw new Error(`backend/tsconfig.json could not be read: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, backendRoot);
  if (parsed.errors.length > 0) {
    throw new Error(
      `backend/tsconfig.json is invalid:\n${parsed.errors
        .map((diagnostic) => `  - ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
        .join('\n')}`,
    );
  }
  return new Set(parsed.fileNames.map((file) => resolve(file)));
}

function checkProjectCoverage() {
  let covered;
  try {
    covered = filesInBackendProject();
  } catch (error) {
    console.error(`preflight failed: ${error.message}`);
    return false;
  }

  const uncovered = backendTypeScriptFiles()
    .map((file) => resolve(file))
    .filter((file) => !covered.has(file))
    .map((file) => `  - ${relative(backendRoot, file)}`)
    .sort();

  if (uncovered.length > 0) {
    console.error(
      `backend/tsconfig.json does not cover every .ts file in the backend tree:\n${uncovered.join('\n')}\n\n` +
        'A file outside "include" is invisible to `npm run typecheck` and rejected by the typed ESLint parser, ' +
        'so nothing in the gate can see it. Add the directory to "include" in backend/tsconfig.json.',
    );
    return false;
  }

  return true;
}

function preflight() {
  for (const [label, root] of [
    ['backend/node_modules', backendRoot],
    ['frontend/node_modules', frontendRoot],
  ]) {
    if (!existsSync(join(root, 'node_modules'))) {
      console.error(
        `${label} is missing. The gate lints and type-checks ${label === 'backend/node_modules' ? 'the backend' : 'the frontend'}, so run:\n\n  cd ${relative(resolve(root, '..'), root)} && npm ci\n\nbefore running verify.`,
      );
      return false;
    }
  }

  return checkProjectCoverage();
}

function run() {
  if (!preflight()) {
    return 1;
  }

  console.log('npm run verify — typecheck, lint, unit, integration, RLS proof, database smoke');

  for (const [index, step] of steps.entries()) {
    banner(index + 1, steps.length, step.name);

    const result = spawnSync('npm', step.args, {
      cwd: step.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    if (result.error !== undefined) {
      console.error(`\nverify failed: could not run '${step.args.join(' ')}': ${result.error.message}`);
      return 1;
    }

    if (result.status !== 0) {
      console.error(`\nverify failed at step ${index + 1}/${steps.length}: ${step.name} (exit ${result.status}).`);
      return result.status ?? 1;
    }
  }

  console.log('\nverify passed.');
  return 0;
}

process.exit(run());
