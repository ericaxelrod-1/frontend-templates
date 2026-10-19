import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable, throwError } from 'rxjs';
import { POSTGREST_BASE_URL } from '../api/api-base-urls';
import type {
  ConsentPageGroup,
  ConsentPurpose,
  ConsentRecord,
  ConsentTag,
  ConsentTagGroup,
} from './consent.types';

/**
 * Communicates with PostgREST for the consent data model.
 *
 * All operations target the PostgREST base path directly:
 * - `consent_purposes` (catalogue)
 * - `consent_page_groups` (route matching)
 * - `consent_tags` (tracking scripts and purpose requirements)
 * - `consent_tag_groups` (join table)
 * - `consent_records` (append-only audit log)
 *
 * ## THE CATALOGUE READS DO NOT SWALLOW THEIR ERROR
 *
 * The four catalogue reads used to end in `catchError(() => of([]))`, which
 * turned a catalogue that could not be fetched into an EMPTY catalogue —
 * indistinguishable from a deployment that has configured no purposes, and the
 * reason the consent gate's own `catch { }` was unreachable: the failure never
 * reached it. A gate with an empty catalogue has no groups and no tags, so no
 * tag can ever load, and the application behaves exactly like a deployment
 * with no analytics (AGENTS.md §2.3).
 *
 * The error therefore propagates to the consent gate, which reports it and
 * continues with an empty catalogue — which injects nothing. The same
 * reasoning the write path below already sets out applies here: a read that
 * cannot be attempted fails, and it fails loudly.
 */
@Injectable({ providedIn: 'root' })
export class ConsentApi {
  private readonly http = inject(HttpClient, { optional: true });

  /** Reads the catalogue of processing purposes, ordered by display rank. */
  purposes(): Observable<readonly ConsentPurpose[]> {
    if (!this.http) {
      return throwError(
        () => new Error('no HTTP client is available, so the consent catalogue cannot be read'),
      );
    }
    return this.http.get<ConsentPurpose[]>(`${POSTGREST_BASE_URL}/consent_purposes`, {
      params: new HttpParams({ fromObject: { order: 'sort_order.asc,key.asc' } }),
    });
  }

  /** Reads the configured page groups and their path globs. */
  pageGroups(): Observable<readonly ConsentPageGroup[]> {
    if (!this.http) {
      return throwError(
        () => new Error('no HTTP client is available, so the consent catalogue cannot be read'),
      );
    }
    return this.http.get<ConsentPageGroup[]>(`${POSTGREST_BASE_URL}/consent_page_groups`, {
      params: new HttpParams({ fromObject: { order: 'key.asc' } }),
    });
  }

  /** Reads active tracking tags. */
  tags(): Observable<readonly ConsentTag[]> {
    if (!this.http) {
      return throwError(
        () => new Error('no HTTP client is available, so the consent catalogue cannot be read'),
      );
    }
    return this.http.get<ConsentTag[]>(`${POSTGREST_BASE_URL}/consent_tags`, {
      params: new HttpParams({ fromObject: { enabled: 'eq.true' } }),
    });
  }

  /** Reads the join mapping tags to page groups. */
  tagGroups(): Observable<readonly ConsentTagGroup[]> {
    if (!this.http) {
      return throwError(
        () => new Error('no HTTP client is available, so the consent catalogue cannot be read'),
      );
    }
    return this.http.get<ConsentTagGroup[]>(`${POSTGREST_BASE_URL}/consent_tag_groups`);
  }

  /**
   * Reads a signed-in subject's consent records, newest first.
   *
   * RLS restricts this table to `user_id = authz.actor()`, so a member receives
   * exclusively their own decisions. Derives current effective consent by
   * taking the first record for each purpose key.
   *
   * ## THE THREE STATES, AND WHY A FAILED READ IS NOT ONE OF THEM
   *
   * The answer to "what are this subject's records?" has three outcomes, and
   * this function used to collapse two of them into one:
   *
   * 1. **the server answered and holds records** — the records are emitted;
   * 2. **the server answered and holds none** — an empty list is emitted;
   * 3. **the server did not answer** — the error propagates.
   *
   * It used to end in `catchError(() => of([]))`, which turned (3) into (2).
   * The sign-in sync reads an empty list as "the server holds no records for
   * this person", and its rule is "if the server holds no record, adopt the
   * browser's decision" — so a transient network error, a 500 or a timeout
   * made the gate conclude that the account had never consented and then
   * **wrote the browser's anonymous decision to the server**, under the wrong
   * `mechanism` and `source`, as though the person had chosen it.
   *
   * The log is append-only, so the mistaken record cannot be corrected, only
   * added to. A decision must never be written from an unanswered question.
   *
   * So the failure now propagates, exactly as the catalogue reads and the
   * write above already do: the caller has to decide what an unanswered
   * question means, and that decision is not this function's to make.
   */
  effectiveConsent(userId: string): Observable<readonly ConsentRecord[]> {
    if (!this.http) {
      return throwError(
        () => new Error('no HTTP client is available, so the consent records cannot be read'),
      );
    }
    return this.http.get<ConsentRecord[]>(`${POSTGREST_BASE_URL}/consent_records`, {
      params: new HttpParams({
        fromObject: {
          user_id: `eq.${userId}`,
          order: 'recorded_at.desc,id.desc',
        },
      }),
    });
  }

  /**
   * Appends an explicit consent decision through the server write seam.
   *
   * `POST /rpc/record_consent_decision` is the `public` wrapper the backend
   * migration creates; the write itself happens in `authz.record_consent_decision`,
   * which derives the subject from the token's claims, so there is no user id in
   * this call and there is nothing here that could record a decision for somebody
   * else.
   *
   * **THE FAILURE IS NOT CAUGHT, AND THAT IS THE POINT.**
   *
   * This used to end in `catchError(() => of(null))`, which turned a rejected
   * write — a 404 from a route that did not exist, a `42501` from a refused
   * subject, a 500 from a broken deployment — into a value the caller could not
   * tell from a successful write that returned nothing. The person who clicked
   * "accept" was told their choice was recorded when no row existed, and the
   * defect was invisible: the feature was present, looked right, and did nothing
   * (AGENTS.md §2.3).
   *
   * The error therefore propagates to the subscriber, which is the only place
   * that can tell the person their choice was not recorded. The same reasoning
   * applies to the "no HTTP client" branch: a write that cannot be attempted
   * fails, and it fails loudly.
   */
  recordConsentDecision(
    purposeKey: string,
    granted: boolean,
    mechanism: string,
    source = 'app',
  ): Observable<string> {
    if (!this.http) {
      return throwError(
        () => new Error('no HTTP client is available, so the consent decision cannot be recorded'),
      );
    }
    return this.http
      .post<string | { id?: string }>(`${POSTGREST_BASE_URL}/rpc/record_consent_decision`, {
        p_purpose_key: purposeKey,
        p_granted: granted,
        p_mechanism: mechanism,
        p_source: source,
      })
      .pipe(
        map((res) => {
          // PostgREST returns a scalar-returning function as a bare JSON string.
          // Anything else that carries an id is accepted; anything else is a
          // failure, and a failure is reported as one rather than as a write
          // that "probably" happened.
          if (typeof res === 'string') {
            return res;
          }
          const id = res.id;
          if (typeof id === 'string') {
            return id;
          }
          throw new Error('the consent write returned no record id');
        }),
      );
  }
}
