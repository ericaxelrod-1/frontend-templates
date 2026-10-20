import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The answer to a login that the gate says must carry a challenge.
 *
 * ## WHY 428 AND NOT 401
 *
 * `401` is this route's generic credential refusal, and it is deliberately the
 * SAME answer for an unknown username, a wrong password and a disabled account.
 * A caller who learns that their sign-in failed *because the account is switched
 * off* has learned three things: that the account exists, that it is under
 * security action, and which of the reasons applies.
 *
 * A challenge requirement is not one of those reasons and must not be dressed as
 * one. `428 Precondition Required` says exactly what happened — *the request was
 * received and it is incomplete* — and it is not the credential refusal, so a
 * client can tell the two apart and act differently: one retries with a
 * challenge, the other does not.
 *
 * ## WHY IT IS NOT AN ENUMERATION ORACLE
 *
 * The requirement is decided by the ACCOUNT's recent failure count, and
 * `login_attempts` rows are written **unconditionally** — for an account that
 * exists and one that does not. The count therefore reaches its threshold at the
 * same request number either way, so the status code says "this name has been
 * guessed at" and not "this name exists". A gate that counted only registered
 * accounts would answer `428` for one name and `401` for another, and that
 * difference is the oracle.
 */
export class CaptchaRequiredException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PRECONDITION_REQUIRED,
        error: 'Precondition Required',
        message: 'captcha required',
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
}
