/**
 * Canonical IP normalisation and subnet aggregation for the brute-force
 * counters (W11 slice 3, security.md §IP reputation).
 *
 * The property that matters: representation rotation must not fragment a
 * counter. `1.2.3.4`, `::ffff:1.2.3.4`, `::FFFF:1.2.3.4` and `1.2.3.04`
 * are the same host and must key the same counter. Both the normalised-host
 * key and the subnet key are therefore derived from the address, never from
 * the caller's string.
 *
 * IPv4 → the subnet key is the normalised host itself (a /32): IPv4
 * addresses are scarce enough that per-address counting is meaningful, and
 * aggregating to a /24 would let one shared-NAT office hide behind a single
 * counter shared with hundreds of strangers. Rotation is already handled by
 * canonical normalisation, so no wider prefix is needed.
 *
 * IPv6 → the subnet key is the /64: subscribers receive a /64, so a
 * per-address counter is worthless against an attacker who rotates within
 * it, and /64 is the granularity security.md names.
 *
 * An unparseable input is returned trimmed-but-verbatim rather than throwing:
 * a counter keyed on it still records *something*, and an attacker fuzzing
 * source strings cannot take the login path down (§2.3 — the decision is
 * still made, fail-closed-ish, never a crash). The request-IP from the
 * HTTP server is expected to be parseable; the audit row keeps the raw value.
 */

/** Normalises a dotted-quad string, stripping leading zeros: '01.2.3.4' → '1.2.3.4'. */
function normalizeIpv4(text: string): string | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) {
    return undefined;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }
    const value = Number.parseInt(part, 10);
    if (value > 255) {
      return undefined;
    }
    octets.push(value);
  }
  return octets.join('.');
}

/**
 * Expands an IPv6 address to its eight 16-bit groups. Handles `::`
 * compression and an embedded dotted-quad tail. Returns undefined when the
 * text is not a parseable IPv6 address.
 */
function ipv6Groups(text: string): number[] | undefined {
  let working = text;
  const lastColon = working.lastIndexOf(':');
  if (lastColon >= 0) {
    const maybeV4 = working.slice(lastColon + 1);
    if (maybeV4.includes('.')) {
      const v4 = normalizeIpv4(maybeV4);
      if (v4 === undefined) {
        return undefined;
      }
      const octets = v4.split('.').map((octet) => Number.parseInt(octet, 10));
      const hi = ((octets[0] ?? 0) * 256 + (octets[1] ?? 0)).toString(16);
      const lo = ((octets[2] ?? 0) * 256 + (octets[3] ?? 0)).toString(16);
      working = working.slice(0, lastColon + 1) + `${hi}:${lo}`;
    }
  }
  const doubleColon = working.indexOf('::');
  const hasCompression = doubleColon >= 0;
  const headText = hasCompression ? working.slice(0, doubleColon) : working;
  const tailText = hasCompression ? working.slice(doubleColon + 2) : '';
  const parseGroups = (value: string): number[] | undefined => {
    if (value === '') {
      return [];
    }
    const groups = value.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
        return undefined;
      }
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = parseGroups(headText);
  const tailGroups = hasCompression ? parseGroups(tailText) : [];
  if (head === undefined || tailGroups === undefined) {
    return undefined;
  }
  let groups: number[];
  if (hasCompression) {
    const missing = 8 - (head.length + tailGroups.length);
    if (missing < 0) {
      return undefined;
    }
    groups = [...head, ...new Array<number>(missing).fill(0), ...tailGroups];
  } else {
    if (head.length !== 8) {
      return undefined;
    }
    groups = head;
  }
  return groups;
}

/** Canonical compressed lowercase form of an IPv6 group list (RFC 5952-ish). */
function canonicalIpv6(groups: number[]): string {
  // Longest run of zero groups, length >= 2, earliest start on ties (RFC 5952).
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === 0) {
      if (runStart < 0) {
        runStart = i;
      }
      const runLength = i - runStart + 1;
      if (runLength > bestLength) {
        bestStart = runStart;
        bestLength = runLength;
      }
    } else {
      runStart = -1;
    }
  }
  const hextets = groups.map((group) => group.toString(16));
  if (bestLength >= 2) {
    const head = hextets.slice(0, bestStart).join(':');
    const tailStart = bestStart + bestLength;
    const tail = hextets.slice(tailStart).join(':');
    return `${head}::${tail}`;
  }
  return hextets.join(':');
}

/**
 * Returns the canonical form of an IP address:
 * - IPv4: dotted quad, no leading zeros (`1.2.3.04` → `1.2.3.4`).
 * - IPv6: lowercase, compressed (RFC 5952-ish) — `2001:DB8::0001` → `2001:db8::1`.
 * - IPv4-mapped IPv6 (`::ffff:1.2.3.4`, full form `0:0:0:0:0:ffff:1.2.3.4`):
 *   flattened to the dotted quad, so it keys identically to the plain IPv4.
 * - Unparseable input: returned as-is (trimmed); never throws.
 */
export function normalizeIpAddress(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') {
    return '';
  }
  let text = raw.trim();
  const zone = text.indexOf('%');
  if (zone >= 0) {
    text = text.slice(0, zone);
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1);
  }
  if (text.includes(':')) {
    const groups = ipv6Groups(text);
    if (groups === undefined) {
      return text;
    }
    // IPv4-mapped IPv6: groups 0..4 == 0, group 5 == 0xffff.
    const mapped =
      groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0xffff;
    if (mapped) {
      const a = (groups[6] ?? 0) >> 8;
      const b = (groups[6] ?? 0) & 0xff;
      const c = (groups[7] ?? 0) >> 8;
      const d = (groups[7] ?? 0) & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
    return canonicalIpv6(groups);
  }
  const v4 = normalizeIpv4(text);
  return v4 ?? text;
}

/**
 * Subnet-aggregated counter key:
 * - IPv4: the normalised host (a /32) — precise, rotation-safe.
 * - IPv6: the first 64 bits (`xxxx:xxxx:xxxx:xxxx::/64`), because per-address counters are
 *   worthless inside a subscriber's /64.
 * - Unparseable/empty input: returned as-is, never throws.
 */
export function ipSubnetKey(normalized: string): string {
  if (normalized === '') {
    return '';
  }
  if (normalized.includes(':')) {
    const groups = ipv6Groups(normalized);
    if (groups === undefined) {
      return normalized;
    }
    const head = groups.slice(0, 4);
    return `${canonicalIpv6([...head, 0, 0, 0, 0])}/64`;
  }
  return normalized;
}
