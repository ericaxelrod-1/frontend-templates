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
| **No query filters by site *and* by feature** | Grep: no capability role appears in any policy or grant |
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