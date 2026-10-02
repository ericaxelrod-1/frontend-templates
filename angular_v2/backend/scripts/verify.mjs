import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = resolve(backendRoot, '..', 'frontend');

/**
 * The verification gate (`AGENTS.md` §1). Steps run in the order below and the
 * first failure ends the run with that step's exit code, so a broken step is
 * never reported as a later one. Every step inherits stdio: output is the real
 * output of the real tool, not a summary of it.
 */
const steps = [
  { name: 'typecheck (backend)', cwd: backendRoot, args: ['run', 'typecheck'] },
  { name: 'typecheck (frontend)', cwd: frontendRoot, args: ['run', 'typecheck'] },
  { name: 'lint (both projects)', cwd: backendRoot, args: ['run', 'lint'] },
  { name: 'unit tests (backend)', cwd: backendRoot, args: ['test'] },
  { name: 'unit tests (frontend)', cwd: frontendRoot, args: ['test', '--', '--watch=false'] },
  { name: 'integration tests', cwd: backendRoot, args: ['run', 'test:e2e'] },
  { name: 'database smoke check', cwd: backendRoot, args: ['run', 'smoke'] },
];

function banner(stepNumber, total, name) {
  const label = `[${stepNumber}/${total}] ${name}`;
  console.log(`\n${label}\n${'-'.repeat(label.length)}`);
}

function preflight() {
  if (!existsSync(join(frontendRoot, 'node_modules'))) {
    console.error(
      `frontend/node_modules is missing. The gate lints and type-checks the frontend, so run:\n\n  cd frontend && npm ci\n\nbefore running verify.`,
    );
    return false;
  }
  return true;
}

function run() {
  if (!preflight()) {
    return 1;
  }

  console.log('npm run verify — typecheck, lint, unit, integration, database smoke');

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
