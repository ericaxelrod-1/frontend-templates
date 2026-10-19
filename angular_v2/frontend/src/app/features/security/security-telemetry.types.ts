import type { components } from '../../api/schema';

export type SecurityAlertRow = Pick<
  components['schemas']['security_alerts'],
  | 'id'
  | 'alert_type'
  | 'severity'
  | 'title'
  | 'message'
  | 'source'
  | 'pattern_id'
  | 'ip'
  | 'ip_normalized'
  | 'ip_subnet'
  | 'user_id'
  | 'status'
  | 'acknowledged_at'
  | 'acknowledged_by'
  | 'resolved_at'
  | 'resolved_by'
  | 'resolution_notes'
  | 'alert_data'
  | 'expires_at'
  | 'is_mock'
  | 'created_at'
  | 'updated_at'
>;

export type IpReputationRow = Pick<
  components['schemas']['ip_reputation'],
  | 'id'
  | 'ip'
  | 'ip_normalized'
  | 'ip_subnet'
  | 'status'
  | 'reputation_score'
  | 'failed_attempts'
  | 'captcha_required_count'
  | 'is_blocked'
  | 'blocked_until'
  | 'geo_location'
  | 'statistics'
  | 'block_history'
  | 'metadata'
  | 'is_mock'
  | 'created_at'
  | 'updated_at'
>;

export type DetectedPatternRow = Pick<
  components['schemas']['security_detected_patterns'],
  | 'id'
  | 'pattern_type'
  | 'severity'
  | 'ip'
  | 'ip_normalized'
  | 'ip_subnet'
  | 'detection_timestamp'
  | 'time_window_start'
  | 'time_window_end'
  | 'attempt_count'
  | 'unique_email_count'
  | 'evidence'
  | 'status'
  | 'resolved_at'
  | 'resolved_by'
  | 'resolution_notes'
  | 'metadata'
  | 'is_mock'
  | 'created_at'
  | 'updated_at'
>;

export type PatternLoginAttemptRow = Pick<
  components['schemas']['pattern_login_attempts'],
  'id' | 'pattern_id' | 'login_attempt_id' | 'is_primary_evidence' | 'is_mock' | 'created_at'
>;

export type LoginAttemptRow = Pick<
  components['schemas']['login_attempts'],
  | 'id'
  | 'username'
  | 'ip'
  | 'status'
  | 'created_at'
  | 'ip_normalized'
  | 'ip_subnet'
  | 'attempt_kind'
  | 'is_mock'
>;

/**
 * `is_mock` is on the row since `0025`, so this is the row type and not a
 * wrapper. It was a wrapper while the flag had to be derived from a join, which
 * is what made the filter bypassable.
 */
export type LoginAttemptWithMock = LoginAttemptRow;

export interface DetectedPatternWithAttempts extends DetectedPatternRow {
  readonly linkedAttempts: readonly LoginAttemptWithMock[];
}
