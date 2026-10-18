import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EmailRenderer } from '../../../src/email/email.renderer.js';
import { BACKEND_ROOT } from '../../support/paths.js';

/**
 * **The regression this slice exists to prevent.**
 *
 * The previous tree's `nest-cli.json` had no `assets` entry, so
 * `src/email/templates/*.html` was never copied into `dist/`. Its renderer
 * caught the resulting `ENOENT` and returned `<p>Email template error: …</p>`,
 * the provider logged nothing wrong and returned `success: true` — so
 * **every** message a built process ever sent was a paragraph telling the user
 * their template was missing, and every log said it was delivered. Nothing
 * caught it, because no test read `dist/`.
 *
 * So this suite builds the project for real and reads the built output. It does
 * not trust that the files exist: it renders both templates **from
 * `dist/email/templates/`** and asserts the links that come out, which fails
 * for a stale, truncated or absent copy as well as for a missing one.
 *
 * `nest build` runs once, in `beforeAll`, and takes about fifteen seconds.
 */

const BUILD_TIMEOUT_MS = 300_000;
const DIST_TEMPLATES = join(BACKEND_ROOT, 'dist', 'email', 'templates');
const SOURCE_TEMPLATES = join(BACKEND_ROOT, 'src', 'email', 'templates');

/**
 * The three templates that ship, sorted.
 *
 * **A THIRD ENTRY, `email-change.html`, and the two assertions below are exhaustive on
 * purpose.** `email-assets.spec.ts` exists because the previous tree shipped nine
 * templates, six of which nothing rendered, and "a template with no caller is a
 * maintenance surface that silently rots". So the list is not allowed to grow quietly:
 * adding a renderer means adding it here, which is the moment somebody confirms it has a
 * caller (`EmailService.sendEmailChangeEmail`).
 */
const EXPECTED_TEMPLATES = ['email-change.html', 'password-reset.html', 'verify-email.html'];

let buildOutput = '';

beforeAll(() => {
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
    // Windows resolves `npm` to `npm.cmd` only through a shell; without this,
    // `spawnSync` returns `status: null` with `ENOENT` and the failure below
    // reports an empty build log — a red suite whose cause is the platform rather
    // than the assets. It is a platform detail, not an assertion: what runs is
    // still `npm run build` in the same directory with the same arguments.
    shell: true,
  });
  buildOutput = `${build.stdout ?? ''}\n${build.stderr ?? ''}`;
  if (build.status !== 0) {
    throw new Error(`nest build failed (exit ${build.status}):\n${buildOutput}`);
  }
}, BUILD_TIMEOUT_MS);

describe('the email templates reach dist/', () => {
  it('built the project, so the assertions below are not reading a stale dist/', () => {
    expect(buildOutput).not.toBe('');
    expect(existsSync(join(BACKEND_ROOT, 'dist', 'app.module.js'))).toBe(true);
  });

  it('copies every live template into dist/email/templates/', () => {
    // Without the "assets" entry in nest-cli.json this directory does not
    // exist, and this is the assertion that says so.
    expect(existsSync(DIST_TEMPLATES)).toBe(true);
    expect(readdirSync(DIST_TEMPLATES).filter((entry) => entry.endsWith('.html')).sort()).toEqual(
      EXPECTED_TEMPLATES,
    );
  });

  it('copies no template that has no caller', () => {
    // The previous tree shipped nine, including a base layout nothing rendered
    // and a welcome mail nothing sent.
    expect(readdirSync(SOURCE_TEMPLATES).filter((entry) => entry.endsWith('.html')).sort()).toEqual(
      EXPECTED_TEMPLATES,
    );
  });

  it('copies each template byte-for-byte, so the built message is the reviewed one', () => {
    for (const name of EXPECTED_TEMPLATES) {
      expect(readFileSync(join(DIST_TEMPLATES, name), 'utf8')).toBe(
        readFileSync(join(SOURCE_TEMPLATES, name), 'utf8'),
      );
    }
  });

  it('renders both templates from the built copy, producing working absolute links', () => {
    const fromDist = new EmailRenderer(pathToFileURL(`${DIST_TEMPLATES}/`));

    const verification = fromDist.render('verify-email', {
      appName: 'Acme',
      recipientName: 'Robin',
      verificationUrl: 'https://app.example.test/verify-email?token=tok-abc',
      expiresInHours: 24,
    });
    const reset = fromDist.render('password-reset', {
      appName: 'Acme',
      recipientName: 'Robin',
      resetUrl: 'https://app.example.test/reset-password?token=tok-xyz',
      expiresInMinutes: 60,
    });

    for (const html of [verification, reset]) {
      expect(html).not.toContain('{{');
      expect(html).not.toContain('Email template error');
      expect(html).toContain('https://app.example.test/');
    }
    expect(verification).toContain('tok-abc');
    expect(reset).toContain('tok-xyz');
  });

  it('does not depend on the source tree: the built renderer works with src/ renamed away', () => {
    // The renderer resolves its directory from `import.meta.url`, so the copy
    // in dist/ is self-sufficient. Proven by reading it, not by renaming
    // anything: nothing in the built path points back at src/.
    const builtRenderer = readFileSync(join(BACKEND_ROOT, 'dist', 'email', 'email.renderer.js'), 'utf8');
    expect(builtRenderer).not.toContain('src/email/templates');
    expect(builtRenderer).toContain('./templates/');
  });
});