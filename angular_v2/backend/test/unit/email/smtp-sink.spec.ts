import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import {
  SMTP_SINK_LOOPBACK_ADDRESS,
  SmtpSinkBindError,
  startSmtpSink,
  type SmtpSink,
} from '../../../scripts/smtp-sink.js';
import { loadEnvironment } from '../../../src/config/environment.js';
import { NodemailerEmailProvider } from '../../../src/email/nodemailer-email.provider.js';
import { EmailRenderer } from '../../../src/email/email.renderer.js';
import { EmailService } from '../../../src/email/email.service.js';
import { decodeHtmlEntities, parseSmtpMessage } from '../../../scripts/smtp-message.js';
import { BACKEND_ROOT } from '../../support/paths.js';
import { selfSignedSmtpSinkTls } from '../../support/self-signed-certificate.js';

/**
 * The local SMTP sink itself, asserted as infrastructure rather than as a
 * convenience: if the sink binds something other than loopback, or accepts a
 * message without the handshake a real relay demands, then the "development
 * and test run the production code path" claim is false.
 *
 * Every sink here binds **port 0**, so the OS picks a free one. `AGENTS.md` §B8
 * forbids starting a test server on a port something else may already hold: the
 * readiness probe would succeed against the other server and the suite would
 * quietly test a thing it did not create.
 */

const SINK_CREDENTIALS = { user: 'sink-user', password: 'sink-password' } as const;
const RECIPIENT = 'robin@example.test';

function serviceAgainst(sink: SmtpSink, tls: boolean, credentials: boolean): EmailService {
  const environment = loadEnvironment({
    NODE_ENV: 'test',
    APP_BASE_URL: 'https://app.example.test',
    EMAIL_HOST: sink.host,
    EMAIL_PORT: String(sink.port),
    EMAIL_SECURE: String(tls),
    EMAIL_TLS_REJECT_UNAUTHORIZED: 'false',
    ...(credentials ? { EMAIL_USER: SINK_CREDENTIALS.user, EMAIL_PASSWORD: SINK_CREDENTIALS.password } : {}),
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'app',
    DB_PASSWORD: 'app',
    DB_NAME: 'app_test',
    JWT_SECRET: 'sink-spec-signing-secret-key-0123456789',
    AUTHENTICATOR_PASSWORD: 'authenticator-password',
  });
  const config = { getOrThrow: <T>(key: string): T => ({ environment })[key] as T } as ConfigService;
  return new EmailService(
    config,
    new NodemailerEmailProvider(environment.email),
    new EmailRenderer(),
  );
}

describe('the sink binds loopback and nothing else', () => {
  it('reports the loopback address it actually bound, and a port the OS chose', async () => {
    const sink = await startSmtpSink({ port: 0 });
    try {
      expect(sink.host).toBe(SMTP_SINK_LOOPBACK_ADDRESS);
      expect(sink.host).toBe('127.0.0.1');
      expect(sink.port).toBeGreaterThan(0);
      expect(sink.port).toBeLessThan(65536);
    } finally {
      await sink.close();
    }
  });

  it('refuses a non-loopback address before a socket exists', async () => {
    // Not `0.0.0.0` by accident: `0.0.0.0` accepts from every interface, which
    // is the exact failure this assertion exists to prevent.
    for (const host of ['0.0.0.0', '192.168.1.10', '::', 'example.test']) {
      const attempt = startSmtpSink({ port: 0, host });

      await expect(attempt).rejects.toThrow(SmtpSinkBindError);
      await expect(attempt).rejects.toThrow(/loopback/i);
    }
  });

  it('refuses to start on a port something else already holds, rather than moving', async () => {
    const first = await startSmtpSink({ port: 0 });
    try {
      await expect(startSmtpSink({ port: first.port })).rejects.toThrow(SmtpSinkBindError);
    } finally {
      await first.close();
    }
  });
});

describe('one transport, whatever the mode', () => {
  it('delivers a password reset over a real SMTP conversation when NODE_ENV=test', async () => {
    const sink = await startSmtpSink({ port: 0 });
    try {
      const receipt = await serviceAgainst(sink, false, false).sendPasswordResetEmail(
        'robin@example.test',
        'Robin',
        'sink-token-1',
      );

      expect(receipt.messageId).not.toBe('');
      const delivery = await sink.waitForDelivery();
      expect(delivery.recipients).toEqual(['robin@example.test']);
      expect(delivery.openingCommand).toBe('EHLO');
      expect(delivery.secure).toBe(false);

      const message = parseSmtpMessage(delivery.raw);
      expect(message.headers['subject']).toBe('Reset your app.example.test password');
      // Read out of the *decoded* parts: the raw payload carries `?token=3D…`,
      // because that is what quoted-printable does to `=`.
      expect(message.text).toContain('https://app.example.test/reset-password?token=sink-token-1');
      expect(decodeHtmlEntities(message.html)).toContain(
        'https://app.example.test/reset-password?token=sink-token-1',
      );
      expect(sink.errors).toEqual([]);
    } finally {
      await sink.close();
    }
  });

  it('delivers the same message when NODE_ENV=development, over the same socket', async () => {
    // The parity claim, stated as a test: the two modes differ in the
    // destination and in nothing else. Previously development never opened a
    // socket at all, so this comparison could not be made.
    const sink = await startSmtpSink({ port: 0 });
    try {
      const environment = loadEnvironment({
        NODE_ENV: 'development',
        APP_BASE_URL: 'https://app.example.test',
        EMAIL_HOST: sink.host,
        EMAIL_PORT: String(sink.port),
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'app',
        DB_PASSWORD: 'app',
        DB_NAME: 'app_dev',
        JWT_SECRET: 'sink-spec-signing-secret-key-0123456789',
        AUTHENTICATOR_PASSWORD: 'authenticator-password',
      });
      const config = {
        getOrThrow: <T>(key: string): T => ({ environment })[key] as T,
      } as ConfigService;
      const service = new EmailService(
        config,
        new NodemailerEmailProvider(environment.email),
        new EmailRenderer(),
      );

      await service.sendVerificationEmail('robin@example.test', 'Robin', 'sink-token-2');

      const delivery = await sink.waitForDelivery();
      expect(delivery.recipients).toEqual(['robin@example.test']);
      expect(delivery.openingCommand).toBe('EHLO');
      expect(parseSmtpMessage(delivery.raw).text).toContain(
        'https://app.example.test/verify-email?token=sink-token-2',
      );
    } finally {
      await sink.close();
    }
  });

  it('completes a STARTTLS handshake and authenticates, so those paths are covered', async () => {
    const sink = await startSmtpSink({
      port: 0,
      tls: await selfSignedSmtpSinkTls(),
      credentials: SINK_CREDENTIALS,
    });
    try {
      await serviceAgainst(sink, false, true).sendVerificationEmail(
        'robin@example.test',
        'Robin',
        'sink-token-3',
      );

      const delivery = await sink.waitForDelivery();
      // `secure` is the server's own view of the socket at DATA time, not a
      // claim the client made.
      expect(delivery.secure).toBe(true);
      expect(delivery.authenticatedAs).toBe(SINK_CREDENTIALS.user);
    } finally {
      await sink.close();
    }
  });

  it('completes an implicit-TLS handshake from the first byte, the port-465 shape', async () => {
    const sink = await startSmtpSink({
      port: 0,
      tls: await selfSignedSmtpSinkTls(),
      implicitTls: true,
    });
    try {
      await serviceAgainst(sink, true, false).sendPasswordResetEmail(
        'robin@example.test',
        'Robin',
        'sink-token-4',
      );

      expect((await sink.waitForDelivery()).secure).toBe(true);
    } finally {
      await sink.close();
    }
  });

  it('reports a delivery that never arrived as a failure rather than a success', async () => {
    const sink = await startSmtpSink({ port: 0 });
    try {
      await expect(sink.waitForDelivery(() => true, 150)).rejects.toThrow(
        /no matching message reached the sink/,
      );
    } finally {
      await sink.close();
    }
  });
});

describe('one sink, and the application cannot reach it', () => {
  it('is imported by the dev orchestrator and by the tests, from one module', () => {
    const sinkPath = join(BACKEND_ROOT, 'scripts', 'smtp-sink.ts');
    const consumers = [
      join(BACKEND_ROOT, 'scripts', 'dev.mjs'),
      join(BACKEND_ROOT, 'test', 'unit', 'email', 'smtp-sink.spec.ts'),
      join(BACKEND_ROOT, 'test', 'e2e', 'email.e2e-spec.ts'),
    ];


    for (const consumer of consumers) {
      expect(readFileSync(consumer, 'utf8'), consumer).toContain('smtp-sink');
    }
    expect(readFileSync(sinkPath, 'utf8')).toContain('export async function startSmtpSink');
  });

  it('is not referenced from src/, so a production process cannot start one', () => {
    // The structural half of "production must not run a sink": the sink is
    // hosted by the dev orchestrator, and nothing under src/ can even name it.
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.ts')) {
          const source = readFileSync(path, 'utf8');
          if (source.includes('smtp-sink') || source.includes('startSmtpSink') || source.includes('smtp-server')) {
            offenders.push(path.slice(BACKEND_ROOT.length + 1));
          }
        }
      }
    };
    walk(join(BACKEND_ROOT, 'src'));

    expect(offenders).toEqual([]);
  });
});
describe('reading what the sink received', () => {
  it('reads a single-part message, rather than reporting an empty body for one', async () => {
    // A caller that sets only `text` produces a non-multipart message. The
    // reader has to say so, or every assertion about a text-only message passes
    // against an empty string.
    const sink = await startSmtpSink({ port: 0 });
    try {
      await nodemailer
        .createTransport({ host: sink.host, port: sink.port, secure: false })
        .sendMail({
          from: 'no-reply@app.example.test',
          to: RECIPIENT,
          subject: 'single part',
          text: 'https://app.example.test/verify-email?token=single-part',
        });

      const delivery = await sink.waitForDelivery();
      const message = parseSmtpMessage(delivery.raw);

      expect(message.headers['subject']).toBe('single part');
      expect(message.text).toContain('https://app.example.test/verify-email?token=single-part');
      expect(message.html).toBe('');
    } finally {
      await sink.close();
    }
  });

  it('refuses to decode an encoding it does not implement, instead of returning the encoded bytes', () => {
    // The failure this prevents: a reader that quietly hands back base64 makes
    // every link assertion pass against the wrong characters.
    expect(() =>
      parseSmtpMessage(
        [
          'Content-Type: text/plain',
          'Content-Transfer-Encoding: base64',
          '',
          'aHR0cHM6Ly9hcHAuZXhhbXBsZS50ZXN0',
        ].join('\r\n'),
      ),
    ).toThrow(/only decodes 7bit\/8bit\/quoted-printable/);
  });

  it('folds a header continued onto the next line, which is how nodemailer writes Content-Type', () => {
    const parsed = parseSmtpMessage(
      [
        'Subject: folded',
        'Content-Type: text/plain;',
        ' boundary="abc"',
        '',
        'body',
      ].join('\r\n'),
    );

    expect(parsed.headers['subject']).toBe('folded');
    expect(parsed.headers['content-type']).toBe('text/plain; boundary="abc"');
  });
});
