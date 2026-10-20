/**
 * A user row containing account disable and suspension attributes.
 *
 * `null` values represent database NULLs (e.g., permanent disable or automated disable).
 */
export interface DisabledUserRow {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly created_at: string;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly disabled_at?: string | null;
  readonly disabled_by?: string | null;
  readonly disabled_reason?: string | null;
  readonly disabled_until?: string | null;
}
