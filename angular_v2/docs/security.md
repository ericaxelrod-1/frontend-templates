# Security

Threat model and controls for `angular_v2/`. Baseline: an app that must survive
being forked and built upon, running with zero third-party credentials.

Full inventory of what was removed and why is in [`rebase.md`](./rebase.md).
Decisions are in [`adr.md`](./adr.md) — ADR-0002, ADR-0004, ADR-0008 through
ADR-0011, ADR-0017, ADR-0022 and **ADR-0023** cover this document.

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
| **Default deny** | `REVOKE ALL ... FROM PUBLIC` before any grant | Default deny is cheaper than default allow |
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

PostgREST exposes the verified claims as a transaction-scoped setting. Read it
defensively, because it returns `''` — not `NULL` — once anything has been
`SET LOCAL` in the session, and `''::json` raises:

```sql
CREATE FUNCTION request_claims() RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
```

> **WITHDRAWN — the policy this section originally showed.** It was
> `USING (site_id = nullif(request_claims()->>'site_id', '')::uuid);`, and the
> `nullif` is not enough: **the `uuid` cast still raises on a malformed claim**,
> taking the whole query down instead of denying. Verified:
> `invalid input syntax for type uuid: "garbage"`. What ships guards the cast:

```sql
CREATE FUNCTION claim_site_id() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE raw text;
BEGIN
  raw := request_claims()->>'site_id';
  IF raw IS NULL OR raw = '' THEN RETURN NULL; END IF;
  RETURN raw::uuid;
EXCEPTION WHEN others THEN RETURN NULL;   -- never raise on attacker input
END $$;

CREATE POLICY tenant_isolation ON projects USING (
    current_user = 'app_admin'
    OR site_id = ANY (site_tree_ids(claim_site_id()))
);
```

- Tables intended to be globally readable are listed explicitly. Default is deny.
- **Key the admin branch on `current_user`, never on the `role` claim.** Verified
  over HTTP: a policy keyed on `request_claims()->>'role' = 'admin'` is **dead
  code** — no token carries the bare string `admin`, the DB role is `app_admin` —
  so a valid admin token got `200 []` and saw nothing. `current_user` is set by
  Postgres from the `SET ROLE` the escalation boundary already constrained, so a
  member who forges `"role":"admin"` into their own validly-signed token gets zero
  rows.
- **A policy is evaluated for EVERY role that reaches the table, `app_anon`
  included.** So `EXECUTE` on the policy's helpers must be granted to `app_anon`
  too — verified, omitting it made an unauthenticated read fail with
  `permission denied for function site_tree_ids` instead of returning zero rows.
  A policy that *errors* is a denial-of-service surface and an oracle.
- **A hierarchy function that walks the table its own policy protects must be
  `SECURITY DEFINER`, and that table must not be `FORCE`d** — one decision, not
  two. Under `SECURITY INVOKER` the walk reads a table whose policy calls the walk,
  and every request as a non-superuser role dies with `stack depth limit exceeded`
  after ~100 frames. `FORCE` on that table does not fix it; it causes it, because
  the owner inside the function is then subject to the same policy. Safe as
  `DEFINER` only because the function reads no caller-supplied table and returns no
  caller-supplied data.
- **`SET LOCAL app.user_id` is not an alternative.** A policy reads the setting it
  names; `app.user_id` is invisible to a policy built on `request.jwt.claims`.
- **VERIFIED: a table's owner bypasses its policies, silently.** Four roles are
  mandatory — a migration/owner role that never serves requests, plus
  `app_anon` / `app_member` / `app_admin` — and `FORCE ROW LEVEL SECURITY` goes on
  every protected table. Otherwise every policy here is decorative.
- **`FORCE` does not bind a superuser or `BYPASSRLS` role** — `postgres` read 5/5
  from a `FORCE`d table. Every role that can reach a protected table must be
  `NOSUPERUSER NOBYPASSRLS`.
- **`FORCE` also blocks the owner from writing**, so seeding goes *through* the
  boundary: connect as `pgrst_authenticator`, `SET ROLE app_admin`, insert.
  Setting `row_security = off` would also work and is used nowhere — it reopens
  the owner bypass for every later session on that backend.
- **`EXECUTE` is granted to `PUBLIC` on new functions by default** (7 of 9 test
  functions had `NULL proacl`), so any `SECURITY DEFINER` helper is anonymously
  reachable. **But a revoke is not a policy**: revoking from `PUBLIC` while
  granting to *nobody* `403`s every scoped request
  (`permission denied for function request_claims`) and leaves row scoping
  **100% non-functional** while everything on the page still looks right. Revoke
  and grant, together.
- **The JWT `role` claim is an escalation vector.** A validly-signed token naming
  a table-owning role got full read, and its `DELETE` returned `204` and removed
  the row. The control is `GRANT app_anon, app_member, app_admin TO
  pgrst_authenticator` and nothing else — mint-time validation protects only the
  issuer. That `GRANT` needs `ADMIN OPTION`, so it **cannot** run in a migration
  (`must have admin option on role "app_anon"`); it is a superuser statement in
  `database/bootstrap/001_roles.sql`, asserted there by reading `pg_auth_members`.
- **`jwt-role-claim-key` must be the JSPath `".role"`.** The bare `"role"` makes
  PostgREST 16.4 **panic on boot** rather than fall back
  (`failed to parse role-claim-key value (role) … unexpected "r" / expecting "."`).
  `$.role` panics too on 16.4 — do not "modernise" it.
- **Denials are invisible in the status code.** No grant → `401`. Grant present,
  RLS denies → `200 []`. A full `USING (true)` leak was **also `200`** — so a
  status-only test passes on a real leak. **Assert on the response body.**
- **Every policy has a test**: the permitted case returns rows, the denied case
  returns none, and the denied case is proven for each access path. An LLM writing
  `USING (true)` is otherwise invisible. The gate is verified rather than asserted:
  disabling `ENABLE ROW LEVEL SECURITY`, dropping the column `REVOKE`s, and
  inverting the boundary `GRANT` each turn `verify` red at step 7 while the earlier
  steps stay green (`rebase.md` §6.6.1).
- Application code must not build query-builder proxies, `Proxy` wrappers, or
  CLS-based scope propagation. Enforcement below the application is the point.

### Scope is one axis; capability is another

ADR-0023 defines the whole model. **Row scope and capability never appear in the
same expression.**

| Axis | Question | Mechanism | Keyed on |
|---|---|---|---|
| Scope | Which rows? | RLS policy | `site_id` claim |
| Operation | Which verbs? | table `GRANT` | DB `role` claim |
| Feature | Which features? | thin-app guards | capability role |

**An IC and a site manager are the same DB role — `app_member`.** They reach the same
features and are scoped to their own site by the *identical* policy. Their only
difference is capability, enforced above RLS. An admin is recognised by
`current_user = 'app_admin'`, **not** by an absent `site_id` and not by a claim —
so the admin branch matches every row for a reason that cannot be forged.

Never create DB roles named after capabilities (`ic`, `site_manager`). That fuses
the axes and forces a policy per role per table.

For a hierarchy, scope derives from position in a tree via one recursive function —
`RETURNS uuid[]` with `array_agg` (`SETOF uuid` is **rejected** in a policy
expression), indexed on `sites(parent_id)`, and `PARALLEL UNSAFE`. It is
evaluated **per row** — 400,000 rows cost 400,001 calls — so large tables should
denormalise the scope instead. Adding a level is a data change.

The walk is **self-inclusive**: a member scoped to a site sees its own row plus its
descendants, and a member scoped to an unrelated site sees **its own single row and
none of the subtree**. Verified counts over the five-row proof fixture:
root→3, mid→2, unrelated→**1**, unknown→0, admin→all 5.

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
REVOKE ALL ON customers FROM app_member;     -- table level, ALL verbs
GRANT  SELECT, INSERT   ON customers TO app_member;
REVOKE SELECT ON customers FROM app_member;   -- table level, FIRST
GRANT  SELECT (id, site_id, name) TO app_member;
```

Order matters, and the wrong order **fails open silently**: revoking a column while
a table-level grant exists does nothing at all — **verified**,
`has_column_privilege(…, 'internal_notes', 'SELECT')` was `t` with the column
revoke in place, and the value came back at HTTP 200. A column grant can only
narrow a table grant that has already been taken away. And a column-restricted role
cannot use `select=*`, so requests against that table must name columns explicitly.
Prefer keeping sensitive columns out of the readable set from the outset rather
than revoking after the fact.

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