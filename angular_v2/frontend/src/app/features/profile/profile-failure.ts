import { HttpErrorResponse } from '@angular/common/http';

/**
 * What a failed `/users/me` call says on the page.
 *
 * One place for it, because the five routes in `profile-api.service.ts` answer the
 * same handful of statuses and three forms would otherwise each grow their own
 * copy of the same switch — three copies drift, and the drift is invisible until a
 * member is told the wrong thing about their own account.
 *
 * `subject` is what the page calls the thing being asked for ("the name change",
 * "the password change"), so the sentence names the action rather than the route:
 * a member reading "your password was not changed" learns something, and one
 * reading "HTTP 403" learns where to look in developer tools.
 *
 * ## `401` is handled once, elsewhere, and this must not undo it
 *
 * `authInterceptor` treats a `401` on a request that carried a token as the end of
 * the session: it clears the tokens and navigates to `/access-denied`. So `401`
 * here means "the API refused the token", never "that value was wrong". That is a
 * constraint on the BACKEND as much as on this file, and the sharpest instance is
 * the password form — a wrong `current_password` must be answered `422` or `403`,
 * because a `401` would sign the member out for mistyping their own password.
 *
 * Nothing here returns a success-shaped value or swallows an error. A status this
 * file has no sentence for is reported as `HTTP <status>`, which is a truthful
 * answer about an answer nobody has written a sentence for yet — better than a
 * generic "something went wrong" that hides which status it was.
 */
export function describeProfileFailure(error: unknown, subject: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'The request could not be completed.';
  }
  switch (error.status) {
    case 0:
      return 'The service could not be reached.';
    case 401:
      return `The API refused the access token this request carried, so ${subject} was not sent.`;
    case 403:
      return `This session is not permitted to ${subject} (403).`;
    case 404:
      return `The API has no route for ${subject} yet (404).`;
    case 422:
      return validationDetail(error) ?? `The server's validation refused ${subject} (422).`;
    case 429:
      return 'Too many attempts. Wait before trying again.';
    default:
      return `${subject === '' ? 'The request' : `The request to ${subject}`} failed: HTTP ${error.status}.`;
  }
}

/**
 * The `message` from a `ValidationPipe` body, when there is one to read.
 *
 * The global `ValidationPipe` is `whitelist` + `forbidNonWhitelisted`
 * (AGENTS.md §B3), so a `422` body is `{ statusCode, message, error }` with
 * `message` a string or an array of strings. Reading it is what turns "HTTP 422"
 * into "first_name should not be blank" for the person who has to fix it.
 *
 * ONLY that shape is read. A body that is a bare string is not treated as a reason,
 * and that is deliberate: the shape a `text/plain` or HTML error page from
 * something in front of the API arrives in is exactly the shape a careless
 * implementation would render as the server's explanation. A failure to read the
 * detail must not be rendered as a detail — the caller falls back to the status,
 * which is a true sentence.
 *
 * The narrowing is explicit rather than a cast: `HttpErrorResponse.error` is typed
 * `any`, and everything from it lands in an `unknown` before anything is read off
 * it, so no value from the wire is ever taken on trust.
 */
export function validationDetail(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body: unknown = error.error;
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return null;
  }
  const message: unknown = (body as { readonly message: unknown }).message;
  if (typeof message === 'string' && message !== '') {
    return message;
  }
  if (Array.isArray(message)) {
    const parts: string[] = [];
    for (const part of message as readonly unknown[]) {
      if (typeof part === 'string' && part !== '') {
        parts.push(part);
      }
    }
    return parts.length > 0 ? parts.join('; ') : null;
  }
  return null;
}