/**
 * The shapes exchanged with the thin Nest app's `auth` routes.
 *
 * THESE ARE NOT GENERATED, and the reason is structural rather than a shortcut.
 * `src/app/api/schema.ts` is produced by `openapi-typescript` from
 * `../openapi.json`, and that document is emitted by **PostgREST** from the live
 * schema — it describes the CRUD layer only. The thin Nest app has no generated
 * contract at all (AGENTS.md §B3: `@ApiProperty()` applies to its own routes,
 * and PostgREST is not involved). So these three interfaces are a hand-written
 * mirror, and the authority for each is named beside it. If a field is added to a
 * DTO, this file is where it has to be added too — there is nothing to
 * regenerate.
 *
 * `@ApiProperty()` on a DTO does not reach the browser, so a mismatch here fails
 * at runtime with an `undefined` field rather than at compile time.
 */

/** Mirrors `backend/src/auth/login-request.dto.ts`. */
export interface AuthLoginRequest {
  readonly username: string;
  readonly password: string;
}

/**
 * Mirrors `backend/src/auth/login-response.dto.ts` and
 * `backend/src/auth/refresh-response.dto.ts`, which are the same shape.
 */
export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  /** Access-token lifetime in seconds, echoed from the signer's own config. */
  readonly expiresIn: number;
}

/** Mirrors `backend/src/auth/logout-request.dto.ts`. */
export interface AuthLogoutRequest {
  readonly refreshToken: string;
}

/** Mirrors `backend/src/auth/me-response.dto.ts`. */
export interface AuthMe {
  readonly sub: string;
  readonly role: string;
  /** Seconds until the presented access token expires. */
  readonly expiresIn: number;
}