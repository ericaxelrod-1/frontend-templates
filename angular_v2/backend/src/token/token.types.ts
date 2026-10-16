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
