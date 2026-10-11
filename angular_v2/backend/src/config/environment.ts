/**
 * Typed, validated process environment.
 *
 * Every key this application depends on is read here, once. A missing or
 * malformed value is a hard error: there is no default fallback for a database
 * coordinate and no default for the JWT signing secret. `loadEnvironment`
 * throws with the complete list of problems rather than the first one, so a
 * misconfigured checkout is fixed in one pass.
 */

import { normalizeIpAddress } from '../auth/ip-address.js';

export const MINIMUM_JWT_SECRET_LENGTH = 32;

export type DatabaseConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
};

export type JwtConfig = {
  readonly secret: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
};

/**
 * The login path connects as this role and impersonates app_admin, the same
 * boundary the seed uses. The role's LOGIN password is deployment-specific,
 * like DB_PASSWORD: required, no default, asserted at bootstrap.
 */
export type AuthenticatorConfig = {
  readonly user: string;
  readonly password: string;
};

export type ServerConfig = {
  readonly port: number;
};

/**
 * The resolved runtime mode. `NODE_ENV` is the key, lowercased, and the same
 * key `load-env-file.ts` reads to choose *which file* to load — that module is
 * the authority for file selection, this one for the resolved value, and both
 * default to `development` when the key is absent. An unrecognised value is
 * reported as a problem here and thrown by `load-env-file.ts` before it can be
 * reached, so a typo never silently selects development behaviour.
 */
export type RuntimeMode = 'development' | 'test' | 'production';

export const RUNTIME_MODES: readonly RuntimeMode[] = ['development', 'test', 'production'];

export const DEFAULT_RUNTIME_MODE: RuntimeMode = 'development';

/**
 * The SMTP destination, in every mode.
 *
 * There is exactly one transport — nodemailer's `smtpTransport` — so this is not
 * a nullable union and not keyed on the runtime mode: development, test and
 * production build the same transport and differ only in **where it points**
 * (ADR-0024). `host` and `port` are therefore required in *every* mode with no
 * default, because a mode that has to guess a destination is a mode that can
 * silently pick one nobody is listening on.
 *
 * `user`/`password` are `null` together or set together. Production asserts
 * both (§2.3: no default for a credential); outside production they are
 * optional, because a loopback sink may not authenticate at all and a half-pair
 * is rejected rather than half-used.
 */
export type SmtpConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string | null;
  readonly password: string | null;
  /** Implicit TLS from the first byte (port 465). False means STARTTLS. */
  readonly secure: boolean;
  /**
   * Certificate verification. `true` everywhere unless a local sink with a
   * self-signed certificate says otherwise — and **refused** in production, for
   * the same reason a loopback host is refused: it is a setting whose only
   * purpose is to talk to something that is not a real relay.
   */
  readonly rejectUnauthorized: boolean;
};

/**
 * Transactional email (ADR-0024).
 *
 * `baseUrl` is required in **every** mode and has no default anywhere: it is
 * the application's own public origin, and the default the previous tree used
 * (`http://localhost:4200`) is exactly the kind of value that survives into a
 * real deployment and mails every user a link to nothing.
 *
 * `from` is required in production and derived from `baseUrl`'s host
 * otherwise, so no mode ever invents a sender domain.
 */
export type EmailConfig = {
  readonly appName: string;
  readonly baseUrl: string;
  readonly from: string;
  readonly smtp: SmtpConfig;
};

/**
 * Brute-force stack configuration (W11 slice 3).
 *
 * Progressive delay defaults follow security.md's stated schedule —
 * 0s → 1s → 4s → 16s — with a hard ceiling (the cap) so a single retry is
 * never unreasonably held. The values are documented defaults, not secrets,
 * so env-overridable constants are allowed here (unlike JWT_SECRET): tests
 * shrink the schedule for real-delay assertions instead of mocking clocks.
 *
 * The window (600s) bounds the blast radius of a scripted failure flood: a
 * request more than ten minutes after the last failure is neither counted
 * nor penalised, so an attacker cannot lock an account indefinitely — at
 * worst they keep its owners' logins in the throttle band for as long as
 * they keep writing fresh failures, and that penalty lifts when they stop.
 *
 * The block threshold defaults to 5, the number security.md's six tests
 * name ("five failures from one IP"); once either counter reaches it the
 * handler refuses before any credential check, and the refusal audits a
 * 'failed' row like any other attack surface.
 */
export type SecurityConfig = {
  readonly ipAllowlist: readonly string[];
  readonly failureWindowSeconds: number;
  readonly delayScheduleSeconds: readonly number[];
  readonly delayCapSeconds: number;
  readonly blockThreshold: number;
};

export type Environment = {
  readonly database: DatabaseConfig;
  readonly jwt: JwtConfig;
  readonly server: ServerConfig;
  readonly authenticator: AuthenticatorConfig;
  readonly security: SecurityConfig;
  readonly email: EmailConfig;
};

export const DEFAULT_SERVER_PORT = 3000;

/** 15 minutes — inside the short-lived ~15–30 minute band of AGENTS.md §B5. */
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 900;

/** Exactly 30 days; the documented ceiling for a first-issue refresh token. */
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export const AUTHENTICATOR_ROLE = 'pgrst_authenticator';

/** Documented brute-force defaults; every one is env-overridable. */
export const DEFAULT_FAILURE_WINDOW_SECONDS = 600;
export const DEFAULT_DELAY_SCHEDULE_SECONDS: readonly number[] = [0, 1, 4, 16];
export const DEFAULT_DELAY_CAP_SECONDS = 30;
export const DEFAULT_BLOCK_THRESHOLD = 5;

/** The SMTP keys that carry a secret or a sender domain: asserted in
 * production, never defaulted. `EMAIL_HOST` and `EMAIL_PORT` are additionally
 * asserted in every mode, because there is one transport and it needs a
 * destination everywhere. */
export const REQUIRED_PRODUCTION_EMAIL_KEYS = [
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'EMAIL_FROM',
] as const;

/** The implicit-TLS port. `EMAIL_SECURE` defaults from it. */
export const IMPLICIT_TLS_SMTP_PORT = 465;

const DATABASE_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as const;

const MINIMUM_PORT = 1;
const MAXIMUM_PORT = 65535;

export class EnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The environment is not usable. ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'EnvironmentError';
    this.problems = problems;
  }
}

function readString(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') {
    problems.push(`${key} is required but was not set`);
    return undefined;
  }
  if (typeof value !== 'string') {
    problems.push(`${key} must be a string, received ${typeof value}`);
    return undefined;
  }
  return value;
}

function readPort(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: number | undefined,
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback === undefined) {
      problems.push(`${key} is required but was not set`);
      return undefined;
    }
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(`${key} must be an integer between ${MINIMUM_PORT} and ${MAXIMUM_PORT}, received '${text}'`);
    return undefined;
  }
  const port = Number.parseInt(text, 10);
  if (port < MINIMUM_PORT || port > MAXIMUM_PORT) {
    problems.push(`${key} must be between ${MINIMUM_PORT} and ${MAXIMUM_PORT}, received '${text}'`);
    return undefined;
  }
  return port;
}

function readDatabase(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): DatabaseConfig | undefined {
  const values: Partial<Record<(typeof DATABASE_KEYS)[number], string | undefined>> = {};
  for (const key of DATABASE_KEYS) {
    if (key === 'DB_PORT') {
      continue;
    }
    values[key] = readString(source, key, problems);
  }
  const port = readPort(source, 'DB_PORT', problems, undefined);

  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = values;
  if (
    DB_HOST === undefined ||
    DB_USER === undefined ||
    DB_PASSWORD === undefined ||
    DB_NAME === undefined ||
    port === undefined
  ) {
    return undefined;
  }
  return { host: DB_HOST, port, user: DB_USER, password: DB_PASSWORD, database: DB_NAME };
}

function readTtlSeconds(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: number,
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer number of seconds, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(`${key} must be an integer number of seconds, received '${text}'`);
    return undefined;
  }
  const seconds = Number.parseInt(text, 10);
  if (seconds <= 0) {
    problems.push(`${key} must be greater than zero, received ${seconds}`);
    return undefined;
  }
  return seconds;
}

function readJwt(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): JwtConfig | undefined {
  const secret = readString(source, 'JWT_SECRET', problems);
  if (secret === undefined) {
    return undefined;
  }
  if (secret.length < MINIMUM_JWT_SECRET_LENGTH) {
    problems.push(
      `JWT_SECRET must be at least ${MINIMUM_JWT_SECRET_LENGTH} characters, received ${secret.length}`,
    );
    return undefined;
  }
  const postgrestSecret = source['PGRST_JWT_SECRET'];
  if (postgrestSecret !== undefined && postgrestSecret !== null && postgrestSecret !== '') {
    if (postgrestSecret !== secret) {
      problems.push(
        'PGRST_JWT_SECRET must equal JWT_SECRET: PostgREST and the thin app verify the same secret, and divergent values issue tokens that the API layer refuses',
      );
    }
  }
  const accessTokenTtlSeconds = readTtlSeconds(
    source,
    'JWT_ACCESS_TOKEN_TTL_SECONDS',
    problems,
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  );
  const refreshTokenTtlSeconds = readTtlSeconds(
    source,
    'JWT_REFRESH_TOKEN_TTL_SECONDS',
    problems,
    DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  );
  if (accessTokenTtlSeconds === undefined || refreshTokenTtlSeconds === undefined) {
    return undefined;
  }
  return { secret, accessTokenTtlSeconds, refreshTokenTtlSeconds };
}

function readAuthenticator(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): AuthenticatorConfig | undefined {
  const password = readString(source, 'AUTHENTICATOR_PASSWORD', problems);
  if (password === undefined) {
    return undefined;
  }
  return { user: AUTHENTICATOR_ROLE, password };
}

function readNonNegativeIntList(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: readonly number[],
): readonly number[] | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (typeof raw !== 'string') {
    problems.push(`${key} must be a comma-separated list of non-negative integers`);
    return undefined;
  }
  const parts = raw.split(',').map((part) => part.trim());
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      problems.push(`${key} must be a comma-separated list of non-negative integers, received '${raw}'`);
      return undefined;
    }
    values.push(Number.parseInt(part, 10));
  }
  return values;
}

function readCount(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  fallback: number,
): number | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    problems.push(`${key} must be an integer, received ${typeof raw}`);
    return undefined;
  }
  const text = String(raw);
  if (!/^\d+$/.test(text)) {
    problems.push(`${key} must be an integer, received '${text}'`);
    return undefined;
  }
  const value = Number.parseInt(text, 10);
  if (value <= 0) {
    problems.push(`${key} must be greater than zero, received ${value}`);
    return undefined;
  }
  return value;
}

function readSecurity(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): SecurityConfig | undefined {
  const rawAllowlist = source['SECURITY_IP_ALLOWLIST'];
  let allowlist: readonly string[] = [];
  if (rawAllowlist !== undefined && rawAllowlist !== null && rawAllowlist !== '') {
    if (typeof rawAllowlist !== 'string') {
      problems.push(`SECURITY_IP_ALLOWLIST must be a comma-separated list of addresses, received ${typeof rawAllowlist}`);
      return undefined;
    }
    allowlist = rawAllowlist
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => normalizeIpAddress(entry));
  }
  const failureWindowSeconds = readCount(
    source, 'SECURITY_FAILURE_WINDOW_SECONDS', problems, DEFAULT_FAILURE_WINDOW_SECONDS,
  );
  const delayScheduleSeconds = readNonNegativeIntList(
    source, 'SECURITY_DELAY_SCHEDULE_SECONDS', problems, DEFAULT_DELAY_SCHEDULE_SECONDS,
  );
  const delayCapSeconds = readCount(source, 'SECURITY_DELAY_CAP_SECONDS', problems, DEFAULT_DELAY_CAP_SECONDS);
  const blockThreshold = readCount(source, 'SECURITY_BLOCK_THRESHOLD', problems, DEFAULT_BLOCK_THRESHOLD);
  if (
    failureWindowSeconds === undefined ||
    delayScheduleSeconds === undefined ||
    delayScheduleSeconds.length === 0 ||
    delayCapSeconds === undefined ||
    blockThreshold === undefined
  ) {
    if (delayScheduleSeconds !== undefined && delayScheduleSeconds.length === 0) {
      problems.push('SECURITY_DELAY_SCHEDULE_SECONDS must not be an empty list');
    }
    return undefined;
  }
  return {
    ipAllowlist: allowlist,
    failureWindowSeconds,
    delayScheduleSeconds,
    delayCapSeconds,
    blockThreshold,
  };
}

/**
 * The first 16-bit group of a canonical (RFC 5952-ish) IPv6 literal, or
 * `undefined` when the text is not one. `normalizeIpAddress` has already
 * stripped a zone and any brackets, and `::`-compressed a full address, so
 * `::1` and `::` are compared literally further down.
 */
function firstHextet(canonical: string): number | undefined {
  if (canonical.startsWith('::')) {
    return 0;
  }
  const colon = canonical.indexOf(':');
  const head = colon === -1 ? canonical : canonical.slice(0, colon);
  if (!/^[0-9a-f]{1,4}$/.test(head)) {
    return undefined;
  }
  return Number.parseInt(head, 16);
}

/**
 * True when an SMTP host can only be a listener on this machine or this
 * network — loopback, unspecified, link-local, or private. `0.0.0.0` and `::`
 * count: they are the *unspecified* address, so connecting to one reaches the
 * local host and nothing beyond it.
 *
 * **Why this exists.** SMTP's `250` means "I accept responsibility for this
 * message", not "the recipient has it". A local sink answers `250`, stores
 * nothing anybody reads, and never relays — so a production process pointed at
 * one mails every password reset and every address verification into a void
 * with **no error anywhere**. The failure is total and silent, which is the one
 * class of defect `AGENTS.md` §2.3 is about.
 *
 * `localhost` is matched by name as well as by address, and `::ffff:127.0.0.1`
 * is caught because `normalizeIpAddress` flattens the mapped form to the dotted
 * quad first — the two spellings of one host must not disagree.
 *
 * A name that is not `localhost` is **not** refused: a relay hostname is a DNS
 * name, and this function cannot resolve DNS at bootstrap without turning
 * configuration validation into a network call. Only the literal address forms
 * it can decide are decided.
 */
export function isNonRoutableSmtpHost(raw: string): boolean {
  const host = normalizeIpAddress(raw).replace(/\.$/, '');
  if (host === '') {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  const dottedQuad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (dottedQuad !== null) {
    const first = Number.parseInt(dottedQuad[1] ?? '0', 10);
    const second = Number.parseInt(dottedQuad[2] ?? '0', 10);
    return (
      first === 0 || // 0.0.0.0/8, "this network" / unspecified
      first === 127 || // loopback
      first === 10 || // RFC 1918
      (first === 172 && second >= 16 && second <= 31) || // RFC 1918
      (first === 192 && second === 168) || // RFC 1918
      (first === 169 && second === 254) // link-local
    );
  }
  if (!host.includes(':')) {
    return false;
  }
  const hextet = firstHextet(host);
  if (hextet === undefined) {
    // Not an IPv6 literal this can classify; leave the decision to DNS.
    return false;
  }
  if (host === '::' || host === '::1') {
    return true; // unspecified, loopback
  }
  if (hextet >= 0xfe80 && hextet <= 0xfebf) {
    return true; // fe80::/10 link-local
  }
  return hextet >= 0xfc00 && hextet <= 0xfdff; // fc00::/7 unique-local
}

/**
 * The resolved `NODE_ENV`, lowercased. Absent means the documented default;
 * anything unrecognised returns `undefined` so the caller records a problem
 * instead of quietly choosing development behaviour.
 */
export function runtimeModeOf(source: Readonly<Record<string, unknown>>): RuntimeMode | undefined {
  const raw = source['NODE_ENV'];
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_RUNTIME_MODE;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const mode = raw.toLowerCase();
  return (RUNTIME_MODES as readonly string[]).includes(mode) ? (mode as RuntimeMode) : undefined;
}

/**
 * Accepts `local@host` and the `Display Name <local@host>` form a mail library
 * accepts, and rejects anything that could add a header or name a second
 * recipient. The threat is a CR or LF — that ends the header block and turns a
 * value into a `Bcc:` — so that is checked first and unconditionally. The rest
 * is shape, not RFC 5322: enough to catch a stray value without pretending to
 * be an address parser.
 */
export function isSingleLineAddress(value: string): boolean {
  if (value === '' || /[\r\n]/.test(value)) {
    return false;
  }
  const delimited = /^(.*)<([^<>]*)>$/.exec(value);
  if (delimited !== null) {
    const displayName = (delimited[1] ?? '').trim();
    // A display name is either quoted or a dot-atom. A bare comma or colon
    // would let a caller smuggle a second address or header value in.
    if (!/^"[^"\\]*"$/.test(displayName) && !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ .]+$/.test(displayName)) {
      return false;
    }
    return isSingleLineAddress(delimited[2] ?? '');
  }
  if (/\s/.test(value)) {
    return false;
  }
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return false;
  }
  if (value.slice(0, at).includes('@')) {
    return false;
  }
  return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
    value.slice(at + 1),
  );
}

/** The origin without a trailing slash, so a caller can always append `/path`
 * and never produce `https://app.example.com//verify-email`. */
function normalizeBaseUrl(
  raw: string,
  mode: RuntimeMode,
  problems: string[],
): { readonly url: URL; readonly origin: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    problems.push(`APP_BASE_URL must be an absolute http(s) URL, received '${raw}'`);
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    problems.push(`APP_BASE_URL must use http or https, received '${parsed.protocol}'`);
    return undefined;
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    problems.push('APP_BASE_URL must not carry a query string or a fragment');
    return undefined;
  }
  if (mode === 'production' && parsed.protocol !== 'https:') {
    // A verification or reset token delivered over plain HTTP is handed to
    // every network hop between here and the user.
    problems.push("APP_BASE_URL must use https in production: an emailed token over http is readable in transit");
    return undefined;
  }
  const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return { url: parsed, origin: `${parsed.origin}${pathname}` };
}

function readOptionalString(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Transactional email configuration.
 *
 * `EMAIL_HOST` and `EMAIL_PORT` are asserted in **every** mode. There is one
 * transport, so a mode that has no destination has nothing to do with mail; a
 * default here would be a default nobody chose, and the local sink's port is
 * an operational fact of the dev orchestrator, not a property of the
 * application (ADR-0024).
 *
 * `EMAIL_USER`, `EMAIL_PASSWORD` and `EMAIL_FROM` are asserted in production
 * only, because a loopback sink may legitimately accept a message from an
 * unauthenticated client — demanding a credential there would be demanding a
 * fake one (§2.2). `APP_BASE_URL` is asserted everywhere: every template
 * carries an absolute link and a relative one is not a link.
 */
function readEmail(
  source: Readonly<Record<string, unknown>>,
  problems: string[],
): EmailConfig | undefined {
  const mode = runtimeModeOf(source);
  if (mode === undefined) {
    problems.push(
      `NODE_ENV must be one of ${RUNTIME_MODES.join(', ')}, received '${String(source['NODE_ENV'])}'`,
    );
    return undefined;
  }
  const isProduction = mode === 'production';
  // Every problem is collected before anything is returned. This module's
  // contract is that a misconfigured checkout is fixed in one pass, and an
  // early return on the first missing key turns that into five round trips —
  // so `complete` is what decides the outcome, not the first failure seen.
  let complete = true;

  const rawBaseUrl = readString(source, 'APP_BASE_URL', problems);
  const baseUrl = rawBaseUrl === undefined ? undefined : normalizeBaseUrl(rawBaseUrl, mode, problems);
  if (baseUrl === undefined) {
    complete = false;
  }

  const host = readString(source, 'EMAIL_HOST', problems);
  const port = readPort(source, 'EMAIL_PORT', problems, undefined);
  if (host === undefined || port === undefined) {
    complete = false;
  }

  // A sink is a local listener. Pointing a production process at one makes every
  // password reset and every address verification fail *silently* for every real
  // user: SMTP's 250 is an acknowledgement, not a delivery.
  if (host !== undefined && isProduction && isNonRoutableSmtpHost(host)) {
    problems.push(
      `EMAIL_HOST must be a routable relay host in production, not '${host}': a local sink accepts a message and never relays it, so SMTP would answer 250 while every password reset and email verification failed silently for every user`,
    );
    complete = false;
  }

  // Credentials: a pair or nothing. Production has no default for either (§2.3).
  let user: string | null = null;
  let password: string | null = null;
  if (isProduction) {
    const productionUser = readString(source, 'EMAIL_USER', problems);
    const productionPassword = readString(source, 'EMAIL_PASSWORD', problems);
    if (productionUser === undefined || productionPassword === undefined) {
      complete = false;
    } else {
      user = productionUser;
      password = productionPassword;
    }
  } else {
    user = readOptionalString(source, 'EMAIL_USER') ?? null;
    password = readOptionalString(source, 'EMAIL_PASSWORD') ?? null;
    if ((user === null) !== (password === null)) {
      problems.push(
        'EMAIL_USER and EMAIL_PASSWORD must be set together: half a credential pair authenticates nobody and looks configured',
      );
      complete = false;
    }
  }

  const rawSecure = readOptionalString(source, 'EMAIL_SECURE');
  const secureIsValid = rawSecure === undefined || /^(true|false|1|0|yes|no)$/i.test(rawSecure);
  if (!secureIsValid) {
    problems.push(`EMAIL_SECURE must be true or false, received '${rawSecure}'`);
    complete = false;
  }

  const rawRejectUnauthorized = readOptionalString(source, 'EMAIL_TLS_REJECT_UNAUTHORIZED');
  const rejectIsValid =
    rawRejectUnauthorized === undefined || /^(true|false|1|0|yes|no)$/i.test(rawRejectUnauthorized);
  if (!rejectIsValid) {
    problems.push(
      `EMAIL_TLS_REJECT_UNAUTHORIZED must be true or false, received '${rawRejectUnauthorized}'`,
    );
    complete = false;
  }
  let rejectUnauthorized = true;
  if (rawRejectUnauthorized !== undefined && rejectIsValid) {
    rejectUnauthorized = /^(true|1|yes)$/i.test(rawRejectUnauthorized);
    if (isProduction && !rejectUnauthorized) {
      problems.push(
        'EMAIL_TLS_REJECT_UNAUTHORIZED must not be false in production: it exists for a local sink with a self-signed certificate, and a relay whose certificate cannot be verified is a relay whose traffic anyone can read',
      );
      complete = false;
    }
  }

  const rawFrom = readOptionalString(source, 'EMAIL_FROM');
  let from = rawFrom;
  if (from === undefined) {
    if (isProduction) {
      problems.push('EMAIL_FROM is required in production but was not set');
      complete = false;
    } else if (baseUrl !== undefined) {
      // The sender domain is the application's own hostname — never
      // `URL.host`, which carries the port and would make `no-reply@host:4000`,
      // which is not an address. No mode invents a sender domain.
      from = `no-reply@${baseUrl.url.hostname}`;
    }
  }
  if (from !== undefined && !isSingleLineAddress(from)) {
    problems.push(`EMAIL_FROM must be a single-line address, received '${from}'`);
    from = undefined;
    complete = false;
  }

  if (
    !complete ||
    baseUrl === undefined ||
    from === undefined ||
    host === undefined ||
    port === undefined
  ) {
    return undefined;
  }

  return {
    appName: readOptionalString(source, 'APP_NAME') ?? baseUrl.url.hostname,
    baseUrl: baseUrl.origin,
    from,
    smtp: {
      host,
      port,
      user,
      password,
      secure: rawSecure === undefined ? port === IMPLICIT_TLS_SMTP_PORT : /^(true|1|yes)$/i.test(rawSecure),
      rejectUnauthorized,
    },
  };
}

export function loadEnvironment(source: Readonly<Record<string, unknown>>): Environment {
  const problems: string[] = [];
  const database = readDatabase(source, problems);
  const jwt = readJwt(source, problems);
  const server = readPort(source, 'PORT', problems, DEFAULT_SERVER_PORT);
  const serverConfig = server === undefined ? undefined : { port: server };
  const authenticator = readAuthenticator(source, problems);
  const security = readSecurity(source, problems);
  const email = readEmail(source, problems);

  if (
    database !== undefined &&
    jwt !== undefined &&
    serverConfig !== undefined &&
    authenticator !== undefined &&
    security !== undefined &&
    email !== undefined
  ) {
    return { database, jwt, server: serverConfig, authenticator, security, email };
  }
  throw new EnvironmentError(problems);
}
