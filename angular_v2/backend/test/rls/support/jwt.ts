import { createHmac } from 'node:crypto';

/**
 * JWT minting for the PostgREST-facing RLS tests, in TypeScript, with no
 * dependency. The algorithm is the stdlib-python one from
 * `/home/eaxelrod/pgrst-smoke/mk-jwt.py`: HS256, base64url, no padding.
 *
 * These are real tokens against the real shared secret. Nothing here fakes a
 * signature, and a token that PostgREST rejects is a finding, not a flake.
 */

const HEADER = '{"alg":"HS256","typ":"JWT"}';

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function sign(secret: string, signingInput: string): string {
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest('base64url');
}

export type Claims = Readonly<Record<string, unknown>>;

/**
 * Mints a token. `exp` is always set and always in the future: PostgREST accepts
 * a token with no `exp` at all (verified), so a token minted without one would
 * test nothing about expiry and would be a footgun for the next reader.
 */
export function mintToken(secret: string, claims: Claims): string {
  const withExpiry: Record<string, unknown> = { ...claims };
  if (withExpiry['exp'] === undefined) {
    withExpiry['exp'] = Math.floor(Date.now() / 1000) + 3600;
  }
  const signingInput = `${base64url(HEADER)}.${base64url(JSON.stringify(withExpiry))}`;
  return `${signingInput}.${sign(secret, signingInput)}`;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * Issues a request. `token` is optional because "no Authorization header at all"
 * is itself a case under test: PostgREST then falls back to db-anon-role, and an
 * unauthenticated read must be a denial rather than a crash.
 */
export async function request(url: string, token?: string, init?: RequestInit): Promise<HttpResponse> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (token !== undefined) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { ...init, headers });
  return { status: response.status, body: await response.text() };
}

export interface JsonRow {
  readonly [column: string]: unknown;
}

export function parseJsonArray(body: string): readonly JsonRow[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) {
    throw new TypeError(`expected a JSON array from PostgREST, received: ${body.slice(0, 200)}`);
  }
  return parsed as readonly JsonRow[];
}

export function parseJsonObject(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`expected a JSON object from PostgREST, received: ${body.slice(0, 200)}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The SQLSTATE PostgREST reports, or undefined when the body carries none.
 *
 * Assertions in this suite are on the SQLSTATE rather than the HTTP status wherever
 * two different controls can produce the same status: PostgREST answers the ANONYMOUS
 * role with 401 for a privilege error and answers `permission denied for table` and
 * `permission denied for function` the same way, so the status cannot tell "the grant
 * refused" from "the policy could not be evaluated". Returns undefined instead of
 * throwing on a non-JSON body, because a body that is not JSON is itself the finding
 * the caller is about to assert on.
 */
export function sqlStateOf(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const code = (parsed as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : undefined;
}
