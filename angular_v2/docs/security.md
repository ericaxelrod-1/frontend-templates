# Security

Threat model and controls for `angular_v2/`. Baseline: an app that must survive
being forked and built upon, running with zero third-party credentials.

Full inventory of what was removed and why is in [`rebase.md`](./rebase.md).
Decisions are in [`adr.md`](./adr.md) — ADR-0002, ADR-0004, ADR-0008 through
ADR-0011, ADR-0017 and ADR-0022 cover this document.

**The security model spans two runtimes.** PostgREST verifies the JWT and serves
CRUD; a thin Nest app issues tokens and handles everything PostgREST cannot do.
Most controls below are enforced at or below the database. Neither runtime is
trusted to remember a policy.

---

## Design principle

Every control is positioned in a hierarchy. Controls do not all bear load at the
same level, because they are not equally strong.

| Strength | Layer | Why |
|---|---|---|
| **Cannot be bypassed** | Postgres RLS | Sits below both runtimes. No request path can evade it. |
| **Cannot be bypassed** | Column-level `REVOKE` | A revoked column is unreadable, not merely omitted |
| **Default deny** | PostgREST JWT verification + `APP_GUARD` on the thin app | Forgetting auth is loud, not silent |
| **Runs before the query** | `db-pre-request` | Revocation and per-request throttling, ahead of any data access |
| **Fails on abuse** | Per-account counter → delay + challenge | Cannot be weaponised into a lockout DoS. |
| **Corroborating** | IP reputation | Weak identity in 2026; never the primary control. |
| **Speed bump** | CAPTCHA | Defeats unsophisticated traffic. Bypassable by farms. |
| **Triage only** | Behavioural scoring | Informs a decision. Never blocks. |

The previous implementation inverted this: the weakest signal (IP) carried the
primary load, and the strongest mechanism (a database policy) was reimplemented in
application code where it enforced nothing.

**One architectural decision removes most of the attack surface.** TypeORM is not
a dependency. There is no `entityManager`, no `createQueryBuilder`, and no
raw-query escape hatch — `entityManager.query()` was precisely how the previous
implementation evaded its own security layer. With no ORM, application code
cannot issue SQL at all.

---

## Authentication

- **PostgREST verifies the JWT** from `PGRST_JWT_SECRET` and performs role
  impersonation via the `role` claim. `jwt-role-claim-key` is set explicitly.
- **The thin app registers `JwtAuthGuard` via `APP_GUARD`. Default deny.** Public
  routes opt out with an explicit `@Public()` decorator — never by forgetting a
  guard.
- **Both runtimes read the same secret.** If the two diverge, fail loudly at
  boot rather than issuing tokens nothing accepts.
- **No default `JWT_SECRET`.** Bootstrap asserts presence and minimum length, and
  throws otherwise.
- **Revocation via `db-pre-request`.** PostgREST enforces no constraint beyond
  JWT validation; upstream's own example is *"immediately revoke access for a
  certain user"*. A `jti` allowlist checked there takes effect on the next
  request rather than at token expiry.
- Access tokens are short-lived (~15–30 min). Permissions are read from the
  database on refresh, **not baked into the token**, so revocation takes effect
  within one token lifetime rather than one week.
- Refresh tokens are persisted in the database, rotated on every use, and
  genuinely revocable. In-memory session state is forbidden — it breaks on restart
  and on more than one instance.
- Logout invalidates the refresh token for real.
- Password hashing is bcrypt or argon2, cost ≥ 12, configurable.

### Login flow ordering

Controls run **above** credential validation, so a bad password is still recorded
and still counts toward throttling:

```
POST /auth/login          (thin Nest app)
  1. IP block check        ─┐
  2. CAPTCHA verification   │ before any password is examined
  3. bcrypt.compare        ─┘
  4. record the attempt, pass or fail
  5. issue tokens
```

There is no Passport strategy to hook. The checks live inside the handler, ordered
so they cannot be skipped by a successful credential comparison.

> **The bug this replaces.** `angular/` put `@UseGuards(LocalAuthGuard)` on the
> login route. Guards run *before* handlers, so the handler — containing the IP
> check, the CAPTCHA gate and the `status: 'failed'` audit write — was reached only
> when credentials were already correct. One misplaced decorator made captcha,
> audit logging, IP reputation and pattern detection all inert simultaneously,
> while every one of them appeared to be working.

Getting this wrong is invisible in review, so it is asserted by test: test 1 below
fails if the audit write moves below the credential check.

---

## Brute force

Per-account failure counting is primary. It drives **progressive delay** and a
**risk-scoped challenge**, not a hard lockout.

| Anti-pattern | Why it fails |
|---|---|
| Hard lock after N failures | Anyone can lock any account by attempting it N times — unauthenticated account-lockout DoS |
| Blanket CAPTCHA on threshold | Attacker deliberately trips the threshold so legitimate users get challenged. Behind CGNAT, one corporate NAT challenges hundreds |
| Permanent lockout | Same DoS, with no recovery |

**Only a party who proves knowledge of the correct password clears the
penalty.** Delay escalates (0s → 1s → 4s → 16s → cap); the challenge appears only
on elevated risk. All thresholds come from config.

## IP reputation

Secondary signal. Two requirements, both currently unmet:

1. **Canonical normalisation.** `1.2.3.4` and `::ffff:1.2.3.4` are the same host
   and must key the same counter. Without this, an attacker rotates string
   representation and never accumulates five failures.
2. **Subnet aggregation.** Per-address counters are worthless against an IPv6
   `/64` or a rotating IPv4 pool. Aggregate to a subnet before counting.

Allowlisted IPs skip counting entirely and cannot be blocked. The allowlist is
populated explicitly; it is not a loopback-only stub.

---

## CAPTCHA

Server-side, self-rolled, zero credentials — the correct answer to the
portability constraint.

- The server issues the challenge and stores the answer. **The answer never
  appears in the challenge payload.**
- Single-use: consumed on verification, so replay fails.
- Expiring: short TTL, plus periodic cleanup of abandoned challenges.
- **Never validated in the browser.** There is nothing to validate client-side —
  this is impossible rather than unfinished.
- An accessible non-visual alternative is required. An image challenge that
  excludes screen-reader users is a liability shipped into every fork.

The three previous implementations were: one correct, one self-solving
(`challenge: solution`), and one frontend service with the answers hardcoded in
client JavaScript. Two deleted, one kept.

---

## Row-level security

Enforced by `CREATE POLICY` in migrations — below both runtimes, so nothing in
application code can evade it.

PostgREST exposes the verified claims as a transaction-scoped setting:

```sql
CREATE POLICY tenant_isolation ON users
  USING (group_id = (current_setting('request.jwt.claims', true)::json->>'group_id')::uuid);
```

The thin Nest app passes identity with `SET LOCAL app.user_id = ...` inside a
transaction.

- Tables intended to be globally readable are listed explicitly. Default is deny.
- **Every policy has a test**: the permitted case returns rows, the denied case
  returns none, and the denied case is proven for each access path. An LLM writing
  `USING (true)` is otherwise invisible.
- Application code must not build query-builder proxies, `Proxy` wrappers, or
  CLS-based scope propagation. Enforcement below the application is the point.

### Never create a view

A view is invoked with the privileges of its owner, like `SECURITY DEFINER`. From
PostgREST's authorization docs:

> When created by a SUPERUSER role, **all row-level security policies will be
> bypassed.**

Migrations run as `postgres`, so every view created by a migration would disable
RLS on its base table, with no error. This has already caused a real leak
(PostgREST #2124). It is the same failure mode as the deleted RLS proxy — a
security mechanism that reports success while enforcing nothing.

Escape hatch exists but is not used here: `CREATE VIEW ... WITH
(security_invoker = true)` on PG ≥ 15. It is a trap rather than a solution, since
it is silent by default and version-gated.

## Hiding columns

Use **column-level privileges**, not a projection:

```sql
REVOKE SELECT ON users FROM api_role;              -- table level first
GRANT  SELECT (id, email, display_name) ON users TO api_role;
```

Order matters: revoking a column while a table-level grant exists **silently does
nothing**. And a column-restricted role cannot use `select=*`, so requests against
that table must name columns explicitly. Prefer keeping sensitive columns out of
the readable set from the outset rather than revoking after the fact.

---

## Detection and alerting

Behavioural and risk scoring is **triage**, not prevention. It informs a decision;
it never silently blocks. It ranks accounts for review.

Known limits, stated so a forker is not misled:

- **Cold start** — a new account has no baseline, so early activity is anomalous
  by definition.
- **False positives dominate** — travel, new device, corporate VPN, CGNAT,
  timezone change all read as anomalies.
- **Detection lags** — credential stuffing completes faster than most polling
  intervals.
- **Adversarial adaptation** — user-agent and IP baselines are spoofable once
  known to the attacker.

Alerts persist to the database. Notification channels are opt-in via config. No
channel stubs that log "would send".

---

## Information disclosure

Removed, not merely guarded:

| Endpoint | Reason |
|---|---|
| `GET /schema/**` | Unauthenticated; returned every table, column, type, PK and FK. PostgREST now emits `openapi.json` from the live schema, so the endpoint is redundant as well as unsafe. |
| `GET /auth/diag/db-check` | Unauthenticated; returned user counts and whether a specific admin account existed. |

`trustProxy` is set explicitly. `X-Forwarded-For` is otherwise attacker-controlled,
which would let one header defeat IP allowlisting and geo-blocking.

---

## Secrets and data

- `.env*` files are never committed. Only `.env.example`.
- Database files are never committed. A tracked SQLite file in `angular/` contained
  real emails, bcrypt hashes, IP addresses and login history.
- Credentials, tokens, passwords and full request bodies are never logged.
- The injected logger is used everywhere. No `console.log`.

## No mocks

A mock service in application code is forbidden. Fixtures live only in
`*.spec.ts` and `*.stories.ts`. No fake is registered in the DI container. No real
integration is bypassed to save time.

> A mock is not a placeholder for work — it is a claim that the work is done. If
> a real service cannot be written yet, the consuming code does not get written
> either. A truthful "this needs X" is a valid outcome; a mock plus a success
> message is a lie.

---

## Frontend is not a security boundary

Permission checks in the frontend are UX affordance. The backend is authoritative.
A hidden button is not access control, and neither is a route guard.

---

## Six tests that must exist

Each currently fails against the old implementation, which is why they are the
proof that this document is implemented rather than merely written:

1. A wrong password creates a `login_attempt` row with `status: 'failed'`.
2. Five failures from one IP make `isBlocked()` return `true`.
3. A blocked IP is rejected **before** credentials are validated.
3b. A revoked `jti` is rejected by `db-pre-request` on the next request.
4. `::ffff:x.x.x.x` and `x.x.x.x` share a counter.
5. Four failures across four IPs for one email throttle that account.
6. A blocked, allowlisted IP is neither blocked nor counted.

Plus, per ADR-0002: every RLS policy has a permitted-case and a denied-case test.