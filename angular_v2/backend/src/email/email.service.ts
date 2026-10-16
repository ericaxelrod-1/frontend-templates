import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isSingleLineAddress,
  type Environment,
} from '../config/environment.js';
import { isAnonymizedRecipient } from '../privacy/tombstone.js';
import { EmailAuditWriter, type EmailAttempt } from './email-audit.writer.js';
import { EmailDeliveryError } from './email-delivery-error.js';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  type EmailProvider,
  type SentEmail,
} from './email.provider.js';
import { EmailRenderer } from './email.renderer.js';
import {
  PASSWORD_RESET_LINK_LIFETIME_MINUTES,
  PASSWORD_RESET_PATH,
  VERIFICATION_LINK_LIFETIME_HOURS,
  VERIFICATION_PATH,
} from './email.template-context.js';

/**
 * The two flows' stored `template` values.
 *
 * These are NOT the renderer's file names (`password-reset`, `verify-email`).
 * The column records what KIND of message this was, for filtering and for the
 * credential-suppression rule, and the rule has to key on a value that renaming a
 * file cannot change. Two vocabularies, mapped explicitly, in one place.
 */
export const PASSWORD_RESET_TEMPLATE = 'password_reset';
export const EMAIL_VERIFICATION_TEMPLATE = 'email_verification';

/**
 * The erasure receipt.
 *
 * Free text in the schema on purpose (`0005:58-62`): the set of templates is an
 * application decision, so adding one is a line rather than a migration, and the
 * credential-suppression rule keys on a value that renaming a renderer file cannot
 * change.
 *
 * **It is NOT in `CREDENTIAL_BEARING_TEMPLATES`**, and the distinction is the point:
 * that set is about a rendered body containing a bearer token, and this body
 * contains none. What this template must not persist is the erased person's own
 * name and address — writing those into `email_messages` while erasing them from
 * `users` would be a second copy of the data the erasure exists to remove. So the
 * body is offered as `null` and the row stays `content_class = 'metadata_only'`.
 */
export const ERASURE_RECEIPT_TEMPLATE = 'erasure_receipt';

/** A recipient this application refused to hand to a header parser. See `send`. */
const REDACTED_RECIPIENT = '<rejected-recipient>';

/**
 * The two live transactional flows, and nothing else.
 *
 * `sendWelcomeEmail`, `sendGenericEmail` and the five privacy-ticket methods of
 * the previous tree are gone: none of them had a single caller, and a send
 * method with no caller is a promise nobody is keeping (§2.1). What remains is
 * what an auth surface needs and what the next W11 slices — registration and
 * password reset — will call.
 *
 * **Failure policy.** Both methods reject with `EmailDeliveryError` when the
 * transport refuses. Neither returns a boolean, and neither swallows a failure
 * into a success-shaped value. The caller decides what the user is told; this
 * service's job is to make the failure impossible to mistake for a success.
 *
 * **URLs.** Every link is absolute, built from `EmailConfig.baseUrl`, which is
 * asserted at bootstrap in every mode and has no default. A relative link in a
 * mail client is not a link, and the previous `http://localhost:4200` default
 * was a link to the developer's own machine inside every message the
 * application ever sent.
 *
 * **Every attempt is recorded.** Each send writes exactly one `email_messages`
 * row through `EmailAuditWriter` — including the attempts that fail, which is the
 * half that matters: "this user was mailed a reset and it never arrived" is the
 * first question an operator asks. The row carries no token: `body` is NULL for
 * both credential-bearing templates, enforced by `contentClassFor` rather than by
 * convention (ADR-0025).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly env: Environment;

  constructor(
    config: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly renderer: EmailRenderer,
    private readonly audit: EmailAuditWriter,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
  }

  /**
   * Confirm a new address. `token` is a bearer credential for exactly this
   * link — it is never logged here, never stored in `email_messages`, and never
   * logged by the production transport at any level (see
   * `nodemailer-email.provider.ts`).
   *
   * `userId` is the recipient's `users.id`. It is the derived-scope key, and
   * `email_messages.user_id` is `NOT NULL` precisely because a row whose scope is
   * "the groups this user belongs to" is meaningless without the user.
   *
   * IT IS OPTIONAL, and that is a documented residual rather than a design choice
   * — see §The recording gap in the class comment. When it is supplied the attempt
   * is recorded; when it is not, nothing is written and a warning names exactly
   * what was missing. It is never a silent skip.
   */
  async sendVerificationEmail(
    recipient: string,
    recipientName: string,
    token: string,
    userId?: string,
  ): Promise<SentEmail> {
    const verificationUrl = this.absoluteUrl(VERIFICATION_PATH, token);
    return this.send(
      {
        to: recipient,
        subject: `Verify your ${this.env.email.appName} email address`,
        html: this.renderer.render('verify-email', {
          appName: this.env.email.appName,
          recipientName,
          verificationUrl,
          expiresInHours: VERIFICATION_LINK_LIFETIME_HOURS,
        }),
        text:
          `Hello ${recipientName},\n\n` +
          `Confirm this address to finish setting up your ${this.env.email.appName} account:\n` +
          `${verificationUrl}\n\n` +
          `The link expires in ${VERIFICATION_LINK_LIFETIME_HOURS} hours.\n` +
          `If you did not create an account, ignore this message — nothing has changed.`,
      },
      {
        userId,
        template: EMAIL_VERIFICATION_TEMPLATE,
        recipient,
        subject: `Verify your ${this.env.email.appName} email address`,
        // The body is deliberately NOT offered: this template's body carries the
        // verification token, and `contentClassFor` would refuse it. Passing
        // `null` is the credential-suppression rule applied at the call site as
        // well as in the writer, so the two cannot drift apart.
        body: null,
      },
    );
  }

  /**
   * Confirm a deletion request, to the address that is still live.
   *
   * ## WHY IT IS SENT BEFORE THE ANONYMISATION, AND WHY THAT IS ALSO WHY IT MUST
   * NOT DESCRIBE THE ANONYMISATION AS DONE
   *
   * Once the address is a tombstone there is nowhere to send it, so
   * `ErasureService` sends this **outside and before** the transaction and refuses
   * to erase anything if the send fails. A receipt is therefore a statement about
   * the REQUEST — received, being actioned — and never a claim that the row has
   * already been rewritten, because at the moment this message is handed to the
   * transport the rewrite has not happened yet and may still fail. A receipt that
   * said "your account has been erased" would be describing work that had not run.
   *
   * **No name in the body.** The greeting is bare rather than personalised, which
   * is the boring solution to a real problem: a rendered body that interpolates the
   * account's username needs an HTML-escaping decision, and there is no reason for
   * an erasure receipt to carry the identifier the erasure is about to destroy. The
   * message is still addressed to the right person — the envelope names them.
   */
  async sendErasureReceipt(recipient: string, userId?: string): Promise<SentEmail> {
    const subject = `Your ${this.env.email.appName} account erasure request`;
    return this.send(
      {
        to: recipient,
        subject,
        html:
          '<p>Hello,</p>' +
          `<p>We have received your request to erase your ${escapeHtmlText(this.env.email.appName)} account.</p>` +
          '<p>What happens next, in this order:</p>' +
          '<ol>' +
          '<li>your username is replaced, so you will not be able to sign in;</li>' +
          '<li>every session you hold is revoked;</li>' +
          '<li>the email address on file is replaced with a non-routable placeholder, ' +
          'so this address will stop receiving mail from us;</li>' +
          '<li>your sign-in history is kept for security-investigation purposes for the ' +
          'period the law requires, with your username replaced the same way.</li>' +
          '</ol>' +
          '<p>The record of this request is retained independently of your account.</p>' +
          '<p>If you did not ask for this, reply to this message before the change is actioned.</p>',
        text:
          'Hello,\n\n' +
          `We have received your request to erase your ${this.env.email.appName} account.\n\n` +
          'What happens next, in this order:\n' +
          '1. your username is replaced, so you will not be able to sign in;\n' +
          '2. every session you hold is revoked;\n' +
          '3. the email address on file is replaced with a non-routable placeholder, so ' +
          'this address will stop receiving mail from us;\n' +
          '4. your sign-in history is kept for security-investigation purposes for the ' +
          'period the law requires, with your username replaced the same way.\n\n' +
          'The record of this request is retained independently of your account.\n\n' +
          'If you did not ask for this, reply to this message before the change is actioned.\n',
      },
      {
        userId,
        template: ERASURE_RECEIPT_TEMPLATE,
        recipient,
        subject,
        // Metadata only, and the reason is the erasure itself: this body carries the
        // person's name and address, and `email_messages` is a table the erased
        // person's record will outlive.
        body: null,
      },
    );
  }

  /** Change a forgotten password. Same bearer-token and recording behaviour. */
  async sendPasswordResetEmail(
    recipient: string,
    recipientName: string,
    token: string,
    userId?: string,
  ): Promise<SentEmail> {
    const resetUrl = this.absoluteUrl(PASSWORD_RESET_PATH, token);
    return this.send(
      {
        to: recipient,
        subject: `Reset your ${this.env.email.appName} password`,
        html: this.renderer.render('password-reset', {
          appName: this.env.email.appName,
          recipientName,
          resetUrl,
          expiresInMinutes: PASSWORD_RESET_LINK_LIFETIME_MINUTES,
        }),
        text:
          `Hello ${recipientName},\n\n` +
          `Use this link to choose a new ${this.env.email.appName} password:\n` +
          `${resetUrl}\n\n` +
          `The link expires in ${PASSWORD_RESET_LINK_LIFETIME_MINUTES} minutes and can be used once.\n` +
          `If you did not ask for this, ignore this message — your password has not changed.`,
      },
      {
        userId,
        template: PASSWORD_RESET_TEMPLATE,
        recipient,
        subject: `Reset your ${this.env.email.appName} password`,
        body: null,
      },
    );
  }

  /**
   * The single send path, so validation, wrapping, logging and recording are not
   * re-implemented per flow. The template is rendered by the caller, which means
   * a rendering failure propagates *before* anything is handed to the transport —
   * no half-sent state, and no row for a message that was never attempted.
   *
   * ORDER IS THE WHOLE OF THIS METHOD: the attempt is recorded AFTER the provider
   * call resolves or rejects, so `status`, `provider_message_id` and `error`
   * describe what actually happened rather than what was intended.
   *
   * ## The recording gap — a documented residual, not a design choice
   *
   * `userId` is optional, and when it is absent NOTHING IS WRITTEN and a warning
   * names what was missing. Two facts force the optionality, and both are
   * properties of the repository rather than preferences:
   *
   * 1. **The method arity is a frozen contract.** `sendVerificationEmail` and
   *    `sendPasswordResetEmail` are called with three arguments in
   *    `test/unit/email/email.service.spec.ts` (19 call sites) and
   *    `test/e2e/email.e2e-spec.ts`, and this slice may not modify either. A
   *    fourth REQUIRED parameter does not compile them.
   * 2. **The frozen suite has no database.** Its environment names `DB_NAME =
   *    app_test`, which does not exist, and it deliberately opens no connection —
   *    it proves the transport. An unconditional write inside `send()` therefore
   *    fails that suite with a connection error, and it would fail it for a
   *    reason that has nothing to do with what it is testing.
   *
   * So the gap is real and it is LOGGED at `warn` with the template, the recipient
   * and the status, which is the §2.3 obligation: a missing audit row is reported,
   * never swallowed. It is a hole in the trail — an attempt made without a
   * recipient user leaves no evidence — and it is named here, in the ADR, and
   * asserted by `email-messages.spec.ts`, which proves the recorded path end to end
   * against a real database.
   *
   * **Every production caller must pass `userId`.** There is no production caller
   * yet (ADR-0024 §Consequences: `EmailService` is wired but not yet called), so
   * the gap costs nothing today and closes itself when the registration and
   * password-reset routes land: they already hold the user row they are mailing.
   * The alternative — a required parameter, and editing 19 call sites in two suites
   * this slice does not own — was rejected as out of scope, not as wrong.
   */
  private async send(
    message: EmailMessage,
    subject: Omit<
      EmailAttempt,
      'status' | 'providerMessageId' | 'error' | 'userId'
    > & {
      readonly userId: string | undefined;
    },
  ): Promise<SentEmail> {
    if (!isSingleLineAddress(message.to)) {
      // Caught here rather than by nodemailer: a rejected recipient must never
      // reach a header parser, and the message must not be attempted at all.
      //
      // The offending value is NOT echoed. Nest's exception handler logs the
      // error, and a rejected recipient is attacker-controlled and may itself
      // contain a CRLF — so repeating it verbatim would put a forged line in
      // every log the exception passes through. The reason is reported; the
      // value is not.
      //
      // NOTHING IS RECORDED for a rejected recipient, and that is deliberate: the
      // address never became an envelope, so there is no attempt to audit, and
      // storing an attacker-controlled string that failed validation is the one
      // case where the audit table would be the wrong place for it.
      throw new EmailDeliveryError(
        REDACTED_RECIPIENT,
        message.subject,
        new Error('the recipient is not a single-line address'),
      );
    }

    // AN ANONYMISED SUBJECT IS EXCLUDED FROM ALL OUTBOUND MAIL, and this is the one
    // place that can say so — `send()` is the single path every flow goes through.
    //
    // Checked by SHAPE (`isAnonymizedRecipient`) rather than by reading
    // `users.email_anonymized`, because the case that matters is the one where the
    // database can no longer help: after a retention purge there is no row to ask,
    // and a check that fails open when the answer is unavailable is a check that
    // mails tombstones exactly when the system is busiest. The shape is carried by
    // the address itself and is therefore true with or without a database.
    //
    // Refused BEFORE the transport, so no envelope is ever built for it, and
    // unrecorded, on the same reasoning as the address check above: there was no
    // attempt, so there is nothing to audit.
    if (isAnonymizedRecipient(message.to)) {
      throw new EmailDeliveryError(
        REDACTED_RECIPIENT,
        message.subject,
        new Error('the recipient is an anonymised address, and an anonymised subject receives no mail'),
      );
    }

    if (subject.userId === undefined) {
      this.logger.warn(
        `email attempt for ${message.to} template=${subject.template} was NOT recorded: no recipient user id was supplied, and email_messages.user_id is NOT NULL because a row's scope is derived from that user's group memberships`,
      );
    }

    try {
      const sent = await this.provider.send(message);
      if (subject.userId !== undefined) {
        await this.audit.record({
          ...subject,
          userId: subject.userId,
          status: 'sent',
          providerMessageId: sent.messageId === '' ? null : sent.messageId,
          error: null,
        });
      }
      return sent;
    } catch (error) {
      // The FAILURE row is written before the rethrow, so a caller who never sees
      // this exception can still ask "was a reset attempted for this user?".
      //
      // If the audit write itself fails, that failure REPLACES the delivery error
      // rather than hiding it: a silent audit write would produce a history with
      // holes, and a hole is indistinguishable from an attempt that never
      // happened. The delivery error is carried inside the AggregateError so both
      // survive to the caller.
      if (subject.userId !== undefined) {
        const attempt: EmailAttempt = {
          ...subject,
          userId: subject.userId,
          status: 'failed',
          providerMessageId: null,
          error: describeFailure(error),
        };
        this.audit.refusalLogLine(attempt, error);
        try {
          await this.audit.record(attempt);
        } catch (auditError) {
          throw new EmailDeliveryError(
            message.to,
            message.subject,
            new AggregateError(
              [error, auditError],
              `the message was not accepted AND its attempt could not be recorded: ${describeFailure(auditError)}`,
            ),
          );
        }
      }
      throw new EmailDeliveryError(message.to, message.subject, error);
    }
  }

  /**
   * `<base>/<path>?token=<urlencoded>`.
   *
   * `baseUrl` is stored without a trailing slash precisely so this cannot
   * produce `//`, and the token is percent-encoded so a token carrying `&` or
   * `#` cannot append parameters of its own to the link.
   */
  private absoluteUrl(path: string, token: string): string {
    if (token === '') {
      throw new Error('refusing to build an email link with an empty token');
    }
    return `${this.env.email.baseUrl}${path}?token=${encodeURIComponent(token)}`;
  }
}

/**
 * HTML-escape one interpolated value.
 *
 * The other two flows render through Handlebars, which escapes `{{var}}` for them.
 * This receipt is assembled as a string because it carries no context worth a
 * template file, so the same guarantee is made here explicitly rather than assumed:
 * `APP_NAME` is operator configuration rather than caller input, and a value that
 * reaches a mail body unescaped is an attribute-injection surface the moment
 * somebody points it at something untrusted.
 */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A failure reason safe to persist in the `error` column.
 *
 * The TRANSPORT's message, never the rendered body and never the token: a stored
 * reason is read by whoever investigates the row, and it is read over the same
 * channel the body would have been. A non-Error is stringified rather than
 * discarded, because "the provider threw something we cannot describe" is a real
 * state and an empty `error` column would read as "no reason recorded".
 */
function describeFailure(error: unknown): string {
  return error instanceof Error
    ? error.message
    : `a non-Error value: ${String(error)}`;
}
