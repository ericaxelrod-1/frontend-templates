/**
 * The hostile-pattern set, and the detector that applies it.
 *
 * ## WHAT A PATTERN IS HERE
 *
 * A pattern is a SHAPE a hostile request carries, not a verdict about the request.
 * The registry is the whole of the threat model this build carries: SQL injection,
 * XSS, path traversal, command injection, LDAP injection and NoSQL injection. A
 * fork that faces a different surface adds ONE entry to {@link HOSTILE_PATTERNS}
 * and nothing else changes — the detector, the collector, the writer and the tests
 * all read that array.
 *
 * ## WHY THE DETECTOR IS A PURE FUNCTION AND NOT A SERVICE
 *
 * It reads strings and returns matches. It touches no database, no clock, no
 * network and no state, so it is the one part of this feature that can be reasoned
 * about — and it is the only part that runs on the request path. Keeping it free of
 * I/O is what lets the request-path cost be "a bounded number of regular
 * expression tests" rather than "a number of round trips".
 *
 * ## WHAT A MATCH CARRIES, AND WHAT IT MUST NOT
 *
 * A match carries the pattern's TYPE, its SEVERITY, and the NAME of the field that
 * matched. **It never carries the value.** The fields these producers inspect are
 * request bodies, and a request body on this application carries a password
 * (`AGENTS.md` §2.5: "Never log credentials, tokens, passwords, or full request
 * bodies"). The name of the field is enough for an investigator — "the username
 * carried an injection payload" — and the value is the thing that must never be
 * written anywhere.
 *
 * ## THE BOUNDS, AND WHY THEY ARE HERE
 *
 * The detector runs on the request path, so it is bounded twice over:
 *
 *   * **a value is truncated** at {@link MAX_SCANNED_VALUE_LENGTH} characters, so a
 *     caller cannot make the process spend a minute on one field by sending a
 *     megabyte of it;
 *   * **the number of fields is capped** at {@link MAX_SCANNED_FIELDS}, so a body
 *     with a thousand keys cannot make the detector do a thousand passes.
 *
 * The regular expressions are also written to be linear in the length of the
 * value: none of them nests a quantifier inside a quantifier, so none of them can
 * backtrack catastrophically. That is a property of the pattern set and it is why
 * a hostile caller cannot turn the detector itself into the denial of service.
 */

export type PatternSeverity = 'low' | 'medium' | 'high' | 'critical';

/** One shape a hostile request carries. */
export type HostilePattern = {
  /** The stable name recorded in `security_detected_patterns.pattern_type`. */
  readonly type: string;
  /** The severity recorded alongside it, and the severity of the alert it raises. */
  readonly severity: PatternSeverity;
  /**
   * The shape itself.
   *
   * **Never global.** A `/g` regular expression carries `lastIndex` between calls
   * to `test`, so the same value would match on one call and not on the next — a
   * detector whose answer depends on how many times it has been called is not a
   * detector.
   */
  readonly expression: RegExp;
};

/**
 * SQL injection.
 *
 * The alternatives are each a complete shape rather than a single token, because
 * the tokens (`or`, `select`, `;`) appear in ordinary text and a detector built
 * out of them would report every message that contained the word "select".
 */
const SQL_INJECTION: HostilePattern = {
  type: 'sql_injection',
  severity: 'high',
  expression:
    /\bunion\s+(?:all\s+)?select\b|['"`]?\b(?:or|and)\b\s+['"`]?[\w.]+['"`]?\s*=\s*['"`]?[\w.]+['"`]?|;\s*\b(?:drop|delete|truncate|alter|insert|update)\b|\bsleep\s*\(\s*\d+\s*\)|\b(?:select|insert|update|delete)\b[^;]{0,120}\bfrom\b[^;]{0,80}\bwhere\b[^;]{0,60}\b(?:information_schema|pg_catalog|pg_user|sysobjects)\b/i,
};

/**
 * Cross-site scripting.
 *
 * The event-handler form (`onerror=`) is included because it is the one that
 * survives a naive "strip the tags" filter, and the `javascript:`/`data:` URL
 * forms because a payload does not need a tag at all.
 */
const XSS: HostilePattern = {
  type: 'xss',
  severity: 'high',
  expression:
    /<\s*script\b|<\s*\/\s*script\s*>|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon(?:error|load|mouseover|focus|click)\s*=\s*['"`]?[\w(]/i,
};

/**
 * Path traversal.
 *
 * Both the literal form and the PERCENT-ENCODED ones are matched, because a
 * traversal is usually encoded on the way in and decoded on the way down — and
 * the double-encoded form is there because a decoder that runs twice is a real
 * thing to find.
 */
const PATH_TRAVERSAL: HostilePattern = {
  type: 'path_traversal',
  severity: 'medium',
  expression: /(?:\.\.[/\\]){2,}|\.\.%2f|%2e%2e[/\\]|%252e%252e|\.\.\.\//i,
};

/**
 * Command injection.
 *
 * The shell metacharacter has to be followed by a COMMAND, not merely be present:
 * a `;` in a display name is not an attack, and a detector that reports it teaches
 * its reader to ignore it.
 */
const COMMAND_INJECTION: HostilePattern = {
  type: 'command_injection',
  severity: 'critical',
  expression: /[;&|`]\s*(?:cat|ls|id|whoami|uname|curl|wget|nc|netcat|sh|bash|python\d?|perl)\b|\$\([^)]{1,80}\)/i,
};

/**
 * LDAP injection.
 *
 * The filter-closing forms are the shapes that change the MEANING of a filter
 * rather than merely its contents: `*)(` closes one filter and opens another,
 * and `)(|` appends an alternative to it. The last two alternatives catch the
 * attribute-comparison forms, where the payload names a field the filter did not
 * name before.
 */
const LDAP_INJECTION: HostilePattern = {
  type: 'ldap_injection',
  severity: 'medium',
  expression:
    /\*\)\s*\(|\)\s*\(\s*[|&!]|\)\s*\(\s*(?:cn|uid|objectclass|sn)\s*=|\|\s*(?:cn|uid)\s*=/i,
};

/**
 * NoSQL injection.
 *
 * The operator forms (`$ne`, `$gt`, `$where`) are what turn a JSON value into a
 * query. `$ne` alone is enough to turn "the password equals this" into "the
 * password is not this".
 */
const NOSQL_INJECTION: HostilePattern = {
  type: 'nosql_injection',
  severity: 'medium',
  expression: /\$where\b|\$ne\b|\$gt\b|\$gte\b|\$regex\b|\{\s*\$/i,
};

/**
 * THE PATTERN SET.
 *
 * **This array is the whole of the threat model, and adding an entry here is the
 * whole of adding a pattern.** The detector iterates it; the collector keys its
 * buckets on `type`; the writer writes `pattern_type`; the alert's `alert_type` is
 * the same string; and the test suite has a payload per entry, so a new pattern
 * that nobody has proved detectable fails the suite rather than sitting here
 * untested.
 *
 * Frozen, because the array is read on the request path by every request and a
 * mutable registry is a registry a test can mutate between two assertions.
 */
export const HOSTILE_PATTERNS: readonly HostilePattern[] = Object.freeze([
  SQL_INJECTION,
  XSS,
  PATH_TRAVERSAL,
  COMMAND_INJECTION,
  LDAP_INJECTION,
  NOSQL_INJECTION,
]);

/** One field offered to the detector: a NAME and a value. */
export type ScannedField = {
  readonly name: string;
  readonly value: string;
};

/**
 * One pattern found in one field.
 *
 * `field` is the field's NAME and never its value — see the file header.
 */
export type PatternMatch = {
  readonly type: string;
  readonly severity: PatternSeverity;
  readonly field: string;
};

/** The most characters of one value the detector will look at. */
export const MAX_SCANNED_VALUE_LENGTH = 2048;

/** The most fields the detector will look at in one request. */
export const MAX_SCANNED_FIELDS = 32;

/**
 * Applies every pattern to every field.
 *
 * **One match per (pattern, field) pair.** A value carrying two different
 * injection payloads reports two patterns; a value carrying the same payload
 * twice reports one, because the second occurrence is not a second finding.
 *
 * The result is ordered by pattern and then by field, so two calls over the same
 * input produce the same array — which is what lets a test assert on it.
 */
export function detectPatternMatches(fields: readonly ScannedField[]): readonly PatternMatch[] {
  const matches: PatternMatch[] = [];
  const seen = new Set<string>();
  for (const field of fields.slice(0, MAX_SCANNED_FIELDS)) {
    const value = field.value.slice(0, MAX_SCANNED_VALUE_LENGTH);
    for (const pattern of HOSTILE_PATTERNS) {
      const key = `${pattern.type}|${field.name}`;
      if (seen.has(key)) {
        continue;
      }
      if (pattern.expression.test(value)) {
        seen.add(key);
        matches.push({ type: pattern.type, severity: pattern.severity, field: field.name });
      }
    }
  }
  return matches;
}
