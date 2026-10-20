import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { ipSubnetKey, normalizeIpAddress } from '../auth/ip-address.js';
import { dispatchTokenForRoute } from '../breaker/dispatch-token.js';
import type { Environment } from '../config/environment.js';
import { ATTEMPT_ROUTES, normaliseAttemptSubject } from './attempt-route.js';
import type { AttemptRoute } from './attempt-route.js';
import { MAX_SCANNED_FIELDS, detectPatternMatches } from './pattern-registry.js';
import type { ScannedField } from './pattern-registry.js';
import { SecurityTelemetryCollector } from './telemetry-collector.js';

/**
 * The detection point: the one place a request is looked at for a hostile shape.
 *
 * ## IT DETECTS AND NOTHING ELSE
 *
 * **This interceptor never refuses a request, never throws, and never changes a
 * response.** §B6: "Behavioral/risk scoring is triage, not prevention. It
 * informs a decision; it never silently blocks." The obvious implementation of
 * "detect an injection and refuse the request" is a security control that reads
 * like a feature and is a denial of service waiting for a false positive — and
 * the assertion that the request still succeeds is the one that proves this
 * interceptor is a detector.
 *
 * The risk is not that a hostile request is served. It is that a *legitimate*
 * request carrying a shape the patterns recognise — a password that happens to
 * contain `or 1=1`, a display name with an apostrophe — is refused, and the
 * person it refuses is a customer. So the pattern goes to a human and the request
 * goes through.
 *
 * ## IT IS AN INTERCEPTOR BESIDE THE BREAKER, NOT INSIDE IT
 *
 * The breaker (`src/breaker/`) is a resource gate: it refuses to dispatch when
 * the machine is short of memory. This is a content detector: it notices what a
 * request carries. They answer different questions, they have different failure
 * directions, and merging them would mean a detector that could refuse a request
 * by borrowing a resource gate's authority. So this is a second `APP_INTERCEPTOR`
 * in the same chain — the order between the two is the order they are registered
 * in, and the breaker's gate runs first because a gated request is not dispatched
 * at all and there is nothing to detect.
 *
 * ## AND THE SCOPE, BECAUSE IT IS MISREAD
 *
 * As an `APP_INTERCEPTOR` this sees **only the thin app's own routes**. It does
 * not see PostgREST, which is a separate process (`postgrest.conf`), and no
 * placement choice inside Nest changes that. So a CRUD read or write through the
 * API layer is not scanned by this interceptor, and nothing in this tree claims
 * otherwise.
 *
 * ## WHAT IS SCANNED, AND WHAT IS NOT STORED
 *
 * The request's own URL (path and query) and the top-level string fields of its
 * body. The fields are inspected and **nothing about their contents is kept**:
 * the collector receives the pattern's type, the NAME of the field, and the
 * address the request came from. A body on this application carries a password,
 * and §2.5 forbids writing one anywhere.
 */
@Injectable()
export class SecurityTelemetryInterceptor implements NestInterceptor {
  private readonly env: Environment;

  constructor(
    private readonly collector: SecurityTelemetryCollector,
    config: ConfigService,
  ) {
    this.env = config.getOrThrow<Environment>('environment');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.observe(context);
    return next.handle();
  }

  /**
   * The detection itself.
   *
   * **Nothing here can fail the request.** The detector is a pure function over
   * strings, the address helpers never throw, and the collector only counts. The
   * one thing that could go wrong — a body that is not an object, an address the
   * transport did not report — is handled by narrowing rather than by catching,
   * so there is no error path that could swallow a request.
   */
  private observe(context: ExecutionContext): void {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const matches = detectPatternMatches(this.scannedFields(request));
    if (matches.length === 0) {
      return;
    }

    const ip = request.ip;
    const normalized = normalizeIpAddress(ip);
    // An allowlisted address is not counted, and not scanned either: the
    // allowlist is a list of addresses the operator has vouched for, and the
    // per-account gate already writes no canonical keys for them. Recording them
    // here would put a host the operator trusts into the reputation table.
    if (normalized !== '' && this.env.security.ipAllowlist.includes(normalized)) {
      return;
    }

    const subnet = ipSubnetKey(normalized);
    const route = this.routeOf(context);
    const attempt = route === undefined ? undefined : ATTEMPT_ROUTES[route];
    const subject = attempt === undefined ? null : this.subjectOf(request.body, attempt);
    const observedAtMs = Date.now();

    for (const match of matches) {
      this.collector.observe({
        type: match.type,
        severity: match.severity,
        ip,
        ipNormalized: normalized,
        ipSubnet: subnet,
        subject,
        attemptKind: attempt?.kind ?? null,
        route: route ?? 'unrouted',
        field: match.field,
        observedAtMs,
      });
    }
  }

  /**
   * The fields offered to the detector.
   *
   * **The body's TOP-LEVEL string fields, and the URL.** Nested objects are not
   * walked: a body is a DTO here, the DTOs are flat, and an unbounded walk over
   * a caller-supplied structure is work the caller controls on the request path.
   */
  private scannedFields(request: FastifyRequest): readonly ScannedField[] {
    const fields: ScannedField[] = [];
    const body: unknown = request.body;
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
        if (typeof value === 'string') {
          fields.push({ name, value });
        }
        if (fields.length >= MAX_SCANNED_FIELDS) {
          break;
        }
      }
    }
    // The URL carries the path and the query string, percent-encoded as they
    // arrived. It is offered under one name so a value in the query is not
    // counted twice.
    fields.push({ name: 'url', value: request.url });
    return fields;
  }

  /**
   * The identity the request was aimed at.
   *
   * **`null` when there is none**, which is the honest answer for a route that is
   * not an attempt: the pattern is still recorded, it simply has no identity to
   * count and no attempt to link to.
   */
  private subjectOf(body: unknown, attempt: AttemptRoute): string | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return null;
    }
    const value = (body as Record<string, unknown>)[attempt.field];
    if (typeof value !== 'string' || value === '') {
      return null;
    }
    return normaliseAttemptSubject(attempt.kind, value);
  }

  /**
   * The route's dispatch token, which is also how the collector names the route
   * and how `ATTEMPT_ROUTES` says whether this request was an attempt.
   *
   * **`undefined` for a route this build cannot name**, and the observation is
   * then recorded with no attempt kind and no subject — the same state a
   * non-attempt route produces.
   */
  private routeOf(context: ExecutionContext): string | undefined {
    const controller = context.getClass();
    const handler = context.getHandler();
    if (typeof controller !== 'function' || typeof handler !== 'function') {
      return undefined;
    }
    return dispatchTokenForRoute(controller.name, handler.name);
  }
}
