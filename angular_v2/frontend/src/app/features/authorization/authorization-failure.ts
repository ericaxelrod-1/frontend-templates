import { HttpErrorResponse } from '@angular/common/http';

/**
 * What a failed administration call says on the page.
 *
 * ## THE DATABASE'S OWN WORDS COME FIRST
 *
 * A refusal from PostgREST carries the server's message in its body:
 * `{ code, message, details, hint }`. For the refusal this feature exists to
 * surface — a group that would close a cycle — that message is the answer:
 *
 *     group cycle: <group> cannot be parented to <parent>, which is itself or a
 *     descendant of <group>
 *
 * It names what was refused, and replacing it with "the move was rejected" would
 * throw away the only part an administrator can act on. So the message is
 * rendered when there is one, and the status is the fallback.
 *
 * ## `401` IS HANDLED ONCE, ELSEWHERE
 *
 * `authInterceptor` treats a `401` on a request that carried a token as the end of
 * the session: it clears the tokens and sends the browser to `/access-denied`. So
 * a `401` here means "the API refused the token", never "that value was wrong" —
 * and the sentence says so, rather than implying the administration was refused.
 *
 * ## NOTHING HERE SWALLOWS AN ERROR
 *
 * A status this file has no sentence for is reported as `HTTP <status>`, which is
 * a truthful answer about an answer nobody has written a sentence for yet. A
 * failure is never turned into a success-shaped value.
 */
export function describeAuthorizationFailure(error: unknown, subject: string): string {
  if (error instanceof HttpErrorResponse) {
    const detail = databaseMessage(error);
    if (detail !== null) {
      return `The database refused ${subject}: ${detail}`;
    }

    switch (error.status) {
      case 0:
        return 'The service could not be reached.';
      case 401:
        return `The API refused the access token this request carried, so ${subject} was not sent.`;
      case 403:
        return `This session is not permitted to ${subject} (403).`;
      case 404:
        return `The API has no route for ${subject} (404).`;
      case 409:
        return `The database already has that ${subject}.`;
      default:
        return `The request to ${subject} failed: HTTP ${error.status}.`;
    }
  }

  // A failure the CLIENT detected rather than one the database reported — a
  // mutation that matched no row, for instance. Its message is the reason it
  // exists, so it is shown; replacing it with a generic sentence would throw away
  // the only part that says what happened.
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'The request could not be completed.';
}

/**
 * The `message` from a PostgREST error body, when there is one to read.
 *
 * ONLY that shape is read. The body is typed `any` by `HttpClient`, so
 * everything from the wire lands in an `unknown` before anything is read off it,
 * and a body that is a bare string is not treated as the server's explanation.
 */
export function databaseMessage(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return null;
  }
  const message: unknown = (body as { readonly message: unknown }).message;
  return typeof message === 'string' && message !== '' ? message : null;
}
