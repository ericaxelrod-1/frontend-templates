import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startSmtpSink, type SmtpSink } from '../../scripts/smtp-sink.js';
import { restoreAuthenticatorPassword } from '../support/cluster.js';
import { BACKEND_ROOT } from '../support/paths.js';
import {
  PROOF_AUTHENTICATOR_PASSWORD,
  PROOF_JWT_SECRET,
  authenticatorClient,
  baseUrl,
  dropProofDatabase,
  ownerClient,
  proofDatabase,
  queryAsSuperuser,
  rebuildDatabase,
  startPostgrest,
} from './support/fixture.js';
import { mintToken } from './support/jwt.js';

/**
 * Erasure is cross-subject or it is not an erasure.
 *
 * ## WHAT THIS SUITE IS
 *
 * `POST /privacy/erase` is mounted (`PrivacyController.erase`, dispatch token
 * `privacy.erase`), `ErasureService` anonymises an account, and `0021`'s
 * `authz.record_erasure_audit` writes the statutory record. `erasure-cross-user.
 * e2e-spec.ts` proves the erasure through the SERVICE and says out loud that it
 * cannot make an HTTP request, so it has no case at the trust boundary — "when
 * `privacy.submit` exists, this file gains a case that presents A's token and
 * asserts it cannot reach B's row at all". This file is that case: the mounted
 * route, a real bearer token through the real `JwtAuthGuard`, and the target
 * account's rows read back out of PostgreSQL afterwards.
 *
 * ## WHY THE FIXTURE IS THE SHARED ONE AND NOT A LOCAL `recreateDatabase`
 *
 * `rebuildDatabase()` (`test/rls/support/fixture.ts`) is the only place that
 * creates the proof database, applies `database/bootstrap/001_roles.sql` and sets
 * `pgrst_authenticator`'s LOGIN password — and `ALTER ROLE … PASSWORD` is
 * CLUSTER-scoped, so a local copy that drops the database without restoring the
 * role leaves `app_dev` unable to authenticate at all
 * (`restoreAuthenticatorPassword()` in `test/support/cluster.ts` is the undo, and
 * `afterAll` here calls it in a `finally`). A suite that reimplements this is a
 * suite that can take the machine with it. The other half of the reason is
 * simpler: `0001_rls_foundation.sql` alone builds no `users` table, so the
 * erasure cannot run until `database/seed.ts` has applied `0002`–`0021` — which
 * is why this file provisions through the seed, exactly as `identity-seam.spec.ts`
 * does, rather than hand-feeding SQL at `psql`.
 *
 * ## WHICH POSTGREST THE APPLICATION UNDER TEST IS POINTED AT
 *
 * The proof's OWN instance, started by the shared fixture's `startPostgrest()` on
 * its own port over `rls_proof` and signing with `PROOF_JWT_SECRET` — the route
 * `identity-seam.spec.ts` and `rls.spec.ts` both take, and the reason the one
 * `POSTGREST_URL` override in `beforeAll` exists. The configured value is
 * `.env.test`'s `http://127.0.0.1:3001`: a different PostgREST, over a different
 * database (`app_dev`), which nothing in this suite starts and which may not be
 * running at all. The app therefore reads the fixture's URL, and the first case
 * asserts the booted application resolved that rather than trusting the
 * assignment — a suite whose PostgREST-backed paths address a foreign server is
 * asserting rows nobody in the file created.
 *
 * ## WHERE THE CONTROL ACTUALLY IS, AND WHY IT IS NOT A POLICY
 *
 * The subject is `req.user.sub` — the claim `JwtAuthGuard` read out of the
 * verified token — and `PrivacyController.erase` takes no other subject from
 * anywhere: no DTO, no path parameter, no query parameter. That is the whole
 * cross-subject control, and it is an application boundary on purpose.
 *
 * **The database cannot enforce it on this connection, and the measurement is
 * short.** `ErasureService` writes over `pg` under `SET LOCAL ROLE app_admin`,
 * which carries no `request.jwt.claims`, so inside that transaction
 * `authz.actor()` is NULL and `users_update` — `USING (current_user =
 * 'app_admin')`, the whole of it (`0008:421`) — admits every row in the table.
 * Three candidate database-side controls each fail for a reason that is a
 * decision rather than an inconvenience, and all three are measured in place on
 * `CLOSE_OPEN_REQUESTS_SQL` (`src/privacy/erasure.service.ts`):
 *
 *   - `current_user = 'app_admin'` OR'd into `privacy_request_read` — measured:
 *     a claimless admin reads 7 of 7 requests across every group.
 *   - a narrow `SECURITY DEFINER` seam — measured: updates ZERO rows, because
 *     `current_user` rebinds to the owner inside a DEFINER body and
 *     `privacy_requests` is `FORCE ROW LEVEL SECURITY`.
 *   - the identity seam itself (`PostgrestClient` with the caller's verified
 *     token, proven in `identity-seam.spec.ts`) — this WORKS for the request
 *     closure, and it is the fix for case 3 below. It cannot carry the `users`
 *     UPDATE, because `app_member` holds no write verb on `users` and granting
 *     one is a much larger decision than this suite may make on its own.
 *
 * So case 1 asserts the boundary control AND the target's byte-identical rows,
 * and case 3 records the one statement in the erasure that provably does
 * nothing. Both are reported rather than papered over.
 *
 * ## WHAT IS ASSERTED, AND ON WHAT
 *
 * Every assertion is on a ROW the database holds afterwards, read through the
 * cluster superuser. `authz.actor()` is NULL in a superuser read too, so a
 * `claimless` read is not a way to see through the policies — and the refusal
 * that matters is proven by an UNFILTERED count, never a status code (§B8).
 */

const TIMEOUT = 300_000;

/**
 * The pepper this suite signs with, distinct from `.env.test`'s.
 *
 * A suite that asserted against the configured pepper could not tell a real
 * `subject_hmac` from a coincidence; naming the key it installed is what lets
 * case 4 recompute the digest and compare it byte for byte.
 */
const PEPPER = 'erasure-identity-suite-pepper-key-0123456789';
const PEPPER_KID = 'erasure-identity-v1';
const TOMBSTONE_DOMAIN = 'tombstone.erasure-identity.test';

/**
 * One subject per case, and that is not tidiness.
 *
 * The erasure is idempotent by design: a second call on an anonymised account
 * returns at the first branch and issues no statement at all. Run every case
 * against one account in declaration order and every case after the first is
 * measuring a no-op — "the request was closed" observes nothing, "the record was
 * written" counts a row an earlier case wrote. A control measured against a
 * fixture that was never there cannot fail, so each case plants its own.
 */
const CALLER = 'bbbbbbbb-0000-0000-0000-000000000001';
const VICTIM = 'bbbbbbbb-0000-0000-0000-000000000002';
const SELF = 'bbbbbbbb-0000-0000-0000-000000000003';
const OPEN_REQUEST_SUBJECT = 'bbbbbbbb-0000-0000-0000-000000000004';
const AUDIT_SUBJECT = 'bbbbbbbb-0000-0000-0000-000000000005';
const RETRY_SUBJECT = 'bbbbbbbb-0000-0000-0000-000000000006';

const OPEN_REQUEST = 'cccccccc-0000-0000-0000-000000000001';

/**
 * A syntactically valid bcrypt string that verifies nothing.
 *
 * The erasure overwrites `password_hash` with a real hash of its own, so the
 * planted value and the replacement have to be distinguishable — and the planted
 * one doubles as the fingerprint that proves an untouched account kept the
 * credential it came with.
 */
const PLANTED_HASH = '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUV';

type UserRow = {
  readonly username: string;
  readonly email: string;
  readonly password_hash: string;
  readonly deleted_at: string | null;
  readonly deletion_reason: string | null;
  readonly email_anonymized: boolean;
};

type RequestRow = {
  readonly id: string;
  readonly request_key: string;
  readonly user_id: string;
  readonly status: string;
  readonly closed_at: string | null;
};

type AuditRow = {
  readonly request_key: string;
  readonly event_type: string;
  readonly response_nature: string | null;
  readonly subject_hmac: string;
  readonly pepper_kid: string;
  readonly subject_user_id: string | null;
};

/**
 * The REAL provision path — bootstrap, then migrations, then reference data, in
 * that order (`database/seed.ts`). This suite deliberately does not apply
 * migrations itself: `rebuildDatabase()` has already applied `0001` (twice,
 * because the fixture holds it to being idempotent) and `scripts/migrate.ts`
 * owns the `migrations` table, so hand-feeding the files through `psql` first
 * would make the migrator re-apply schema the database already has.
 */
function runSeed(): void {
  const result = spawnSync('node', ['--experimental-strip-types', 'database/seed.ts'], {
    cwd: BACKEND_ROOT,
    env: {
      ...process.env,
      DB_NAME: proofDatabase(),
      SEED_ADMIN_PASSWORD: 'erasure-identity-admin-password',
      // The proof's own value, so the authenticator the seed configures is the
      // one `rebuildDatabase()` installed. `restoreAuthenticatorPassword()` puts
      // the configured one back in `afterAll`.
      SEED_AUTHENTICATOR_PASSWORD: PROOF_AUTHENTICATOR_PASSWORD,
    },
    encoding: 'utf8',
    timeout: TIMEOUT,
  });
  if (result.status !== 0) {
    throw new Error(`seed failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}

/** First row of `sql`, or `undefined` when it matched nothing. */
function first<T>(sql: string): T | undefined {
  return queryAsSuperuser<T>(sql)[0];
}

/** `count(*)` of `sql` — `-1` on a failure, so a broken query is never read as zero. */
function count(sql: string): number {
  return first<{ readonly n: number }>(sql)?.n ?? -1;
}

/**
 * The whole `users` row as one comparable string.
 *
 * `to_jsonb` over the entire row rather than a hand-picked column list, because
 * "byte-identical" is the claim and a column list is a list of the columns
 * somebody remembered. A column added by a later migration is covered here
 * without touching this file.
 */
function userFingerprint(id: string): string {
  const row = first<{ readonly row: unknown }>(
    `SELECT to_jsonb(u) AS row FROM public.users u WHERE u.id = '${id}'::uuid`,
  );
  if (row === undefined) {
    throw new Error(`no users row for ${id}, so there is nothing to fingerprint`);
  }
  return JSON.stringify(row.row);
}

function readUser(id: string): UserRow | undefined {
  return first<UserRow>(
    `SELECT username, email, password_hash, deleted_at::text, deletion_reason, email_anonymized
       FROM public.users WHERE id = '${id}'::uuid`,
  );
}

function readRequest(id: string): RequestRow | undefined {
  return first<RequestRow>(
    `SELECT id, request_key, user_id, status, closed_at::text
       FROM public.privacy_requests WHERE id = '${id}'::uuid`,
  );
}

/** Every audit row naming `subjectId`, oldest first. UNFILTERED on the subject, never on the event. */
function auditRowsFor(subjectId: string): readonly AuditRow[] {
  return queryAsSuperuser<AuditRow>(
    `SELECT request_key, event_type, response_nature,
            encode(subject_hmac, 'hex') AS subject_hmac,
            pepper_kid, subject_user_id
       FROM public.privacy_request_audits
      WHERE subject_user_id = '${subjectId}'::uuid
      ORDER BY created_at`,
  );
}

/**
 * Plants an account, and — where the case needs it — the role and group rows the
 * erasure's choke point is supposed to remove.
 *
 * Two connections, and the split is `fixture.seed()`'s rather than this file's
 * invention. `user_roles` carries `assert_grant_subset`'s BEFORE trigger
 * (`0004`), which refuses a write that carries no caller identity and is not the
 * superset principal — so it goes through `SET LOCAL ROLE app_admin`, which is
 * the superset principal. `user_groups` has no INSERT grant for any serving role
 * (`0001:1009-1019`), so membership is written by the owner. Planting either
 * through the other connection fails the database, not the assertion.
 *
 * The values are this file's own constants rather than caller input, so
 * interpolating them into SQL is not an injection surface.
 */
async function plantSubject(id: string, username: string, withAuthority: boolean): Promise<void> {
  const admin = authenticatorClient();
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE app_admin');
    await admin.query(
      `INSERT INTO public.users (id, username, email, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [id, username, `${username}@example.test`, PLANTED_HASH],
    );
    if (withAuthority) {
      const role = first<{ readonly id: string }>(`SELECT id FROM public.roles WHERE name = 'member'`);
      if (role === undefined) {
        throw new Error('the seed did not create the member role this suite reads back');
      }
      await admin.query('INSERT INTO public.user_roles (user_id, role_id) VALUES ($1, $2)', [id, role.id]);
    }
    await admin.query('COMMIT');
  } finally {
    await admin.end();
  }

  if (!withAuthority) {
    return;
  }

  const group = first<{ readonly id: string }>(`SELECT id FROM public.groups WHERE name = 'EU'`);
  if (group === undefined) {
    throw new Error('the seed did not create the EU group this suite reads back');
  }
  const owner = ownerClient();
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query('INSERT INTO public.user_groups (user_id, group_id) VALUES ($1, $2)', [id, group.id]);
    await owner.query('COMMIT');
  } finally {
    await owner.end();
  }
}

/**
 * Plants an open data-subject request for `userId`.
 *
 * `app_admin` may INSERT it (`privacy_request_create`'s operator branch) and may
 * not READ it back — the read policy needs an actor — so the assertions read it
 * through the superuser.
 */
async function plantOpenRequest(id: string, userId: string): Promise<void> {
  const admin = authenticatorClient();
  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE app_admin');
    await admin.query(
      `INSERT INTO public.privacy_requests (id, user_id, request_nature, request_channel, status)
       VALUES ($1, $2, 'deletion', 'in_app', 'open')`,
      [id, userId],
    );
    await admin.query('COMMIT');
  } finally {
    await admin.end();
  }
}

/** How many rows a subject still holds in `user_groups` and `user_roles` — total, not filtered. */
function authorityOf(userId: string): { readonly groups: number; readonly roles: number } {
  return {
    groups: count(`SELECT count(*)::int AS n FROM public.user_groups WHERE user_id = '${userId}'::uuid`),
    roles: count(`SELECT count(*)::int AS n FROM public.user_roles WHERE user_id = '${userId}'::uuid`),
  };
}

function callerToken(sub: string): string {
  return mintToken(PROOF_JWT_SECRET, {
    sub,
    role: 'app_member',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

interface EraseResponseBody {
  readonly userId: string;
  readonly alreadyErased: boolean;
  readonly tombstoneAddress: string;
  readonly anonymizedAt: string | null;
  readonly pepperKid: string;
}

/**
 * Presents a caller's token to the mounted route.
 *
 * `app.inject`, not `supertest`: it is the same adapter, the same pipes and the
 * same global `JwtAuthGuard` registration the process runs with, with no socket
 * in between.
 */
async function eraseAs(sub: string, payload?: Record<string, unknown>): Promise<{
  readonly status: number;
  readonly body: EraseResponseBody;
}> {
  const response = await thinApp().inject({
    method: 'POST',
    url: '/privacy/erase',
    headers: { authorization: `Bearer ${callerToken(sub)}` },
    payload: payload ?? {},
  });
  return {
    status: response.statusCode,
    body: response.json<EraseResponseBody>(),
  };
}

let moduleRef: TestingModule | undefined;
let app: NestFastifyApplication | undefined;
let sink: SmtpSink | undefined;
let stopPostgrest: (() => void) | undefined;
/** What the booted application's own `PostgrestClient` resolved, read back for the control. */
let postgrestBaseUrl: string | undefined;

/** The booted thin app, or a loud failure. `beforeAll` always runs first; this exists so the type is not `| undefined`. */
function thinApp(): NestFastifyApplication {
  if (app === undefined) {
    throw new Error('the thin app was never booted, so this suite has no subject');
  }
  return app;
}

beforeAll(async () => {
  rebuildDatabase();
  runSeed();

  await plantSubject(CALLER, 'erasure-caller', true);
  await plantSubject(VICTIM, 'erasure-victim', true);
  await plantSubject(SELF, 'erasure-self', true);
  await plantSubject(OPEN_REQUEST_SUBJECT, 'erasure-open-request', false);
  await plantSubject(AUDIT_SUBJECT, 'erasure-audit', false);
  await plantSubject(RETRY_SUBJECT, 'erasure-retry', false);
  await plantOpenRequest(OPEN_REQUEST, OPEN_REQUEST_SUBJECT);

  // The proof's own PostgREST, on the shared fixture's port, serving `rls_proof`
  // with the proof secret. Started here, before the application is booted, because
  // the app resolves its PostgREST origin while its module graph is evaluated — and
  // stopped in `afterAll` before the database it serves is dropped.
  const running = await startPostgrest();
  stopPostgrest = running.stop;

  // The receipt crosses a real transport and `ErasureService` refuses to
  // anonymise anybody it could not reach, so the suite points the application at
  // an in-process sink rather than asserting around a failed send.
  sink = await startSmtpSink({ port: 0 });

  // Set BEFORE the dynamic import: `load-env-file.js` loads `.env.test` for
  // NODE_ENV=test and a variable already in the real environment wins, so these
  // are the values the application actually boots with. Everything not listed
  // here is the configured `.env.test` value, unchanged — except `POSTGREST_URL`,
  // which is the fixture's own instance rather than the configured 3001, so the
  // graph under test addresses `rls_proof` and not `app_dev`.
  process.env['DB_NAME'] = proofDatabase();
  process.env['JWT_SECRET'] = PROOF_JWT_SECRET;
  process.env['PGRST_JWT_SECRET'] = PROOF_JWT_SECRET;
  process.env['AUTHENTICATOR_PASSWORD'] = PROOF_AUTHENTICATOR_PASSWORD;
  process.env['POSTGREST_URL'] = baseUrl();
  process.env['PRIVACY_HMAC_PEPPER'] = PEPPER;
  process.env['PRIVACY_HMAC_PEPPER_KID'] = PEPPER_KID;
  process.env['PRIVACY_TOMBSTONE_DOMAIN'] = TOMBSTONE_DOMAIN;
  process.env['EMAIL_HOST'] = sink.host;
  process.env['EMAIL_PORT'] = String(sink.port);

  // The reset and the dynamic import are required, not tidiness. Importing
  // `AppModule` at module scope would evaluate `erasure.module.ts` — and so read
  // `PRIVACY_*` — BEFORE the lines above ran, and the container would then be
  // built against a different erasure key than the one the assertions recompute.
  vi.resetModules();
  const { AppModule } = await import('../../src/app.module.js');
  // Same registry as `AppModule`, deliberately: a static import of the class would
  // be a different object after `vi.resetModules()`, so `moduleRef.get` would be
  // asking for a provider token the graph does not hold.
  const { PostgrestClient: ProofPostgrestClient } = await import('../../src/postgrest/postgrest-client.js');

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  postgrestBaseUrl = moduleRef.get(ProofPostgrestClient).baseUrl;
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // The global pipe from `main.ts`, so a body the route does not bind is refused
  // by the same rule production applies rather than by luck.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, TIMEOUT);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    try {
      await moduleRef?.close();
    } finally {
      try {
        await sink?.close();
      } finally {
        try {
          // Before the database it serves is dropped, and before the password it
          // logs in with is restored — the same order `rls.spec.ts` tears down in.
          stopPostgrest?.();
        } finally {
          try {
            dropProofDatabase();
          } finally {
            // CLUSTER-scoped: `rebuildDatabase()` and `database/seed.ts` both
            // rewrote `pgrst_authenticator`'s password, and this is the one undo.
            restoreAuthenticatorPassword();
          }
        }
      }
    }
  }
}, TIMEOUT);

describe('erasure is cross-subject: one account cannot reach another through the mounted route', () => {
  it('the booted application reaches this suite\'s own PostgREST, so no row below can come from a server this file did not start', () => {
    // The control for the wiring every other case in this file rests on. Left on
    // `.env.test`'s `http://127.0.0.1:3001` the graph under test would address the
    // developer's own PostgREST over `app_dev` — a different database — while the
    // assertions below read `rls_proof` through the superuser.
    expect(postgrestBaseUrl).toBe(baseUrl());
  });

  it(
    'a logged-in caller naming another subject in the body erases ITSELF, and the named account is byte-identical afterwards',
    async () => {
      // The fixture, asserted BEFORE the request: "nothing changed" is worth
      // nothing when the subject had nothing to change.
      expect(userFingerprint(VICTIM)).toContain('erasure-victim@example.test');
      expect(authorityOf(VICTIM)).toEqual({ groups: 1, roles: 1 });

      const before = userFingerprint(VICTIM);

      const response = await eraseAs(CALLER, { subjectId: VICTIM });

      // The route resolved the subject from the verified token and from nowhere
      // else — so the erasure that ran was the CALLER's own, and the response
      // names the caller rather than the account it was asked to reach.
      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(CALLER);

      // THE ASSERTION. Not "the service returned an error" and not "the request
      // was rejected": the named account's whole row, every column including
      // `password_hash`, `deleted_at` and `created_at`, is unchanged.
      expect(userFingerprint(VICTIM)).toBe(before);

      // …and the four other things an erasure touches, read as UNFILTERED counts
      // over the victim's own rows. A filtered count cannot tell "nothing was
      // erased" from "I can see nothing", which is what makes a denial assertion
      // vacuous (§B8).
      expect(authorityOf(VICTIM)).toEqual({ groups: 1, roles: 1 });
      expect(count(`SELECT count(*)::int AS n FROM public.privacy_requests WHERE user_id = '${VICTIM}'::uuid`)).toBe(0);
      expect(auditRowsFor(VICTIM)).toHaveLength(0);

      // The positive control INSIDE this case: the request did real work, and it
      // did it to the caller. Without this the assertions above would also be
      // satisfied by a route that refuses everybody, which is the failure mode
      // §B8 names.
      expect(readUser(CALLER)?.email_anonymized).toBe(true);
      expect(auditRowsFor(CALLER)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'a logged-in caller CAN erase their own account, so the refusal above is a boundary and not a lockout',
    async () => {
      expect(authorityOf(SELF)).toEqual({ groups: 1, roles: 1 });
      const before = userFingerprint(SELF);

      const response = await eraseAs(SELF);

      expect(response.status).toBe(200);
      expect(response.body.userId).toBe(SELF);
      expect(response.body.alreadyErased).toBe(false);
      expect(response.body.pepperKid).toBe(PEPPER_KID);
      expect(response.body.tombstoneAddress.endsWith(`@${TOMBSTONE_DOMAIN}`)).toBe(true);

      // The account really changed, and in every way that matters: the address
      // is a tombstone nobody can receive mail at, the username is no longer a
      // name, and the old password is gone — a tombstone that still verifies a
      // password is not an erasure.
      expect(userFingerprint(SELF)).not.toBe(before);
      const erased = readUser(SELF);
      expect(erased?.email_anonymized).toBe(true);
      expect(erased?.deletion_reason).toBe('rtbf');
      expect(erased?.deleted_at).not.toBeNull();
      expect(erased?.username).not.toBe('erasure-self');
      expect(erased?.password_hash).not.toBe(PLANTED_HASH);

      // The receipt went to the address that was still LIVE, and never to the
      // tombstone that replaced it. If the two were the same value this ordering
      // would be unobservable, so the comparison is the assertion.
      expect(sink?.deliveries.length ?? 0).toBeGreaterThan(0);
      const recipients = (sink?.deliveries ?? []).flatMap((delivery) => delivery.recipients);
      expect(recipients).toContain('erasure-self@example.test');
      expect(recipients).not.toContain(response.body.tombstoneAddress);

      // `authz.revoke_subject_authority()` (0009) fired rather than merely
      // existing: the rows the tombstone's authority resolved from are gone.
      expect(authorityOf(SELF)).toEqual({ groups: 0, roles: 0 });
    },
    TIMEOUT,
  );

  it(
    'the erasure fabricates no discharge for the request it did not close: the request stays open and no audit event claims it',
    async () => {
      const planted = readRequest(OPEN_REQUEST);
      expect(planted?.status).toBe('open');

      const response = await eraseAs(OPEN_REQUEST_SUBJECT);
      expect(response.status).toBe(200);

      // GAP A, MEASURED, AND NOT CLOSED BY THIS SUITE.
      //
      // `CLOSE_OPEN_REQUESTS_SQL` matches ZERO rows on this connection and always
      // has: the erasure writes under `SET LOCAL ROLE app_admin` with no claims
      // GUC, so `authz.actor()` is NULL, `authz.can_read_privacy_request()`
      // answers false, and PostgreSQL ANDs `privacy_request_read` into the
      // UPDATE's scan filter. Verified on this suite's own database before it was
      // written — `EXPLAIN` of the statement shows the read policy's conjunct in
      // the `Filter:` and `authz.can_read_privacy_request()` as a `One-Time
      // Filter` — and asserted as a live value by "a claimless app_admin session
      // reads ZERO requests and closes none" in `test/rls/privacy-requests.spec.ts`.
      // The fix is the identity seam (`src/privacy/privacy.controller.ts`): with
      // the caller's verified token replayed through `PostgrestClient`,
      // `privacy_request_update` admits the subject's own row. That is a
      // production change to the erasure's transaction, not a test change, and
      // this file reports the gap rather than asserting it as a requirement.
      const after = readRequest(OPEN_REQUEST);
      expect(after?.status).toBe('open');
      expect(after?.closed_at).toBeNull();

      // The half that IS a control, and the reason the assertion above is worth
      // reading rather than skipping: 11 CCR §7101(b) completeness is a property
      // of the RECORD, and a record that claims a discharge the erasure did not
      // perform is worse than no record. `authz.record_erasure_audit` is called
      // with three arguments, so `p_request_key` defaults to NULL and the row
      // gets a fresh `uuidv7()` — it is not bound to the request that is still
      // open. Had the erasure bound it, this case would be red: a statutory
      // event answering a request whose working copy still says `open`.
      expect(auditRowsFor(OPEN_REQUEST_SUBJECT).map((row) => row.request_key)).not.toContain(
        planted?.request_key,
      );
    },
    TIMEOUT,
  );

  it(
    'the statutory record is written on erasure and carries the subject digest and the key id that signed it',
    async () => {
      const response = await eraseAs(AUDIT_SUBJECT);
      expect(response.status).toBe(200);

      const rows = auditRowsFor(AUDIT_SUBJECT);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.event_type).toBe('responded');
      expect(row?.response_nature).toBe('fulfilled');

      // `subject_hmac` is `HMAC(PRIVACY_HMAC_PEPPER, users.id)` computed
      // application-side — the pepper is never sent to PostgreSQL — so the only
      // way to assert it is to recompute it with the key this suite installed.
      // Asserting merely "not null" would be satisfied by any 32 bytes.
      expect(row?.subject_hmac).toBe(
        createHmac('sha256', PEPPER).update(AUDIT_SUBJECT).digest('hex'),
      );

      // The kid is what survives a pepper rotation: without it every historical
      // row becomes unverifiable the moment the key changes.
      expect(row?.pepper_kid).toBe(PEPPER_KID);
      expect(response.body.pepperKid).toBe(PEPPER_KID);

      // The record outlives the subject's row and carries the digest, not the
      // id — the whole reason `privacy_request_audits.subject_hmac` exists. The
      // `subject_user_id` column is NULLABLE convenience for the window in
      // which the row still exists, and it is written here only because the
      // erasure is running while the subject is still there.
      expect(row?.subject_user_id).toBe(AUDIT_SUBJECT);
      expect(readUser(AUDIT_SUBJECT)?.email_anonymized).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'a retried erasure is a no-op: the same tombstone, the same instant, and no second compliance record',
    async () => {
      const first = await eraseAs(RETRY_SUBJECT);
      expect(first.status).toBe(200);
      expect(first.body.alreadyErased).toBe(false);

      const afterFirst = readUser(RETRY_SUBJECT);
      expect(afterFirst?.email_anonymized).toBe(true);

      const second = await eraseAs(RETRY_SUBJECT);
      expect(second.status).toBe(200);
      expect(second.body.alreadyErased).toBe(true);
      expect(second.body.tombstoneAddress).toBe(first.body.tombstoneAddress);
      expect(second.body.anonymizedAt).toBe(first.body.anonymizedAt);

      // The rows are unchanged, not merely "still anonymised": the idempotency
      // guard is `AND deleted_at IS NULL` in the WHERE clause, so a second run
      // matches zero rows and cannot rewrite the address a second time.
      const afterSecond = readUser(RETRY_SUBJECT);
      expect(afterSecond?.email).toBe(afterFirst?.email);
      expect(afterSecond?.username).toBe(afterFirst?.username);
      expect(afterSecond?.deleted_at).toBe(afterFirst?.deleted_at);

      // …and the statutory record is written ONCE. A retry that appended a second
      // `responded`/`fulfilled` row would report two discharges of one erasure,
      // which is precisely the duplicate a compliance file must not contain.
      expect(auditRowsFor(RETRY_SUBJECT)).toHaveLength(1);

      // And no second receipt: the idempotency branch returns before the
      // transport is touched, so the outbox holds one message for this subject.
      const recipients = (sink?.deliveries ?? []).flatMap((delivery) => delivery.recipients);
      expect(recipients.filter((recipient) => recipient === 'erasure-retry@example.test')).toHaveLength(1);
    },
    TIMEOUT,
  );
});
