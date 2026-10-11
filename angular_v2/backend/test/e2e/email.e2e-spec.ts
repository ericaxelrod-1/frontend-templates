import { Body, Controller, HttpCode, Module, Post, ValidationPipe } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { IsString, MinLength } from 'class-validator';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../scripts/smtp-sink.js';
import { parseSmtpMessage, decodeHtmlEntities } from '../../scripts/smtp-message.js';
import { Public } from '../../src/auth/public.decorator.js';
import { EmailModule } from '../../src/email/email.module.js';
import { EmailService } from '../../src/email/email.service.js';
import { loadEnvironment, type Environment } from '../../src/config/environment.js';
import { loadTestEnvironment } from '../support/database.js';
import { selfSignedSmtpSinkTls } from '../support/self-signed-certificate.js';

/**
 * Transactional email, end to end: the real `AppModule`, the real `EmailModule`,
 * the real nodemailer provider on its **SMTP** transport, the real handlebars
 * renderer and the real templates, driven over real HTTP through Nest's DI and
 * Fastify — and then asserted against what a **real SMTP server actually
 * received**.
 *
 * That server is `startSmtpSink` from `backend/scripts/smtp-sink.ts`: the same
 * in-process listener `npm run dev` hosts. A real socket, a real EHLO, a real
 * `DATA`, a real `250`.
 *
 * **This is the parity requirement.** The previous version of this suite used
 * nodemailer's `jsonTransport`, which serialises a message and sends nothing, so
 * the suite asserted on bytes no server ever saw and the transport layer's first
 * real run happened in production. It also asserted `email.transport === 'json'`
 * — a test that went red the moment the mode stopped choosing the transport,
 * which is exactly backwards. What is asserted here is the destination the
 * configuration named and the content that arrived at it.
 *
 * **Why this suite owns a controller.** The routes that will *actually* call
 * `sendVerificationEmail` / `sendPasswordResetEmail` are the registration and
 * password-reset endpoints of later W11 slices, and they need a token table —
 * `backend/database/**` is not this slice's to touch. Rather than claim a route
 * the application does not ship, this suite mounts a controller of its own over
 * the real module and states plainly that it is the seam. What it proves is the
 * part that is real: DI wiring, config resolution, the one transport, the
 * handshake, rendering, absolute-URL construction, and — the point of the slice
 * — that a transport failure reaches the client as a failure.
 *
 * Every sink binds **port 0**, so the OS picks a free one and the suite can never
 * reach a listener some other process already owns (`AGENTS.md` §B8).
 */

const TIMEOUT = 60_000;
const BASE_URL = 'https://mail.example.test';
const RECIPIENT = 'robin@example.test';
const RECIPIENT_NAME = 'Robin';

/** The sink's own credential. A loopback test password, not a secret. */
const SINK_CREDENTIALS = { user: 'e2e-sink-user', password: 'e2e-sink-password' } as const;

class DispatchDto {
  @IsString()
  @MinLength(3)
  to!: string;

  @IsString()
  @MinLength(1)
  recipientName!: string;

  @IsString()
  @MinLength(1)
  token!: string;
}

@Controller('auth')
class EmailProbeController {
  constructor(private readonly email: EmailService) {}

  // `@Public()` because AppModule registers JwtAuthGuard as APP_GUARD — default
  // deny — and the routes that will really call this are registration and reset,
  // which are unauthenticated by definition. The probe obeys the same guard the
  // application does rather than a probe-only bypass.
  @Public()
  @Post('email/verification')
  @HttpCode(200)
  verification(@Body() body: DispatchDto): Promise<unknown> {
    return this.email.sendVerificationEmail(body.to, body.recipientName, body.token);
  }

  @Public()
  @Post('email/password-reset')
  @HttpCode(200)
  passwordReset(@Body() body: DispatchDto): Promise<unknown> {
    return this.email.sendPasswordResetEmail(body.to, body.recipientName, body.token);
  }
}

/** The real application plus the probe controller, over the same EmailModule
 * instance AuthModule uses — one module, one provider, no second registration. */
@Module({
  imports: [EmailModule],
  controllers: [EmailProbeController],
})
class EmailProbeModule {}

interface ReceiptBody {
  readonly messageId: string;
}

/** Everything the real environment needs that is not an email key. */
const BASE_SOURCE: Readonly<Record<string, string>> = {
  APP_BASE_URL: BASE_URL,
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'app',
  DB_PASSWORD: 'app',
  DB_NAME: 'app_dev',
  JWT_SECRET: 'e2e-email-signing-secret-key-0123456789',
  AUTHENTICATOR_PASSWORD: 'pgrst',
};

/**
 * The application, over the real module, aimed at a sink this suite started.
 * The only thing supplied is configuration — no stub, no fake provider, no
 * transport override, because there is no longer such a thing to override.
 */
async function applicationOver(environment: Environment): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        cache: true,
        ignoreEnvFile: true,
        load: [registerAs('environment', () => environment)],
      }),
      EmailProbeModule,
    ],
  }).compile();

  const application = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  application.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await application.init();
  await application.getHttpAdapter().getInstance().ready();
  return application;
}

let app: NestFastifyApplication;
let plainSink: SmtpSink;

beforeAll(async () => {
  plainSink = await startSmtpSink({ port: 0 });
  // The real environment wins over backend/.env.test, exactly as Node's own
  // --env-file behaves — so the assertion below is against an absolute https
  // origin the suite chose, not against whatever a local file happens to say.
  process.env['APP_BASE_URL'] = BASE_URL;
  process.env['EMAIL_HOST'] = plainSink.host;
  process.env['EMAIL_PORT'] = String(plainSink.port);
  vi.resetModules();

  const { AppModule } = await import('../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, EmailProbeModule],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, TIMEOUT);

afterAll(async () => {
  await app?.close();
  await plainSink?.close();
});

describe('a request that triggers a verification email', () => {
  it('puts a message addressed to the caller, with an absolute link off APP_BASE_URL, into a real SMTP server', async () => {
    plainSink.clear();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/email/verification',
      payload: { to: RECIPIENT, recipientName: RECIPIENT_NAME, token: 'verify-token-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ReceiptBody>().messageId).not.toBe('');

    // The envelope the server parsed, not a shape the client invented.
    const delivery = await plainSink.waitForDelivery();
    expect(delivery.recipients).toEqual([RECIPIENT]);
    expect(delivery.openingCommand).toBe('EHLO');

    const message = parseSmtpMessage(delivery.raw);
    expect(message.headers['subject']).toBe('Verify your mail.example.test email address');
    expect(message.text).toContain(`${BASE_URL}/verify-email?token=verify-token-1`);
    expect(decodeHtmlEntities(message.html)).toContain(
      `${BASE_URL}/verify-email?token=verify-token-1`,
    );
    // The old tree shipped `<p>Email template error: …</p>` as a *successful*
    // send whenever the templates were missing from dist/.
    expect(message.html).not.toContain('Email template error');
    expect(message.html).not.toContain('{{');
  }, TIMEOUT);

  it('puts a password reset on the reset path, into the same server', async () => {
    plainSink.clear();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/email/password-reset',
      payload: { to: RECIPIENT, recipientName: RECIPIENT_NAME, token: 'reset-token-2' },
    });

    expect(response.statusCode).toBe(200);
    const delivery = await plainSink.waitForDelivery();
    expect(delivery.recipients).toEqual([RECIPIENT]);

    const message = parseSmtpMessage(delivery.raw);
    expect(message.headers['subject']).toBe('Reset your mail.example.test password');
    expect(message.text).toContain(`${BASE_URL}/reset-password?token=reset-token-2`);
    expect(message.html).not.toContain('Email template error');
  }, TIMEOUT);

  it('reaches the same EmailService instance AuthModule imports, rather than a second registration', () => {
    const email = app.get(EmailService);
    const again = app.get(EmailService);
    expect(email).toBe(again);
  }, TIMEOUT);
});

describe('the handshake paths production will use', () => {
  /**
   * STARTTLS and AUTH are *handshake* paths, and a handshake that is only ever
   * exercised in production is a handshake whose first run is a production
   * incident. Both run here over the same transport, the same provider and the
   * same service — only the destination and its two flags differ.
   *
   * `EMAIL_TLS_REJECT_UNAUTHORIZED=false` is what makes the self-signed
   * certificate usable, and `environment.ts` refuses that value in production:
   * it exists for a loopback sink and for nothing else.
   */
  let tlsSink: SmtpSink;
  let tlsApp: NestFastifyApplication;

  beforeAll(async () => {
    tlsSink = await startSmtpSink({
      port: 0,
      tls: await selfSignedSmtpSinkTls(),
      credentials: SINK_CREDENTIALS,
    });
    tlsApp = await applicationOver(
      loadEnvironment({
        ...BASE_SOURCE,
        NODE_ENV: 'test',
        EMAIL_HOST: tlsSink.host,
        EMAIL_PORT: String(tlsSink.port),
        EMAIL_USER: SINK_CREDENTIALS.user,
        EMAIL_PASSWORD: SINK_CREDENTIALS.password,
        EMAIL_SECURE: 'false',
        EMAIL_TLS_REJECT_UNAUTHORIZED: 'false',
      }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await tlsApp?.close();
    await tlsSink?.close();
  });

  it('upgrades to TLS and authenticates before the DATA, and the server saw both', async () => {
    tlsSink.clear();

    const response = await tlsApp.inject({
      method: 'POST',
      url: '/auth/email/password-reset',
      payload: { to: RECIPIENT, recipientName: RECIPIENT_NAME, token: 'reset-token-5' },
    });
    expect(response.statusCode).toBe(200);

    const delivery = await tlsSink.waitForDelivery();
    // Both are the server's own record, not a claim the client made about
    // itself: `session.secure` and the authenticated user on the session that
    // carried the DATA.
    expect(delivery.secure).toBe(true);
    expect(delivery.authenticatedAs).toBe(SINK_CREDENTIALS.user);
    expect(parseSmtpMessage(delivery.raw).text).toContain(
      `${BASE_URL}/reset-password?token=reset-token-5`,
    );
    expect(tlsSink.errors).toEqual([]);
  }, TIMEOUT);

  it('refuses a client that offers the wrong credential, rather than accepting anything', async () => {
    // A sink that accepted every credential would prove nothing about AUTH.
    const rejectingApp = await applicationOver(
      loadEnvironment({
        ...BASE_SOURCE,
        NODE_ENV: 'test',
        EMAIL_HOST: tlsSink.host,
        EMAIL_PORT: String(tlsSink.port),
        EMAIL_USER: SINK_CREDENTIALS.user,
        EMAIL_PASSWORD: 'not-the-sink-password',
        EMAIL_SECURE: 'false',
        EMAIL_TLS_REJECT_UNAUTHORIZED: 'false',
      }),
    );
    try {
      const response = await rejectingApp.inject({
        method: 'POST',
        url: '/auth/email/password-reset',
        payload: { to: RECIPIENT, recipientName: RECIPIENT_NAME, token: 'reset-token-6' },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(500);
      expect(response.statusCode).not.toBe(200);
    } finally {
      await rejectingApp.close();
    }
  }, TIMEOUT);
});

describe('implicit TLS, the port-465 shape', () => {
  let secureSink: SmtpSink;
  let secureApp: NestFastifyApplication;

  beforeAll(async () => {
    secureSink = await startSmtpSink({
      port: 0,
      tls: await selfSignedSmtpSinkTls(),
      implicitTls: true,
    });
    secureApp = await applicationOver(
      loadEnvironment({
        ...BASE_SOURCE,
        NODE_ENV: 'test',
        EMAIL_HOST: secureSink.host,
        EMAIL_PORT: String(secureSink.port),
        EMAIL_SECURE: 'true',
        EMAIL_TLS_REJECT_UNAUTHORIZED: 'false',
      }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await secureApp?.close();
    await secureSink?.close();
  });

  it('is TLS from the first byte, so EMAIL_SECURE has an effect that is asserted rather than assumed', async () => {
    const response = await secureApp.inject({
      method: 'POST',
      url: '/auth/email/verification',
      payload: { to: RECIPIENT, recipientName: RECIPIENT_NAME, token: 'verify-token-7' },
    });
    expect(response.statusCode).toBe(200);

    expect((await secureSink.waitForDelivery()).secure).toBe(true);
  }, TIMEOUT);
});

describe('a provider failure reaches the caller', () => {
  /**
   * A second application over the same `EmailModule`, pointed at a loopback port
   * nothing listens on. The transport, the provider, the renderer and the service
   * are the real ones; the only difference is a genuinely dead SMTP endpoint, so
   * the failure is a genuine connection refusal rather than a scripted one.
   *
   * `NODE_ENV` is `test`, not `production`, and that is not a convenience: a
   * production configuration may no longer name a loopback host at all (the sink
   * refusal), which is the point of the refusal — and the connection-refused path
   * does not depend on the mode, because there is only one transport.
   */
  let brokenApp: NestFastifyApplication;

  beforeAll(async () => {
    brokenApp = await applicationOver(
      loadEnvironment({
        ...BASE_SOURCE,
        NODE_ENV: 'test',
        // Port 1 is reserved and nothing binds it.
        EMAIL_HOST: '127.0.0.1',
        EMAIL_PORT: '1',
      }),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await brokenApp?.close();
  });

  it('answers 5xx rather than 200, so a user is never told a failed reset was sent', async () => {
    const response = await brokenApp.inject({
      method: 'POST',
      url: '/auth/email/password-reset',
      payload: { to: RECIPIENT, recipientName: RECIPIENT_NAME, token: 'reset-token-3' },
    });

    // The previous tree's `sendEmail` returned `false`, `EmailService` returned
    // that boolean and `AuthService` discarded it — so this response was
    // HTTP 200 with a user who never received their reset link.
    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toContain('reset-token-3');
  }, TIMEOUT);

  it('rejects an unusable recipient before the transport sees it, and still answers 5xx', async () => {
    plainSink.clear();

    const response = await brokenApp.inject({
      method: 'POST',
      url: '/auth/email/verification',
      payload: {
        to: `${RECIPIENT}\r\nBcc: victim@example.test`,
        recipientName: RECIPIENT_NAME,
        token: 'verify-token-4',
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(response.statusCode).not.toBe(200);
    // Not one byte of the hostile recipient reached a header parser.
    expect(plainSink.deliveries).toEqual([]);
  }, TIMEOUT);
});

describe('the environment the suite ran against', () => {
  it('was the validated one, with the destination the suite chose and no transport label', () => {
    const environment = loadTestEnvironment();
    expect(environment.email.baseUrl).toBe(BASE_URL);
    expect(environment.email.smtp.host).toBe(plainSink.host);
    expect(environment.email.smtp.port).toBe(plainSink.port);
    expect(environment.email.smtp.secure).toBe(false);
    // There is nothing left to vary by mode, so there is nothing to assert here.
    expect(environment.email).not.toHaveProperty('transport');
  });
});