export class PostgrestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PostgrestError';
  }
}

/**
 * Thrown when PostgREST is unreachable (connection refused, network failure, timeout).
 * This is a compliance path: an unreachable database layer must fail loudly and
 * must never degrade into a success-shaped value (AGENTS.md §2.3).
 */
export class PostgrestUnavailableError extends PostgrestError {
  readonly url: string;

  constructor(message: string, options: { readonly url: string; readonly cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = 'PostgrestUnavailableError';
    this.url = options.url;
  }
}

/**
 * Thrown when PostgREST answers with an HTTP error status (>= 400).
 * Preserves the HTTP status, the SQLSTATE / PostgREST error code, and error details.
 */
export class PostgrestResponseError extends PostgrestError {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: string | null;
  readonly hint: string | null;
  readonly body: unknown;
  readonly url: string;

  constructor(
    status: number,
    message: string,
    options: {
      readonly code?: string;
      readonly details?: string | null;
      readonly hint?: string | null;
      readonly body?: unknown;
      readonly url: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PostgrestResponseError';
    this.status = status;
    this.code = options.code;
    this.details = options.details ?? null;
    this.hint = options.hint ?? null;
    this.body = options.body;
    this.url = options.url;
  }
}

/**
 * Thrown when an account-scoped operation requires an authenticated caller token,
 * but no token was provided. A missing caller identity is a denial, not a silent success.
 */
export class PostgrestAuthenticationError extends PostgrestError {
  constructor(message = 'A verified caller bearer token is required to act with user identity') {
    super(message);
    this.name = 'PostgrestAuthenticationError';
  }
}
