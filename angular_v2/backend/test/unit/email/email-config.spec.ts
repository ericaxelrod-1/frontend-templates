import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_MODE,
  EnvironmentError,
  REQUIRED_PRODUCTION_EMAIL_KEYS,
  RUNTIME_MODES,
  isNonRoutableSmtpHost,
  isSingleLineAddress,
  loadEnvironment,
} from '../../../src/config/environment.js';
import { BACKEND_ROOT } from '../../support/paths.js';
import { PRODUCTION_EMAIL_SOURCE, sourceWith } from './email-environment-fixture.js';

const EMAIL_ROOT = join(BACKEND_ROOT, 'src', 'email');
const PROVIDER_SOURCE = join(EMAIL_ROOT, 'nodemailer-email.provider.ts');

/** The problems `loadEnvironment` reports, or `[]` when the source is usable. */
function problemsOf(source: Record<string, string>): string[] {
  try {
    loadEnvironment(source);
    return [];
  } catch (error) {
    if (error instanceof EnvironmentError) {
      return [...error.problems];
    }
    throw error;
  }
}

/**
 * Comments are stripped before scanning, for the reason
 * `test/unit/claims-write-surface.spec.ts` gives: the prose that explains *why*
 * a key is absent quotes the key, and a scanner that cannot tell prose from a
 * read returns those lines and reads as a failure.
 */
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

/** Every application source file, comments removed. */
function applicationSource(): string {
  return [
    readFileSync(join(BACKEND_ROOT, 'src', 'config', 'environment.ts'), 'utf8'),
    ...readdirSync(EMAIL_ROOT)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => readFileSync(join(EMAIL_ROOT, entry), 'utf8')),
  ]
    .map(stripComments)
    .join('\n');
}

describe('runtime mode', () => {
  it('defaults an absent NODE_ENV to development, the same default load-env-file.ts applies', () => {
    const source = sourceWith();
    delete source['NODE_ENV'];

    expect(loadEnvironment(source).email.smtp.host).toBe(source['EMAIL_HOST']);
    expect(DEFAULT_RUNTIME_MODE).toBe('development');
  });

  it('reports an unrecognised NODE_ENV instead of falling back to development', () => {
    // The failure mode this prevents: a typo like NODE_ENV=prod silently
    // selecting development behaviour, which is what chose the transport in the
    // previous tree.
    expect(problemsOf(sourceWith({ NODE_ENV: 'prod' }))).toEqual([
      "NODE_ENV must be one of development, test, production, received 'prod'",
    ]);
  });
});

describe('one transport, and no code path chooses it', () => {
  it('builds the transport with no conditional of any kind', () => {
    // The structural assertion the slice requires. A `switch (mode)` in here
    // would be invisible to every other test in this repository, which is why it
    // is asserted against the source rather than against behaviour.
    const provider = stripComments(readFileSync(PROVIDER_SOURCE, 'utf8'));

    expect(provider).toContain('nodemailer.createTransport');
    for (const forbidden of [
      'switch',
      'case ',
      'if (',
      'NODE_ENV',
      'process.env',
      'streamTransport',
      'jsonTransport',
      'transportForMode',
    ]) {
      expect(provider, `nodemailer-email.provider.ts must not contain '${forbidden}'`).not.toContain(forbidden);
    }
  });

  it('names no transport in EmailConfig, so nothing can be selected', () => {
    // `EmailConfig` had a `transport: 'stream' | 'json' | 'smtp'` field that the
    // provider switched on. A one-transport config has no such field to set.
    expect(stripComments(readFileSync(join(BACKEND_ROOT, 'src', 'config', 'environment.ts'), 'utf8'))).not.toContain(
      'EmailTransport',
    );
    expect(Object.keys(loadEnvironment(sourceWith()).email).sort()).toEqual([
      'appName',
      'baseUrl',
      'from',
      'smtp',
    ]);
  });

  it('reads no runtime mode anywhere in the email path', () => {
    // `NODE_ENV` selects the env *file*, which is a different decision made by
    // `load-env-file.ts`. The email path must not consult it at all.
    const emailSources = readdirSync(EMAIL_ROOT)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => stripComments(readFileSync(join(EMAIL_ROOT, entry), 'utf8')))
      .join('\n');

    expect(emailSources).not.toContain('NODE_ENV');
    expect(emailSources).not.toContain('process.env');
  });

  it('resolves the same destination shape for every mode, with no per-mode transport', () => {
    for (const mode of RUNTIME_MODES) {
      const source = sourceWith(
        mode === 'production' ? { ...PRODUCTION_EMAIL_SOURCE, NODE_ENV: mode } : { NODE_ENV: mode },
      );
      const email = loadEnvironment(source).email;

      expect(email).not.toHaveProperty('transport');
      expect(email.smtp).toEqual(
        expect.objectContaining({ host: source['EMAIL_HOST'], port: Number(source['EMAIL_PORT']) }),
      );
    }
    // load-env-file.ts lowercases the same key, so the resolution does too.
    expect(loadEnvironment(sourceWith({ NODE_ENV: 'TEST' })).email.smtp.host).toBe(
      sourceWith()['EMAIL_HOST'],
    );
  });

  it('exposes no environment key that selects a transport, so a production process cannot be pointed at a transport that never leaves the machine', () => {
    // The previous tree defined EMAIL_PROVIDER and EMAIL_ENABLED and read
    // neither: a deployment could believe it had chosen a transport and had
    // not. Every env read in this tree is a bracketed lookup, so scanning for
    // one of those is scanning for a real read rather than for a mention.
    const sources = applicationSource();

    for (const key of ['EMAIL_PROVIDER', 'EMAIL_ENABLED', 'EMAIL_TRANSPORT']) {
      expect(sources).not.toContain(`source['${key}']`);
      expect(sources).not.toContain(`process.env.${key}`);
    }
  });
});

describe('the SMTP destination is required in every mode', () => {
  it('names a missing host or port in every mode, because there is one transport and it needs a destination', () => {
    for (const mode of RUNTIME_MODES) {
      for (const key of ['EMAIL_HOST', 'EMAIL_PORT']) {
        const source = sourceWith(
          mode === 'production' ? { ...PRODUCTION_EMAIL_SOURCE, NODE_ENV: mode } : { NODE_ENV: mode },
        );
        delete source[key];

        expect(problemsOf(source)).toContain(`${key} is required but was not set`);
      }
    }
  });

  it('refuses half a credential pair rather than half-using it', () => {
    expect(problemsOf(sourceWith({ NODE_ENV: 'test', EMAIL_USER: 'someone' }))).toEqual([
      'EMAIL_USER and EMAIL_PASSWORD must be set together: half a credential pair authenticates nobody and looks configured',
    ]);
    expect(problemsOf(sourceWith({ NODE_ENV: 'test', EMAIL_PASSWORD: 'secret' }))).toEqual([
      'EMAIL_USER and EMAIL_PASSWORD must be set together: half a credential pair authenticates nobody and looks configured',
    ]);
    expect(problemsOf(sourceWith({ NODE_ENV: 'test' }))).toEqual([]);
    expect(loadEnvironment(sourceWith({ NODE_ENV: 'test' })).email.smtp.user).toBeNull();
    expect(loadEnvironment(sourceWith({ NODE_ENV: 'test' })).email.smtp.password).toBeNull();
  });
});

describe('production may not be pointed at a sink', () => {
  const REFUSAL_PREFIX = 'EMAIL_HOST must be a routable relay host in production, not ';

  it('refuses a loopback address, in both spellings', () => {
    for (const host of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1', 'localhost', 'smtp.localhost']) {
      const problems = problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_HOST: host }));

      expect(problems.some((problem) => problem.startsWith(REFUSAL_PREFIX))).toBe(true);
      expect(problems.some((problem) => problem.includes(`'${host}'`))).toBe(true);
    }
  });

  it('refuses the unspecified address, which binds every interface', () => {
    // `0.0.0.0` is not loopback, but connecting to it reaches the local host and
    // nothing beyond it, so it fails for the same reason.
    for (const host of ['0.0.0.0', '::']) {
      expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_HOST: host })).some((problem) =>
        problem.startsWith(REFUSAL_PREFIX),
      )).toBe(true);
    }
  });

  it('refuses a link-local or private address', () => {
    for (const host of ['169.254.169.254', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', 'fe80::1', 'fd00::1']) {
      expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_HOST: host })).some((problem) =>
        problem.startsWith(REFUSAL_PREFIX),
      ), host).toBe(true);
    }
  });

  it('accepts a public relay hostname and a public address', () => {
    for (const host of ['smtp.example.test', 'smtp.eu-west-1.amazonaws.com', '8.8.8.8', '2606:4700::1111']) {
      expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_HOST: host })), host).toEqual([]);
    }
  });

  it('allows every one of those hosts outside production, because a sink IS the development destination', () => {
    for (const mode of ['development', 'test']) {
      for (const host of ['127.0.0.1', '::1', 'localhost', '0.0.0.0', '192.168.1.10']) {
        expect(problemsOf(sourceWith({ NODE_ENV: mode, EMAIL_HOST: host })), `${mode} ${host}`).toEqual([]);
      }
    }
  });

  it('classifies the same set the assertion above exercises, so the rule is readable on its own', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost', '0.0.0.0', '10.1.2.3', '169.254.1.1', 'fe80::abcd']) {
      expect(isNonRoutableSmtpHost(host), host).toBe(true);
    }
    for (const host of ['smtp.example.test', '93.184.216.34', '2606:2800:220:1::1']) {
      expect(isNonRoutableSmtpHost(host), host).toBe(false);
    }
  });
});

describe('production TLS verification cannot be switched off', () => {
  it('refuses EMAIL_TLS_REJECT_UNAUTHORIZED=false, which exists for the sink', () => {
    expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_TLS_REJECT_UNAUTHORIZED: 'false' }))).toContain(
      "EMAIL_TLS_REJECT_UNAUTHORIZED must not be false in production: it exists for a local sink with a self-signed certificate, and a relay whose certificate cannot be verified is a relay whose traffic anyone can read",
    );
  });

  it('defaults to true in every mode, and accepts it when stated', () => {
    for (const mode of RUNTIME_MODES) {
      const source = sourceWith(
        mode === 'production' ? { ...PRODUCTION_EMAIL_SOURCE, NODE_ENV: mode } : { NODE_ENV: mode },
      );
      expect(loadEnvironment(source).email.smtp.rejectUnauthorized).toBe(true);
    }
    expect(
      loadEnvironment(sourceWith({ NODE_ENV: 'test', EMAIL_TLS_REJECT_UNAUTHORIZED: 'false' })).email.smtp
        .rejectUnauthorized,
    ).toBe(false);
  });

  it('rejects a value that is neither true nor false', () => {
    expect(problemsOf(sourceWith({ EMAIL_TLS_REJECT_UNAUTHORIZED: 'mostly' }))).toEqual([
      "EMAIL_TLS_REJECT_UNAUTHORIZED must be true or false, received 'mostly'",
    ]);
  });
});

describe('APP_BASE_URL is asserted in every mode', () => {
  it('is required with no default, so no message can carry a relative or invented origin', () => {
    for (const nodeEnv of RUNTIME_MODES) {
      const source = sourceWith(
        nodeEnv === 'production' ? PRODUCTION_EMAIL_SOURCE : { NODE_ENV: nodeEnv },
      );
      delete source['APP_BASE_URL'];

      expect(problemsOf(source)).toContain('APP_BASE_URL is required but was not set');
    }
  });

  it('strips a trailing slash, so a link cannot become //path', () => {
    expect(loadEnvironment(sourceWith({ APP_BASE_URL: 'https://app.example.test/' })).email.baseUrl).toBe(
      'https://app.example.test',
    );
    expect(loadEnvironment(sourceWith({ APP_BASE_URL: 'https://app.example.test/base/' })).email.baseUrl).toBe(
      'https://app.example.test/base',
    );
  });

  it('rejects a value that is not an absolute http(s) URL, and says which one it got', () => {
    expect(problemsOf(sourceWith({ APP_BASE_URL: '/verify-email' }))).toEqual([
      "APP_BASE_URL must be an absolute http(s) URL, received '/verify-email'",
    ]);
    expect(problemsOf(sourceWith({ APP_BASE_URL: 'ftp://app.example.test' }))).toEqual([
      "APP_BASE_URL must use http or https, received 'ftp:'",
    ]);
  });

  it('requires https in production, because an emailed token over http is readable in transit', () => {
    expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, APP_BASE_URL: 'http://app.example.test' }))).toContain(
      'APP_BASE_URL must use https in production: an emailed token over http is readable in transit',
    );
  });
});

describe('production SMTP configuration has no defaults', () => {
  it('names every missing key rather than substituting one', () => {
    const expected: Readonly<Record<string, string>> = {
      EMAIL_HOST: 'EMAIL_HOST is required but was not set',
      EMAIL_PORT: 'EMAIL_PORT is required but was not set',
      EMAIL_USER: 'EMAIL_USER is required but was not set',
      EMAIL_PASSWORD: 'EMAIL_PASSWORD is required but was not set',
      EMAIL_FROM: 'EMAIL_FROM is required in production but was not set',
    };
    for (const key of REQUIRED_PRODUCTION_EMAIL_KEYS) {
      const source = sourceWith(PRODUCTION_EMAIL_SOURCE);
      delete source[key];

      expect(problemsOf(source)).toContain(expected[key]);
    }
  });

  it('reports all of them at once, so a misconfigured deployment is fixed in one pass', () => {
    const source = sourceWith(PRODUCTION_EMAIL_SOURCE);
    for (const key of REQUIRED_PRODUCTION_EMAIL_KEYS) {
      delete source[key];
    }

    expect(problemsOf(source)).toEqual([
      'EMAIL_HOST is required but was not set',
      'EMAIL_PORT is required but was not set',
      'EMAIL_USER is required but was not set',
      'EMAIL_PASSWORD is required but was not set',
      'EMAIL_FROM is required in production but was not set',
    ]);
  });

  it('defaults EMAIL_SECURE from the port and honours an explicit value', () => {
    expect(loadEnvironment(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_PORT: '465' })).email.smtp.secure).toBe(true);
    expect(loadEnvironment(sourceWith(PRODUCTION_EMAIL_SOURCE)).email.smtp.secure).toBe(false);
    expect(
      loadEnvironment(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_PORT: '465', EMAIL_SECURE: 'false' })).email.smtp.secure,
    ).toBe(false);
    expect(
      loadEnvironment(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_SECURE: 'yes' })).email.smtp.secure,
    ).toBe(true);
  });

  it('rejects an EMAIL_SECURE that is neither true nor false', () => {
    expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_SECURE: 'maybe' }))).toEqual([
      "EMAIL_SECURE must be true or false, received 'maybe'",
    ]);
  });
});

describe('the sender address', () => {
  it('is required in production and derived from APP_BASE_URL otherwise', () => {
    expect(loadEnvironment(sourceWith(PRODUCTION_EMAIL_SOURCE)).email.from).toBe('Acme <no-reply@acme.example>');
    expect(loadEnvironment(sourceWith()).email.from).toBe('no-reply@app.example.test');
  });

  it('rejects an address carrying a newline or naming a second recipient', () => {
    for (const from of [
      'no-reply@acme.example\r\nBcc: victim@example.test',
      'no-reply@acme.example\nBcc: victim@example.test',
      'a@b@example.test',
      'Acme, Victim <a@b.example.test>',
      'no-reply@acme example',
      'no-reply',
      '',
    ]) {
      expect(isSingleLineAddress(from)).toBe(false);
    }

    expect(problemsOf(sourceWith({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_FROM: 'a@b@c' }))).toEqual([
      "EMAIL_FROM must be a single-line address, received 'a@b@c'",
    ]);
  });

  it('accepts the display-name form a mail library accepts', () => {
    expect(isSingleLineAddress('Acme <no-reply@acme.example>')).toBe(true);
    expect(isSingleLineAddress('"Acme, Inc." <no-reply@acme.example>')).toBe(true);
    expect(isSingleLineAddress('no-reply@acme.example')).toBe(true);
  });
});

describe('APP_NAME', () => {
  it('defaults to the APP_BASE_URL host, so no mode invents a product name', () => {
    expect(loadEnvironment(sourceWith()).email.appName).toBe('app.example.test');
    expect(loadEnvironment(sourceWith({ APP_NAME: 'Acme' })).email.appName).toBe('Acme');
  });
});