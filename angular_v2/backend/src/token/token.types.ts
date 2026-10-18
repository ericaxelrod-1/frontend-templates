import {
  PASSWORD_RESET_LINK_LIFETIME_MINUTES,
  VERIFICATION_LINK_LIFETIME_HOURS,
} from '../email/email.template-context.js';

/**
 * The closed set of token purposes.
 *
 * Structurally enforced in the database CHECK constraint:
 * `purpose IN ('password_reset', 'email_verification', 'account_deletion')`.
 *
 * Cross-purpose confusion is refused at the type level, the application level,
 * and the database constraint layer.
 *
 * **`email_change` is deliberately NOT a fourth member**, and the reason is in
 * `email-change-token.ts`: the CHECK and `authz.mint_auth_token`'s own guard both
 * enumerate this vocabulary, so adding a kind is a migration to two places in the
 * schema. The email-change flow therefore mints under `email_verification` and is
 * separated from the verification flow by its token FORMAT and by a
 * domain-separated subject — which `email-change-token.ts` states in full, because
 * "it reuses a purpose" is the sentence a reviewer needs to interrogate.
 */
export const TOKEN_PURPOSES = [
  'password_reset',
  'email_verification',
  'account_deletion',
] as const;

export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export function isTokenPurpose(value: unknown): value is TokenPurpose {
  return typeof value === 'string' && (TOKEN_PURPOSES as readonly string[]).includes(value);
}

/**
 * Default lifetimes in seconds for each purpose, matched to email template commitments.
 */
export const DEFAULT_TOKEN_TTL_SECONDS: Readonly<Record<TokenPurpose, number>> = {
  password_reset: PASSWORD_RESET_LINK_LIFETIME_MINUTES * 60,
  email_verification: VERIFICATION_LINK_LIFETIME_HOURS * 3600,
  account_deletion: 3600,
};

export interface MintTokenInput {
  readonly purpose: TokenPurpose;
  readonly subjectIdentifier: string;
  readonly userId?: string | null;
  readonly ttlSeconds?: number;
}

export interface MintedToken {
  readonly id: string;
  readonly rawToken: string;
  readonly purpose: TokenPurpose;
  readonly expiresAt: Date;
}

export interface RedeemTokenInput {
  readonly rawToken: string;
  readonly expectedPurpose: TokenPurpose;
}

export interface RedeemedToken {
  readonly id: string;
  readonly userId: string | null;
  readonly subjectHmac: Buffer;
  readonly pepperKid: string;
  readonly purpose: TokenPurpose;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export type RedeemTokenResult =
  | {
      readonly status: 'success';
      readonly token: RedeemedToken;
    }
  | {
      readonly status: 'invalid_or_expired';
    };

export interface DeliverTokenInput {
  readonly purpose: TokenPurpose;
  readonly email: string;
}

export interface DeliveryResult {
  readonly status: 'accepted';
}

/**
 * What the email-change flow mints: the member's id (the subject the link belongs
 * to) and the address they asked for.
 *
 * `pendingEmail` is carried into the token and nowhere else — see
 * `email-change-token.ts` for why it is not a column on `users` and not a column on
 * `auth_tokens` either.
 */
export interface MintEmailChangeInput {
  readonly userId: string;
  readonly pendingEmail: string;
}

/**
 * A redeemed email-change link: WHO it moves the address FOR, and the address it
 * moves it TO.
 *
 * Both halves come from the same authenticated token, and neither can be supplied
 * by the caller — the confirm DTO carries the token and nothing else.
 */
export type RedeemEmailChangeResult =
  | {
      readonly status: 'success';
      readonly userId: string;
      readonly pendingEmail: string;
    }
  | {
      readonly status: 'invalid_or_expired';
    };
