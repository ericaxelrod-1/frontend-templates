import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { DatabaseConnectionSource } from '../common/database-pool.js';
import { SharedDatabasePool } from '../common/database-pool.js';
import {
  contentClassFor,
  type EmailContentClass,
} from './email-content-class.js';

/**
 * One row per email attempt, in `email_messages`.
 *
 * `email_messages` is the FOURTH scoping category (ADR-0025): it has no
 * `group_id`, and a row's visibility is resolved through the RECIPIENT USER's
 * `user_groups`. So this class's only job is to write the row with the right
 * `user_id` and the right content class; the database does the rest.
 *
 * WHY A SEPARATE CLASS AND NOT A METHOD ON `EmailService`. The write runs on the
 * FAILURE path too — a provider that refuses still produces a row, because "this
 * user was mailed a reset and it never arrived" is the first question an operator
 * asks — so it needs its own transaction handling rather than a branch inside a
 * method whose contract is "throw if the transport refused". One mechanism per
 * concern (§2.4): this writes rows and nothing else. It renders nothing, sends
 * nothing, and decides nothing about delivery.
 *
 * **The pool connects as `pgrst_authenticator` and every write runs
 * `SET LOCAL ROLE app_admin`**, the same escalation boundary the seed and
 * `AuthService` use. Claims alone cannot buy write access: the write policy
 * discriminates on `current_user` and never on a token field (§B2), so this
 * class cannot be talked into writing by a caller holding only `email:read`.
 */

/** The persisted shape of one attempt. No token, ever — see `contentClassFor`. */
export type EmailAttempt = {
  /**
   * The RECIPIENT USER — the derived-scope key. `NOT NULL` in the schema, because
   * the policy resolves a row's visibility through exactly this user's
   * memberships, so a row without one has no scope at all.
   */
  readonly userId: string;
  /** The stored `template` value: `password_reset`, `email_verification`, … */
  readonly template: string;
  readonly recipient: string;
  readonly subject: string;
  /** `sent` when the transport accepted it, `failed` when it refused. */
  readonly status: 'sent' | 'failed';
  /** The transport's own id, or NULL when there was none (a refusal). */
  readonly providerMessageId: string | null;
  /**
   * Why the attempt failed, in words safe to store.
   *
   * The transport's message, never the body and never the token: a failure reason
   * is read by whoever investigates the row, and over the same channel the body
   * would have been.
   */
  readonly error: string | null;
  /**
   * A rendered body to persist, or NULL to store none.
   *
   * NULL for every credential-bearing template. `contentClassFor` THROWS rather
   * than quietly discarding one, so a caller can never believe a body was stored
   * when the column is empty.
   */
  readonly body: string | null;
};

@Injectable()
export class EmailAuditWriter {
  private readonly logger = new Logger(EmailAuditWriter.name);

  constructor(
    @Inject(SharedDatabasePool) private readonly pool: DatabaseConnectionSource,
  ) {}

  /**
   * Records one attempt, inside the escalation boundary.
   *
   * Every send produces exactly one row — accepted or refused — and a failure
   * here THROWS rather than returning a boolean, for the same reason
   * `EmailService` throws: an audit write that fails quietly produces a history
   * with holes in it, and a hole in an audit trail is indistinguishable from an
   * event that never happened.
   *
   * `contentClassFor` runs BEFORE the transaction opens, so a refused body costs
   * no round trip and is never partially applied.
   */
  async record(attempt: EmailAttempt): Promise<void> {
    const { contentClass, body } = contentClassFor(
      attempt.template,
      attempt.body,
    );

    const client: PoolClient = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_admin');

      await client.query(
        `INSERT INTO email_messages
           (user_id, template, recipient, subject, status,
            provider_message_id, error, body, content_class, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 CASE WHEN $5 = 'sent' THEN now() ELSE NULL END)`,
        [
          attempt.userId,
          attempt.template,
          attempt.recipient,
          attempt.subject,
          attempt.status,
          attempt.providerMessageId,
          attempt.error,
          body,
          contentClass,
        ],
      );

      await client.query('COMMIT');
      committed = true;
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
   * Metadata only, and only ever on a refusal.
   *
   * The rendered body is not logged and neither is the token, so a failed send
   * leaves the same trail as a successful one. What is logged is the correlation
   * key an operator actually has — which user, which template, what the transport
   * said — the same rule ADR-0024 §10 sets for the transport layer.
   */
  refusalLogLine(attempt: EmailAttempt, cause: unknown): string {
    const detail =
      cause instanceof Error
        ? cause.message
        : `a non-Error value: ${String(cause)}`;
    const line =
      `email attempt failed for ${attempt.recipient} template=${attempt.template} ` +
      `subject="${attempt.subject}" user=${attempt.userId}: ${detail}`;
    this.logger.error(line);
    return line;
  }
}

/** Re-exported so a caller needs one import to name the stored class. */
export type { EmailContentClass };
