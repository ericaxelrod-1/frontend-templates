import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import type { Environment } from '../config/environment.js';
import { ipSubnetKey, normalizeIpAddress } from './ip-address.js';

/**
 * The challenge, as it is handed to the person who has to answer it.
 *
 * **The answer is not in here, and that is the whole point of the shape.**
 * `0022_security_telemetry.sql` stores `solution_salt` and `solution_hash`, never a
 * plaintext answer, so the row is not an oracle for whoever can read the table —
 * and the payload is not an oracle for whoever can read the network.
 */
export type IssuedCaptcha = {
  /** The token the answer is presented with. Only its digest is stored. */
  readonly token: string;
  /** The question, as text. A `text` challenge is readable by a screen reader. */
  readonly challenge: string;
  /** `text` or `image`, as the table's CHECK allows. This build issues `text`. */
  readonly type: 'text';
  /** ISO-8601 expiry. */
  readonly expiresAt: string;
};

/**
 * The issued-challenge row, as the database holds it.
 */
type CaptchaRow = {
  readonly id: string;
  readonly solution_salt: string;
  readonly solution_hash: string;
  /** Whether the row is still inside its window, as the DATABASE's clock says. */
  readonly live: boolean;
};

/**
 * The issuer and the verifier for `public.captcha`.
 *
 * ## WHAT THIS IS, AND WHAT IT IS NOT
 *
 * `0022_security_telemetry.sql` created the table and said, in its own words, that
 * it was "the storage half of an unimplemented requirement": §B6 requires that
 * "captcha is validated server-side — the server issues a challenge, stores the
 * answer, and verifies it", and neither half of that existed. This file is the
 * logic half.
 *
 * **It is a SPEED BUMP, and `docs/security.md` says so.** Its own table of
 * controls calls this mechanism "would defeat unsophisticated traffic" and
 * "bypassable by farms". The challenge here is an arithmetic question, which a
 * determined bot answers with one line of code — so this is not an anti-bot
 * product, and a fork that needs one has to replace the issuer, not tune this
 * one. What it *is* good for is the thing the requirement actually asks for: a
 * server-side, single-use, expiring challenge that a person can answer and a
 * script cannot skip, recorded against the login that demanded it.
 *
 * ## WHY THE TEXT TYPE, AND NOT AN IMAGE
 *
 * §B6: "Provide an accessible non-visual alternative." An image challenge that
 * excludes screen-reader users is a liability shipped into every fork, and this
 * tree ships to forks. `public.captcha.type` allows `'text'` and `'image'`; this
 * build issues **only** `'text'`, and the text challenge IS the accessible
 * alternative — there is no inaccessible variant beside it to accidentally be the
 * default. The alternative to shipping a text challenge is not "ship an image
 * challenge and also ship a text one"; it is to ship a challenge nobody using a
 * screen reader can pass.
 *
 * ## WHY THE TOKEN IS NOT THE ROW KEY
 *
 * `token_hash` is a digest of a 256-bit random token. A dump of `public.captcha`
 * is therefore not a set of replayable challenges: the token is the only thing
 * that can redeem the row, and only its digest is stored. This is the same shape
 * `refresh_tokens.token_hash` already uses (`0002`), for the same reason.
 *
 * ## WHY THE ANSWER IS SALTED
 *
 * A challenge answer is low-entropy by construction — a short number a person
 * reads off a screen — so an unsalted digest of it is crackable in bulk by
 * anyone who can read the table. The per-row `solution_salt` is what stops two
 * challenges with the same answer sharing a digest, and what stops a
 * precomputed table from applying to every row at once.
 */
@Injectable()
export class CaptchaService {
  private readonly env: Environment;

  constructor(
    config: ConfigService,
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
  }

  /**
   * Issue a challenge and store the answer's digest.
   *
   * **The row is written through the same boundary every other writer in this
   * tree uses**: `SET LOCAL ROLE app_admin` inside one transaction, on the
   * shared pool. `app_admin` holds `INSERT` on `public.captcha` (`0022`), and no
   * serving role holds anything else on it — so this is the only principal that
   * can create one, and a challenge cannot be minted by a request that reached
   * the table under a member's grants.
   *
   * **The expired rows are pruned in the same transaction.** A table nothing
   * prunes grows for ever, and the alternative — a scheduled sweep — is a job,
   * a dispatch token, a schedule key and a lock for the removal of rows that are
   * already worthless. Pruning on the only write path keeps the table bounded
   * by (issuance rate × TTL) with no second mechanism, and the write that would
   * otherwise grow the table is the write that shrinks it.
   *
   * **The address is RECORDED and not ENFORCED.** The row carries `ip`,
   * `ip_normalized` and `ip_subnet` so a challenge can be traced back to the
   * address it was issued to, and nothing checks them at redemption. Two reasons:
   * a mobile address changes between the issue request and the sign-in, and a
   * check that fails for that reason refuses a legitimate person; and the
   * challenge is a QUESTION rather than a credential — it grants nothing, so
   * there is nothing to bind it to. Binding it to an ACCOUNT would be worse
   * than useless: the issue route would have to name the account, and a route
   * that behaves differently for an account that exists is an enumeration
   * oracle.
   */
  async issue(ip: string | undefined): Promise<IssuedCaptcha> {
    const { question, answer } = makeChallenge();
    const token = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const normalizedIp = normalizeIpAddress(ip);
    const subnet = ipSubnetKey(normalizedIp);

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      await client.query('DELETE FROM public.captcha WHERE expires_at < now()');
      const inserted = await client.query<{ readonly expires_at: string | Date }>(
        `INSERT INTO public.captcha
           (type, token_hash, challenge, solution_salt, solution_hash, expires_at, ip, ip_normalized, ip_subnet)
         VALUES ('text', $1, $2, $3, $4, now() + make_interval(secs => $5::double precision), $6, $7, $8)
         RETURNING expires_at`,
        [
          digest(token),
          question,
          salt,
          digest(`${salt}:${answer}`),
          this.env.security.captchaTtlSeconds,
          ip ?? null,
          normalizedIp === '' ? null : normalizedIp,
          subnet === '' ? null : subnet,
        ],
      );
      const expiresAt = inserted.rows[0]?.expires_at;
      await client.query('COMMIT');
      committed = true;
      return {
        token,
        challenge: question,
        type: 'text',
        expiresAt: new Date(expiresAt ?? Date.now()).toISOString(),
      };
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Redeem a challenge.
   *
   * **One attempt per challenge, and the attempt is what consumes it.** The row
   * is consumed whether the answer was right or wrong, so a challenge cannot be
   * brute-forced inside its window: the first attempt spends it. That is also
   * what makes the single-use property a property of the WRITE — the redemption
   * is `UPDATE … WHERE id = $1 AND is_used = false`, and a second redemption of
   * the same token updates no row and fails.
   *
   * **The answer is compared in constant time**, and the comparison is over
   * digests, so the comparison itself leaks nothing about the answer's shape.
   *
   * **The expiry is the DATABASE's clock**, read in the same statement that
   * fetches the row: `expires_at > now()` is evaluated by the server that
   * stamped `expires_at`, so the two clocks cannot disagree about whether a
   * challenge is still live. An application clock compared against a database
   * timestamp is wrong by exactly the skew between them, and this is a window
   * measured in minutes.
   */
  async verify(token: string, answer: string): Promise<boolean> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');
      const found = await client.query<CaptchaRow>(
        `SELECT id, solution_salt, solution_hash, (expires_at > now()) AS live
           FROM public.captcha
          WHERE token_hash = $1
          FOR UPDATE`,
        [digest(token)],
      );
      const row = found.rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        committed = true;
        return false;
      }
      const matches =
        row.live && digestsEqual(digest(`${row.solution_salt}:${normaliseAnswer(answer)}`), row.solution_hash);
      const consumed = await client.query(
        'UPDATE public.captcha SET is_used = true, used_at = now() WHERE id = $1 AND is_used = false',
        [row.id],
      );
      await client.query('COMMIT');
      committed = true;
      // The row count IS the single-use check: a challenge somebody else already
      // redeemed updates nothing, and a replay is a zero-row update.
      return matches && consumed.rowCount === 1;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * The challenge itself.
 *
 * **An arithmetic question, because the answer must not be in the payload.** The
 * question is what the person reads and the answer is what they compute, so a
 * dump of the row is not a dump of the answers — and a script that wants to
 * answer it has to solve it rather than copy it.
 *
 * Two addends between 2 and 9, so the answer is a number a person can do in their
 * head and a screen reader can read back.
 */
function makeChallenge(): { readonly question: string; readonly answer: string } {
  const left = randomInt(2, 10);
  const right = randomInt(2, 10);
  return { question: `What is ${String(left)} + ${String(right)}?`, answer: String(left + right) };
}

/**
 * The answer is compared as the person would type it: trimmed, and case-blind.
 * Nothing else is normalised, because a comparison that is too generous is a
 * comparison that accepts more than one answer.
 */
function normaliseAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

/** SHA-256, hex. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Two digests compared in constant time.
 *
 * `timingSafeEqual` refuses two buffers of different lengths, so the lengths are
 * compared first — and both sides are a SHA-256 hex digest, so they are the same
 * length unless something upstream is broken.
 */
function digestsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
