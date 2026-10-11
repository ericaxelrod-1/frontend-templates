import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EmailRenderer } from '../../../src/email/email.renderer.js';
import { EmailTemplateError } from '../../../src/email/email.template-error.js';
import type { EmailTemplateName } from '../../../src/email/email.template-context.js';

/**
 * The real handlebars renderer against the real templates. The previous
 * renderer's escape set covered `<`, `>` and `"` and omitted `&`, and it built
 * its `RegExp` by interpolating the context key unescaped — so this file
 * asserts on both the characters and the substitution, not on "it rendered".
 */

const renderer = new EmailRenderer();

const HOSTILE = {
  script: '<script>alert(1)</script>',
  ampersand: 'Tom & Jerry',
  quotes: '"double" and \'single\'',
  angle: '<b>bold</b>',
} as const;

const BASE_VERIFY = {
  appName: 'Acme',
  recipientName: 'Robin',
  verificationUrl: 'https://app.example.test/verify-email?token=tok-123',
  expiresInHours: 24,
} as const;

const BASE_RESET = {
  appName: 'Acme',
  recipientName: 'Robin',
  resetUrl: 'https://app.example.test/reset-password?token=tok-456',
  expiresInMinutes: 60,
} as const;

/**
 * Handlebars' escape set is `& < > " ' \` =`, so the encoded form of a URL
 * carries `&#x3D;` for every `=`. That is correct HTML — a browser decodes it
 * back to the same address — so the assertions decode before comparing, and the
 * tests that care about escaping check the encoded form directly.
 */
function decodeEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x60;/g, '`')
    .replace(/&#x3D;/gi, '=')
    .replace(/&#x3d;/g, '=')
    .replace(/&amp;/g, '&');
}

function hrefsOf(html: string): readonly string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => decodeEntities(match[1] ?? ''));
}

describe('EmailRenderer', () => {
  it('ships exactly the two live templates and nothing else', () => {
    // A template with no caller is a maintenance surface that rots: the
    // previous tree shipped nine, six of which nothing referenced.
    const shipped = readdirSync(new URL('../../../src/email/templates/', import.meta.url))
      .filter((entry) => entry.endsWith('.html'))
      .sort();
    expect(shipped).toEqual(['password-reset.html', 'verify-email.html']);
  });

  it('substitutes the verification link, the recipient and the lifetime', () => {
    const html = renderer.render('verify-email', BASE_VERIFY);

    expect(html).toContain('Hello Robin,');
    expect(html).toContain('your Acme account');
    expect(html).toContain('expires in 24 hours');
    expect(hrefsOf(html)).toEqual([
      'https://app.example.test/verify-email?token=tok-123',
      'https://app.example.test/verify-email?token=tok-123',
    ]);
    expect(html).not.toContain('{{');
  });

  it('substitutes the reset link, the recipient and the lifetime', () => {
    const html = renderer.render('password-reset', BASE_RESET);

    expect(html).toContain('Hello Robin,');
    expect(html).toContain('new Acme password');
    expect(html).toContain('expires in 60 minutes');
    expect(hrefsOf(html)).toEqual([
      'https://app.example.test/reset-password?token=tok-456',
      'https://app.example.test/reset-password?token=tok-456',
    ]);
    expect(html).not.toContain('{{');
  });

  it('escapes a script tag in a display name instead of shipping it into the body', () => {
    const html = renderer.render('verify-email', { ...BASE_VERIFY, recipientName: HOSTILE.script });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes & and both quote characters, which the previous escape set omitted or missed', () => {
    const html = renderer.render('verify-email', { ...BASE_VERIFY, recipientName: `${HOSTILE.ampersand} ${HOSTILE.quotes}` });

    expect(html).not.toContain('Tom & Jerry');
    expect(html).toContain('Tom &amp; Jerry');
    expect(html).not.toContain('"double"');
    expect(html).toContain('&quot;double&quot;');
    expect(html).not.toContain("'single'");
    expect(html).toContain('&#x27;single&#x27;');
  });

  it('escapes angle brackets in an app name, so a name cannot inject markup', () => {
    const html = renderer.render('password-reset', { ...BASE_RESET, appName: HOSTILE.angle });

    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes a hostile URL rather than letting it break out of the href attribute', () => {
    const hostile = 'https://app.example.test/verify-email?token="><script>alert(1)</script>';
    const html = renderer.render('verify-email', { ...BASE_VERIFY, verificationUrl: hostile });

    // The quote and both angle brackets are encoded, so the substitution cannot
    // terminate the attribute or open a tag: the document has exactly the two
    // anchors the template declares and no third.
    expect(html).toContain('token&#x3D;&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/href="[^"]*<script/);
    expect([...html.matchAll(/<a\b/g)]).toHaveLength(2);
    expect(hrefsOf(html)).toEqual([hostile, hostile]);
  });

  it('keeps an absolute URL with several parameters readable, encoding & as &amp;', () => {
    const url = 'https://app.example.test/verify-email?token=abc&next=%2Fhome';
    const html = renderer.render('verify-email', { ...BASE_VERIFY, verificationUrl: url });

    expect(html).toContain('abc&amp;next');
    expect(html).not.toContain('token=abc&next');
    expect(hrefsOf(html)).toEqual([url, url]);
  });
});

describe('EmailRenderer fails loudly', () => {
  it('throws when the template file is absent, rather than returning a rendered error paragraph', () => {
    // This is the regression the slice exists to prevent: the old renderer
    // caught ENOENT and returned `<p>Email template error: …</p>`, which the
    // provider then reported as a successful send.
    const emptyDirectory = mkdtempSync(join(tmpdir(), 'email-templates-'));
    try {
      const isolated = new EmailRenderer(pathToFileURL(`${emptyDirectory}/`));

      expect(() => isolated.render('verify-email', BASE_VERIFY)).toThrow(EmailTemplateError);
      expect(() => isolated.render('verify-email', BASE_VERIFY)).toThrow(/ENOENT/);
      expect(() => isolated.render('verify-email', BASE_VERIFY)).toThrow(/nest-cli\.json/);
    } finally {
      rmSync(emptyDirectory, { recursive: true, force: true });
    }
  });

  it('throws when the template is syntactically broken, rather than shipping broken markup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'email-templates-'));
    try {
      writeFileSync(join(directory, 'verify-email.html'), '<p>{{#if}}unclosed</p>', 'utf8');
      const isolated = new EmailRenderer(pathToFileURL(`${directory}/`));

      expect(() => isolated.render('verify-email', BASE_VERIFY)).toThrow(EmailTemplateError);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('names the template that failed, so the log identifies which of the two it was', () => {
    const directory = mkdtempSync(join(tmpdir(), 'email-templates-'));
    try {
      const isolated = new EmailRenderer(pathToFileURL(`${directory}/`));

      try {
        isolated.render('password-reset', BASE_RESET);
        expect.unreachable('render should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(EmailTemplateError);
        expect((error as EmailTemplateError).name).toBe('EmailTemplateError');
        expect((error as EmailTemplateError).template).toBe('password-reset');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('the template name type is the two live flows, not a free string', () => {
  it('accepts exactly the names that exist', () => {
    const names: readonly EmailTemplateName[] = ['verify-email', 'password-reset'];
    expect(names).toEqual(['verify-email', 'password-reset']);
  });
});