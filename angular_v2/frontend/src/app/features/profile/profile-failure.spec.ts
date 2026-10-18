import { HttpErrorResponse } from '@angular/common/http';
import { describeProfileFailure, validationDetail } from './profile-failure';

/** An error carrying a `ValidationPipe` body, which is what a `422` looks like. */
function validationError(message: string | readonly string[]): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 422,
    error: { statusCode: 422, message, error: 'Unprocessable Entity' },
  });
}

describe('validationDetail', () => {
  it('reads a single message out of the body', () => {
    expect(validationDetail(validationError('first_name should not be blank'))).toBe(
      'first_name should not be blank',
    );
  });

  /**
   * `ValidationPipe` answers a `422` with `message` as an array when several rules
   * failed, and a page that reported only the first would send the member round the
   * loop twice for one mistake.
   */
  it('joins an array of messages', () => {
    expect(
      validationDetail(validationError(['first_name should not be blank', 'last_name too long'])),
    ).toBe('first_name should not be blank; last_name too long');
  });

  /**
   * A body that is not the `ValidationPipe` shape must produce no detail rather than
   * a detail that is wrong. The shape a bare string arrives in is exactly the shape a
   * careless implementation would render as the server's explanation — and an HTML
   * error page from something in front of the API is not a reason a person can act
   * on. `error` is typed `any` by `HttpClient`, so everything from the wire lands in
   * an `unknown` before anything is read off it.
   */
  it('returns null for a body that carries no message', () => {
    expect(
      validationDetail(new HttpErrorResponse({ status: 422, error: '<html>oops</html>' })),
    ).toBeNull();
    expect(validationDetail(new HttpErrorResponse({ status: 500, error: null }))).toBeNull();
    expect(validationDetail(new Error('not an HTTP failure'))).toBeNull();
  });

  it('ignores a message array holding something that is not a string', () => {
    // `HttpErrorResponse.error` is `any`, so a body of any shape can arrive here.
    const mixed = new HttpErrorResponse({ status: 422, error: { message: [1, 'ok', null] } });

    expect(validationDetail(mixed)).toBe('ok');
  });
});

describe('describeProfileFailure', () => {
  it('names the action that did not happen, and the status it came back with', () => {
    expect(describeProfileFailure(new HttpErrorResponse({ status: 403 }), 'the name change')).toBe(
      'This session is not permitted to the name change (403).',
    );
    expect(describeProfileFailure(new HttpErrorResponse({ status: 500 }), 'the profile')).toContain(
      'HTTP 500',
    );
  });

  /**
   * `401` means the API would not accept the TOKEN, and `authInterceptor` has
   * already cleared the session by the time this runs. Saying so here keeps the
   * message consistent with where the browser has just been sent.
   */
  it('treats a 401 as the end of the session, not as a rejected value', () => {
    expect(
      describeProfileFailure(new HttpErrorResponse({ status: 401 }), 'the password change'),
    ).toBe('The API refused the access token this request carried, so the password change was not sent.');
  });

  it('surfaces the server’s reason for a 422 in preference to the status', () => {
    expect(describeProfileFailure(validationError('new_password is too short'), 'the password change')).toBe(
      'new_password is too short',
    );
  });

  it('falls back to the status when a 422 body carries nothing readable', () => {
    expect(describeProfileFailure(new HttpErrorResponse({ status: 422 }), 'the name change')).toBe(
      "The server's validation refused the name change (422).",
    );
  });

  /**
   * The routes are being written in parallel, so a `404` is the honest current
   * answer and it is named as one rather than rendered as "your profile is empty".
   */
  it('says plainly that a route the profile depends on is not there', () => {
    expect(describeProfileFailure(new HttpErrorResponse({ status: 404 }), 'the profile')).toBe(
      'The API has no route for the profile yet (404).',
    );
  });

  it('distinguishes an unreachable service from a refused request', () => {
    expect(describeProfileFailure(new HttpErrorResponse({ status: 0 }), 'the name change')).toBe(
      'The service could not be reached.',
    );
    expect(describeProfileFailure(new Error('boom'), 'the name change')).toBe(
      'The request could not be completed.',
    );
  });
});