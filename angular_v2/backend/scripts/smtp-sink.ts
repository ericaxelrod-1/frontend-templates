import { SMTPServer } from 'smtp-server';
import type {
  SMTPServerAuthentication,
  SMTPServerAuthenticationResponse,
  SMTPServerDataStream,
  SMTPServerOptions,
  SMTPServerSession,
} from 'smtp-server';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'node:net';

/**
 * The local SMTP sink: one listener, in this process, that speaks real SMTP.
 *
 * **Why a sink at all.** The application has exactly one transport —
 * nodemailer's `smtpTransport` — and it needs *somewhere* to connect in
 * development and in the test suite. Previously each of those modes invented a
 * different transport that opened no socket, so the transport layer's first real
 * run happened in production. A sink makes development and test run the same
 * code path production does: a real TCP connection, a real EHLO, a real `DATA`,
 * a real `250` (ADR-0024).
 *
 * **Why `smtp-server` and not `maildev`.** `maildev` is a web UI plus a server;
 * this repository has no web UI for email and does not want one shipped. The
 * `smtp-server` package is the protocol implementation underneath it, with no
 * UI of its own. It is a library, so it runs **in this process** — `npm run dev`
 * stays one Node process for the app plus PostgREST, with no second process, no
 * container and no external binary.
 *
 * **Loopback only.** `SMTP_SINK_LOOPBACK_ADDRESS` is the only value this module
 * will hand to `listen`, a non-loopback `host` is refused before a socket
 * exists, and the bound address is re-read after listening. A sink another host
 * could reach would accept mail addressed to real users and never relay it.
 *
 * **`250` is not delivery.** The sink answers `250` because that is what a
 * server that accepted responsibility for a message answers. It relays nothing.
 * That is precisely why `environment.ts` refuses a loopback `EMAIL_HOST` in
 * production, and why nothing here is reachable from anywhere but this machine.
 *
 * ## `250` and why a success receipt proves nothing
 *
 * SMTP's final reply means *"I accept responsibility for this message"* — not
 * "the recipient has it", not "the domain exists", and emphatically not "this
 * message was relayed onward". A sink is the limiting case: it answers `250` to
 * everything, stores it in an array in this process, and no user is ever
 * contacted. So a `SentEmail` receipt can report acceptance and nothing more,
 * and a caller that needs to know a message reached a person needs bounce and
 * delivery webhooks, which this subsystem does not have.
 */

/** The only address this sink will bind. Not configurable — see above. */
export const SMTP_SINK_LOOPBACK_ADDRESS = '127.0.0.1';

/** The banner a sink announces, so a session is identifiable in a capture. */
export const SMTP_SINK_NAME = 'angular-v2-local-smtp-sink';

export class SmtpSinkBindError extends Error {
  readonly requestedHost: string;

  constructor(requestedHost: string, reason: string) {
    super(
      `the local SMTP sink refused to bind ${requestedHost}: ${reason}. ` +
        'It is a loopback-only listener, and a sink another host can reach would ' +
        'accept mail addressed to real users and never relay it.',
    );
    this.name = 'SmtpSinkBindError';
    this.requestedHost = requestedHost;
  }
}

/** Credentials the sink will authenticate, or `undefined` for a sink that does not authenticate. */
export type SmtpSinkCredentials = {
  readonly user: string;
  readonly password: string;
};

/** A key and certificate. PEM text; the sink passes them straight to `tls`. */
export type SmtpSinkTls = {
  readonly key: string;
  readonly cert: string;
};

export type SmtpSinkOptions = {
  /** `0` asks the OS for a free port, which is what the test suite does. */
  readonly port: number;
  /** Present only so the refusal is testable; only loopback is accepted. */
  readonly host?: string;
  readonly credentials?: SmtpSinkCredentials;
  /** Supplying this advertises STARTTLS — and makes implicit TLS available. */
  readonly tls?: SmtpSinkTls;
  /** Implicit TLS from the first byte (the port-465 shape) instead of STARTTLS. */
  readonly implicitTls?: boolean;
};

/** One message the sink accepted, exactly as it arrived. */
export type SmtpSinkDelivery = {
  /** The `MAIL FROM` address, or `null` for the null sender (`<>`). */
  readonly mailFrom: string | null;
  /** The `RCPT TO` addresses — the real envelope, before any header parsing. */
  readonly recipients: readonly string[];
  /** The `DATA` payload verbatim: headers, body, and both terminators' worth of bytes. */
  readonly raw: string;
  /** Whether the transport that carried it was TLS — implicit or STARTTLS. */
  readonly secure: boolean;
  /** The authenticated user, or `null` when the session was not authenticated. */
  readonly authenticatedAs: string | null;
  /** The opening command the client used, so an EHLO is distinguishable from a HELO. */
  readonly openingCommand: string;
};

export type SmtpSink = {
  readonly host: string;
  readonly port: number;
  /** Everything accepted so far, in arrival order. */
  readonly deliveries: readonly SmtpSinkDelivery[];
  /**
   * Resolves with the first delivery, past or future, that satisfies
   * `predicate`. Polling rather than an event, because a listener registered
   * after the message arrived would miss it — and a test that missed its own
   * message would hang or assert on the wrong one.
   */
  waitForDelivery(
    predicate?: (delivery: SmtpSinkDelivery) => boolean,
    timeoutMs?: number,
  ): Promise<SmtpSinkDelivery>;
  /**
   * Listener-level errors smtp-server re-emitted after the bind succeeded.
   * Empty is the only healthy state; a suite that finds one has a sink that
   * misbehaved, and an `EventEmitter` with no `error` listener would otherwise
   * turn it into an uncaught exception instead.
   */
  readonly errors: readonly Error[];
  /** Forget every delivery and authentication record. */
  clear(): void;
  close(): Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start the sink and resolve once it is listening on a verified loopback
 * address.
 *
 * A bind failure — including "something already holds this port" — rejects
 * rather than resolving on a different port, because a test that silently talks
 * to somebody else's listener is the failure `AGENTS.md` §B8 names explicitly.
 */
export async function startSmtpSink(options: SmtpSinkOptions): Promise<SmtpSink> {
  // One address, not "any loopback address": `::1` and `::ffff:127.0.0.1` are the
  // same host as 127.0.0.1 but a different socket, and a sink that could be asked
  // to bind either of them is a sink whose reachable surface is a configuration
  // value. The `host` option exists so the refusal is testable.
  const host = options.host ?? SMTP_SINK_LOOPBACK_ADDRESS;
  if (host !== SMTP_SINK_LOOPBACK_ADDRESS) {
    throw new SmtpSinkBindError(
      host,
      `a loopback-only listener binds exactly ${SMTP_SINK_LOOPBACK_ADDRESS} and nothing else`,
    );
  }

  const deliveries: SmtpSinkDelivery[] = [];
  /** session id → the user that session authenticated as. */
  const authenticatedBy = new Map<string, string>();
  const sockets = new Set<Socket>();
  const credentials = options.credentials;
  if (credentials !== undefined && options.tls === undefined) {
    // A credential offered in clear text is not a credential. smtp-server
    // refuses AUTH on an unencrypted connection anyway, so a sink configured
    // this way would advertise AUTH and then reject every client — this is
    // said at startup instead, where it can be read.
    throw new Error(
      'the local SMTP sink will not authenticate without TLS: supply `tls` alongside ' +
        '`credentials`, or drop `credentials` and let the sink accept unauthenticated mail.',
    );
  }

  const serverOptions: SMTPServerOptions = {
    name: SMTP_SINK_NAME,
    // smtp-server logs to stdout by default; the sink is not the application and
    // must not write to the console (AGENTS.md §2.5).
    logger: false,
    // Reverse DNS on every connection makes a loopback listener slower than the
    // thing it stands in for.
    disableReverseLookup: true,
    secure: options.implicitTls === true,
    // AUTH is always advertised by smtp-server, so a sink with no credentials
    // must say authentication is optional or it rejects every client with 530.
    authOptional: credentials === undefined,
  };
  if (options.tls === undefined) {
    // Without a certificate the library would offer STARTTLS using its own
    // built-in one — which is expired, publicly known, and the reason a "plain"
    // sink silently became a TLS one. No TLS material means no STARTTLS.
    serverOptions.disabledCommands = ['STARTTLS'];
  } else {
    serverOptions.key = options.tls.key;
    serverOptions.cert = options.tls.cert;
  }
  if (credentials !== undefined) {
    serverOptions.onAuth = (
      auth: SMTPServerAuthentication,
      session: SMTPServerSession,
      callback: (err: Error | null | undefined, response?: SMTPServerAuthenticationResponse) => void,
    ): void => {
      if (auth.username === credentials.user && auth.password === credentials.password) {
        authenticatedBy.set(session.id, auth.username);
        session.user = auth.username;
        callback(null, { user: auth.username });
        return;
      }
      callback(new Error('535 5.7.8 Authentication credentials invalid'));
    };
  }
  serverOptions.onData = (
    stream: SMTPServerDataStream,
    session: SMTPServerSession,
    callback: (err?: Error | null) => void,
  ): void => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    stream.on('end', () => {
      const mailFrom = session.envelope.mailFrom;
      deliveries.push({
        mailFrom: mailFrom === false ? null : mailFrom.address,
        recipients: session.envelope.rcptTo.map((address) => address.address),
        raw: Buffer.concat(chunks).toString('utf8'),
        secure: session.secure,
        authenticatedAs: authenticatedBy.get(session.id) ?? null,
        openingCommand: session.openingCommand,
      });
      callback();
    });
  };

  const errors: Error[] = [];
  const smtp = new SMTPServer(serverOptions);
  smtp.on('error', (error: Error) => {
    errors.push(error);
  });
  smtp.server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(
        new SmtpSinkBindError(
          host,
          `port ${options.port} could not be bound (${error.message}). ` +
            'Refusing to continue rather than binding somewhere else: a test that reaches ' +
            "somebody else's listener tests nothing.",
        ),
      );
    };
    smtp.server.once('error', onError);
    smtp.server.listen(options.port, host, () => {
      smtp.server.removeListener('error', onError);
      resolve();
    });
  });

  const address = smtp.server.address() as AddressInfo | null;
  if (address === null || typeof address === 'string' || address.address !== SMTP_SINK_LOOPBACK_ADDRESS) {
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    throw new SmtpSinkBindError(
      address === null || typeof address === 'string' ? 'an unnamed socket' : address.address,
      `the listener bound ${address === null ? 'nothing' : address.address} rather than ${SMTP_SINK_LOOPBACK_ADDRESS}`,
    );
  }

  return {
    host: address.address,
    port: address.port,
    get errors(): readonly Error[] {
      return errors;
    },
    get deliveries(): readonly SmtpSinkDelivery[] {
      return deliveries;
    },
    async waitForDelivery(predicate = () => true, timeoutMs = 10_000): Promise<SmtpSinkDelivery> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = deliveries.find(predicate);
        if (found !== undefined) {
          return found;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `no matching message reached the sink within ${timeoutMs} ms; it accepted ${deliveries.length}. ` +
              'This is a delivery that never arrived, not a message that was refused.',
          );
        }
        await sleep(10);
      }
    },
    clear(): void {
      deliveries.length = 0;
      authenticatedBy.clear();
    },
    async close(): Promise<void> {
      // Destroy live sockets first: `smtp-server` otherwise waits out its
      // 30-second close timeout before calling back.
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
    },
  };
}