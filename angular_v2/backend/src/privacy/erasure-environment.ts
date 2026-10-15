/**
 * The `PRIVACY_*` namespace, read once and asserted at boot.
 *
 * ## Why this is a decision and not a convenience, which is why it has no default
 *
 * `PRIVACY_HMAC_PEPPER` is the key every tombstone in the database is derived
 * from. A default would be a *published* key: anyone who has read this repository
 * could recompute `HMAC(pepper, users.id)` for any row and match it against the
 * tombstone, which turns a keyed pseudonym back into the enumeration `tombstone.ts`
 * exists to refuse. So the key is required, in every mode, and a missing one
 * aborts the boot — the same treatment `JWT_SECRET` gets in
 * `src/config/environment.ts` and the two `RETENTION_*` windows get in
 * `src/purge/retention-environment.ts`, for the same reason: **a control whose
 * value proposition is refusing bad configuration must refuse it before it has
 * acted on it.**
 *
 * ## Why a third loader and not two more fields on `Environment`
 *
 * `Environment` is asserted key-for-key by a `toEqual` over the whole object in
 * `test/unit/environment.spec.ts`, which this change does not own, and the two
 * existing loaders already establish the precedent of a namespace owning its own
 * file (`breaker-environment.ts` says the same thing about `BREAKER_*`). One
 * decision, one loader, one name for the namespace.
 *
 * ## `PRIVACY_HMAC_PEPPER_KID` IS READ AND IS NOT COSMETIC
 *
 * `privacy_request_audits.pepper_kid` (`0010:223-234`) exists for one reason: a
 * pepper that rotates makes every historical row unverifiable unless the reader
 * can tell **which** key signed it, and a single global "current pepper" is
 * exactly the answer that stops existing the moment it rotates. This loader
 * requires the kid alongside the key, and the erasure path stamps it on its
 * outcome, so the two cannot drift apart — a pepper with no kid is refused rather
 * than accepted and never named.
 *
 * The kid's *durable* home is the audit row, and that write is currently
 * unreachable from the thin app (see `erasure.service.ts`); today it survives on
 * the erasure log line. That is a recorded residual, not a design.
 */
export type ErasureEnvironment = {
  /** The HMAC key. Required, ≥ 32 characters, never equal to `JWT_SECRET`. */
  readonly pepper: string;
  /** Which key this is, recorded beside every row it signs. */
  readonly pepperKid: string;
  /** The domain a tombstone address is minted in. No mode invents one. */
  readonly tombstoneDomain: string;
};

/**
 * The DI token for the validated namespace.
 *
 * A plain object cannot be its own injection token, so the token and the value
 * are created together in `erasure.module.ts` and nothing can register one without
 * the other — the same pairing `RETENTION_ENV` / `BREAKER_ENV` use.
 */
export const ERASURE_ENV = 'ERASURE_ENVIRONMENT';

/**
 * 32 characters = 256 bits of key material at 8 bits per character.
 *
 * The floor is not arbitrary: below it, an offline sweep over the 2^122 id space
 * stops being infeasible, and the floor is refused at boot rather than documented,
 * because a floor nobody can find is a floor nobody knows they are standing on.
 */
export const MINIMUM_PEPPER_LENGTH = 32;

/**
 * The kid is an identifier written into a `text` column, so it is bounded and
 * shaped rather than free: a kid containing a newline or a quote is a value that
 * corrupts a log line and a CSV export long before it is a security problem.
 */
export const MINIMUM_PEPPER_KID_LENGTH = 3;
export const MAXIMUM_PEPPER_KID_LENGTH = 64;
const PEPPER_KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A bare host: labels of alphanumerics and hyphens, at least two labels. No `@`,
 * no scheme, no port, no whitespace — the value is concatenated after `@`, so a
 * value carrying its own `@` would produce an address whose real recipient is
 * somebody else's.
 */
const TOMBSTONE_DOMAIN_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export class ErasureEnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `The erasure configuration is not usable. ${problems.length} problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    );
    this.name = 'ErasureEnvironmentError';
    this.problems = problems;
  }
}

function readRequiredString(source: Readonly<Record<string, unknown>>, key: string, problems: string[]): string | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null || raw === '') {
    problems.push(`${key} is required but was not set. It signs every tombstone in the database, and a default is a published key.`);
    return undefined;
  }
  if (typeof raw !== 'string') {
    problems.push(`${key} must be a string, received ${typeof raw}`);
    return undefined;
  }
  return raw;
}

/**
 * @throws ErasureEnvironmentError listing every problem at once, so a misconfigured
 *   checkout is fixed in one pass rather than in three.
 */
export function loadErasureEnvironment(source: Readonly<Record<string, unknown>>): ErasureEnvironment {
  const problems: string[] = [];

  const pepper = readRequiredString(source, 'PRIVACY_HMAC_PEPPER', problems);
  if (pepper !== undefined && pepper.length < MINIMUM_PEPPER_LENGTH) {
    problems.push(
      `PRIVACY_HMAC_PEPPER must be at least ${String(MINIMUM_PEPPER_LENGTH)} characters, received ${String(pepper.length)}: ` +
        'below it an offline sweep over the uuid space stops being infeasible, and every tombstone this application has ever written becomes derivable.',
    );
  }
  // Key reuse, refused rather than documented. A pepper that is also the JWT
  // signing secret means one leaked key is two compromises, and it means the
  // digest and the signature are two answers from one input.
  if (pepper !== undefined && pepper !== '') {
    const jwtSecret = source['JWT_SECRET'];
    if (typeof jwtSecret === 'string' && jwtSecret !== '' && jwtSecret === pepper) {
      problems.push(
        'PRIVACY_HMAC_PEPPER must not equal JWT_SECRET: one key signing both the session tokens and the tombstone digests is one leak and two compromises.',
      );
    }
  }

  const pepperKid = readRequiredString(source, 'PRIVACY_HMAC_PEPPER_KID', problems);
  if (pepperKid !== undefined) {
    if (pepperKid.length < MINIMUM_PEPPER_KID_LENGTH || pepperKid.length > MAXIMUM_PEPPER_KID_LENGTH) {
      problems.push(
        `PRIVACY_HMAC_PEPPER_KID must be between ${String(MINIMUM_PEPPER_KID_LENGTH)} and ${String(MAXIMUM_PEPPER_KID_LENGTH)} characters, received ${String(pepperKid.length)}`,
      );
    } else if (!PEPPER_KID_PATTERN.test(pepperKid)) {
      problems.push(
        `PRIVACY_HMAC_PEPPER_KID must be an identifier — letters, digits, dot, underscore or hyphen — received '${pepperKid}'. It is written into a column and into a log line, so it may not carry a quote or a newline.`,
      );
    }
  }

  const tombstoneDomain = readRequiredString(source, 'PRIVACY_TOMBSTONE_DOMAIN', problems);
  if (tombstoneDomain !== undefined && !TOMBSTONE_DOMAIN_PATTERN.test(tombstoneDomain)) {
    problems.push(
      `PRIVACY_TOMBSTONE_DOMAIN must be a bare host such as 'tombstone.example.test', received '${tombstoneDomain}'. ` +
        "It is appended after '@', so a value carrying its own '@' would mint an address whose real recipient is somebody else's.",
    );
  }

  if (
    pepper === undefined ||
    pepperKid === undefined ||
    tombstoneDomain === undefined ||
    problems.length > 0
  ) {
    throw new ErasureEnvironmentError(problems);
  }
  return { pepper, pepperKid, tombstoneDomain };
}