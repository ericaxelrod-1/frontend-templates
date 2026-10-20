import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { NEST_BASE_URL, POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import type { ProfileMe } from '../profile/profile-me';
import type { EraseResponse, PrivacyPurgeQueueItem } from './privacy.types';

/**
 * Privacy and erasure API service.
 *
 * ## SELF-SERVICE ERASURE
 *
 * Calls `POST /api/privacy/erase` on the thin Nest application. The backend extracts
 * the subject identity exclusively from the caller's verified JWT `sub` claim — there
 * is no subject parameter in the request body or path, making cross-subject erasure
 * unrepresentable (AGENTS.md §2.1).
 *
 * ## RETENTION PURGE QUEUE
 *
 * PostgREST read against `privacy_purge_queue` to provide visibility into the
 * scheduled physical purge pipeline.
 */
@Injectable({ providedIn: 'root' })
export class PrivacyApi {
  private readonly http = inject(HttpClient);

  /**
   * Request erasure of the signed-in caller's own account.
   *
   * Triggers immediate soft-delete + HMAC tombstone anonymisation, session revocation,
   * authority revocation, and delivery of an erasure receipt to the caller's email.
   */
  eraseSelf(): Observable<EraseResponse> {
    return this.http.post<EraseResponse>(`${NEST_BASE_URL}/privacy/erase`, {});
  }

  /**
   * Reads the caller's own account and privacy attributes.
   */
  myPrivacyState(): Observable<ProfileMe> {
    return this.http.get<ProfileMe>(`${NEST_BASE_URL}/users/me`);
  }

  /**
   * Reads scheduled purge queue items for retention visibility.
   */
  purgeQueue(): Observable<readonly PrivacyPurgeQueueItem[]> {
    return this.http.get<PrivacyPurgeQueueItem[]>(
      `${POSTGREST_BASE_URL}/privacy_purge_queue?select=id,status,scheduled_for,completed_at&order=scheduled_for.desc&limit=10`,
    );
  }
}
