# API Objectives

The requirements the `angular_v2` API layer must satisfy, each traceable to the
ADR that decided it. This is the acceptance criteria for the API surface — not a
description of what exists.

Context in [`architecture.md`](./architecture.md); the build plan in
[`rebase.md`](./rebase.md).

---

## The boundary

PostgREST is the API layer. A thin Nest app handles what PostgREST cannot
(ADR-0004). A route belongs to exactly one of them, never both.

| Requirement | Owner | Rationale |
|---|---|---|
| CRUD over a table or view-shaped resource | **PostgREST** | Mechanical by definition; a hand-written controller adds nothing |
| JWT **issuance** | Nest | PostgREST verifies; something must sign |
| Password verification | Nest | bcrypt belongs in an app |
| Login orchestration | Nest | Combines block check, CAPTCHA, audit, token issuance |
| Email delivery | Nest | SMTP credentials, template rendering |
| CAPTCHA generation | Nest | A challenge is minted and checked in the thin app; PostgREST cannot issue one |
| Scheduled jobs | Nest | Behavioural detection, cache cleanup |
| Multi-step workflows | Nest | Export, delete, consent |

---

## Objective 1 — authorization cannot be bypassed

**Enforced below application code, in the database.** ADR-0002, ADR-0009,
ADR-0023.

| Requirement | Verification |
|---|---|
| Row scoping is enforced by `CREATE POLICY`, never in application code | Every policy has a permitted-case and a denied-case test |
| Default is deny: `REVOKE ALL ... FROM PUBLIC` before any grant | Policy and grant set reviewed as a whole |
| **No request-serving role owns a table**, and `FORCE ROW LEVEL SECURITY` is set on every table one can reach **except `groups` and `user_groups`** | Test asserts the policy still applies when queried as the owner role. The two exceptions are asserted too — `groups` and `user_groups` are ENABLEd and deliberately NOT FORCEd. **`FORCE` on `groups` makes the closure refresh write an empty closure: every tenant's scope becomes zero rows, silently** (measured **0 rows**, not a half-tree) |
| **No serving role is `SUPERUSER` or `BYPASSRLS`** | `FORCE` does not bind either; a `postgres` session read 5/5 from a `FORCE`d table |
| **The authenticator may assume only the three app roles** | A token naming a table-owning role must be `403`. It read everything and its `DELETE` removed the row |
| That boundary `GRANT` is a **superuser statement in the bootstrap**, asserted by reading `pg_auth_members` | It cannot run in a migration: `must have admin option on role "app_anon"` |
| `REVOKE SET ON PARAMETER role` is **not** the control | Inert on PostgreSQL 15 |
| Every function has `EXECUTE` revoked from `PUBLIC` **and granted to `app_anon`, `app_member` and `app_admin`** | `PUBLIC` gets it by default (7 of 9 functions had `NULL proacl`), so a `SECURITY DEFINER` helper is anonymously reachable — but a revoke with no grant 403s every scoped request and leaves scoping 100% non-functional |
| **The admin branch is keyed on `current_user`, not the `role` claim** | A claim-keyed branch is **dead code**: no token carries the bare string `admin`, so a valid `app_admin` token got `200 []` and saw nothing. A forged `"role":"admin"` in a member's own validly-signed token gets zero rows |
| A policy is **total**: empty, absent and malformed claims deny, never error | `current_setting(...,true)` returns `''`, and `''::json` raises. `OR` does **not** short-circuit past a raising operand, so a garbage claim broke an admin too — only a guarded accessor (`EXCEPTION … RETURN NULL`) makes it total. **Keep the three-argument `current_setting`**: measured, the two-argument form *raises* (`500`) while three-argument + `nullif` gives a clean denial |
| ~~A non-uuid or empty `sub` is fail-closed but signals `500`, not `403`~~ **CLOSED** | `authz.actor()` wraps the cast in `EXCEPTION … RETURN NULL`. Assert a `"sub":"garbage"` token and a token with **no** `sub` both return **zero rows**, and that a garbage `sub` does not break an admin |
| **`USING` alone governs `INSERT`** | `polqual` is reused when no `WITH CHECK` is written — confirmed by **denial** (an out-of-scope insert is refused), not by reading `pg_policy` |
| A hierarchy function that walks the table its own policy protects is `SECURITY DEFINER`, **and that table is not `FORCE`d** | One decision, not two. Under `SECURITY INVOKER` every non-superuser query died with `stack depth limit exceeded`; `FORCE` on that table causes it rather than fixing it |
| Hierarchy scope derives from a **membership table** joined to a refreshed **closure matview**, not from duplicated policy logic | The scoping subquery is uncorrelated and therefore hoisted: **`loops = 1`** at 305 rows and at 3305 rows, against `loops = 305` for a correlated variant. `SETOF` in a policy expression is **rejected** by Postgres. **Superseded counts from the claim-keyed design:** root→3, mid→2, unrelated→**1** (self-inclusive), unknown→0, admin→all |
| **The old recursive walk is per-row — which is why the scope was denormalised** | Measured: 400,001 calls over 400,000 rows. `STABLE` is **not** hoisted. It appears as a `STABLE` function call in the Seq Scan's `Filter` (`rebase.md` §6.6.2) |
| **Scope is a table read, so a membership change bites on the next request** | Same token, changed `user_groups`, next request sees the new scope. A token claim cannot express this |
| **The closure matview lives in `authz`, outside `db-schemas`, and is granted to the three serving roles** — *not* granted to nobody | A matview has no RLS and PostgREST publishes anything in `db-schemas` regardless of grants: **one `GRANT SELECT` on a `public` closure served the whole org tree to an anonymous caller.** But "granted to nobody" is **unimplementable**: a policy expression's subquery runs with the **querying** role's privileges, so without the grant every scoped read dies with `permission denied for materialized view org_closure`. Assert **both** halves: the grant state, and that the relation is absent from the served spec |
| **The closure is refreshed `CONCURRENTLY` from a statement-level trigger on the hierarchy table** | Chosen for **the lock it avoids**, not a measured constant: a plain `REFRESH` holds an **`AccessExclusiveLock`** for the whole rebuild. The published timings (13.5 / 6.7 / 7,606 / 8,466 ms) **do not reproduce** — on the shipped 12-row closure, plain `REFRESH` measured **36.5 ms** and `CONCURRENTLY` **27.5 ms**. No staleness window, because the refresh is in the writing transaction. Statement-level because N changes cost one rebuild. `DROP MATERIALIZED VIEW` is impossible — policies depend on it |
| **`CONCURRENTLY` CAN run inside a transaction block that has already written** | Verified on 15.19 from a row-level trigger. The only two restrictions that bite are a read-only transaction and a missing unique index. The old claim (and a "correction to the record" that repeated it) was false |
| **The closure query uses `UNION` with no accumulator column, and `temp_file_limit` is set on the refreshing session** | Cyclic graph: `UNION ALL` + `depth` is non-terminating, hits `temp_file_limit` in **91 ms**; `UNION` no-accumulator returns **384 rows in 12.7 ms**. Acyclic: both **361 rows**, indistinguishable. `parent_id REFERENCES groups(id)` does not enforce acyclicity |
| **Multi-row `INSERT` into `groups` is refused only because the command counter advances** | Fragile and undocumented: the `BEFORE … FOR EACH ROW` acyclicity trigger sees rows written earlier in the **same command**. Change it to a statement-level or constraint trigger and one multi-row statement can build a cyclic closure. Any bulk group load needs a test that loads it in **one statement** |
| **Every table is declared group-scoped, hierarchy, or unscoped, and its PK follows** | Group-scoped (`projects`, `customers`): `PRIMARY KEY (group_id, id)`, `group_id` on every FK. `groups`: simple PK, admin-only self-FK. `users`/`actions`/`permissions`/`roles`/`role_permissions`/`user_roles`/`user_groups`: simple PKs |
| **No group-scoped table carries an FK leaving the group-scoped set** | RLS does **not** govern FK/unique/PK checks. Measured: existence oracle via `23503`, content oracle into an unreadable table, `UNIQUE` + `ON CONFLICT DO NOTHING` with **no error at all**, and `ON DELETE CASCADE` crossing RLS |
| **`has_permission()` returns `true` for an actor who HOLDS the permission** | The **positive** case. The previous resolver read `current_user` inside a `SECURITY DEFINER` body, which rebinds to the owner: `false` for `app_admin` *while holding the row* — the whole capability axis silently absent, denying everyone. Identity is the **actor argument**; `SECURITY INVOKER` would publish the whole permission matrix |
| **`role_permissions.role_id` is a real FK to `roles.id`** | The previous design keyed capability on a *PostgreSQL role name*, which left the `roles` table referenced by nothing — so no query or constraint could answer "what can this role do?". Assert the FK exists and that `has_permission()` traverses it |
| **Every user has at least one role and at least one group** | Two counts. There is no `permission_rules` table, no AND/OR combiner, and no "nobody" case on either axis |
| **No per-user grant and no deny exists** | `user_roles` is the only user↔capability link. A `user_permissions` table, an `is_granted` boolean, or any deny-precedence rule is a regression — every member of a role holds identical capabilities. `grep` gate |
| **The ORM-driven scope engine is absent** — `rls_rules`, `rls_join_paths`, `rls_join_conditions`, `rls_scope_templates`, `rls_condition_groups`, `rls_rule_conditions`, and the raw-SQL `sql` / `parameters` / `scope_sql` columns | `grep` gate over `backend/database/`. It existed to make RLS work on SQLite; on PostgreSQL the policy *is* the join, written as SQL |
| **The permission cache database is absent** — `cache/permissions.sqlite`, `cache_permission_maps`, `cache_sync_status`, sync endpoints | A second copy of the authorization data is a second source of truth. `has_permission()` reads the live rows |
| **The object-scanning tables are absent** — `api_endpoints`, `frontend_routes`, `ui_components`, `*_permissions` joins | PostgREST derives the API surface from the schema, so the permission surface is *which tables and which verbs* and is expressed directly in `permissions(resource, action_id)` |
| **A caller cannot grant a capability it does not hold** | **ENFORCED** by `BEFORE INSERT OR UPDATE` trigger on `role_permissions` and `user_roles` (`0004_grant_subset.sql`, `assert_grant_subset()`, raising `42501`). Proved by `backend/test/rls/grant-subset.spec.ts`. Scope half is enforced via `WITH CHECK`; capability half is enforced via trigger. **W08b** |
| **`is_system_role` / `is_system_group` are the administrative floor** | **ENFORCED** by a `BEFORE` row trigger on both tables: a floor row may not be `UPDATE`d or `DELETE`d except from a superuser session, and `INSERT` is uncovered so the floor is creatable. `SECURITY INVOKER` — a `DEFINER` body would answer about the owner and never fire. The superuser test is `current_setting('is_superuser')`, **not** `current_user`, because it survives `SET ROLE`. `TRUNCATE` does not fire a row trigger and is closed by the grants instead |
| **Scope must never be keyed on a setting the caller can write** | `request.jwt.claims` is a custom GUC and **any role may `SET` it** — verified: a member set it directly and read another tenant's rows. **No grant or policy can prevent this**; the only control is that no request-reachable SQL path can reach the `SET`, and that is an absence, not a defence. **Any `pg` client, RPC or `db-pre-request` hook that can set it is a P0** — assert the absence before adding one |
| **`has_permission`'s `who` argument is a caller-supplied parameter, not a verified identity** | PostgREST exposes it as an RPC in `public`, so `who` arrives in the request body verbatim. No wiring supplies it from `actor()`. It is **advisory for a self-check and must never become the enforcement point for CRUD**, which is table grants. Because `who` is an argument it is a **disclosure oracle**: measured, **63 unauthenticated probes recovered the administrator's complete permission set**, so it is granted to `app_member`/`app_admin` and **not** `app_anon` — no policy calls it, so the "grant every policy helper to `app_anon`" rule does not apply |
| **`app_admin` reads the complete `user_groups` table** | Forced: the scope policy reads `user_groups` with the querying role's privileges, so no serving role can be denied `SELECT`. `app_member` is narrowed by its policy; `app_admin` reads every user in every group. **No serving role may write it, `app_admin` included** — that omission fails open if forgotten |
| **`app_admin` is a superset across four mechanisms**, not a bypass | Four distinct tests: all **rows** (RLS), all **tables** (grants), all **pages** (`has_permission`), all **endpoints** (the boundary `GRANT`). Removing any one loses access in one kind only — that partial failure is the point |
| **`PARALLEL UNSAFE` is the default and the safe marking for a `SECURITY DEFINER` helper — not a ~170× performance fix** | Measured: `PARALLEL SAFE` **5.8 s** vs `PARALLEL UNSAFE` **12.5 s** on the same 400k scan. The previous "~170× slower" claim was backwards |
| **Resolved scope is never cached in a GUC the caller can set** | A per-session scope cache let a member read 50 rows, then **500** after one `set_config` on its own custom GUC. Rejected as a vulnerability, not a trade-off |
| The `role` claim is validated at minting | Necessary but **not sufficient** — it protects only the issuer |
| The issuer always sets `exp` | A token with no `exp` is **accepted** by PostgREST |
| Denials are asserted on the body, not the status | A correct denial, a full leak and a partial 3-of-5 leak were **all HTTP 200** |
| Missing claims yield **zero rows**, never an error | Policy test with a claim-less token |
| Seeding goes **through** the boundary: `pgrst_authenticator` + `SET ROLE app_admin` | Claims alone can no longer admit a write, and `row_security = off` is used nowhere — it reopens the owner bypass |
| `jwt-role-claim-key` is the JSPath `".role"` | `"role"` and `"$.role"` **panic** PostgREST 16.4 on boot |
| **No ORM**, therefore no raw-query escape hatch | `pg`, `typeorm`, `sequelize`, `prisma` absent from `package.json` |
| **No database views** | Superuser-created views bypass RLS silently — migration test asserts none exist |
| Identity reaches policies via `current_setting('request.jwt.claims', true)` | A policy test runs as a non-superuser role |
| Internal columns revoked with column-level `GRANT`, **after** a table-level `REVOKE SELECT` | Assert `SELECT` is **denied**, not merely omitted. The wrong order fails open at `200` with the value intact |
| An admin token carries no `site_id`, so scope cannot narrow it | Admin sees rows across every group in one test, and is recognised by `current_user` rather than by a missing claim |
| **A DB role is never named after a capability, and `roles` never stores a PostgreSQL role name** | A `grep` gate asserts no DB role is named after a capability. Modelling a capability set as database roles needs one role per distinct set — five capabilities means **31** additional roles — and role inheritance only adds and never subtracts, and is inert under `NOINHERIT` |
| **Capability is `resource` + `action` over a table, not a closed label vocabulary** | A new permission is one inserted row: no DDL, no policy change, no new tier name to invent |
| **A new permission inside an existing role is one inserted row, no migration** | Nothing hard-codes a permission list. A new **tier** that is not a superset is a new database role — a bootstrap and `ADMIN OPTION` change |
| ~~**No query filters by site *and* by feature**~~ **WITHDRAWN — this caused a privilege escalation** | Two permissive policies on one operation are **OR**ed, so a `FOR ALL` scope policy discarded the capability gate: a member with **zero** capabilities `DELETE`d and `INSERT`ed, no error. The axes are now separate *inputs* that are **not** expressed as two competing policies on one operation — scope is one policy per table, capability is a grant. No `AND`/`OR` combiner exists |
| **Live-session revocation is an explicit unknown, but its old premise is gone** | Scope used to ride in a signed claim while capability came from a table — different latency by construction. **Both are now table reads**, so a membership change bites on the next request. What is still untested is the capability side, token lifetime and refresh rotation |
| **No operation carries two permissive policies**; two policies require `AS RESTRICTIVE` | Assert on `pg_policy` that no `(relid, cmd)` pair has two `polpermissive` rows. Verified: two permissive `SELECT` policies → 2 rows; adding `RESTRICTIVE` → 1 |
| **A member with no membership rows sees nothing, in its own scope** | The cross-axis test. Every per-half test passes against both the correct and the broken shape; only this one fails |
| **The RLS suite is proven able to fail** | Disabling `ENABLE ROW LEVEL SECURITY`, dropping the column `REVOKEs`, and inverting the boundary `GRANT` each turn `verify` red at step 7 of 8 (`rebase.md` §6.6.1) |
| Thin-app routes default deny | A new controller without `@Public()` or a guard fails a test |

---

## Objective 2 — the contract cannot drift

**Generated from the live database.** ADR-0003, ADR-0022.

| Requirement | Verification |
|---|---|
| `openapi.json` is emitted by PostgREST from the live schema | **`npm run smoke` — `test/smoke/openapi-contract.smoke-spec.ts` compares the committed file to the live catalog**; a missing table, a missing column, an extra table or an extra column is a red run |
| Angular types are generated by `openapi-typescript` | Generated directory is committed and never hand-edited |
| No hand-written URL, response interface, or HTTP call anywhere | `grep` gate in `verify`; no `HttpClient` in components |
| No runtime key transform | `grep` gate — none exists, so none can corrupt `jsonb` |
| One naming convention: `snake_case` end to end | Generated field names match column names |
| Every route that errors has a documented error shape | PostgREST's standard error body; thin-app routes use a shared filter |

---

## Objective 3 — failures are recorded before they are judged

**Ordering is the control.** ADR-0011.

```
POST /auth/login
  1. IP block check        ─┐ before any password is examined
  2. CAPTCHA verification   │
  3. bcrypt.compare        ─┘
  4. record the attempt, pass or fail
  5. issue tokens
```

| Requirement | Verification |
|---|---|
| A wrong password creates a `login_attempt` row with `status: 'failed'` | Test 1 |
| A blocked IP is rejected before credentials are validated | Test 3 |
| IP reputation increments on failure and resets on success | Tests 2, 4 |
| Per-account counting is independent of IP | Test 5 |
| An allowlisted IP is neither blocked nor counted | Test 6 |

> The bug this objective exists to prevent: in `angular/`,
> `@UseGuards(LocalAuthGuard)` ran before the handler, so the audit write, IP check
> and CAPTCHA gate were reachable only on **success**. One decorator made four
> controls inert while all four appeared to work.

---

## Objective 4 — brute force fails safely

Per-account counting drives **progressive delay** and a **risk-scoped challenge**.
Never a hard lockout from unauthenticated traffic — anyone can lock any account by
attempting it N times. Only a party proving knowledge of the correct password
clears the penalty. ADR-0010.

| Requirement | Verification |
|---|---|
| Escalating delay, capped | Config-driven; test asserts the sequence |
| Challenge appears only on elevated risk | Test asserts a low-risk attempt is not challenged |
| No hard lock from anonymous traffic | Test asserts an account cannot be locked by a stranger |
| **IP reputation is secondary**, normalised, subnet-aggregated | `1.2.3.4` and `::ffff:1.2.3.4` share a counter |
| All thresholds come from config | No threshold literal in source |
| **PostgREST routes are rate-limited** by a reverse proxy or `db-pre-request` | PostgREST does not throttle; upstream documents this |

---

## Objective 5 — authentication is honest

ADR-0005, ADR-0013, ADR-0021.

| Requirement | Verification |
|---|---|
| No default JWT secret; bootstrap throws if absent or short | Boot test |
| Both runtimes read the same secret | Startup fails loudly on divergence |
| Access tokens ~15–30 min; permissions read from the DB, not baked in | Revocation test |
| Refresh tokens persisted, rotated on every use, revocable | Test asserts reuse of a rotated token fails |
| Logout actually invalidates the refresh token | Test |
| A revoked `jti` is rejected on the next request via `db-pre-request` | Test 3b |
| Password hashing bcrypt/argon2, cost ≥ 12, configurable | Config test |

---

## Objective 6 — the security suite is real

ADR-0008, ADR-0017.

| Requirement | Verification |
|---|---|
| **No mock service, fake DI registration, or in-memory stand-in** anywhere | `no-restricted-imports` on mock paths |
| Tests assert; no test can pass vacuously | Every spec has assertions |
| Tests run against real Postgres, never mocked | `verify` fails if the DB is unreachable |
| CAPTCHA validated server-side; answer never in the payload | Test |
| CAPTCHA single-use and expiring | Replay test; expiry test |
| An accessible non-visual challenge exists | Manual review — an image-only challenge is a defect |
| Behavioural scoring informs, never blocks | No code path from a score to a block |

---

## Objective 7 — setup works in one command

ADR-0018, ADR-0020. A template is judged once, at the fork.

| Requirement | Verification |
|---|---|
| `npm run setup` reaches a running app with a seeded admin user | Run it on a clean clone |
| No Docker, no container runtime | `grep` gate; no compose file |
| No third-party account or API key | `npm install` and `setup` succeed offline |
| `npm run verify` fails loudly rather than skipping | Deliberately stop Postgres; assert non-zero exit |
| Every documented command exists | `docs/development.md` checked against `package.json` |
| Every documented claim is true | Docs review before release |

---

## Non-goals

Stated so nobody adds them and calls it an improvement.

| Not doing | Why |
|---|---|
| Hard account lockout | Account-lockout DoS |
| CAPTCHA on every login | Accessibility cost, defeats the purpose |
| Behavioural scoring that blocks | False positives dominate; cold start has no baseline |
| Geo-blocking enabled by default | Geolocates VPNs and proxies to datacenter countries |
| Automatic key transform | Corrupts `jsonb`; deleted once already |
| Database views for the API shape | Bypasses RLS silently |
| A second state store on the frontend | Two sources of truth was the defect |
| CI in the template | Never a live app; `verify` is inherited by forks instead |