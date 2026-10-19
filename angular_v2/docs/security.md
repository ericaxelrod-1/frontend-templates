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
| **Speed bump** | CAPTCHA — **storage only, no issuer or verifier** | Would defeat unsophisticated traffic. Bypassable by farms. |
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
  2. CAPTCHA verification   │ before any password is examined   ← NOT IMPLEMENTED, §CAPTCHA
  3. bcrypt.compare        ─┘
  4. record the attempt, pass or fail
  5. issue tokens
```

Steps 1, 3, 4 and 5 run, in that order, inside the handler. Step 2 is the
position a CAPTCHA has to occupy, not something that occupies it today: there is
no issuer and no verifier (§CAPTCHA). The ordering is the part that is
load-bearing, and it is why the sequence is written with the credential check
inside the bracket rather than below it.

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

Secondary signal, and both of its requirements are met — so read this as the
signal's ceiling rather than as a wish list:

1. **Canonical normalisation.** `1.2.3.4` and `::ffff:1.2.3.4` are the same host
   and key the same counter. `normalizeIpAddress` in `src/auth/ip-address.ts`
   flattens the IPv4-mapped form to the dotted quad, and `auth.service.ts` writes
   `ip_normalized` on every `login_attempts` row. Without this, an attacker
   rotates string representation and never accumulates five failures.
2. **Subnet aggregation.** `ipSubnetKey` produces the /64 for IPv6 and the
   normalised host for IPv4, written to `ip_subnet`, and the per-account counters
   in `auth.service.ts` query on `ip_subnet` rather than on the raw string.
   Per-address counters are worthless against an IPv6 `/64` or a rotating IPv4
   pool.

Allowlisted IPs skip counting entirely and cannot be blocked. The allowlist is
populated explicitly; it is not a loopback-only stub, and
`normalizeIpAddress` is applied to every entry before comparison.

**What does not exist is the standing reputation itself.** `ip_reputation` is a
table with no writer: nothing scores an address and nothing consults the score, so
the row's `reputation_score` and `is_blocked` describe nothing. The per-account
brute-force counters above it are real; the reputation row is storage. See §
Detection and alerting.

---

## CAPTCHA

**The storage half ships. The logic half does not.** `0022_security_telemetry.sql`
creates `public.captcha` complete — `token_hash`, a per-row `solution_salt` beside
`solution_hash`, and an `is_used` / `used_at` pair that makes single-use a property
of the write rather than a hope about the read. **Nothing in `backend/src/` issues
a challenge and nothing verifies one.** Read this section as the shape the missing
code must take, not as a description of what the template does.

The requirements it exists to satisfy are below. They are requirements, not
current behaviour:

- The server issues the challenge and stores the answer. **The answer never
  appears in the challenge payload.**
- Single-use: consumed on verification, so replay fails. The columns are shaped
  for it — `is_used` alone cannot answer "used when", and two replays inside the
  same instant are indistinguishable on a boolean that does not record the moment
  it flipped. The redemption path is `UPDATE … SET is_used = true, used_at = now()
  WHERE id = $1 AND is_used = false`, asserting one row.
- Expiring: short TTL, plus periodic cleanup of abandoned challenges. `expires_at`
  is `NOT NULL` and `CHECK (expires_at > issued_at)` already enforces the window.
- **Never validated in the browser.** There is nothing to validate client-side —
  this is impossible rather than unfinished.
- An accessible non-visual alternative is required. An image challenge that
  excludes screen-reader users is a liability shipped into every fork.

Where it sits in the login path is in §Login flow ordering above: **before any
password is examined**, so the challenge cannot be skipped by a successful
credential comparison.

The three previous implementations were: one correct, one self-solving
(`challenge: solution`), and one frontend service with the answers hardcoded in
client JavaScript. Two deleted, one kept — and the kept one is now only half
present. `ip_reputation.captcha_required_count` is a column the seed fills and no
code increments, so a dashboard showing a non-zero count is showing seed data.

---

## Transport headers

**Neither project sets `Content-Security-Policy`.** No `helmet`, no
`@fastify/helmet`, no `<meta http-equiv>`, no `contentSecurityPolicy` block in
`frontend/angular.json`. That is the whole of it, and it is stated here because it
is the kind of absence a deployer discovers in an audit rather than in a README.

**Where it belongs is the layer in front of the stack.** All three processes are
plain HTTP on loopback behind a TLS terminator, so the reverse proxy is already
the place every other transport decision is made — TLS, `NG_TRUST_PROXY_HEADERS`,
rate limiting on the PostgREST path. A policy header added there costs this
repository nothing and survives a rebuild; a policy header added in application
code is duplicated per runtime and can drift between the three processes.

What the template owes an operator is therefore the *statement*, and
[`deployment-guide.md`](./deployment-guide.md) carries it beside the nginx block
so the two are read together. Two properties of a policy for this application are
worth naming before one is written, because both are easy to get wrong:

- **`frame-ancestors`, not `X-Frame-Options`,** for clickjacking. They are not
  equivalent and the legacy header does not cover nested frames.
- **`connect-src` must include the same-origin prefixes the application actually
  uses** — `/api` and `/rest`, both relative. A policy that names `http://127.0.0.1:3000`
  in `connect-src` because that is what the SSR process proxies to will break every
  browser request, because the browser never sees that host: it sees
  `https://your-domain`. See §`NG_ALLOWED_HOSTS` in
  [`deployment-guide.md`](./deployment-guide.md) for the same trap on the host
  allowlist.

The reverse proxy should also send `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`
and `Referrer-Policy` — none of which the application can usefully set, because all
three are meaningless on a plain-HTTP loopback listener.

---

## Cookies and consent

**This template sets no cookie, reads no cookie, and loads no tracker.** That
is a checked absence, not an observation: the §`Not yet present` ledger in
[`deployment-guide.md`](./deployment-guide.md) greps application code and the
migrations for the cookie API, a `cookie_consent` table and a fixed list of
analytics vendors, so adding one without deciding what to do about consent
turns `verify` red.

The consent data model (`0028_consent_model.sql`) and consent controls have
shipped — a universal widget on public pages, a settings surface inside the app
— and a decision is stored (in the browser for an anonymous visitor and in
`consent_records` for a signed-in user). What remains absent is anything the
consent would have to gate: this tree sets no cookie, reads no cookie, and loads
no tracker.

The session token is in `localStorage`, not a cookie, and that choice is
deliberate and documented in `session.service.ts`. `localStorage` is not
classified as a cookie under GDPR or UK GDPR, so no consent requirement attaches
to it. It is a weaker store — readable by any script on the origin, which is why
a CSP is the control that matters above — and §Transport headers is where that
trade is answered. Setting `HttpOnly; Secure; SameSite=Lax` would move the token
out of reach of injected script entirely, and it is the change a fork that wants
cookie-based sessions should make first.

**The obligation attaches the moment a fork adds a tracker or any non-essential
cookie.** At that point GDPR and UK GDPR consent requirements apply to it, and
the tag machinery — `consent_tags`, `consent_page_groups`, and the generic
injector that runs a vendor's snippet verbatim — is what gates it. Two
obligations survive that fork and neither is optional:

1. **The banner has to be wired, not merely rendered.** A consent record nobody
   reads is the artifact-without-compliance case again, one layer up.
2. **The retention window starts at consent, not at account creation.** A record
   kept longer than the consent justifies is its own finding.

**None of this is where this template's substantive privacy work is.** Erasure,
retention windows, the purge queue, tombstones and the statutory compliance
record are all in the tree, all enforced below the application, and none of them
is affected by the absence above. A fork that ships zero trackers is compliant
with cookie consent *and* has real rights machinery behind it; a fork that ships a
tracker and a banner has a banner.

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

> **SUPERSEDED.** The policy above is what the migration still ships; it keys scope
> on a `site_id` **token claim** and walks the hierarchy **per row**. The proven
> design reads **membership from a table** joined to a refreshed **closure
> matview**, so the subquery is hoisted (`loops = 1`) and a membership change takes
> effect on the **next request with the same token**. See ADR-0023 §Row scope. The
> totality lessons below — guarded accessor, no unguarded `uuid` cast, `OR` does not
> short-circuit past a raising operand — all still stand, and they are why the
> shipped shape never leaked.

- Tables intended to be globally readable are listed explicitly. Default is deny.
- **Key the admin branch on `current_user`, never on the `role` claim.** Verified
  over HTTP: a policy keyed on `request_claims()->>'role' = 'admin'` is **dead
  code** — no token carries the bare string `admin`, the DB role is `app_admin` —
  so a valid admin token got `200 []` and saw nothing. `current_user` is set by
  Postgres from the `SET ROLE` the escalation boundary already constrained, so a
  member who forges `"role":"admin"` into their own validly-signed token gets zero
  rows. **In a policy, `current_user` is right; inside a `SECURITY DEFINER`
  function it is wrong** — it rebinds to the owner. See §Scope and capability.
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
  every protected table **except `groups` and `user_groups`**, where adding it is a
  silent data-loss bug rather than hardening. Otherwise every policy here is
  decorative.
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

### Scope and capability are separate inputs, resolved separately

ADR-0023 defines the whole model. ~~**Row scope and capability never appear in the
same expression.**~~ **That rule is withdrawn — it caused a silent privilege
escalation.** Two axes written as two policies on one operation is precisely the
arrangement in which a capability check is silently OR-ed out of existence, and it
was verified: a member with **zero** capabilities deleted a row and inserted a row,
no error.

**What replaced it is not "compose them" but "stop making them compete."** Scope
is *one policy per table*. Capability is *object-level security* — a grant, or a
`has_permission()` answer. Neither axis can widen the other and there is no
`AND`/`OR` combiner to reconcile.

```sql
-- one policy per table: which rows
CREATE POLICY row_scope ON projects USING (
    group_id IN (SELECT c.descendant FROM user_groups ug
                 JOIN org_closure c ON c.ancestor = ug.group_id
                 WHERE ug.user_id = actor())
);

-- capability: which objects, resolved from the caller's roles
CREATE FUNCTION has_permission(who uuid, resource text, action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ ... $$;
-- resolved as user_roles -> roles (walking parent_id upward)
--                 -> role_permissions -> permissions -> actions
```

They remain **separate inputs** — neither derived from the other — but there is no
statement that has to combine them. Two policies on one operation are only correct
with **`AS RESTRICTIVE`**, which ANDs with the permissive set: two *permissive*
policies are **OR**ed, so they always **widen** access.

| Axis | Question | Mechanism | Key material |
|---|---|---|---|
| Scope | Which rows? | RLS policy | a **membership table**, not a claim |
| Capability | Which objects? — tables, verbs, columns, pages, endpoints | OLS: `GRANT` + `has_permission()` | `user_roles` → `roles` → `role_permissions` → `permissions` |

> **CORRECTED twice — the previous capability model left `roles` unconnected.** It
> was `role_capability(db_role, capability)`, keyed on a **PostgreSQL role name**,
> with capability as a fixed label vocabulary (`ic` / `site_manager` / `admin`).
> Nothing in the schema joined `roles` to it, so no constraint could answer *"what
> can this role do?"* — only application code could, and that is where it enforced
> nothing. Capability is now `resource` + `action` over a table, and
> `role_permissions.role_id` is a real FK to `roles.id`.
>
> **Withdrawn with it, deliberately:** `user_permissions` and `is_granted` (per-user
> grants and denies, and the precedence rules that made them order-dependent — every
> member of a role now holds identical capabilities); `permission_rules` (an AND/OR
> combiner that put both axes on one row); the permission **cache database**
> (`cache/permissions.sqlite`, `cache_permission_maps`, `cache_sync_status`, sync
> endpoints — a second source of truth); and the **object-scanning tables**
> (`api_endpoints`, `frontend_routes`, `ui_components` and their `*_permissions`
> joins — PostgREST derives the API surface from the schema, so the permission
> surface is *which tables and which verbs*, and there is nothing to scan). Each
> existed to make RLS work on SQLite through an ORM. Named once, with the reason,
> so nobody restores one. ADR-0023 §Capability.
>
> **And a measured defect that survives in a new shape.** The previous resolver read
> `rc.db_role = current_user` inside a **`SECURITY DEFINER`** function.
> `SECURITY DEFINER` rebinds `current_user` to the **function owner**, so the
> predicate compared the capability table against the *owner's* role name and never
> against the serving role: **measured, it returned `false` for `app_admin` *while
> holding* the capability row.** The whole capability axis was silently absent — and
> absent in the shape that **denies**, so it produced an ordinary zero-row result
> rather than an error.
> - **The rule, generalised:** inside a `SECURITY DEFINER` function, identity comes
>   from the caller — the actor argument, or `current_setting('role', true)`, which
>   tracks impersonation. **Never `current_user`, `current_role` or
>   `session_user`**; all three read plausibly and none of them is right.
> - **`SECURITY INVOKER` is not the fix.** It would require `SELECT` on
>   `role_permissions` and `permissions` for every serving role, publishing the
>   **entire permission matrix**.
> - **Denial tests could never have caught this.** Assert the **positive** case: an
>   actor that *holds* a permission *passes*.

**Least privilege runs in both directions — and both are enforced.**

- **"An account manager cannot create a user outside their own RLS scope"** is
  enforced — the `user_groups` insert is a scoped write, and the policy's
  `WITH CHECK` rejects a `group_id` outside the actor's closure, in the database.
- **"They cannot grant a capability they themselves do not have"** is enforced
  by the grant-subset trigger (`0004_grant_subset.sql`), because a `role_permissions`
  write is **unscoped** and RLS has no group dimension to filter it by. A `BEFORE
  INSERT OR UPDATE` trigger on `role_permissions` **and** `user_roles`
  (`assert_grant_subset()`) checks that the actor's effective permission set is a
  **superset** of what is being conferred and raises `42501` otherwise (asserted by
  `backend/test/rls/grant-subset.spec.ts`). Two residual properties are documented
  in ADR-0023 and the migration: the check is defense in depth (vacuous for a
  grantor conferring exactly what it holds, pending separation of duty) and reads
  the actor from `authz.actor()`.

**`is_system_role` / `is_system_group` are the administrative floor, and they are
enforced.** A row that *is* a floor row may not be `UPDATE`d or `DELETE`d except
from a superuser session; `INSERT` is uncovered so the floor stays creatable. The
trigger is **`SECURITY INVOKER`** and must stay that way — the function is a question
about the caller, so a `DEFINER` body would answer about the owner and the floor
would never fire. The superuser path is `current_setting('is_superuser')`, **not**
`current_user`, because it survives `SET ROLE` and therefore keeps provisioning
distinguishable from a request. `TRUNCATE` does not fire a row trigger; it is closed
by the grants, and that is asserted per role rather than left to a comment.

**The sharpest edge: scope is keyed on a setting the caller can write.**
`request.jwt.claims` is a custom GUC, and any role may `SET` it. Verified — a member
set it directly and read another tenant's rows. **No grant, policy or constraint can
prevent this**; the only control is that no request-reachable SQL path can reach the
`SET`, and that is an absence rather than a defence. **Any `pg` client, RPC, or
`db-pre-request` hook that can set it is a P0** — and `db-pre-request` is exactly
such a path already planned. `has_permission(who, …)` is the same class of hazard:
`who` arrives in the RPC body verbatim, nothing supplies it from the verified token.
Assert the absence of such a surface before adding one. ADR-0023 §F1.

**An admin is a superset, not a bypass.** No flag turns enforcement off.
`app_admin` holds more of everything across **four distinct mechanisms** — all
**rows** (the RLS admin branch), all **tables** (grants), all **pages** (the
resolver), all **endpoints** (the boundary `GRANT`) — and **four separate tests**,
because a bypass is one mechanism that fails silently while a superset is four that
have to be removed one at a time.

Never create DB roles named after capabilities, and never store a PostgreSQL role
name in `roles`. Both collapse the two axes into one. Modelling a capability set as
database roles needs one role per distinct set — five capabilities means **31**
additional roles — and role inheritance cannot help, because it only adds and never
subtracts.

For a hierarchy, scope is a **closure materialized view refreshed from `groups`**,
not a walk. A `STABLE` function in a policy qual is evaluated **once per candidate
row** — measured 400,001 calls over 400,000 rows — because `STABLE` means *"same
answer within this statement"*, not *"called once"*. The replacement joins
membership to the closure, and because that subquery is **uncorrelated** the
planner hoists it: **`loops = 1`** at 305 rows and at 3305 rows, against
`loops = 305` for a deliberately correlated variant. Adding a level is a data
change. (`SETOF uuid` remains **rejected** in a policy expression.) Full record:
ADR-0023 §The hierarchy.

**The closure matview lives in `authz`, outside `db-schemas` — and cannot be granted
to nobody.** A matview has no RLS and no policy, PostgREST auto-publishes anything in
`db-schemas` as a first-class resource, and under `openapi-mode = "ignore-privileges"`
it appears in the served spec regardless of grants. **A single `GRANT SELECT` on a
`public` closure served the entire org tree to an anonymous caller.**

But "granted to nobody" is **unimplementable here**: a policy expression's subquery
runs with the **querying** role's privileges, so without a `SELECT` grant for every
role whose requests evaluate the scope policy, **no scoped read evaluates at all** —
measured as `permission denied for materialized view org_closure` on every insert,
select and update. The answer is the **schema**: `authz.org_closure` is outside
`db-schemas`, so PostgREST cannot address it and `ignore-privileges` cannot advertise
it, **and** it carries `GRANT SELECT … TO app_anon, app_member, app_admin`. Assert
both halves — the grant state, and its absence from the served spec.

**`groups` and `user_groups` are ENABLEd but deliberately NOT FORCEd.** `FORCE` on
`groups` makes the closure refresh — which runs as the view owner — read the tree
through a policy `actor()` cannot satisfy, and the closure is rewritten **empty**.
Every tenant's scope becomes zero rows, silently. Measured: **0 rows**, not the
half-tree an earlier note claimed. Every request-serving role is still bound.

Refresh with `REFRESH MATERIALIZED VIEW CONCURRENTLY` from a **statement-level**
trigger on `groups`. **`CONCURRENTLY` is chosen for the lock it avoids**: a plain
`REFRESH` holds an `AccessExclusiveLock` for the whole rebuild. (The previously
published timings — 13.5 ms / 6.7 ms / 7,606 ms — do **not** reproduce; on the
shipped 12-row closure the audit measured plain `REFRESH` at 36.5 ms and
`CONCURRENTLY` at 27.5 ms. Quote the lock, not the milliseconds.) The refresh
happens inside the writing transaction, so there is **no staleness window** — which
is also why the blue/green swap once proposed here is withdrawn as unnecessary, and
was impossible besides (`DROP MATERIALIZED VIEW` is rejected because policies depend
on it).

**`app_admin` reads the complete `user_groups` table.** The scope policy reads
`user_groups` with the querying role's privileges, so no serving role can be denied
`SELECT` on it; `app_member`'s policy restricts it to its own rows, but `app_admin`
reads **every user in every group**. That is the price of the superset on this table.
**No serving role may write it, `app_admin` included** — that omission is the control
that fails open if forgotten.

**Cycle safety has a fragile edge nobody documents.** The `BEFORE … FOR EACH ROW`
acyclicity trigger sees rows written earlier in the same command, because the command
counter advances between rows. That is the *only* thing stopping a single multi-row
`INSERT` into `groups` from building a cyclic closure. Change it to a statement-level
or constraint trigger and the bulk form is admitted.

**Never cache resolved scope in a GUC the caller can set.** A per-session scope
cache was built and rejected as a vulnerability, not a trade-off: a member read 50
rows, called `set_config('app.scope', …)` on its own custom GUC, and read **500**.
Custom GUCs have no privilege control and `SET LOCAL` gives no protection — and
neither does `request.jwt.claims`, which is what the real design reads. See above.

**Referential-integrity checks bypass RLS and fail OPEN.** FK, unique and primary key
checks are not policy-governed: a plain FK is an **existence oracle** (`23503`
versus success reveals any group id, including out-of-scope ones); an FK to an
unreadable table is a **content oracle**; `UNIQUE` + `ON CONFLICT DO NOTHING` gives
the same oracle with **no error at all**; and `ON DELETE CASCADE` **crosses RLS** —
a member deleted a group they held and destroyed a row in a group they could never
see. The rule: *a group-scoped table may only carry foreign keys that stay within
the group-scoped set, and any FK leaving that set must terminate at a table members
cannot write to.* Table categories and the matching primary keys are in ADR-0023
§Referential-integrity checks bypass RLS.

The scope expansion is **self-inclusive**: a member scoped to a group sees its own row
plus its descendants, and a member scoped to an unrelated group sees **its own single
row and none of the subtree**. Multiple groups **union** — `IN`/`ANY`, never `AND`.
*"Unrelated → 0" describes a bug, not a design; anyone writing that assertion is
testing the wrong thing.*

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
GRANT  SELECT (id, group_id, name) TO app_member;
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

Alerts **persist to the database** — `security_alerts` is created, granted,
RLS-scoped to `app_admin` and read by `/admin/security-alerts`. **Nothing
produces them.** No application code writes `security_alerts`,
`ip_reputation`, `security_detected_patterns` or `pattern_login_attempts`; the
only writer is `database/seed.ts`, and every row it inserts is `is_mock = true`.
There is no scoring pipeline and no notification channel, so there is no opt-in
config to set and no stub logging "would send" — the whole pipeline is the
absence, which is a different thing from a pipeline with a stub in it, and is
recorded as such in [`deployment-guide.md`](./deployment-guide.md) §
`Not yet present`.

So a dashboard showing live-looking rows in a development database is showing
fixtures, and `is_mock` is the display filter that lets you exclude them. It is a
filter and not a fabrication guard: nothing in the schema prevents application
code from writing a row that is not what it claims to be, because a guard here
would turn a synthetic row into a hard failure instead of an excluded one.

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