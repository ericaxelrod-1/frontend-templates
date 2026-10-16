/**
 * The `AUTH_TOKEN_*` environment namespace, read once and asserted at boot.
 *
 * ## Why this has no default and refuses bad configuration
 *
 * `AUTH_TOKEN_PEPPER` is the key one-time tokens (password reset, email verification,
 * and account deletion confirmation) are hashed under and out-of-band subject digests
 * are keyed by. A default would be a published key, allowing anyone reading this
 * repository to precompute or reverse token hashes and subject pseudonyms.
 *
 * It is required in every mode, validated at module-evaluation time, and must not
 * be shared with `JWT_SECRET` (which signs access tokens) or `PRIVACY_HMAC_PEPPER`
 * (which signs tombstones) — §2.4: one key per concern.
 */

export type TokenEnvironment = {
  /** The HMAC key for token hashing and subject digests. Required, ≥ 32 characters. */
  readonly pepper: string;
  /** Key identifier recorded on token rows to support rotation. */
  readonly pepperKid: string;
};

export const TOKEN_ENV = 'TOKEN_ENVIRONMENT';

export const MINIMUM_TOKEN_PEPPER_LENGTH = 32;
export const MINIMUM_TOKEN_PEPPER_KID_LENGTH = 3;
export const MAXIMUM_TOKEN_PEPPER_KID_LENGTH = 64;
const PEPPER_KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class TokenEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The token configuration is not usable. ${String(problems.length)} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'TokenEnvironmentError';
    this.problems = problems;
  }
}

function readRequiredString(
  source: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): string | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    problems.push(`${key} is required but was not set. A default is a published key.`);
    return undefined;
  }
  if (typeof raw !== 'string') {
    problems.push(`${key} must be a string, received ${typeof raw}`);
    return undefined;
  }
  return raw;
}

/**
 * @throws TokenEnvironmentError listing every problem at once.
 */
export function loadTokenEnvironment(
  source: Readonly<Record<string, unknown>>,
): TokenEnvironment {
  const problems: string[] = [];

  const pepper = readRequiredString(source, 'AUTH_TOKEN_PEPPER', problems);
  if (pepper !== undefined && pepper.length < MINIMUM_TOKEN_PEPPER_LENGTH) {
    problems.push(
      `AUTH_TOKEN_PEPPER must be at least ${String(MINIMUM_TOKEN_PEPPER_LENGTH)} characters, received ${String(pepper.length)}: ` +
        'below 256 bits of key material, brute-force search against stored token hashes becomes feasible.',
    );
  }

  if (pepper !== undefined && pepper !== '') {
    const jwtSecret = source['JWT_SECRET'];
    if (typeof jwtSecret === 'string' && jwtSecret !== '' && jwtSecret === pepper) {
      problems.push(
        'AUTH_TOKEN_PEPPER must not equal JWT_SECRET: sharing keys between session signing and one-time token hashing violates single concern.',
      );
    }

    const privacyPepper = source['PRIVACY_HMAC_PEPPER'];
    if (
      typeof privacyPepper === 'string' &&
      privacyPepper !== '' &&
      privacyPepper === pepper
    ) {
      problems.push(
        'AUTH_TOKEN_PEPPER must not equal PRIVACY_HMAC_PEPPER: tombstone derivation and one-time token hashing must not share key material.',
      );
    }
  }

  const pepperKid = readRequiredString(source, 'AUTH_TOKEN_PEPPER_KID', problems);
  if (pepperKid !== undefined) {
    if (
      pepperKid.length < MINIMUM_TOKEN_PEPPER_KID_LENGTH ||
      pepperKid.length > MAXIMUM_TOKEN_PEPPER_KID_LENGTH
    ) {
      problems.push(
        `AUTH_TOKEN_PEPPER_KID must be between ${String(MINIMUM_TOKEN_PEPPER_KID_LENGTH)} and ${String(MAXIMUM_TOKEN_PEPPER_KID_LENGTH)} characters, received ${String(pepperKid.length)}`,
      );
    } else if (!PEPPER_KID_PATTERN.test(pepperKid)) {
      problems.push(
        `AUTH_TOKEN_PEPPER_KID must be an identifier — letters, digits, dot, underscore or hyphen — received '${pepperKid}'.`,
      );
    }
  }

  if (pepper === undefined || pepperKid === undefined || problems.length > 0) {
    throw new TokenEnvironmentError(problems);
  }

  return { pepper, pepperKid };
}
