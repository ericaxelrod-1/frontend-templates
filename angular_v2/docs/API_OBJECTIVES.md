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
| CAPTCHA generation | Nest | `canvas` is a native Node module |
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
| **No request-serving role owns a table**, and `FORCE ROW LEVEL SECURITY` is set | Test asserts the policy still applies when queried as the owner role |
| **No serving role is `SUPERUSER` or `BYPASSRLS`** | `FORCE` does not bind either; a `postgres` session read 5/5 from a `FORCE`d table |
| **The authenticator may assume only the three app roles** | A token naming a table-owning role must be `403`. It read everything and its `DELETE` removed the row |
| That boundary `GRANT` is a **superuser statement in the bootstrap**, asserted by reading `pg_auth_members` | It cannot run in a migration: `must have admin option on role "app_anon"` |
| `REVOKE SET ON PARAMETER role` is **not** the control | Inert on PostgreSQL 15 |
| Every function has `EXECUTE` revoked from `PUBLIC` **and granted to `app_anon`, `app_member` and `app_admin`** | `PUBLIC` gets it by default (7 of 9 functions had `NULL proacl`), so a `SECURITY DEFINER` helper is anonymously reachable — but a revoke with no grant 403s every scoped request and leaves scoping 100% non-functional |
| **The admin branch is keyed on `current_user`, not the `role` claim** | A claim-keyed branch is **dead code**: no token carries the bare string `admin`, so a valid `app_admin` token got `200 []` and saw nothing. A forged `"role":"admin"` in a member's own validly-signed token gets zero rows |
| A policy is **total**: empty, absent and malformed claims deny, never error | `current_setting(...,true)` returns `''`, and `''::json` raises. `OR` does **not** short-circuit past a raising operand, so a garbage `site_id` broke an admin too — only a guarded accessor (`EXCEPTION … RETURN NULL`) makes it total |
| A hierarchy function that walks the table its own policy protects is `SECURITY DEFINER`, **and that table is not `FORCE`d** | One decision, not two. Under `SECURITY INVOKER` every non-superuser query died with `stack depth limit exceeded`; `FORCE` on that table causes it rather than fixing it |
| Hierarchy scope derives from a recursive function, not duplicated policy logic | `site_tree_ids()` test; the policy contains no `WITH RECURSIVE`. Counts: root→3, mid→2, unrelated→**1** (the walk is self-inclusive), unknown→0, admin→all |
| **The walk is evaluated per row, and the cost is per-row repetition — not a reason to denormalise** | Measured: 400,001 calls over 400,000 rows; a single call costs ~3 ms. `STABLE` is **not** hoisted (see `rebase.md` §6.6.2) |
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
| An admin token carries no `site_id`, so scope cannot narrow it | Admin sees rows across every site in one test, and is recognised by `current_user` rather than by a missing claim |
| An `ic` and a `site_manager` are the same DB role | A `grep` gate asserts no DB role is named after a capability |
| **Capability lives in a table, enforced by per-operation RLS policies** | `FOR INSERT WITH CHECK` / `FOR DELETE USING` verified to discriminate by operation. Not enforced by a thin-app guard — a guard above the database cannot be composed with the policy below it |
| **Capability is NOT modelled as a database role** | Five capabilities need **31** additional roles (2⁵ sets, empty set already served). Role inheritance only adds and never subtracts, and is inert under `NOINHERIT` |
| **A new capability inside an existing tier is one inserted row, no migration** | Policies name capabilities, so a new name needs no DDL. A new **tier** that is not a superset is a new role — a bootstrap and `ADMIN OPTION` change |
| ~~**No query filters by site *and* by feature**~~ **WITHDRAWN — this caused a privilege escalation** | Two permissive policies on one operation are **OR**ed, so a `FOR ALL` scope policy discarded the capability gate: a member with **zero** capabilities `DELETE`d and `INSERT`ed, no error. Scope and capability now **compose in one policy per operation** |
| **No operation carries two permissive policies**; two policies require `AS RESTRICTIVE` | Assert on `pg_policy` that no `(relid, cmd)` pair has two `polpermissive` rows. Verified: two permissive `SELECT` policies → 2 rows; adding `RESTRICTIVE` → 1 |
| **A member with no capability is denied, in its own scope** | The cross-axis test. Every per-half test passes against both the correct and the broken shape; only this one fails |
| **Live-session revocation is an explicit unknown** | Untested and unwritten (`testing.md`): capability resolves per statement, hierarchy scope resolves from a signed claim — different latency by construction |
| **The RLS suite is proven able to fail** | Disabling `ENABLE ROW LEVEL SECURITY`, dropping the column `REVOKEs`, and inverting the boundary `GRANT` each turn `verify` red at step 7 of 8 (`rebase.md` §6.6.1) |
| Thin-app routes default deny | A new controller without `@Public()` or a guard fails a test |

---

## Objective 2 — the contract cannot drift

**Generated from the live database.** ADR-0003, ADR-0022.

| Requirement | Verification |
|---|---|
| `openapi.json` is emitted by PostgREST from the live schema | `npm run generate:client` diffs cleanly against the committed file |
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