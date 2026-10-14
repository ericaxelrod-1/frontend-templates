import { Injectable, Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { DispatchToken } from './dispatch-token.js';
import { dispatchTokenForRoute } from './dispatch-token.js';
import type { DispatchLease } from './breaker-gate.js';
import { BreakerGate } from './breaker-gate.js';

/**
 * The request-side dispatch gate, registered as `APP_INTERCEPTOR`.
 *
 * ## Why an interceptor and not a guard — and the limitation, stated rather than
 * papered over
 *
 * Nest's request order is **middleware → guards → interceptors → pipes →
 * handler**, so the global `JwtAuthGuard` runs first. That ordering is doing
 * security work, not tidiness: a resource gate placed *before* authentication hands
 * an unauthenticated caller a capacity verdict. `503 — memory critical` tells a
 * prober that the system is under pressure, and **capacity is the reconnaissance
 * that makes a follow-up attack cheaper.** With the interceptor, an unauthenticated
 * request is `401` and reveals nothing at all.
 *
 * **The honest consequence: the breaker cannot fire during an auth flood.** By the
 * time a request has been through JWT verification, the pressure it caused has
 * already happened. Three responses, taken deliberately rather than by omission:
 *
 *  1. accept it — this is a *resource* control, and DoS is §B6's job at the
 *     reverse proxy, which is not in this tree;
 *  2. the control that does work inside the app is the per-account progressive
 *     delay, keyed on the account first and the IP subnet second;
 *  3. **refuse the tempting fix** — moving this into a guard to "catch the flood"
 *     reintroduces the oracle above. An information disclosure to unauthenticated
 *     callers is a worse outcome than an un-gated flood a proxy could absorb, and
 *     this application cannot.
 *
 * ## And the scope, because this is where it gets misread
 *
 * As an `APP_INTERCEPTOR` this sees **only the thin app's own routes**. It does
 * not see PostgREST, which is a separate process (`postgrest.conf:96-97`), and no
 * placement choice inside Nest changes that. It is one of three dispatch sites in
 * this build; the other two are the cron jobs, which go through
 * `BreakerGate.acquire` directly.
 *
 * ## The response, and the one thing this design does not keep
 *
 * A gated dispatch is **not an error**: the handler is never started, and the
 * response is `202 Accepted`. There is no `503`, no `429` and no `Retry-After`.
 *
 * What `queued: false` means, stated in the body rather than left for a reader to
 * infer: **this architecture has no request queue.** The only real queue in the
 * system is `privacy_purge_queue`, and it holds purge work, not HTTP requests. So a
 * gated route is *not dispatched and not deferred* — the body says so, the caller
 * can retry, and nothing is silently dropped. It is recorded here as the one gap in
 * the "accepted and queued" promise, and it is unreachable with the shipped
 * `BREAKER_PROTECTED`: all four thin-app routes are protected, so the gate admits
 * them at every zone including `red`, which is the correct behaviour — an operator
 * must stay able to log in and fix the machine — and which is also why the refusal
 * branch has no runtime exercise today. The job dispatcher does.
 */
@Injectable()
export class BreakerGateInterceptor implements NestInterceptor {
  private readonly logger = new Logger(BreakerGateInterceptor.name);

  constructor(private readonly gate: BreakerGate) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const token: DispatchToken | undefined = this.tokenFor(context);
    const admission = this.gate.acquire(token, false);

    if (!admission.admit) {
      this.logger.warn(`gated ${token ?? 'an unnamed route'} before dispatch: ${admission.refusal}`);
      const reply = context.switchToHttp().getResponse<FastifyReply>();
      reply.status(202).send({
        gated: true,
        dispatched: false,
        queued: false,
        service: token ?? null,
        breaker_state: admission.state.mode,
        refusal: admission.refusal,
        detail:
          'Accepted and not dispatched: the resource gate is not admitting new work. ' +
          'This deployment has no request queue, so the work is not deferred — retry once the breaker reports closed.',
      });
      // An EMPTY observable, so Nest completes the request with the reply already
      // sent. Returning `of(null)` instead would let the interceptor chain continue
      // and write a body over the status line.
      return new Observable<never>((subscriber) => {
        subscriber.complete();
      });
    }

    const lease: DispatchLease = admission.lease;
    return next.handle().pipe(tap({ complete: () => lease.release('completed'), error: () => lease.release('failed') }));
  }

  /**
   * `AuthController` + `login` → `auth.login`.
   *
   * `undefined` when the route cannot be named, and `undefined` is NOT protected:
   * a site the gate cannot identify is breakable. Fail closed, in the direction
   * where being wrong shows up as a gated request rather than as a site quietly
   * running through a memory crisis.
   */
  private tokenFor(context: ExecutionContext): DispatchToken | undefined {
    const controller = context.getClass();
    const handler = context.getHandler();
    if (typeof controller !== 'function' || typeof handler !== 'function') {
      return undefined;
    }
    return dispatchTokenForRoute(controller.name, handler.name);
  }
}