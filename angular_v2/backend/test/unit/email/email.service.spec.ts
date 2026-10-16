import { Logger } from '@nestjs/common';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../../scripts/smtp-sink.js';
import { decodeHtmlEntities, parseSmtpMessage } from '../../../scripts/smtp-message.js';
import { EmailDeliveryError } from '../../../src/email/email-delivery-error.js';
import { EmailAuditWriter } from '../../../src/email/email-audit.writer.js';
import { EmailService } from '../../../src/email/email.service.js';
import { EmailRenderer } from '../../../src/email/email.renderer.js';
import { NodemailerEmailProvider } from '../../../src/email/nodemailer-email.provider.js';
import { SharedDatabasePool } from '../../../src/common/database-pool.js';
import { tombstoneAddress } from '../../../src/privacy/tombstone.js';
import {
  PASSWORD_RESET_LINK_LIFETIME_MINUTES,
  VERIFICATION_LINK_LIFETIME_HOURS,
} from '../../../src/email/email.template-context.js';
import { BACKEND_ROOT } from '../../support/paths.js';
import {
  PRODUCTION_EMAIL_SOURCE,
  emailConfigFor,
  environmentFor,
  sourceWith,
} from './email-environment-fixture.js';

/**
 * The service against the **real** provider over a **real** transport.
 *
 * Every mode builds nodemailer's `smtpTransport`, so there is no transport that
 * serialises a message and sends nothing: the assertions below read the MIME a
 * real SMTP server received, off a real socket. The failure cases use a loopback
 * port nothing listens on, so the rejection is a genuine `ECONNREFUSED` rather
 * than a scripted one. Nothing in this file can pass because a substitute was
 * installed.
 *
 * The sink binds **port 0** so it can never collide with a listener the developer
 * or another suite already owns (`AGENTS.md` §B8).
 */

const RECIPIENT = 'robin@example.test';
const RECIPIENT_NAME = 'Robin';

let sink: SmtpSink;

/** The fixture's own sink, so a service built from `sourceWith()` has somewhere real to send. */
beforeAll(async () => {
  sink = await startSmtpSink({ port: 0 });
});

afterAll(async () => {
  await sink?.close();
});

function serviceFor(overrides: Readonly<Record<string, string>> = {}): EmailService {
  const environment = environmentFor({
    EMAIL_HOST: sink.host,
    EMAIL_PORT: String(sink.port),
    ...overrides,
  });
  const config = { getOrThrow: <T>(key: string): T => ({ environment })[key] as T } as ConfigService;
  return new EmailService(
    config,
    new NodemailerEmailProvider(environment.email),
    new EmailRenderer(),
    new EmailAuditWriter(new SharedDatabasePool(config)),
  );
}

/** Port 1 is reserved and nothing binds it; a connect there fails immediately. */
const DEAD_SMTP: Readonly<Record<string, string>> = {
  EMAIL_HOST: '127.0.0.1',
  EMAIL_PORT: '1',
};

/** The message the sink received for a single recipient, or `undefined`. */
function deliveredTo(recipient: string): ReturnType<typeof parseSmtpMessage> | undefined {
  const delivery = sink.deliveries.find((entry) => entry.recipients.includes(recipient));
  return delivery === undefined ? undefined : parseSmtpMessage(delivery.raw);
}

afterEach(() => {
  vi.restoreAllMocks();
  sink.clear();
});

describe('the two live flows build the message', () => {
  it('sends a verification mail to the given recipient with an absolute link off APP_BASE_URL', async () => {
    const sent = await serviceFor().sendVerificationEmail(RECIPIENT, RECIPIENT_NAME, 'tok-abc');

    expect(sent.messageId.length).toBeGreaterThan(0);

    // Read from the SMTP server, not from the client: the envelope is what the
    // server parsed out of RCPT TO, and the body is what arrived over the wire.
    const delivery = sink.deliveries.at(-1);
    expect(delivery?.recipients).toEqual([RECIPIENT]);
    const message = deliveredTo(RECIPIENT);
    expect(message?.headers['subject']).toBe('Verify your app.example.test email address');
    expect(message?.headers['from']).toBe('no-reply@app.example.test');
    expect(message?.text).toContain('https://app.example.test/verify-email?token=tok-abc');
    expect(decodeHtmlEntities(message?.html ?? '')).toContain(
      'https://app.example.test/verify-email?token=tok-abc',
    );
    expect(message?.text).toContain(`${VERIFICATION_LINK_LIFETIME_HOURS} hours`);
  });

  it('sends a reset mail to the given recipient with an absolute link off APP_BASE_URL', async () => {
    await serviceFor().sendPasswordResetEmail(RECIPIENT, RECIPIENT_NAME, 'tok-xyz');

    const message = deliveredTo(RECIPIENT);
    expect(sink.deliveries.at(-1)?.recipients).toEqual([RECIPIENT]);
    expect(message?.headers['subject']).toBe('Reset your app.example.test password');
    expect(message?.text).toContain('https://app.example.test/reset-password?token=tok-xyz');
    expect(decodeHtmlEntities(message?.html ?? '')).toContain(
      'https://app.example.test/reset-password?token=tok-xyz',
    );
    expect(message?.text).toContain(`${PASSWORD_RESET_LINK_LIFETIME_MINUTES} minutes`);
  });

  it('follows APP_BASE_URL rather than any hard-coded origin', async () => {
    await serviceFor({ APP_BASE_URL: 'https://mail.example.org/app/' }).sendVerificationEmail(
      RECIPIENT,
      RECIPIENT_NAME,
      'tok-abc',
    );

    expect(decodeHtmlEntities(deliveredTo(RECIPIENT)?.html ?? '')).toContain(
      'https://mail.example.org/app/verify-email?token=tok-abc',
    );
  });

  it('uses APP_NAME in the subject when one is configured', async () => {
    await serviceFor({ APP_NAME: 'Acme' }).sendPasswordResetEmail(RECIPIENT, RECIPIENT_NAME, 'tok-xyz');

    expect(deliveredTo(RECIPIENT)?.headers['subject']).toBe('Reset your Acme password');
  });

  it('percent-encodes a token, so a token carrying & or # cannot add parameters to the link', async () => {
    await serviceFor().sendVerificationEmail(RECIPIENT, RECIPIENT_NAME, 'a&b#c d');

    expect(deliveredTo(RECIPIENT)?.text).toContain(
      'https://app.example.test/verify-email?token=a%26b%23c%20d',
    );
  });

  it('refuses to build a link with an empty token', async () => {
    await expect(
      serviceFor().sendVerificationEmail(RECIPIENT, RECIPIENT_NAME, ''),
    ).rejects.toThrow(/empty token/);
  });

  it('refuses a recipient that is not a single-line address, before any transport sees it', async () => {
    await expect(
      serviceFor().sendPasswordResetEmail('robin@example.test\r\nBcc: victim@example.test', RECIPIENT_NAME, 'tok'),
    ).rejects.toThrow(EmailDeliveryError);
    expect(sink.deliveries).toEqual([]);
  });

  it('does not echo a rejected recipient, so a CRLF in one cannot forge a log line', async () => {
    const hostile = 'robin@example.test\r\nBcc: victim@example.test';
    const outcome = await serviceFor()
      .sendVerificationEmail(hostile, RECIPIENT_NAME, 'tok')
      .then(() => 'resolved')
      .catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(EmailDeliveryError);
    const failure = outcome as EmailDeliveryError;
    expect(failure.recipient).toBe('<rejected-recipient>');
    // Nest's exception handler logs this message, so the reason travels and the
    // attacker's bytes do not.
    expect(failure.message).toContain('the recipient is not a single-line address');
    expect(failure.message).not.toContain('Bcc:');
    expect(failure.message).not.toContain('\r');
  });
});

describe('an anonymised subject receives no mail, and that is a refusal rather than a skip', () => {
  // The tombstone is minted by the real generator, so this is not a hand-written
  // lookalike that could drift from the shape the erasure actually writes.
  const TOMBSTONE = tombstoneAddress(
    '018f3c2a-1b4d-7c8e-9f01-23456789abcd',
    'a-test-pepper-of-a-plausible-length-000001',
    'tombstone.example.test',
  );

  it('refuses the address, before any transport sees it', async () => {
    const failure = await serviceFor()
      .sendPasswordResetEmail(TOMBSTONE, RECIPIENT_NAME, 'tok-xyz')
      .then(() => 'resolved')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryError);
    // The address is not echoed: a refused recipient is the same untrusted value as
    // the CRLF case above, and Nest's handler logs this message.
    expect((failure as EmailDeliveryError).recipient).toBe('<rejected-recipient>');
    expect((failure as EmailDeliveryError).message).toContain('an anonymised address');
    expect((failure as EmailDeliveryError).message).not.toContain(TOMBSTONE);
    // Nothing was attempted, so no envelope was ever built for it.
    expect(sink.deliveries).toEqual([]);
  });

  it('refuses the same address in the delimited display-name form the parser accepts', async () => {
    await expect(
      serviceFor().sendVerificationEmail(`"Robin" <${TOMBSTONE}>`, RECIPIENT_NAME, 'tok-abc'),
    ).rejects.toThrow(EmailDeliveryError);
    expect(sink.deliveries).toEqual([]);
  });

  it('refuses the erasure receipt too, so the one flow whose whole point is the address is covered', async () => {
    await expect(serviceFor().sendErasureReceipt(TOMBSTONE)).rejects.toThrow(EmailDeliveryError);
    expect(sink.deliveries).toEqual([]);
  });

  it('still sends to an ordinary address in the same shape, so the check is not "everything is refused"', async () => {
    // The positive control. Without it, a `send()` that threw unconditionally would
    // make all three refusals above green.
    await serviceFor().sendVerificationEmail(RECIPIENT, RECIPIENT_NAME, 'tok-still-works');

    expect(sink.deliveries.at(-1)?.recipients).toEqual([RECIPIENT]);
  });
});

describe('a delivery failure is a failure', () => {
  it('rejects with EmailDeliveryError when the transport cannot connect, and does not resolve', async () => {
    const service = serviceFor(DEAD_SMTP);

    // The previous tree returned `boolean` from every send method and its
    // caller discarded it, so this resolved to `false` and the request answered
    // HTTP 200 with a user who never received their reset link.
    const outcome = await service
      .sendPasswordResetEmail(RECIPIENT, RECIPIENT_NAME, 'tok-xyz')
      .then(() => 'resolved')
      .catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(EmailDeliveryError);
    const failure = outcome as EmailDeliveryError;
    expect(failure.name).toBe('EmailDeliveryError');
    expect(failure.recipient).toBe(RECIPIENT);
    expect(failure.subject).toBe('Reset your app.example.test password');
    // The transport's own error survives as `cause`, so a 535 auth failure and
    // a DNS failure stay distinguishable at the call site.
    expect(failure.cause).toBeInstanceOf(Error);
    expect(String(failure.message)).toMatch(/ECONNREFUSED|connect/);
  });

  it('never logs the rendered body, so a token cannot reach a log through the failure path', async () => {
    const logged: string[] = [];
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown): void => {
        logged.push(String(message));
      });
    }
    const service = serviceFor(DEAD_SMTP);

    await expect(
      service.sendPasswordResetEmail(RECIPIENT, RECIPIENT_NAME, 'super-secret-token'),
    ).rejects.toThrow(EmailDeliveryError);

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain('super-secret-token');
      expect(line).not.toContain('reset-password?token=');
    }
  });
});

describe('the transport is the same one in every mode', () => {
  it('reaches the same sink from development and from test, over one mechanism', async () => {
    // The parity claim. Two configurations, one transport, one provider class.
    // The previous tree built three different transports here — a stream in
    // development, JSON in test, SMTP in production — so only one of the three
    // had ever spoken to a server.
    for (const nodeEnv of ['development', 'test']) {
      sink.clear();
      await serviceFor({ NODE_ENV: nodeEnv }).sendVerificationEmail(RECIPIENT, RECIPIENT_NAME, 'tok-parity');

      expect(sink.deliveries.length, nodeEnv).toBe(1);
      expect(sink.deliveries[0]?.recipients).toEqual([RECIPIENT]);
      expect(sink.deliveries[0]?.openingCommand).toBe('EHLO');
      expect(deliveredTo(RECIPIENT)?.text).toContain(
        'https://app.example.test/verify-email?token=tok-parity',
      );
    }
  });

  it('cannot deliver a production configuration to this sink, because bootstrap refuses one', () => {
    // The other half of the parity claim, and the reason the comparison above
    // stops at two modes rather than three: production is *forbidden* from
    // naming a loopback relay, so it cannot be pointed at a sink even on
    // purpose. That refusal is what stops `250` from meaning "stored and
    // dropped" for every real user.
    expect(() =>
      serviceFor({ ...PRODUCTION_EMAIL_SOURCE, EMAIL_HOST: sink.host, EMAIL_PORT: String(sink.port) }),
    ).toThrow(/routable relay host in production/);
  });

  it('builds the same provider for a routable production host as for the sink', () => {
    const production = emailConfigFor(PRODUCTION_EMAIL_SOURCE);

    expect(new NodemailerEmailProvider(production).name).toBe('nodemailer');
    expect(production.smtp.host).toBe('smtp.example.test');
    expect(production.smtp.user).toBe('apikey');
    // The e2e suite carries the production-shaped delivery: the same transport,
    // over TLS, with AUTH, against a real server.
  });

  it('cannot be pointed anywhere else, because no key selects a transport', () => {
    const attempts: ReadonlyArray<Readonly<Record<string, string>>> = [
      { EMAIL_TRANSPORT: 'stream' },
      { EMAIL_PROVIDER: 'console' },
      { EMAIL_ENABLED: 'false' },
    ];
    for (const override of attempts) {
      const email = emailConfigFor({ ...PRODUCTION_EMAIL_SOURCE, ...override });
      expect(Object.keys(email).sort()).toEqual(['appName', 'baseUrl', 'from', 'smtp']);
    }
  });

  it('sends without a credential when none is configured, rather than inventing one', async () => {
    // The local sink does not authenticate, and the previous tree's transports
    // never opened a socket at all — so "no credential configured" was untested.
    const service = serviceFor({ NODE_ENV: 'test' });

    await service.sendVerificationEmail(RECIPIENT, RECIPIENT_NAME, 'tok-no-auth');

    expect(sink.deliveries.at(-1)?.authenticatedAs).toBeNull();
  });
});

describe('what may be logged', () => {
  it('logs recipient, subject and destination on the success path, and no body', async () => {
    const logged: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown): void => {
      logged.push(String(message));
    });

    await serviceFor().sendPasswordResetEmail(RECIPIENT, RECIPIENT_NAME, 'super-secret-token');

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(RECIPIENT);
    expect(logged[0]).toContain('Reset your');
    expect(logged[0]).toContain(`${sink.host}:${sink.port}`);
    expect(logged[0]).not.toContain('super-secret-token');
  });

  it('no console.* call exists under src/email', () => {
    // `no-console` is already an ESLint error there; this is the assertion a
    // reader of the module can find without reading the lint config.
    const root = join(BACKEND_ROOT, 'src', 'email');
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.ts')) {
          if (/console\.(log|error|warn|info|debug)\b/.test(readFileSync(path, 'utf8'))) {
            offenders.push(path);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('the source is the only environment reader', () => {
  it('neither the service nor the provider reads process.env', () => {
    const offenders = ['email.service.ts', 'nodemailer-email.provider.ts', 'email.renderer.ts']
      .map((file) => readFileSync(join(BACKEND_ROOT, 'src', 'email', file), 'utf8'))
      .flatMap((source) => (source.includes('process.env') ? ['process.env'] : []));
    expect(offenders).toEqual([]);
  });

  it('a development environment with no email keys still resolves a usable configuration', () => {
    // The zero-credential baseline of AGENTS.md §0: a fork boots, and the
    // verification link is clickable — out of the sink `npm run dev` starts,
    // rather than out of a transport that never opened a socket.
    const email = emailConfigFor(sourceWith({ NODE_ENV: 'development' }));
    expect(email.smtp.host).toBe('127.0.0.1');
    expect(email.smtp.port).toBe(1025);
    expect(email.smtp.user).toBeNull();
    expect(email.baseUrl).toBe('https://app.example.test');
  });
});