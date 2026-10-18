import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { forkJoin, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { POSTGREST_BASE_URL } from '../../core/api/api-base-urls';
import type {
  DetectedPatternRow,
  DetectedPatternWithAttempts,
  IpReputationRow,
  LoginAttemptRow,
  LoginAttemptWithMock,
  PatternLoginAttemptRow,
  SecurityAlertRow,
} from './security-telemetry.types';

const SECURITY_ALERT_COLUMNS =
  'id,alert_type,severity,title,message,source,pattern_id,ip,ip_normalized,' +
  'ip_subnet,user_id,status,acknowledged_at,acknowledged_by,resolved_at,' +
  'resolved_by,resolution_notes,alert_data,expires_at,is_mock,created_at,updated_at';

const IP_REPUTATION_COLUMNS =
  'id,ip,ip_normalized,ip_subnet,status,reputation_score,failed_attempts,' +
  'captcha_required_count,is_blocked,blocked_until,geo_location,statistics,' +
  'block_history,metadata,is_mock,created_at,updated_at';

const DETECTED_PATTERN_COLUMNS =
  'id,pattern_type,severity,ip,ip_normalized,ip_subnet,detection_timestamp,' +
  'time_window_start,time_window_end,attempt_count,unique_email_count,evidence,' +
  'status,resolved_at,resolved_by,resolution_notes,metadata,is_mock,created_at,updated_at';

const PATTERN_LOGIN_ATTEMPT_COLUMNS =
  'id,pattern_id,login_attempt_id,is_primary_evidence,is_mock,created_at';

const LOGIN_ATTEMPT_COLUMNS =
  'id,username,ip,status,created_at,ip_normalized,ip_subnet,attempt_kind,is_mock';

/**
 * PostgREST reads for the five admin security telemetry pages.
 *
 * ## Admin-only at the table level
 *
 * `0022_security_telemetry.sql` and `0002_refresh_tokens.sql` grant `SELECT` on
 * `security_alerts`, `ip_reputation`, `security_detected_patterns`,
 * `pattern_login_attempts`, and `login_attempts` to `app_admin` and
 * `app_admin_readonly` only. `app_member` holds no grant on any of the five and
 * receives `403` from PostgREST, which reaches the calling page untouched.
 *
 * ## `is_mock` display filtering
 *
 * The four tables from `0022_security_telemetry.sql` (`security_alerts`,
 * `ip_reputation`, `security_detected_patterns`, `pattern_login_attempts`) carry
 * `is_mock boolean NOT NULL DEFAULT false`. When `includeMock` is `false` (the
 * default), this service passes `is_mock=eq.false` so synthetic seed rows do not
 * masquerade as live attacks.
 *
 * `public.login_attempts` (`0002`/`0003`/`0019`) does not have an `is_mock` column
 * in the database schema; instead, synthetic seeded login attempts are linked via
 * `pattern_login_attempts` (`is_mock = true`). `loginAttempts(includeMock)` reads
 * both tables in parallel, tags synthetic attempts with `is_mock: true`, and
 * excludes them when `includeMock` is `false`.
 */
@Injectable({ providedIn: 'root' })
export class SecurityTelemetryApi {
  private readonly http = inject(HttpClient);

  securityAlerts(includeMock = false): Observable<readonly SecurityAlertRow[]> {
    return this.table<SecurityAlertRow>('security_alerts', {
      select: SECURITY_ALERT_COLUMNS,
      order: 'created_at.desc,id.asc',
      ...(includeMock ? {} : { is_mock: 'eq.false' }),
    });
  }

  ipReputation(includeMock = false): Observable<readonly IpReputationRow[]> {
    return this.table<IpReputationRow>('ip_reputation', {
      select: IP_REPUTATION_COLUMNS,
      order: 'reputation_score.asc,updated_at.desc,id.asc',
      ...(includeMock ? {} : { is_mock: 'eq.false' }),
    });
  }

  detectedPatterns(includeMock = false): Observable<readonly DetectedPatternWithAttempts[]> {
    const mockFilter: Record<string, string> = includeMock ? {} : { is_mock: 'eq.false' };
    return forkJoin({
      patterns: this.table<DetectedPatternRow>('security_detected_patterns', {
        select: DETECTED_PATTERN_COLUMNS,
        order: 'detection_timestamp.desc,id.asc',
        ...mockFilter,
      }),
      links: this.table<PatternLoginAttemptRow>('pattern_login_attempts', {
        select: PATTERN_LOGIN_ATTEMPT_COLUMNS,
        ...mockFilter,
      }),
      attempts: this.table<LoginAttemptRow>('login_attempts', {
        select: LOGIN_ATTEMPT_COLUMNS,
        order: 'created_at.desc,id.asc',
      }),
    }).pipe(
      map(({ patterns, links, attempts }) => attachPatternAttempts(patterns, links, attempts)),
    );
  }

  /**
   * `login_attempts`, with the synthetic rows hidden by default.
   *
   * THE FILTER IS SERVER-SIDE, and it is a predicate on the table rather than a
   * filter in this process. `0025` gave `login_attempts` an `is_mock` column, so
   * an attempt's synthetic-ness is a property of the ROW.
   *
   * Before that column existed, this method asked a second question: it fetched
   * every `pattern_login_attempts` row with `is_mock = true` and treated every
   * attempt they referenced as synthetic. That was an accidental property of how
   * the rows happened to be linked — a synthetic attempt that was not linked to a
   * pattern was indistinguishable from a real one — and it put the filter in
   * JavaScript, so a direct request to `/rest/login_attempts` returned the
   * synthetic rows whatever this page did. A display filter a caller can bypass
   * by asking the database a different question is not a filter.
   */
  loginAttempts(includeMock = false): Observable<readonly LoginAttemptWithMock[]> {
    return this.table<LoginAttemptRow>('login_attempts', {
      select: LOGIN_ATTEMPT_COLUMNS,
      order: 'created_at.desc,id.asc',
      ...(includeMock ? {} : { is_mock: 'eq.false' }),
    });
  }

  private table<Row extends object>(path: string, query: Record<string, string>): Observable<Row[]> {
    return this.http.get<Row[]>(`${POSTGREST_BASE_URL}/${path}`, {
      params: new HttpParams({ fromObject: query }),
    });
  }
}

function attachPatternAttempts(
  patterns: readonly DetectedPatternRow[],
  links: readonly PatternLoginAttemptRow[],
  attempts: readonly LoginAttemptRow[],
): readonly DetectedPatternWithAttempts[] {
  const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const linksByPattern = new Map<string, PatternLoginAttemptRow[]>();
  for (const link of links) {
    const bucket = linksByPattern.get(link.pattern_id);
    if (bucket === undefined) {
      linksByPattern.set(link.pattern_id, [link]);
    } else {
      bucket.push(link);
    }
  }

  return patterns.map((pattern) => {
    const patternLinks = linksByPattern.get(pattern.id) ?? [];
    const linkedAttempts: LoginAttemptWithMock[] = [];
    for (const link of patternLinks) {
      const found = attemptsById.get(link.login_attempt_id);
      if (found !== undefined) {
        // The attempt carries its OWN `is_mock` since `0025`; the link's flag is
        // about the link. Reading the attempt's flag is what makes an attempt
        // that is linked to no pattern at all still identifiable as synthetic.
        linkedAttempts.push(found);
      }
    }
    return {
      ...pattern,
      linkedAttempts,
    };
  });
}
