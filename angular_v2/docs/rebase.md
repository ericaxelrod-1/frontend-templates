# Rebase Plan — `angular/` → `angular_v2/`

**Status:** Proposed · **Author:** architecture review, 2026-10-01
**Scope:** full inventory and migration plan for rebuilding the template

---

## 1. Purpose and framing

This document defines the work to produce a clean `angular_v2/` template. The
existing `angular/` tree is left untouched as the reference implementation and
rollback point; nothing in it is edited during this plan.

### 1.1 What this repository is

An **Angular + NestJS boilerplate meant to be forked.** Three properties follow,
and they drive every decision below:

1. **It is never a live app.** No production deployment, no accounts, no
   third-party API keys. Every feature must work with zero external credentials.
2. **The success metric is fork-time state.** A developer should go from
   `git clone` to a running app with a working authenticated user in one
   command. Not "does this repo stay green over time" — the template is judged
   once, at the fork, and then belongs to someone else.
3. **100% of future changes will be made by LLMs.** This makes *mechanical
   enforcement* matter more than prose. An agent pattern-matches the nearest
   example and replicates it exactly. The code is the instruction.

### 1.2 The governing risk

> A model that confidently builds on a silently-broken foundation, where the
> breakage compounds invisibly.

Every finding in this document is a silent failure. Every rule in `AGENTS.md`
exists to convert one into a compile error, a lint failure, or a failing test.

---

## 2. Findings summary

Counts verified against the tree on 2026-10-01.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | **Home-grown RLS proxy enforces nothing** | 2,411 lines; `RlsContextGuard` in no `@UseGuards`/`APP_GUARD`; zero `CREATE POLICY` in repo; proxied `EntityManager` injected by nobody | **P0** |
| 2 | **Unauthenticated full-schema disclosure** | `schema.controller.ts` — 7 endpoints, 0 guards, returns all tables/columns/PKs/FKs | **P0** |
| 3 | **No default-deny auth posture** | No `APP_GUARD`; only `APP_GUARD` in repo is inside the unwired throttler module | **P0** |
| 4 | **Rate limiting implemented, never registered** | `SecurityThrottlerModule` never imported; `@nestjs/throttler` installed and configured via env | **P0** |
| 5 | **Contract drift unenforced** | `SwaggerModule` imported in `main.ts:11`, `setup()` never called; 126 hand-written frontend HTTP calls; 6 calls to non-existent endpoints | **P0** |
| 6 | **Login brute-force stack unreachable** | `@UseGuards(LocalAuthGuard)` at `auth.controller.ts:53` runs *before* handler; `status:'failed'` write, IP-block check and CAPTCHA gate all sit in the handler | **P0** |
| 7 | **CAPTCHA disabled + client faked** | `auth.service.ts:165` `... \|\| true`; frontend `advanced-captcha.service.ts` hardcodes answers (`'Circle'`, `'3'`, `'Rainy'`) in client JS | **P0** |
| 8 | **1,761 lines of assertion-free "tests"** | 14 `test-*.ts`, zero `expect()` calls, `catch` swallows errors → always exit 0; 10 have no npm entry; jest `testRegex` cannot match them | **P0** |
| 9 | **50 migrations across 2 trees** | 28 in `src/migrations/`, 22 in `src/database/migrations/`; 4 identical class names in both; duplicate timestamps `1720000000003`, `1720000000004`; 3 bookkeeping table names | **P1** |
| 10 | **4 schema-authoring mechanisms** | `database.config.ts`, `data-source.ts`, `schema-sync.ts`, `db:prepare` | **P1** |
| 11 | **Committed 1.1 MB database with real PII** | `angular/backend/db.sqlite` tracked (1,187,840 bytes); `.gitignore:287-290` protection commented out; contains emails, bcrypt hashes, IP history | **P0** |
| 12 | **Secrets in tracked `.env` files** | `.env.test`, `.env.development`, `.env.gmail` present | **P0** |
| 13 | **Permissions baked into 7-day JWTs** | `auth.service.ts:651` `payload = { sub, permissions }`; revocation inert for up to a week | **P1** |
| 14 | **Frontend: 0% OnPush, 0 signals** | 0 of 78 components; 0 `signal()`/`computed()`/`input()`/`output()` | **P1** |
| 15 | **25 manual change-detection calls** | 21 `detectChanges()`, 4 `markForCheck()`, 1 `NgZone`, plus a hand-rolled `🚨 INFINITE LOOP DETECTED` circuit breaker | **P1** |
| 16 | **No template lint rules enabled** | Two competing ESLint configs; neither enables `prefer-on-push`, `prefer-standalone`, `prefer-control-flow`, or a takeUntil rule | **P1** |
| 17 | **SSR configured but delivers nothing** | `ssr.entry: server.ts`, `/register` is `prerender:true`, but 0 `provideClientHydration`; 3 unguarded `localStorage` reads → `ReferenceError` at prerender | **P1** |
| 18 | **5 competing frontend layouts** | 26 services across 7 dirs; 78 components across 6; admin split across both `features/admin/` and `modules/admin/` | **P1** |
| 19 | **72% of subscriptions have no teardown** | 125 of 173 component subscriptions; 0 `takeUntilDestroyed`; 5 `async` pipe usages | **P1** |
| 20 | **Zero custom pipes; 46 method calls in bindings** | 0 `.pipe.ts`; per-CD calls plus arithmetic+`.toFixed()` inline in 4 places | **P2** |
| 21 | **~500 lines duplicated template markup** | 3 admin tables duplicated 2×; test-data panel 5×; auth header 6×; error block 7× | **P2** |
| 22 | **Mock services in application code** | `seed-rls.ts:53` fake `ClsService`; `test-ip-allowlist.ts:27` `MockIPReputationService`; `advanced-captcha.service.ts` | **P1** |
| 23 | **Stray NestJS controller in the Angular tree** | `app/examples/permission-example.controller.ts` imports `@nestjs/common` (not a frontend dep); cannot compile | **P2** |
| 24 | **55 markdown docs, most wrong** | `docs/endpoints.md:5` advertises Swagger that does not exist | **P1** |

---

## 3. Target architecture

```
angular_v2/
├── AGENTS.md                    ← rules (single source of truth)
├── GEMINI.md                    ← imports AGENTS.md
├── README.md                    ← fork-time entry point
├── openapi.json                 ← generated from PostgREST, committed
├── postgrest.conf               ← DB role, schema, JWT claim mapping
└── docs/
    ├── rebase.md  adr.md  architecture.md
    ├── development.md  security.md  api-contract.md  testing.md
```

```
                    ┌─────────────────────────────────────┐
   HTTP ───────────▶│ PostgREST   (the API layer)          │
                    │  serves CRUD straight from the       │
                    │  schema; RLS enforces row scoping     │
                    └──────────────┬───────────────────────┘
                                   │
                     ┌──────────────▼───────────────────────┐
                     │ PostgreSQL                          │
                     │  tables + RLS policies (no views)     │
                     │  scope: user_groups × org_closure     │
                     │  ← migrations are the schema source  │
                     └──────────────▲───────────────────────┘
                                   │
   ┌───────────────────────────────┴──────────────────────────┐
   │  Thin NestJS app — the ten things PostgREST cannot do   │
   │  JWT issuance · login orchestration · password reset    │
   │  email · CAPTCHA generation · rate limiting             │
   │  pattern detection + cron · privacy workflows           │
   └──────────────────────────────────────────────────────────┘
```

**PostgREST is the API layer. NestJS is a small application server beside it,
not beneath it** (ADR-0004).

The boundary is deliberate: anything expressible as CRUD over a table or view is
PostgREST's; anything requiring an algorithm, a secret, a socket, or a schedule is
Nest's. Nothing is served by both.

> **CORRECTED — "a table or view" is a table.** Views are rejected by ADR-0022 and
> forbidden by `AGENTS.md` B1, so the sentence above describes a boundary that no
> resource can land on. A superuser-created view bypasses every RLS policy on its
> base table **silently**, and the migrations here run as a superuser, so a view
> would be an object that turns the whole authorization model off. The boundary
> rule is *CRUD over a base table → PostgREST*, full stop.

### 3.0 Where row scope comes from

Row scope is **not** in the token and **not** in application code. The design
that ADR-0023 §Row scope settles on, and that W26 must implement:

```
PostgREST  SET ROLE app_member          ← the role claim selects the DB role
                 │
Postgres    actor()                      ← identity: the token's `sub`, via request.jwt.claims
                 │
           user_groups(user_id, group_id) ← MEMBERSHIP, read per statement
                 │
           org_closure(ancestor, descendant)  ← precomputed, refreshed, UNIQUE index
                 │
                 └─→ policy scope: group_id IN (SELECT …)  →  hashed SubPlan, loops = 1
```

Three properties follow, and each is a different mechanism's job:

| Property | Mechanism | Measured / executed by |
|---|---|---|
| A membership change bites on the **next request, same token** | scope is a **table read**, not a `site_id` claim | W27 |
| The subquery is evaluated **once per statement** | it is **uncorrelated**, over a **closure** rather than a per-row walk | `loops = 1` at 305 and 3305 rows — W30 |
| A member with **no** membership rows sees nothing, in its own scope | scope is **one policy per table**, and capability is a grant — two axes that cannot widen each other | W27 |

The earlier shape — a `sites` table, a `site_id` claim, and a recursive
`site_tree_ids()` walk evaluated per candidate row — is **superseded**. It is not
what the tree above shows. §6 still describes it, W06 and W07 were proved against
it, and the shipped migration still implements it; that mismatch is the whole
point of W26 and W27, and it is why a green `test:rls` is not evidence for the
model above.

```
nest/                        thin app — ~3–5k LOC, not the API
├── main.ts  app.module.ts
├── config/            database, jwt, email, security (registerAs)
├── common/            guards, interceptors, decorators, filters
├── database/
│   ├── migrations/    ONE directory, ONE table, one baseline chain
│   └── seed.ts        uses PostgREST or psql, not TypeORM
├── modules/
│   ├── auth/          JWT issuance, refresh rotation, login orchestration
│   ├── security/      rate limiting, pattern detection, cron
│   ├── captcha/       server-side challenge (kept — it is correct)
│   ├── email/         provider interface + console/mailpit default
│   └── privacy/       export, delete workflows
└── test/              jest-e2e wired into `npm run verify`

# Everything that was a controller/service/DTO for CRUD is now:
#   a table in a migration — PostgREST serves it directly

frontend/src/app/
├── core/            auth/permission services, guards, interceptors, config
├── shared/          pipes + presentational components used by 2+ features
├── features/        self-contained, feature-local services
├── layouts/         shells
└── store/           NGXS removed; signals only
```

### 3.1 What removing TypeORM buys

TypeORM is **removed**. This is not only a LOC change:

- **No raw-query bypass surface.** `entityManager.query()` and
  `createQueryBuilder()` are how the old code evaded its own RLS layer. With
  TypeORM gone, application code has no SQL escape hatch — every read goes
  through PostgREST's uniform interface.
- **No dual dialect config.** `database.config.ts` and `data-source.ts` each
  switch on `DB_TYPE`; one connection string removes the switch.
- **Migrations are plain SQL** in one directory, not an ORM-coupled tree.
- **The schema is the single declarative artifact.** An LLM reads one file
  instead of 63 files under `modules/permissions/`.

Adding a resource becomes **two** artifacts — a base table and an RLS policy —
instead of five: DTO, entity, controller, service, module registration.

> **CORRECTED.** This said "a table (or view)". Views are not an option: ADR-0022
> rejects them because a superuser-created view bypasses RLS silently, and every
> migration here runs as a superuser. See §3.

---

## 4. Sequencing

Ordering is forced by one dependency: **rules must be enforceable before code
can be corrected, and code must be clean before a version upgrade is safe.**

**P4-N** etc. is the stable identifier for a phase; `W` items are the executable
units inside them.

| Phase | Work | Gate |
|---|---|---|
| **P0-N1** | `angular_v2/` skeleton, `AGENTS.md`, ESLint baseline, Postgres, `npm run verify` | `verify` green on an empty app |
| **P1-N2** | Backend rewrite: RLS, contract pipeline, auth, security wiring | RLS policy tests pass |
| **P2-N3** | Frontend rewrite: standalone + OnPush + signals, generated client, hydration | frontend tests green, no manual CD |
| **P3-N4** | Extraction pass: pipes, shared components, layout collapse | no duplicated markup |
| **P4-N5** | Version upgrade: Angular 18→22, Nest 11→12, then zoneless | `verify` green, no `Eager` anywhere |
| **P5-N6** | Docs rewrite | every documented claim true |
| **P6-N7** | PostgREST/RLS spike | all five curl checks from the spike pass |

### 4.1 Item numbering

Every work item carries a stable ID so any claim can be audited individually:

- **`Wnn`** — a work item. Audited by: done / not started / blocked.
- **`Pn-Nn`** — a phase. Audited by: its gate passing.
- **`§n.m`** — a section of this document.

No item may be marked complete without its verification step being run and
recorded. An item with no stated verification is not auditable and is treated as
not started.

### 4.1 Why upgrade is last

Angular 22 makes `OnPush` the default and renames `Default` → `Eager`. This
codebase is at 0% OnPush across 78 components, so the upgrade is a **silent
behavioral change disguised as a version bump**.

On v18, `OnPush` is opt-in, so migration is incremental and safe
component-by-component. On v22 it is the default and there is no per-component
opt-out. Doing the migration first means the upgrade becomes a no-op.

Harvest during the upgrade (free codemods):
- `ng generate @angular/core:control-flow` → converts 147 `*ngIf` + 26 `*ngFor`
- `standalone` flag codemod for the 5 components missing it
- `nest upgrade --dry-run` then real for v11→v12

---

## 5. File inventory

Disposition: **KEEP** (carries over, minor edits) · **REWRITE** (same purpose,
new implementation) · **MOVE** (relocated) · **SPLIT** (becomes N files) ·
**DELETE** (removed with no replacement)

### 5.1 Backend — root and config

| Path | Disposition | Reason |
|---|---|---|
| `src/main.ts` | **REWRITE (thin)** | no Swagger — PostgREST emits the spec. Keep global `ValidationPipe` (strict) and register both exception filters, which are currently imported and never wired |
| `src/app.module.ts` | **REWRITE** | `SecurityThrottlerModule` registered; `as any` removed; the 14-table `exemptTables` list disappears with the RLS proxy |
| `src/app.controller.ts` | **DELETE** | boilerplate |
| `src/app.controller.spec.ts` | **DELETE** | tests a hello-world controller |
| `src/app.service.ts` | **DELETE** | boilerplate |
| `src/config/database.config.ts` | **REPLACE** | one `PG*` connection string, no `DB_TYPE` switch. Env var names drifted (`DB_DATABASE` vs `DB_NAME`, `DATABASE_SYNCHRONIZE` vs `DB_SYNCHRONIZE` — the developer's intent was silently ignored) |
| `src/config/cache-database.config.ts` | **DELETE** | entirely dead — imported nowhere; provisions a `cache/permissions.sqlite` that is never created |
| `src/config/email.config.ts` | **REWRITE** | keep the abstraction; add `assets` handling |
| `src/config/environment.config.ts` | **REWRITE** | add `jwt`, `alerts`, `security`, `captcha` namespaces; assert required keys at boot. The JWT secret must be shared with PostgREST |
| `src/database/data-source.ts` | **DELETE** | TypeORM removed. Replaced by a plain-SQL migration runner (`node-pg-migrate` or `psql`-driven) plus `seed.ts` |
| `postgrest.conf` | **NEW** | DB role, `db-schemas`, `db-anon-role`, and the JWT role-claim mapping and `jwt-role-claim-key`. This is where JWT → identity reaches the policies — and identity is only ever the token's `sub` via `actor()`; the *scope* key is `user_groups` membership read per statement, never a claim |
| `src/database/database.sqlite` | **DELETE** | tracked binary; must never ship |
| `src/database/README.md` | **REWRITE** | describes the deleted tree |
| `src/database/schema-sync.ts` | **DELETE** | 194-line parallel hand-written DDL system |
| `src/database/src/database/database.sqlite` | **DELETE** | stray tracked binary from a path bug |
| `nest-cli.json` | **REWRITE** | add `assets` (email templates are missing from `dist/`); drop the `@nestjs/swagger` CLI plugin — no decorators to generate; drop the `src/scripts/**/*` exclusion once those files are gone |
| `db.sqlite` | **DELETE** | 1.1 MB, tracked, real PII |
| `.env.development` `.env.test` `.env.gmail` | **DELETE** | secrets in the tree; only `.env.example` is committed |
| `.env.example` | **REWRITE** | `PG*` connection vars; `JWT_SECRET` (shared with PostgREST) required; `PGRST_JWT_SECRET`; add `alerts.*`, `security.*` |
| `fix-permissions.js` | **DELETE** | one-off script at package root |
| `package.json` | **REWRITE** | remove `typeorm`, `@nestjs/typeorm`, `@nestjs/swagger`, `@nestjs/passport`, `passport`, `passport-jwt`, `passport-local`, `sqlite3`; add `pg`, `node-pg-migrate`, `postgrest` (or system service); add `verify`, `generate:client` |
| `.gitignore` | **REWRITE** | uncomment `*.sqlite`; add `*.db`, `openapi.tmp.json` |
| `test/jest-e2e.json` | **REWRITE** | currently orphaned — matches neither jest config |

### 5.2 Backend — `src/modules/`

**Read this first.** With PostgREST serving the API layer, every controller and
DTO below is **DELETE, not REWRITE** — PostgREST serves those routes from base
tables. What survives in Nest is only the logic PostgREST cannot express:
algorithms, secrets, sockets, schedules.

> **CORRECTED.** This originally read "from tables and views". Views are
> forbidden (ADR-0022, `AGENTS.md` B1) — see §3.

| Module | Files | Disposition |
|---|---|---|
| **`auth/`** | 45 | **MOSTLY DELETE** — only issuance and orchestration remain |
| `auth.controller.ts` | | **REWRITE (thin)** — PostgREST owns the CRUD routes; this keeps only `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`. Drop the 4 calls to non-existent endpoints |
| `auth.service.ts` | | **REWRITE (thin)** — remove `\|\| true`; CAPTCHA and IP checks are ordered **inside** the handler before `bcrypt.compare` — there is no Passport strategy and no guard chain to hook (ADR-0011); shorten access-token TTL to ~15–30 min; stop baking permissions into the payload; validate password on reset. All user CRUD → PostgREST |
| `auth.module.ts` | | **REWRITE** — no secret fallback; assert `JWT_SECRET` length at bootstrap; share the signing secret with PostgREST |
| `local.strategy.ts` | | **DELETE** — no Passport. `POST /auth/login` verifies the password directly via `bcrypt.compare` |
| `jwt.strategy.ts` | | **DELETE** — PostgREST verifies tokens itself from the shared secret. Revocation uses `db-pre-request`, which runs after role impersonation and before the main query |
| `passport/` (jwt, local, strategies) | | **DELETE** — superseded by PostgREST's JWT verification |
| `dto/*.dto.ts` (10) | | **DELETE** — request DTOs are replaced by PostgREST's generated types. Keep only where Nest still receives a body (`login`, `refresh`, `register`) |
| `entities/*.ts` (6) | | **REWRITE** — becomes table definitions in plain-SQL migrations. `simple-json`→`jsonb`, `datetime`→`timestamptz`, int-boolean→`boolean` |
| `password-validation.service.ts` | | **KEEP** — correct, wired on all 4 paths; add spec |
| `controllers/ip-reputation.controller.ts` | | **DELETE** — reads over PostgREST tables |
| `controllers/login-attempts.controller.ts` | | **DELETE** — same |
| `controllers/login-monitoring.controller.ts` | | **DELETE** — same |
| `controllers/pattern-detection.controller.ts` | | **DELETE** — same |
| `controllers/security-alert.controller.ts` | | **DELETE** — same |
| `services/ip-reputation.service.ts` | | **KEEP + REWRITE** — canonical IP normalization (IPv4-mapped), subnet aggregation, config thresholds. Counts failures at login, which PostgREST cannot do |
| `services/login-attempt.service.ts` | | **KEEP + REWRITE** — add per-account counter; risk metadata to `jsonb` |
| `services/pattern-detection.service.ts` | | **KEEP as extension point** — 1,927 lines, never fed by real failures; wire first, then trim. Document that it is triage requiring traffic |
| `services/security-alert.service.ts` | | **KEEP + REWRITE** — add `registerAs('alerts')` so the 6 config keys resolve |
| **`permissions/`** | 71 | **SPLIT BY THE TWO AXES — see the table below** |

Under ADR-0023 this module has not one disposition but two, because it conflated
scope (rows) with capability (objects). Splitting it is the largest single win in
the rebase.

> **CORRECTED twice.** The rows below were originally keyed on the pre-closure
> design, and then on a `role_capability(db_role, capability)` table. All of that
> is withdrawn. The corrected model: **groups = RLS (which rows), roles = OLS
> (which objects)**, resolved from `user_groups` ⨝ `org_closure` and from
> `user_roles` → `roles` → `role_permissions` → `permissions`, with **no combiner
> and no row carrying both**. A second correction: the module's `PermissionGuard`
> **was** applied — on 47 endpoints across `roles.controller.ts`,
> `users.controller.ts` and the five security/admin controllers — and absent only
> from `groups.controller.ts`, which is where RLS-rule administration lived. So the
> accurate defect is not "unimplemented capability guards" but **"group management
> and RLS administration sat behind authentication alone."** Full evidence:
> ADR-0023 §Context.

| What it did | Axis | Where it goes | Disposition |
|---|---|---|---|
| Injected row filters from group membership | Scope | `CREATE POLICY` migrations, keyed on **`user_groups` membership joined to `org_closure`** — not on a `site_id` claim, and not on a per-row recursive walk | **DELETE** — no application code writes scoping SQL |
| Gated endpoints by role, in the DB role | Object-level security | table + column `GRANT`s | **DELETE** — grants withhold the verb in the database |
| Gated endpoints by capability | Capability | **`permissions(resource, action_id)` + `role_permissions` + `user_roles`, resolved by `has_permission()`**; a `BEFORE INSERT OR UPDATE` trigger enforces the grant-subset rule | **KEEP, rewritten** — the permission surface is *which tables and which verbs*, expressed directly |
| Managed RLS rule/scope templates | — | — | **DELETE with the scope engine.** A rule *editor* exists only to build SQL the database can already be given directly. Keep the editor and you keep a second source of truth for the one thing that must not have one (ADR-0023) |
| Compiled join paths for policies | — | — | **DELETE with the scope engine.** The policy *is* the join; the closure matview is its precomputed form. A compiler that assembles it re-introduces the ORM-driven engine this migration removes |
| CRUD over actions, permissions, grants | — | tables | **DELETE** — PostgREST serves them as `actions` / `permissions` / `role_permissions` |
| `controllers/actions.controller.ts` (top level) | | **DELETE** — duplicate of `controllers/actions.controller.ts` |
| `controllers/actions.controller.ts` | | **DELETE** — becomes an `actions` table; PostgREST serves it. Resolves the `/permissions/actions` collision by deleting both |
| `controllers/permissions.controller.ts` | | **DELETE** — becomes `permissions` + `role_permissions`. Resolves the 6 frontend 404s because the spec regenerates |
| `controllers/resources.controller.ts` | | **DELETE** — no `resources` table: a capability is `resource` + `action` as two columns on `permissions`, not a scanned object |
| `controllers/permission-inspector.controller.ts` | | **DELETE** — becomes a PostgREST embedding (`?select=*,roles(*)`). Kills the `/user/{id}` vs `/users/{id}` mismatch. **Not a view** — see the correction below |
| `controllers/rls-rules.controller.ts` | | **DELETE** — with `rls_rules` and its `sql` / `parameters` raw-SQL columns |
| `controllers/rls-*.controller.ts` (3) | | **DELETE** — `rls_join_paths`, `rls_join_conditions`, `rls_scope_templates`, `rls_condition_groups`, `rls_rule_conditions`, and the scope engine that fed them |
| `scanners/endpoint-scanner.service.ts`, `scanners/route-scanner.service.ts` | | **DELETE** — nothing to scan. PostgREST derives the API surface from the schema, so the permission surface is *which tables and which verbs* and is stated in `permissions` |
| `controllers/cache-sync.controller.ts` | | **DELETE** with the cache subsystem |
| `cache-entities/*` (4 + index) | | **DELETE** — `cache_permission_maps` / `cache_sync_status` are a second copy of the authorization data. `has_permission()` reads the live rows |
| `guards/permission.guard.ts` (×2) | | **DELETE both — two classes on one concern.** Verb-level access becomes table `GRANT`s, which PostgREST cannot bypass. Capability for non-CRUD routes is resolved by `has_permission()` against the same `permissions` rows, not by a second guard with its own vocabulary |
| `decorators/require-permission*.ts` (2) | | **DELETE both as written** — they guard CRUD routes, which grants now govern, and their `ic` / `site_manager` vocabulary is withdrawn. Kills the 3-decorator / 2-`PERMISSIONS_KEY` drift. Anything that remains a guard must call `has_permission(actor(), resource, action)` |
| `dtos/*.ts` (7) | | **DELETE** — replaced by PostgREST's generated types |
| `entities/*.ts` | | **REWRITE** — become table definitions in migrations |
| `permissions.service.ts` (2,353 lines) | | **DELETE** — the single biggest deletion in the rebase. Row-injection logic moves to RLS policies; the raw query at `:729` disappears with TypeORM. **Note the split:** the row-scoping half becomes SQL (a per-table policy), and the capability half becomes `has_permission()` reading `role_permissions` — **also SQL, on its own axis**. Neither survives as application code writing filters |
| `permissions.module.ts` | | **REWRITE** — remove `RlsContextGuard` (never applied) and the duplicated `PermissionGuard`. Register at most one capability resolver, scoped to the thin app's own non-CRUD routes |
| `cache-entities/*` (5) | | **DELETE** — cache-on-database is the wrong mechanism |
| **`users/`** | 19 | **MOSTLY DELETE** |
| `entities/*.entity.re-export.ts` (4) | | **DELETE** — alternate import paths make `Role`/`Group` ownership ambiguous |
| `services/groups.service.ts` vs `groups.service.ts` | | **DELETE both** — two `GroupsService` classes (490-line repo-based vs 68-line permission-based) with divergent authorization models, selected by import path. The hierarchy becomes a **`groups`** table with `parent_id` self-FK; membership becomes **`user_groups`**; authorization becomes a policy over `user_groups` ⨝ `org_closure` |
| `users.service.ts` | | **REWRITE (thin)** — bcrypt cost 10 → configurable ≥12; password hashing only. All CRUD → PostgREST |
| `users.controller.ts`, `groups.controller.ts` | | **DELETE** — tables + policies |
| `dto/*.ts` (5) | | **DELETE** — generated types |
| **`roles/`** | 9 | **DELETE** — becomes `roles` + `role_permissions` + `permissions` + `actions` tables. PostgREST serves them |
| **`schema/`** | 4 | **DELETE** — superseded entirely. PostgREST emits OpenAPI from the live schema, so `openapi.json` is always accurate; the hand-rolled introspection controller and its unauthenticated disclosure are both gone |
| **`cache/`** | 3 | **DELETE** — `cache-sync.service.ts` is 6× `// Implementation will be added later`; `CacheDatabaseConfig` is dead |
| **`captcha/`** | 4 | **KEEP UNCHANGED** — the one fully correct subsystem: server-side canvas, `crypto.randomUUID()` id, 5-min expiry, single-use `delete()`, proper `/verify`. PostgREST cannot generate images. Wire it; do not touch it |
| **`common/security/`** | 5 | **REWRITE** — register `SecurityThrottlerModule`; fix `skip-throttle.decorator.ts` (`THROTTLE_SKIP_KEY = 'throttle-skip'` is not Nest's key); register both exception filters globally. Add an edge-level rate limiter for PostgREST, which does not throttle |
| **`email/`** | 6 | **KEEP** — best abstraction in the repo (2-method `EmailProvider` + DI token, console/Mailpit default). Add `assets` to `nest-cli.json` |
| **`privacy/`** | 5 | **KEEP** — multi-step export/delete workflows are not CRUD. PostgREST serves the underlying data |
| **`shared/`** | 1 | **MOVE** → `common/` |
| **`notifications/`** | 0 | **DELETE** — empty |
| **`user/`** | 3 | **DELETE** — deprecated shim; sole reference is a throwaway script |

#### Net effect of §5.2

| | Files removed | LOC removed |
|---|---|---|
| `permissions/` CRUD + DTOs + service | ~40 of 71 | ~7,800 |
| `users/` CRUD + re-export shims | ~11 of 19 | ~1,900 |
| `roles/` | 9 of 9 | ~1,200 |
| `schema/` | 4 of 4 | ~380 |
| `auth/` CRUD + Passport | ~12 of 45 | ~2,100 |

Every removed controller becomes a base table. Every removed DTO becomes a
generated type. Every removed authorization check becomes a `CREATE POLICY`.

> **CORRECTED.** This line read "a table or a view". Views are rejected by
> ADR-0022 and forbidden by `AGENTS.md` B1; a superuser-created view bypasses
> every RLS policy on its base table with no error, and the migrations run as a
> superuser.

#### Where each key lives after the split

Four things that used to be one mechanism are now separate artifacts, and the
inventory above has to say which survives:

| Replaced by | Name | Drawn in |
|---|---|---|
| The `sites` hierarchy table and its per-row walk | `groups` + `org_closure` | the **migration** (W26) |
| The `site_id` token claim as the scope key | `user_groups` membership, read per statement | the **migration** (W26) |
| A capability label read only by thin-app guards, keyed on a PostgreSQL role name | `roles` → `role_permissions` → `permissions`, resolved by `has_permission()` from `user_roles` | the **migration** (W26) |
| A per-user grant or deny, and any AND/OR combiner over the two axes | **nothing** — every user has a group and a role, and the axes never compete | not replaced; see ADR-0023 §Capability |

### 5.3 Backend — migrations (50 files, both trees)

**Disposition: DELETE ALL, generate one baseline.** The two trees are divergent
forks with colliding class names and duplicate timestamps; 17 are repair
migrations for damage that a clean schema never had. A baseline regenerated from
entities is smaller, has a working `down()`, and is honest.

| Class of migration | Count | Disposition |
|---|---|---|
| `src/migrations/*.ts` | 28 | **DELETE** → regenerate |
| `src/database/migrations/*.ts` | 22 | **DELETE** → regenerate |
| `*Convert*ToNumeric` (UUID→int, SQLite-only) | 6 | **DELETE** — Postgres has native `uuid` |
| `FixSqliteCompositePrimaryKeys` | 1 | **DELETE** — SQLite limitation |
| `FixSqliteTimestampIssues` | 1 | **DELETE** — verified no-op; body is a comment |
| `*MissingColumns`, `Fix*` | ~10 | **DELETE** — repairs |
| RLS table/column/condition migrations | 5 | **DELETE + REWRITE** as native `CREATE POLICY` migrations |

Result: a baseline schema migration + a small set of `CREATE POLICY`
migrations. Every policy gets a test (per `AGENTS.md` B8).

> **The baseline that exists today implements the SUPERSEDED design, so this row
> is not finished.** `backend/database/migrations/0001_rls_foundation.sql` is
> already generated and shipped, and it contains a **`sites`** table, a
> `site_id`-claim accessor (`claim_site_id()`), and a **recursive per-row walk**
> (`site_tree_ids()`). It has **no** `groups`, `user_groups`, `org_closure`,
> `actions`, `permissions`, `roles`, `role_permissions` or `user_roles` — so there
> is **no capability axis in the shipped schema at all**, not a superseded version
> of one. ADR-0023 §Row scope replaces the scope half with
> `groups` + `user_groups` + an `org_closure` matview, §Capability defines the
> capability half, and §6.6.4 records the measurements that decided the scope half
> (`loops = 1` at 305 and at 3305 rows, against 400,001 function calls over 400,000
> rows for the walk).
>
> **Done — this file is the two-axis schema (W26).** `groups` + `user_groups` +
> `authz.org_closure` + `actor()` on the scope side; `actions`, `permissions`,
> `roles`, `role_permissions`, `user_roles` + `has_permission()` on the capability
> side. The scoping subquery is uncorrelated and evaluated **once per statement**
> (`loops = 1`). The `site_tree_ids()` walk, the `site_id` claim accessor and the
> `sites` table are **gone** — asserted on the executable construct, not on the
> bare word: `grep -rnE 'CREATE[[:space:]]+(TEMP(ORARY)?[[:space:]]+)?TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?sites\b\|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[^[:space:]]*(site_tree_ids\|claim_site_id\|request_claims)\b\|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?VIEW' backend/database/`
> returns **nothing**. The bare-substring gate that gate replaced did **not**
> reproduce — it returned three lines, all of them the SUPERSEDED NOTE explaining
> the withdrawal, which §6.0.1 scores as a failure. The suite was rewritten with
> the migration and now runs **68** tests.
> **Three clauses are declared and not enforced** — the grant-subset trigger
> (W08b) and the caller-writable identity GUC (W37). A green
> `test:rls` is evidence for the shape, with those three exceptions.
>
> The rewritten baseline must also declare **every table in one of FOUR
> scoping categories**, because the primary key follows from the category and
> the FK discipline does not follow from either alone (ADR-0023 §Referential
> integrity, ADR-0025 §The fourth category):

| Category | Tables | Primary key | FK discipline |
|---|---|---|---|
| **Group-scoped** | `projects`, `customers` | `PRIMARY KEY (group_id, id)` | carries `group_id`; **every** FK carries `group_id` too |
| **The hierarchy** | `groups` | simple `PRIMARY KEY (id)` | not scoped — it *is* the group; self-FK `parent_id` is admin-only-reachable |
| **Unscoped** | `users`, `actions`, `permissions`, `roles`, `role_permissions`, `user_roles`, `user_groups`, `refresh_tokens`, `login_attempts` | simple primary keys | global reference data, not tenant rows |
| **DERIVED** | `email_messages` | simple `PRIMARY KEY (id)` | **no `group_id`** — scope is the referenced USER's membership; its FK to `users` is permitted because no serving member role may write to `users` |

> **Why a fourth category was needed, in one line each.** `email_messages` has no
> `group_id` because a single one cannot express a user in **several** groups (one
> row per group makes "which groups is this message in?" ambiguous) or a
> self-service reset that names **no group at all** (inventing one puts the row in a
> scope nobody chose). Its policy therefore routes membership through
> `authz.visible_user_ids()`, a `SECURITY DEFINER` helper: a policy subquery runs
> with the **querying** role's privileges and `user_groups` is self-scoped, so read
> inline the predicate silently degrades to "the recipient is me". **Measured**: a
> colleague's message in the **same** group is visible through the helper and
> **not visible** through the inline correlated form. ADR-0025.

Declaring them late is not available: an FK that leaves the group-scoped set is
an **existence oracle** even when every policy is correct, because FK checks are
constraint triggers that run outside RLS (§6.6.4 item 4, tests in W28).

### 5.3.1 Schema cache reload — a mandatory migration step

PostgREST caches the schema. **A newly migrated table 404s until the cache is
reloaded**, with no error message explaining why. This is the highest-likelihood
"the template is broken" report from a fork, so it is handled in the migration
script rather than left to documentation:

```sql
NOTIFY pgrst, 'reload schema';
```

- `npm run migration:run` issues this automatically after the migration transaction
  commits. Reloading is per-request-cheap and only happens when the schema changed.
- If a table is still not served, `db-channel-enabled` must be `true` (the default)
  and the PostgREST role must be permitted to `NOTIFY`.
- `npm run verify` asserts every migrated table is reachable at its endpoint — so
  a stale cache fails the build instead of confusing a developer.
- Tradeoff to verify in the spike: under high migration frequency the NOTIFY can be
  skipped in favour of a PostgREST restart. Either is acceptable; doing nothing is not.
- `NOTIFY` also covers the `org_closure` matview, and that is the problem rather
  than the solution: a matview has no RLS and no policy, PostgREST **auto-publishes**
  it as a first-class resource, and under `openapi-mode = "ignore-privileges"` it
  appears in the served spec **regardless of grants**. A single `GRANT SELECT`
  served the entire org tree to an anonymous caller. Grant it to **nobody**, and
  assert the grant state in a test — the spec will not tell you (W30).

### 5.4 Backend — `src/scripts/` (30 files)

**Disposition: DELETE ALL.** 1,761 lines of `test-*.ts` that assert nothing, plus
one-off fixers. A stale script is worse than no script: it tells a forker that a
capability exists and has been verified.

| Group | Files | Disposition |
|---|---|---|
| `test-*.ts` | 14 | **DELETE** — 0 `expect()` calls; `catch` swallows → exit 0; 10 have no npm entry |
| `fix-groups-table.ts`, `fix-roles-table.ts` | 2 | **DELETE** — direct `sqlite3` driver, bypass TypeORM |
| `prepare-database.ts`, `schema-audit.ts` | 2 | **DELETE** — manual migration-table manipulation |
| `seed-rls.ts` | 1 | **DELETE** — fabricates a mock `ClsService` |
| `check-db-path.ts`, `test-fs-write.ts`, `test-entity-import.ts`, `test-module.ts` | 4 | **DELETE** — environment probes |
| `seed-*.ts` (12) | 12 | **MIGRATE** → consolidate into one `db/seed.ts` using the real services |

### 5.5 Backend — `packages/nestjs-typeorm-rls/` (30 files, 2,411 LOC)

**Disposition: DELETE THE ENTIRE PACKAGE.** Replaced by ~150 lines of
`CREATE POLICY` in `database/migrations/`, reading the claims PostgREST already
verified.

> **CORRECTED.** This originally said "plus a `SET LOCAL app.user_id` helper".
> **That mechanism does not exist and never worked** — a policy reads the setting
> it names, so a policy built on `request.jwt.claims` is blind to `app.user_id`
> (§6.6, finding 3). ADR-0002 carried the same error and is corrected in place.

`rls.module.ts`, `query-builder.proxy.ts`, `entity-manager.proxy.ts`,
`bypass.service.ts`, `rls-scope.types.ts`, `rls.constants.ts`, `index.ts` and
tests — all deleted. See `docs/adr.md` ADR-0002.

### 5.6 Frontend — root and config

| Path | Disposition | Reason |
|---|---|---|
| `package.json` | **REWRITE** | add `openapi-typescript` + `generate:client`; add `verify`; upgrade to Angular 22 |
| `angular.json` | **REWRITE** | point `ssr.entry` at the single real `server.ts`; add `provideClientHydration(withEventReplay())`; remove the dead `src/server.ts` from `files` |
| `tsconfig.json` | **KEEP** | `strict` + `strictTemplates` already correct |
| `.eslintrc.json` / `eslint.config.js` | **DELETE one, REWRITE other** | two competing formats; `angular-eslint` 19 vs Angular 18 (major skew); neither enables any template or OnPush rule |
| `server.ts` (root, 1.7 KB) | **KEEP** | default SSR scaffold; delete `src/server.ts` |
| `src/server.ts` (9.9 KB) | **DELETE** | dead — carries 4 duplicate `/api/auth/*` Express handlers |
| `src/main.ts` | **REWRITE** | remove `module.hot` block; keep the HMR gating |
| `src/index.html` | **KEEP** | |

### 5.7 Frontend — `core/`

| Path | Disposition | Reason |
|---|---|---|
| `services/auth.service.ts` | **REWRITE** | 7 `BehaviorSubject`s → signals; 7th is a test-verification token that has no backend |
| `services/permission.service.ts` | **REWRITE** | `BehaviorSubject` → signals; reads `userPermissionsSubject` while `permission.guard.ts` reads NGXS — two truths |
| `services/captcha.service.ts` | **KEEP** | already a correct HTTP client to `/captcha/generate` + `/verify` — **never called**; wire it |
| `services/advanced-captcha.service.ts` | **DELETE** | hardcoded answers in client JS (`'Circle'`, `'3'`, `'Star'`, `'Blue'`, `'Red'`, `'Green'`, `'Rainy'`, `'Evening'`) |
| `services/app-config.service.ts` | **KEEP** | 7 getters are the correct pattern — read once into component fields |
| `services/notification.service.ts` | **KEEP** | becomes the single user-facing error path |
| `services/dialog-theming.service.ts` | **KEEP** | correct SSR exemplar (`@Inject(DOCUMENT)` + `OverlayContainer`) |
| `services/page-title.service.ts` | **REWRITE** | `BehaviorSubject` → signal |
| `services/password-generator.service.ts` | **KEEP** | |
| `constants/roles.ts` | **SPLIT** | 170 lines holding `SystemRoleType`, `SystemRole`, `SystemRoles`, `UserRole`, and `RolesConstantsService` — a stateful HTTP service with a `BehaviorSubject` inside a file named `constants.ts` |
| `guards/*.ts` (5) | **REWRITE** | 7 `selectSnapshot` calls; `has-permission` pattern; consolidate to signal-based |
| `interceptors/*.ts` (5) | **REWRITE** | `auth.interceptor` hardcodes `/api/auth/logout` and `/api/auth/refresh`; none normalize errors — that is where the 5 copy-pasted `handleError` no-ops go |
| `config/` | **KEEP** | |
| `utils/` | **KEEP** | |

### 5.8 Frontend — `shared/`

| Path | Disposition | Reason |
|---|---|---|
| `shared.module.ts` | **DELETE** | `declarations: [AccessDeniedComponent]`, imported by nobody |
| `modules/permissions.module.ts` | **DELETE** | NgModule wrapper around one directive; replace with standalone imports |
| `directives/has-permission.directive.ts` | **KEEP, one only** | selector is `[hasPermission]` but 16 usages write `*appHasPermission`; both offending files are orphaned, which is the only reason the build survives |
| `directives/mat-select-fix.directive.ts` | **KEEP** | add `takeUntilDestroyed` at `:39` |
| `directives/mat-menu-fix.directive.ts` | **KEEP** | add `takeUntilDestroyed` at `:41` |
| `components/captcha/advanced/*` (5) | **DELETE** | `visual-reasoning.component.ts`, `physical-world.component.ts` (imported nowhere; answers contradict the service); `captcha-selector.component.ts` duplicated with the live copy |
| `components/side-panel/*` (4) | **MOVE** | `SidePanelService` lives inside a component folder |
| `components/access-denied/*` | **REWRITE** | add `standalone: true`; delete the empty NgModule that declares it |
| `components/accessibility-tester/*` | **DELETE** | 565 LOC, embeds a 470-line HTML string, `querySelector`s the whole document, imported by nothing |
| `components/public-header/*`, `public-footer/*` | **KEEP** | consolidate the duplicated copyright line |
| `components/error/*` | **DELETE** | third error-presentation implementation, referenced by nothing |
| `services/responsive-layout.service.ts` | **REWRITE** | `BehaviorSubject` initialised to hardcoded `"desktop"` → guaranteed SSR mismatch |
| `error/`, `decorators/` | **REWRITE** | |

### 5.9 Frontend — `features/` (44 components)

| Area | Disposition | Reason |
|---|---|---|
| `auth/login/*` | **REWRITE** | `isPlatformBrowser` gate around all 3 store subscriptions → server renders a different DOM; replace with signals |
| `auth/register/*` | **REWRITE** | 3 unguarded `localStorage` reads (`:258`, `:272`, `:545-547`) while siblings are guarded → `ReferenceError` at prerender; inline template 180 LOC |
| `auth/forgot-password/*`, `reset-password/*`, `verify-email/*` | **REWRITE** | same browser-gate pattern; `verify-email/auth/verify-email/` is a duplicated 3-deep path with an 11-line empty component |
| `auth/profile/*` | **REWRITE** | form gated on `*ngIf="user"` where the fetch is browser-only; `[(ngModel)]` at `:94` sits one line after a reactive form closes at `:81` |
| `features/errors/*` | **REWRITE** | `error.module.ts` imported by nobody; both `.scss` files referenced by the components **do not exist**; not routed |
| `users/users.component.ts` | **SPLIT** | 831 LOC; 11 constructor deps; 16 subscriptions; 4 nested subscribes; 5 `detectChanges()`; 4 near-identical ~50-line mutate-then-refetch methods; a getter its own template never calls |
| `users/create-user.component.ts` | **REWRITE** | largest inline template (180 LOC); calls `getAvailableRolesForUser(user)` inside `*ngIf` |
| `users/group-selector-*`, `role-selector-*` | **KEEP** | |
| `roles/*` | **REWRITE** | `sortChange.subscribe` at `:276` has no teardown |
| `groups/*` | **REWRITE** | `:347`, `:416`, `:487` subscriptions without teardown; `$any()` ×2 |
| `groups/groups.component.html` | **DELETE** | orphan — the live component uses a 99-line inline template instead |
| `privacy/*` | **REWRITE** | `privacy.service.ts:56` hardcodes `apiUrl = '/api/privacy'`, bypassing `environment.apiUrl` |
| `admin/rls-management/*` (6) | **DELETE** | 5 of 6 inject `HttpClient` directly; each file declares 2 components — and all six are editors for the **ORM-driven scope engine that is being removed**. There is no rule, template or join-path to manage once the policy is SQL |
| `admin/users-management/users-list/users-list.component.html` | **DELETE** | 179 lines with **no component class anywhere**; Bootstrap `bi bi-*` icons used nowhere else; `href="javascript:void(0)"`; broken `*appHasPermission` |
| `dashboard/*`, `blocked/*`, `legal/*` | **KEEP/REWRITE** | dashboard needs the missing `percent` pipe |

### 5.10 Frontend — `layouts/`

| Path | Disposition | Reason |
|---|---|---|
| `header/*` | **REWRITE** | `ChangeDetectorRef` injected at `:70` and never used — leftover from a reverted fix |
| `sidebar/*` | **REWRITE** | has `destroy$` but only 1 `takeUntil` for 2 subscriptions; `hasPermission()` called in 4 `*ngFor` bindings → 4 map lookups per nav item per CD |
| `user-sidebar/*` | **REWRITE** | empty `ngOnDestroy(): void { }` |
| `custom-layout/*` | **REWRITE** | uses `typeof localStorage !== 'undefined'` — a third SSR-guard idiom alongside `isPlatformBrowser` |
| `footer/*`, `public-layout/*` | **KEEP** | footer duplicates the copyright line with `public-footer` |

### 5.11 Frontend — directories to delete outright

| Path | Files | Reason |
|---|---|---|
| `app/modules/admin/**` | 40 | duplicate of `features/admin/**` — same concern, two sibling folders, both routed |
| `app/pages/**` | 24 | `pages/` is not an Angular concept; duplicates `features/` |
| `app/components/users/*` | 2 | `selector: 'app-users'` duplicate of the live `features/users` one; not routed |
| `app/components/captcha/*` | 2 | 364-LOC duplicate; only referenced by the dead `CaptchaModule` |
| `app/components/join-path-diagram/*` | 2 | `HttpClient` + `Injector` + `ChangeDetectorRef` in one class |
| `app/components/scope-builder/*` | 2 | injects `HttpClient` |
| `app/components/debug/*` | 2 | |
| `app/examples/**` | 3 | `permission-example.controller.ts` imports `@nestjs/common`; `permission-example.component.ts` uses Bootstrap, an unresolvable import path, and `*appHasPermission` with no `imports:` array |
| `app/store/**` | 2 | NGXS; auth state duplicated with `core/services/auth.service.ts` |
| `app/tests/**` | 6 | `testing-utils.ts` and `test-utils.ts` are two parallel mock factories; `tests/backup/` |
| `app/services/logging/logger.server.ts` | 1 | Node `fs` inside the browser app |
| `app/models/**` | 7 | **DELETE** — all hand-declared; replaced by generated types. This is the contract-drift epicentre |

### 5.12 Frontend — models (contract-drift epicentre)

7 files, each independently declaring `Role`, `Permission`, `Group`,
`AuthResponse`. `Role.id` is typed `number`, `string`, and `number?` in three
coexisting declarations. **Disposition: DELETE ALL** — regenerated from
`openapi.json`.

### 5.13 Docs (55 files)

**Disposition: DELETE and replace with 9.** Most are wrong; in a template docs
are the interface between the author and every fork, so a wrong doc is worse
than no doc.

| Path | Disposition |
|---|---|
| `docs/endpoints.md` | **DELETE** — line 5 advertises Swagger that does not exist |
| `docs/row-level-security.md`, `docs/rls-plugin-internals.md` | **DELETE** — describe the deleted package |
| `docs/implementation-plans/TYPEORM_RLS_LIBRARY.md` | **DELETE** — same |
| `docs/cache-database-guide.md` | **DELETE** — describes the deleted cache subsystem |
| `docs/DYNAMIC_ACCESS_CONTROL.md`, `docs/access-control-audit-plan.md`, `docs/permissions-system.md`, `docs/PERMISSIONS_SYSTEM_README.md`, `angular/docs-consolidated/PERMISSIONS.md` | **REWRITE** → `docs/security.md` |
| `docs/API_DOCUMENTATION.md`, `docs/api-docs.md`, `docs-consolidated/API.md`, `angular/docs-consolidated/DATABASE_SCHEMA.md`, `docs/DATABASE_SCHEMA.md` | **REWRITE** → generated from `openapi.json` |
| `docs-consolidated/ARCHITECTURE.md`, `docs/TECHNICAL_DOCUMENTATION.md`, `docs/PROJECT_STRUCTURE.md`, `docs/PROJECT_PLAN.md`, `docs/IMPLEMENTATION_STEPS.md`, `docs/SUMMARY.md` | **REWRITE** → `docs/architecture.md` |
| `docs-consolidated/DEVELOPMENT.md`, `docs/DEVELOPMENT_GUIDE.md` | **REWRITE** → `docs/development.md` (drop all Docker deployment content) |
| `docs/security.md`, `docs/ip-allowlist-guide.md`, `docs/email-configuration-guide.md`, `docs/theme-configuration-guide.md`, `docs/cookies.md`, `docs/PRIVACY_COMPLIANCE.md`, `docs/STYLING_GUIDELINES.md`, `docs/DEBUGGING_LOGGING.md`, `docs/user-management.md` | **REWRITE** → `docs/security.md`, `docs/frontend/theming.md` |
| `docs/tests.md` | **REWRITE** → `docs/testing.md` |
| `docs/task-management/*` (6), `docs/CHANGELOG.md` | **DELETE** — project history, not template content |
| `docs/implementation-plans/*` (8) | **DELETE** — completed plans describing the old architecture |
| `README.md`, `README-permissions.md`, `backend/README.md`, `frontend/README.md` | **REWRITE** → single root README |
| `angular/permissions-manifest.json` | **DELETE** — generated from permissions; duplicates the DB |
| `angular/utilities/` | **DELETE** — inspect |

---

## 6. Cross-cutting work items

Each item carries a **status** in its `Work` cell. The vocabulary is small and
it is deliberately narrower than it looks — see §6.0.1.

| ID | Phase | Work | Verified by |
|---|---|---|---|
| W01 | N1 | ESLint baseline: `prefer-on-push`, `prefer-standalone`, `prefer-control-flow`, `conditional-complexity`, `no-empty-lifecycle-method`, `prefer-takeuntil-destroyed` | `npm run lint` reports zero errors with no `eslint-disable` added |
| W02 | N1 | `npm run verify`: build → typecheck → lint → test → smoke against live Postgres | Stop Postgres; assert **non-zero** exit rather than a skip |
| W03 | N1 | Document-level link checker: every relative link in `docs/` and `AGENTS.md` resolves | The checker runs in CI-equivalent `verify` |
| W04 | N1 | Doc-claims checker: every command in `development.md` exists in a `package.json` script | The checker runs in `verify` |
| W05 | N7 | **PostgREST/RLS spike** — table → policy → PostgREST → JWT → curl → `openapi.json` → types. **CORRECTED:** the spike's scoping check was per-claim (`site_id`), which is the design ADR-0023 §Row scope withdrew | Five curl checks: **membership-scoped** RLS (two members of different groups see disjoint rows), anon not a leak, spec served |
| W06 | N2 | **SUPERSEDED (not done).** `postgrest.conf`: `db-anon-role`, `jwt-role-claim-key`, shared secret. **Four** roles: a migration/owner role plus `app_anon`/`app_member`/`app_admin`. The **role and claims machinery is unaffected** by the scope redesign and still stands — what no longer holds is everything it was verified *against*: the claim it fed was a `site_id`, and the policy that read it is the recursive walk | `curl /` returns the spec; a wrong secret is refused; **no request-serving role owns a table**. Re-run unchanged, then re-run **again** after W26/W27 against the closure-join schema — a pass on the old schema is not a pass on this one |
| W07 | N2 | **SUPERSEDED (not done).** Native RLS policies per ADR-0023. It was implemented and proved, and the proof is real: **one composed policy per operation**, fail-closed, `FORCE ROW LEVEL SECURITY`, and the identity read from `request.jwt.claims`. **The scope key, the hierarchy mechanism, and the capability model are all withdrawn**: it keys scope on a `site_id` claim, evaluates a recursive `site_tree_ids()` walk **per candidate row**, and carries capability in a table keyed on a PostgreSQL role name. See W26/W27 — neither is a rewrite of this item, they are this item re-specified | Permitted returns rows; denied returns none; per access path; **and the policy still applies when run as the owner role**. Plus: no `(relid, cmd)` pair carries two `polpermissive` rows. **All of it must be re-executed against the closure-join schema**: the 33 green tests are the superseded design's |
| W08 | N2 | Column + table grants; `REVOKE ALL FROM PUBLIC` first, then `REVOKE SELECT` **at table level** before the column list | Assert `SELECT` is **denied**, not merely omitted. The column-revoke-only order fails **open** — verified |
| W08a | N2 | **Capability as `resource` + `action` over a table, resolved by `has_permission()` from `user_roles`.** Recorded by executed design testing, not by argument. **CORRECTED:** the closure table was listed here among the rejected hierarchy alternatives — that rejection was of *incremental repair*, and closure refreshed wholesale is now the design (§6.6.4). `ltree` and the per-session scope cache remain rejected, each with evidence. **Also corrected:** this item originally specified `role_capability(db_role, capability)`, which left the `roles` table referenced by nothing; `role_permissions.role_id` is now a real FK | Five permissions need **31** roles as grants; a new permission in an existing role is **one inserted row**; the hierarchy alternatives (scope cache, `ltree`) each rejected with evidence and the **closure table reversed**, with the surviving rule being *compare membership, not counts* — §6.6.2, §6.6.4 |
| W08b | N2 | **NOT IMPLEMENTED — and the ADR's least-privilege invariant is therefore half-met.** The grant-subset rule: a `BEFORE INSERT OR UPDATE` trigger on `role_permissions` **and** `user_roles` raises `42501` unless the actor's effective permission set is a **superset** of what is being conferred. Needed because a `role_permissions` write is **unscoped** — there is no group dimension for RLS to filter, so the scope half ("an account manager cannot create a user outside their own RLS scope") is free via `WITH CHECK` while this half has no policy to fall back on. **The shipped migration grants `app_admin` full `INSERT` on both tables and records no gap**, so today any account manager confers any capability. **Two defects in the sketch itself, which is why it cannot simply be pasted in:** (i) it is **vacuous for a caller who already holds the permission conferred** — if the grantor holds `roles.admin`, conferring `roles.admin` confers everything the grantor has; it needs a separation-of-duty rule pinned to a row that is not grantable; (ii) it reads the grantor from a caller-writable GUC, reproducing the very hole it exists to close (ADR-0023 §F1). Sketch: ADR-0023 §Least privilege | Writing a `role_permissions` row for a permission the caller lacks raises `42501`; same for a `user_roles` row conferring a role whose effective set exceeds the caller's; a caller who **does** hold it succeeds. Removing the trigger makes the first two succeed, so the test **proves it can fail**. **There is nothing to assert today** — write the failing test when this lands |
| W09 | N2 | Plain-SQL migrations, one directory, one table; `NOTIFY pgrst, 'reload schema'` after commit | Every migrated table is reachable at its endpoint |
| W10 | N2 | `seed.ts` using PostgREST or `psql`, never TypeORM; seeds the three DB roles and an admin user. Must seed **through** the boundary: connect as `pgrst_authenticator`, `SET LOCAL ROLE app_admin` | A fresh `setup` reaches a logged-in state |
| W11 | N2 | Thin Nest app: JWT issuance, login orchestration, password reset, email, CAPTCHA, cron | Each route has a test; the six security tests in W13 |
| W12 | N2 | Rate limiting for PostgREST routes. **CORRECTED:** this said "via `db-pre-request` or a reverse proxy" — `db-pre-request` **cannot** do it; it runs in a read-only transaction, so a write there fails `25006` and a working request returns `405`. Reverse proxy only | Sustained requests are throttled; PostgREST does not throttle alone, and `db-pre-request` is asserted **not** to be the throttle |
| W13 | N2 | Six security tests: audit row · 5-failure block · blocked-before-credentials · IP normalization · per-account · allowlist | Each **fails** against the old code, passes after |
| W14 | N2 | Delete `packages/nestjs-typeorm-rls/`, TypeORM, Passport, Swagger, and both migration trees | `grep` gates are empty; `npm ls` shows none installed |
| W15 | N3 | `openapi.json` committed — PostgREST Swagger 2.0 → `swagger2openapi` → OpenAPI 3.0 → `openapi-typescript` | Regeneration is a no-op on a clean tree; generated fields are spec-verbatim |
| W16 | N3 | Delete `app/models/**` and all hand-written URLs | `grep` finds no literal API path in `src/` |
| W17 | N3 | Standalone + OnPush + signals across 78 components; delete 25 manual CD calls and the circuit breaker | `grep` for `detectChanges\|markForCheck\|NgZone` is empty |
| W18 | N3 | `provideClientHydration(withEventReplay())`; remove 9 client-only template guards | No hydration mismatch in the SSR smoke test |
| W19 | N3 | Collapse 5 layouts to `core/shared/features/layouts`; move 5 component-level `HttpClient` calls into services | `grep HttpClient --include=*.component.ts` is empty |
| W20 | N4 | Five pipes: `percent` · `truncate` · `fullName` · `iconFor` · `severityClass` | `grep` finds no method call in a template binding |
| W21 | N4 | Extract 3 duplicated admin tables, IP reputation card, auth header, error block, filter panel | No duplicated block; the 504-line template is gone |
| W22 | N5 | Angular 18→22, harvesting the control-flow and `standalone` codemods; Nest 11→12 via `nest upgrade --dry-run` | `verify` green; 147 `*ngIf` and 26 `*ngFor` now `@if`/`@for` |
| W23 | N5 | Zoneless opt-in; remove `NgZone` | `NgZone.isStable`-dependent code absent; SSR still renders |
| W24 | ALL | Remove every mock service and stub; real tests replace the 14 assertion-free scripts | `grep` for mock factories in `src/` is empty; `no-restricted-imports` active |
| W25 | N6 | Rewrite all docs against the built system | Every command runs; every claim is true; W03/W04 pass |
| W26 | N2 | **DONE — the migration is the two-axis schema.** `backend/database/migrations/0001_rls_foundation.sql` was rewritten from the superseded design. `groups` (hierarchical, `parent_id` self-FK, `is_system_group`) + `user_groups` (membership, **not** member-writable) + `authz.org_closure` on the scope side; `actions` + `permissions` + `roles` (`parent_id`, `is_system_role`) + `role_permissions` + `user_roles` on the capability side; `authz.actor()` replaces `claim_site_id()`; `site_tree_ids()` and the `sites` table are **gone**. **No** `permission_rules`, `user_permissions`, `is_granted`, `rls_rules`, `rls_join_paths`, `rls_scope_templates`, `cache_permission_maps` or `api_endpoints` table — and **no** `sql`, `parameters` or `scope_sql` raw-SQL column. Every table declares its scoping category (group-scoped / hierarchy / unscoped) and takes the primary key that follows from it; every FK on a group-scoped table carries `group_id`. A separate `down` file reverses it, dependency-ordered. **Three design changes were forced during implementation and are recorded in the ADR, not here:** the `authz` schema (`db-schemas = "public"` cannot represent "restricted"); `groups`/`user_groups` deliberately **not** `FORCE`d; and `authz.visible_group_ids()` behind a `SECURITY DEFINER` helper | **Executed and passing.** `grep -rnE 'CREATE[[:space:]]+(TEMP(ORARY)?[[:space:]]+)?TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?sites\b\|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[^[:space:]]*(site_tree_ids\|claim_site_id\|request_claims)\b\|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?VIEW' backend/database/` returns **nothing** — **restated, and executable where the gate it replaced was not.** The old gate keyed on the bare substrings `site_tree_ids\|claim_site_id\|\bsites\b` and therefore returned **three non-empty lines**: `0001_rls_foundation.sql:18`, `:19` and `:21`, which are the SUPERSEDED NOTE explaining that those constructs were withdrawn. §6.0.1 calls a non-empty `grep` result a failure, so the recorded gate did not reproduce and would have been scored as one. This gate asserts on the **executable construct** (`CREATE TABLE sites`, `CREATE FUNCTION site_tree_ids` / `claim_site_id` / `request_claims`, and `CREATE VIEW`) rather than on any occurrence of the word, so it is empty on the shipped file and **bites** when a superseded construct is reintroduced — proved by appending `CREATE TABLE sites (id uuid);`, `CREATE FUNCTION site_tree_ids(root uuid) …`, `CREATE OR REPLACE FUNCTION authz.claim_site_id() …`, `CREATE FUNCTION request_claims() …` and `CREATE VIEW site_totals …` to a scratch copy under `/tmp`, which returned all six lines; the scratch copy was discarded. `grep -rn 'role_capability\|user_permissions\|is_granted\|permission_rules\|rls_rules\|rls_join\|rls_scope\|cache_permission\|api_endpoints\|frontend_routes\|ui_components' backend/database/` returns **nothing**; `role_permissions.role_id` is a real FK to `roles.id`; `projects` and `customers` report `PRIMARY KEY (group_id, id)`; the schema is applied twice in a row with no grant change; and `migration:revert` drops it in reverse dependency order. **Gaps recorded, not closed:** the grant-subset trigger (W08b) and `is_system_role` (W34) are absent from the file |
| W27 | N2 | **DONE — the suite is rewritten and runs 68 tests.** `backend/test/rls/rls.spec.ts` was rewritten against the closure-join shape. It asserts, by name, the measured closure behaviours: a member of `EU` sees `EU`/`UK`/`FR` and **not** `HQ`, **not** `US`; a member of `HQ` sees everything beneath; a member of two disjoint groups sees the **union**; no membership rows → **zero** rows and no error; a membership revoked since the token was minted changes scope on the **next request with the same token**; a forged `"role":"app_admin"` in a member's own token still sees only its own subtree. Capability axis: `has_permission()` returns `true` for an actor who **holds** the permission (including **through a parent role**, and two levels up), `false` for a sibling; `role_permissions.role_id` is a real FK; `app_admin` holds **every** capability, so the resolver is a superset and not a bypass. Plus the structural gates: PK shape, no FK leaving the scoped set, `FORCE`d vs not-`FORCE`d, no function executable by `PUBLIC`, `NOSUPERUSER NOBYPASSRLS`, the column-revoke order in both directions, and the idempotent re-apply | **Executed: 68 tests green, `npm run verify` step 7 of 8.** `grep -rn 'site_id\|site_tree_ids' backend/test/rls/` returns **nothing**. **The §6.6.1 tamper matrix was re-measured against the rewritten suite in W33 (2026-10-07)** — the table there is current; the `12 / 2 / 3 of 33` figures are superseded. |
| W28 | N2 | **SHIPPED as far as the schema allows; three of the four shapes are not constructible under the current FK discipline.** FK, `UNIQUE` and primary-key checks are **not policy-governed**, so they bypass RLS and **fail open**. What shipped: `projects.group_id` and `customers.group_id` are `REFERENCES groups(id)` — a **hierarchy** target, so a cross-group write is refused by the policy's `WITH CHECK` *before* the constraint runs, which is why the existence oracle is not reachable from a group-scoped table. The structural gate **is** asserted: no FK on a group-scoped table leaves the group-scoped set, read from `pg_constraint`. What remains: the **silent `UNIQUE` + `ON CONFLICT DO NOTHING`** form is the dangerous one and needs a purpose-built fixture — the secondary `UNIQUE (id)` index on the scoped tables makes an insert of another group's `id` raise `23505`, which is a **documented cross-group existence signal**, not an exploit (the `id` is a 122-bit random uuid generated by the database, so a caller must already know the value it is probing for). Decide whether that trade is accepted or the `UNIQUE` dropped | The structural `pg_constraint` assertion exists and passes. Still to do: one test per oracle shape that can actually be built, each named after the leak, and an explicit written decision on the `projects_id_uniq` existence signal — either "accepted, ids are database-generated 122-bit random" or "drop `UNIQUE` and keep only the composite key" |
| W29 | N2 | **DONE.** Assert no `SECURITY INVOKER` function is reachable by a serving role. Every helper in the migration is `SECURITY DEFINER` with a pinned `search_path`; `assert_group_acyclic` and `assert_role_acyclic` are granted to **nobody** because they are attached as triggers and never called | Suite asserts, per function, that `prosecdef = true`, that no function is executable by `PUBLIC`, that the two trigger functions are executable by **no** serving role, and that the helpers a policy evaluates are executable by **every** role whose requests evaluate it — `app_anon` included. Either half alone passes against a broken configuration |
| W30 | N2 | **DONE, with three corrections the implementation forced.** `authz.org_closure` is created with `UNION` and **no accumulator column**, with `UNIQUE (ancestor, descendant)` — `REFRESH MATERIALIZED VIEW CONCURRENTLY` is refused without it — and refreshed from a **statement-level** trigger on `groups`, inside the writing transaction. **Corrections:** (1) the matview is in **`authz`**, not `public`, and **is granted** to `app_anon`/`app_member`/`app_admin` — "granted to nobody" is **unimplementable**, because a policy expression's subquery runs with the **querying** role's privileges and without the grant *no scoped read evaluates at all*; (2) `CONCURRENTLY` **can** run inside a transaction block that has already written — verified on 15.19 from a row-level trigger — so statement-level is chosen for **one rebuild per statement**, not for legality; (3) the earlier acceptance criterion quoting tenant-read timings during refresh is **withdrawn** — those figures do not reproduce on the shipped closure. The argument is the lock: a plain `REFRESH` holds an **`AccessExclusiveLock`** for the whole rebuild | `EXPLAIN` shows the policy subplan as a **`hashed SubPlan` with `loops = 1`** (assert on `loops`, never on the policy's apparent shape — an `EXISTS`-shaped variant is simplified back into a hashed SubPlan); a write to `groups` is visible to the next read in the **same** transaction; `authz.org_closure` is unreachable over HTTP and absent from the served spec; `has_table_privilege` shows the grant **is** present for the three serving roles. **Done.** |
| W31 | N2 | **DONE, and the fragile property is now documented in the file.** A `BEFORE INSERT OR UPDATE OF parent_id FOR EACH ROW` trigger rejects a cycle on `groups` and on `roles`; the closure query uses `UNION` with **no accumulator**; `temp_file_limit` must be set on the refreshing session. `parent_id REFERENCES groups(id)` does **not** enforce acyclicity, and on an acyclic tree the unsafe and safe variants are indistinguishable — both return 361 rows — so the property is invisible until the data is broken. **The fragility, now stated in the migration:** the multi-row case is refused as a unit only because Postgres advances the **command counter** between trigger firings, so a `BEFORE ROW` trigger's own `SELECT` sees the partially built tree. Measured and stated by shape: a **forward** chain — every parent written later in the same statement — **is refused**; a **backward** chain is **admitted, and correctly so**, because it is genuinely acyclic when each row is checked and no cycle exists afterwards | A two-node group cycle is refused and both rows survive; a group cannot be re-parented onto its own descendant and cannot parent itself; a two-node role cycle is refused; `has_permission` against a cyclic role graph **terminates** (the `UNION` form — the `UNION ALL` form hangs, which is how the shipped `UNION` was arrived at) |
| W32 | N2 | **DONE.** `actor()` catches the `uuid` cast. It lives at **`authz.actor()`** — outside `db-schemas`, so PostgREST does not publish it as an RPC nobody asked for — and the guarded form is preserved exactly: `nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'`, parenthesised before the cast, then wrapped in `EXCEPTION WHEN others THEN RETURN NULL` | Over HTTP, a token with `"sub":"garbage"` and one with **no** `sub` return **zero rows**, not `HTTP 500`. **Done**, and asserted for a member *and* for an admin (a malformed `sub` must not break the admin branch, because `OR` does not short-circuit past a raising operand) |
 | W33 | N2 | **DONE — re-measured 2026-10-07.** The `12 / 2 / 3 of 33` figures were taken against the superseded claim-keyed migration and cannot be carried forward. Re-run against the rewritten suite (baseline **73**: 68 `rls.spec.ts` + 5 `seed.spec.ts`), removing each control in turn, against a throwaway database (`rls_proof`): `ENABLE→DISABLE ROW LEVEL SECURITY` → **19 of 73 red**; column `REVOKE` lines deleted → **3 of 73 red**; boundary `GRANT` widened to the owning role `app` → bootstrap's own `pg_auth_members` assertion fails the fixture first (73 skipped), and with that assertion neutralized the suite catches it, **3 of 73 red**; `ALTER TABLE groups FORCE ROW LEVEL SECURITY` → **17 of 73 red**, and the data-level failure mode is the **empty closure** (`authz.org_closure` = 0 rows, 7 `groups` rows present, no error); `UNION` → `UNION ALL` in the closure query → **0 of 73 red** on the acyclic fixture (the control is invisible without a cycle — a carried-over red count would be a fabrication), and the bounded cycle probe (two-row cycle inserted with `session_replication_role='replica'`, `statement_timeout=3s`, `temp_file_limit=32MB`) fails with `ERROR: temporary file size exceeds temp_file_limit (32768kB)` while the shipped `UNION` form terminates at **4 rows**. Full table: §6.6.1 | Every row executed and recorded with its real failing-test count against the current suite. A carried-over number is a stale result wearing a current one's clothes |
| W34 | N2 | **DONE — the administrative floor is enforced.** `is_system_role` / `is_system_group` were declared and read by nothing: `app_admin` holds `DELETE` on both tables, `DELETE FROM roles WHERE is_system_role = true` returned `204`, and the row was gone. **A column documented as a control and enforced by nothing is worse than no column**, because the comment tells a reader the control is there. The shipped trigger: a row that *is* a floor row may not be `UPDATE`d or `DELETE`d except from a superuser session; **`INSERT` is deliberately uncovered** so the floor stays creatable. `SECURITY INVOKER` and it must stay — a `DEFINER` body would answer about the **owner** and every check would pass, i.e. a floor that never fires. The superuser path is `current_setting('is_superuser')`, **not** `current_user`, because it derives from `SESSION_USER` and survives `SET ROLE`, which keeps the provisioning path distinguishable from a request | A `DELETE` and an `UPDATE` of a system row are refused as `app_admin`; the same delete succeeds from a superuser session; an `INSERT` of a floor row succeeds (it must); and **no serving role holds `TRUNCATE`** on either table — asserted per role, because `TRUNCATE` does not fire a row trigger and a future table-level grant is the change that would reopen this |
| W35 | N2 | **Correct the migration's own comments — three false claims survive in the shipped file.** (1) The `groups` comment says a `FORCE`d refresh *"wrote a closure containing 1 row instead of 2 — the matview silently lost half the tree"*. Re-measured: the closure **empties entirely, 0 rows**. Half-loss is the lucky case and is the figure most likely to be copied forward as tolerable. (2) The refresh comment repeats the `CONCURRENTLY`-cannot-run-after-a-write claim and cites the unreproducible 13.5 / 6.7 / 7606 ms table; the argument is the `AccessExclusiveLock`. (3) The `has_permission` comment describes the recursive term's hazards correctly but the file is where an agent copies from — confirm the shipped body and the comment agree after any change | **Restated gate:** `grep -rnE '[0-9]+(\.[0-9]+)?[[:space:]]*ms\b\|[0-9]+[[:space:]]+rows?[^.]*instead[[:space:]]+of[[:space:]]+[0-9]+' backend/database/` returns **nothing** — it asserts on the **bare numeric timing literal** and the **"N rows instead of M"** claim, not on the prose that quotes them. The gate it replaced, `grep -n 'half the tree\|7606\|7,606\|13\.5 ms' backend/database/`, **did not reproduce**: it returned `0001_rls_foundation.sql:160`, whose text is `containing ZERO rows — not "half the tree". The failure is TOTAL` — i.e. the *corrected* claim, quoting the old phrase in order to refute it. Intent satisfied, verification not: under §6.0.1 a non-empty `grep` result is a failure, so an auditor would score W35 as failed. The restated gate is empty on the shipped file and **bites**: appending `-- The FORCE'd refresh wrote a closure containing 1 row instead of 2 -- half the tree.` and `-- Baseline 13.5 ms, CONCURRENTLY 6.7 ms, plain 7,606 ms, trigger-held 8466 ms.` to a scratch copy under `/tmp` returned both lines (the old gate also caught the second one, but only by quoting a specific retired number rather than the shape of the claim); the scratch copy was discarded. The `groups` comment says **0 rows**; the refresh comment names `AccessExclusiveLock`; no comment asserts a number that was not measured on the shipped schema |
| W36 | N2 | **Fix the `down` script's refuted claim, and the `postgrest.conf` role list.** (1) `0001_rls_foundation.down.sql` states that `GRANT USAGE ON SCHEMA public TO PUBLIC` *"does NOT put it back … Verified twice."* **False.** It emits **no warning**, exits 0, and `has_schema_privilege(role,'public','USAGE')` flips to `true`. The revert exists and the file omits it. Leaving the narrowing in place is the right call; documenting a **non-existent** limitation is not, and "verified twice" on a negative result is a claim about an absence. (2) `postgrest.conf` documents a role `app_migrator` as "the migration/owner role". **No such role exists**: `backend/database/bootstrap/001_roles.sql` creates `pgrst_authenticator`, and `DB_USER`/the `PGRST_DB_URI` user in `.env` is `app`. The comment block is the only place the name appears | The down script either issues `GRANT USAGE ON SCHEMA public TO PUBLIC` or states plainly that the narrowing is **accepted as a residual** and not that the revert "does not exist"; `grep -rn app_migrator` returns **nothing**; a comment in `postgrest.conf` names the role that actually connects |
| W37 | N2 | **Assert the absence of a `request.jwt.claims` write surface — before `db-pre-request` exists.** The whole scope axis is keyed on a **custom GUC that any role may `SET`**. Verified: a member set it directly and read another tenant's rows. No grant or policy can prevent this; the only control is that **no request-reachable SQL path can reach the `SET`**, which is an absence, not a defence. `db-pre-request` (revocation) is a planned request-reachable path and is a **P0** the moment it can set it | A test or structural check that fails if any `pg` client in request-handling code, any RPC accepting SQL or settings, or the `db-pre-request` hook can reach `SET` on `request.jwt.claims`. Until this exists, treat every new SQL surface as **P0 until shown otherwise** — and prefer a design in which the authenticator cannot be talked into it |


### 6.0.1 Audit protocol

Each item is audited independently as **done / not started / blocked**, and **done
requires its verification column to have been executed and recorded** — not read,
not inferred. An item with no runnable verification is treated as not started.

`grep` gates are expected to return nothing; a non-empty result is a failure, not
a warning.

**Superseded is not a fifth status, and it is not "done".** An item can be
*implemented* and *proved* and still be **superseded**, because the design it was
proved against has since been replaced. Concretely:

- A **superseded** item keeps its verification record, because the proof was real
  and deleting it would lose the eight defects that executing the file found
  (§6.6) — the whole reason the ADR records them.
- It is **not done**, because the verification was executed against a schema that
  is no longer the design. Re-running it against the old schema proves nothing
  about the new one.
- It is therefore **not started** as work, until the replacement's own
  verification passes.

This is the exact failure class the governing risk in §1.2 describes, and it
does not announce itself: `npm run test:rls` is green, `verify` passes, and the
green says only that the superseded shape is internally consistent. **W06 and W07
are superseded** — the role and claims machinery they built still stands, but
everything they were proved against was keyed on a `site_id` claim and a
per-candidate-row walk. **Their replacements, W26 (the schema) and W27 (the suite),
are now done**, so W06 and W07 have moved from *not started as work* to
*implemented, proved against a design that no longer exists*. Their verification
columns are therefore **not** to be re-run as written; §6.6.1's tamper matrix has
been re-measured against the rewritten file (**W33**, 2026-10-07) — the table
there is the current record.

### 6.1 Where the boundary sits

The rule for deciding which runtime owns a route:

| If the route needs… | It belongs to |
|---|---|
| A table, CRUD-shaped | **PostgREST** |
| A JWT signed with the private key | Nest |
| A password comparison | Nest |
| An SMTP connection | Nest |
| A canvas-rendered image | Nest |
| A counter that must not be bypassable | Nest (+ a rate limiter in front of PostgREST) |
| A scheduled job | Nest |
| A multi-step workflow | Nest |

Nothing is served by both. A resource that is pure CRUD does not appear in the
Nest application at all.

### 6.2 Consequences of ADR-0022 (no views)

The four capabilities views were carrying, and where each lives now:

| Capability | Mechanism | Verification |
|---|---|---|
| Field naming | One convention: `user_id` in Postgres, on the wire, in types (W21) | No transform exists; assert generated field names match column names |
| Internal columns hidden | `REVOKE SELECT ON <table> FROM app_member` **first**, then `GRANT SELECT (cols)` (W08) — a column revoke under a standing table grant is a silent no-op, and `select=*` then breaks on that table | Test asserts `select` is **denied** — not merely omitted |
| Derived fields | Generated columns or RPC functions (W23) | Test asserts the computed value matches |
| API decoupled from schema | **Not available, deliberately.** A column rename is a breaking change | `verify` fails at compile time until the client is regenerated |

### 6.3 Naming — the three rejections, verified

| Option | Disqualifying evidence |
|---|---|
| **Views** | Superuser-created views bypass all RLS silently. PostgREST: *"When created by a SUPERUSER role, all row-level security policies will be bypassed."* A real leak is recorded in PostgREST #2124. Writes also unreliable: no PK, so upsert needs explicit keys; PATCH/DELETE *"only works for tables, not views"* (PR #2195); *"Deleting more rows than were requested"* |
| **Client key transform** | Rewrites keys inside `jsonb`, breaking passthrough payloads (porsager/postgres #983). PostgREST returns `jsonb` as nested objects so the transform reaches inside. Already tried and deleted in `angular/` after a 35-task refactor |
| **Quoted camelCase columns** | Postgres folds unquoted identifiers to lowercase; every identifier needs quotes, and the mismatch surfaces only when something else references it |

Codegen tooling, also verified:

| Claim | Verdict |
|---|---|
| Orval `namingConvention` covers schema properties | **False.** It covers file names (`output.namingConvention`) and enum keys (`override.namingConvention.enum`). Property conversion needs a custom mutator — requested in orval#2381 |
| Orval supports Angular | **True**, and signal-first via `override.angular.retrievalClient: 'httpResource'`. Not chosen because of the property-naming gap |
| `openapi-typescript` emits spec-verbatim with zero runtime | **True.** Naming resolved at build time, so nothing can corrupt `jsonb` at runtime |

### 6.4 Verified against upstream

Checked against PostgREST documentation and upstream issues rather than assumed:

| Claim | Verdict |
|---|---|
| RLS works with PostgREST | **Confirmed.** Policies read claims via `current_setting('request.jwt.claims', true)::json` |
| PostgREST verifies the JWT itself | **Confirmed.** Role impersonation via the `role` claim, configurable with `jwt-role-claim-key` |
| PostgREST does **not** rate-limit | **Confirmed.** Upstream states you must put a reverse proxy in front; docs ship an Nginx `limit_req` example. W12 stands — and it is **not** `db-pre-request`, which runs in a read-only transaction |
| PostgREST emits column names verbatim, no auto-transform | **Confirmed.** The feature was explicitly declined upstream |
| Column renaming works on reads | **Confirmed, but read-only** — `?select=alias:column`. Writes still require real column names, so aliases cannot solve naming end-to-end |
| Column privileges replace views for hiding columns | **Confirmed with a caveat we under-weighted** — `select=*` breaks, and grant order matters |
| A client-side key transform corrupts `jsonb` passthrough | **Confirmed.** Reproduced by others; PostgREST returns `jsonb` as nested objects, so a recursive transform reaches inside them. Reinforces dropping the transform |

### 6.5 Verified on a live install

A spike ran against a real install, not documentation. Three of the four findings
change the design.

> **Read this with §6.6.2.** The findings below are about RLS mechanics. A later
> round of executed design testing found that a rule in `AGENTS.md` B2 and
> ADR-0023 — "scope and capability never appear in the same expression" — caused
> a silent privilege escalation, and that two documented performance claims were
> false. Neither was visible from the spike.

| | |
|---|---|
| PostgreSQL | **15.19** via `apt-get install postgresql` |
| PostgREST | **16.4**, static binary. The only OpenAPI settings are `openapi-mode`, `openapi-security-active`, `openapi-server-proxy-uri` — **no version switch** |
| RLS per-claim | **Works — and this is the shape that was later withdrawn.** A `site_id` token → only that site's rows; another `site_id` token → only that one's. **Superseded:** scope is now read from `user_groups` membership joined to `org_closure`, not from a claim (§6.6.4, W26). The spike result stands as evidence that PostgREST applies RLS at all; it is not evidence for how scope is keyed |
| Spec generation | **Works.** `GET /` serves the spec |
| Schema reload | `NOTIFY pgrst, 'reload schema'` is **mandatory and sufficient** — no restart (§5.3.1) |
| Contract chain | **Works.** Swagger 2.0 → OpenAPI 3.0 → types, spec-verbatim, zero camelCase leakage |

**1. A table's owner bypasses its RLS policies, silently.** The same JWT claim
returned 5 of 5 rows as owner and 2 of 5 as non-owner. No error, no warning. This
forces **four** roles — a migration/owner role that never serves requests, plus
`app_anon` / `app_member` / `app_admin` — and `FORCE ROW LEVEL SECURITY` on every
protected table **except `groups` and `user_groups`**, where `FORCE` is a silent
data-loss bug rather than hardening (it empties the closure). W06 and W07 assert
the general rule; W27 asserts the two exceptions.

**2. PostgREST emits Swagger 2.0, not OpenAPI 3.x.** `openapi-typescript` targets
3.x, so `swagger2openapi` is a required step in the contract chain (W15). The
converted spec is committed, so only the regenerator needs the tool.

**3. The JWT `role` claim selects the database role.** PostgREST issues
`SET ROLE` to it, so an unknown role fails the request rather than falling back.

> **Corrected after the W07 proof.** "The issuer must validate on mint" is
> necessary and **nowhere near sufficient** — it protects only the issuer. A
> validly-signed token naming a table-owning role escalated completely (§6.6, H7).
> The control is the grant on the authenticator, asserted in a test.

Also noted: an unauthenticated `GET` returns **`200 []`**, not `401`.

> **Corrected after the W07 proof.** This was the spike's shape, where a grant
> existed and the policy denied. With **no grant at all** — the shipped posture for
> `app_anon`, which receives no table grant — the answer is **`401`**, because the
> grant layer refuses before the policy is ever evaluated. Both are fail-closed; the
> status differs. Neither tells you whether a row leaked, which is why the suite
> asserts on bodies and row counts.

**Caveat.** The spike used throwaway secrets and passwords, and its database is
named `pgrst_smoke`. None of it is template material.

### 6.6 Verified by hypothesis testing

Ten hypotheses executed against PostgreSQL 15.19 + PostgREST 16.4, in a dedicated
`hypothesis_test` database. Three of my documented claims were **wrong**.

> **A fourth batch followed — §6.6.2. A fifth — §6.6.4.** These ten are about RLS
> mechanics. §6.6.2 found that a *rule* in ADR-0023 and `AGENTS.md` B2 caused a
> real privilege escalation and that two performance claims written down here were
> false. §6.6.4 then **replaced the row-scope design outright** and reversed four
> decisions recorded in this section, including the rejection of the closure table.
> The section below is correct as far as it goes and is now **superseded on scope,
> hierarchy and capability**.
>
> **Two things in it are load-bearing for the sections that follow it, so it is
> kept rather than replaced.** The findings below were what executing a policy
> file finds — a `SETOF` return type that does not compile, a claim accessor that
> raises instead of denying, `EXECUTE` granted to `PUBLIC`, an admin branch that
> matches nothing — and **every one of them still applies to the closure-join
> schema**, which is why they are re-verified in W27 rather than inherited.
>
> **What is superseded here is the scope *key* and the hierarchy *mechanism*, not
> the mechanics.** The row counts at the end of this section — root→3, mid→2,
> unrelated→1 — describe `site_tree_ids()` + `claim_site_id()`. They are **not**
> the numbers the closure design produces, and the closure numbers are in §6.6.4.
> The shipped migration still contains the old shape (W26) and the suite still
> asserts the old numbers (W27).

| # | Verdict |
|---|---|
| H1 `FORCE` blocks owner DML | **Confirmed** — `new row violates row-level security policy`; DDL unaffected. *Seeding route later changed* — see item 13 below |
| H2 `WITH CHECK` omitted → `USING` governs inserts | **Confirmed** — `with_check IS NULL`, re-checked on `UPDATE` |
| H3 hierarchy policy | **REFUTED as written** — `SETOF uuid` is rejected in a policy expression. Scoping correct once it returns `uuid[]`; root→3, mid→2, unrelated→**1**, admin→all 5, unknown→0 |
| H4 `INVOKER` vs `DEFINER` | **Confirmed** — `INVOKER` returned 1 row, owner-owned `DEFINER` returned the whole tree |
| H5 column grants break `select=*` | **Confirmed** — `403 42501`; explicit columns `200`. Wrong grant order → **`200` with `secret` fully readable** |
| H6 table grants withhold verbs | **Confirmed** — GET 200, POST 201, PATCH/PUT/DELETE `403`, row unchanged |
| H7 role-claim safety | **REFUTED — escalation.** A token naming an owner role read everything and its `DELETE` **removed the row** |
| H8 `db-pre-request` | **Partial** — revocation clean `401`, but the hook is read-only, and an unreadable revocation table fails **open** |
| H9 `openapi-mode` | `follow-privileges` is role-dependent. **Recommend `ignore-privileges`** — deterministic, and it does not reflect column grants anyway |
| H10 denial signalling | **Partial** — no grant → `401`; RLS denial → `200 []`. **A status-only test passes on a real leak** |

**Seven findings that were not on the list at all:**

1. **The documented hierarchy policy does not compile.** Never executed until now.
2. **`FORCE` does not bind a superuser or `BYPASSRLS` role** — `postgres` read 5/5
   from a `FORCE`d table.
3. **`SET LOCAL app.user_id` is not an alternative** to `request.jwt.claims`;
   ADR-0023 offered them as "or".
4. **`request.jwt.claims` returns `''`, not `NULL`, after any `SET LOCAL`** — so the
   documented policy **errored** instead of denying. `AGENTS.md` B2 and ADR-0023 are
   corrected.
5. **`EXECUTE` is granted to `PUBLIC` on new functions by default** — 7 of 9 test
   functions had `NULL proacl`, so any `SECURITY DEFINER` helper is anonymously
   reachable.
6. **A malformed `site_id` breaks admins too.** Item 4 stopped at the `json` cast.
   The `uuid` cast raises independently, and `OR` does **not** short-circuit past
   a raising operand — verified, `invalid input syntax for type uuid: "garbage"`
   for an admin token. **The `TRUE OR NULL` reasoning in ADR-0023 is invalid and is
   withdrawn**; totality now comes from a guarded accessor (`claim_site_id()`,
   `EXCEPTION WHEN others THEN RETURN NULL`).
7. **The documented admin branch is dead code.** It matched
   `request_claims()->>'role' = 'admin'`, but no token ever carries `admin`; the DB
   role is `app_admin`. Verified over HTTP: a valid admin token got `200 []`.
8. **The hierarchy function recursed through its own policy.** `site_tree_ids()`
   reads `sites`, and the `sites` policy called it. Under the documented default
   `SECURITY INVOKER` that is unbounded recursion: **every query as a non-superuser
   role aborted with `stack depth limit exceeded` after ~100 frames.** The whole
   API was dead and the only symptom was a stack trace in the server log. Fixed as
   **one decision, not two** — `SECURITY DEFINER` *and* `sites` deliberately not
   `FORCE`d, because `FORCE` would put the owner inside the function back under the
   policy that called it. `SECURITY DEFINER` is safe here only because the function
   reads no caller-supplied table and returns no caller-supplied data.

**Corrected in W07**, which is where each of these was proven rather than
reasoned about. Beyond the list above, five further defects were found by
executing the corrected file — recorded here because the pattern, not the
instance, is the lesson. **The proof stands; the file it proved is superseded**
(W06/W07 in §6), so each of these must be re-earned against the closure-join
schema in W27 rather than assumed to carry over.

9. **Revoking `EXECUTE` from `PUBLIC` and granting it to nobody** is worse than
   doing nothing: every scoped request became
   `403 permission denied for function request_claims`. A revoke is not a policy.
10. **Omitting `EXECUTE` for `app_anon`** made unauthenticated reads raise rather
    than deny. A policy is evaluated for every role that reaches the table.
11. **The column-grant order failed open.** With a table-level `SELECT` in place,
    `has_column_privilege(..., 'internal_notes', 'SELECT')` was `t`. A column
    revoke under a table grant is silently a no-op, and the column came back at
    HTTP 200 with its value intact.
12. **The escalation-boundary `GRANT` cannot be run by a migration role** —
    `must have admin option on role "app_anon"`. The one statement that is the
    boundary is necessarily a superuser statement, so it moved to
    `database/bootstrap/001_roles.sql`, where it is asserted by reading
    `pg_auth_members` and raising.
13. **The migration/seeding route changed as a *consequence* of item 7.** Claims
    alone can no longer admit a write, because the admin branch discriminates on
    `current_user` rather than on a claim — which is the point of item 7, applied
    consistently. So `SET LOCAL request.jwt.claims = '{"role":"app_admin"}'` now
    buys nothing, and the documented seeding route in ADR-0023 and `AGENTS.md` B1
    silently stopped working. The seeder now **connects as `pgrst_authenticator`
    and `SET ROLE app_admin`** inside one transaction: through the escalation
    boundary rather than around it. A correction to a policy can invalidate a
    procedure documented two sections earlier, which is why both are recorded here.

**A corrected claim, in the same class.** `site_tree_ids` is **self-inclusive**:
its anchor selects the `root` row itself. So a member scoped to a site outside the
tree sees its **own** row and none of the subtree — **1 row, not 0 and not 2.** The
old figure (`unrelated→2`) was wrong, and it was wrong in the direction that makes
a leak look like a feature. "Unrelated→0" would be wrong too: the row is the
caller's own site, and the suite asserts 1 explicitly so the number cannot drift in
either direction.

The one number every document must now agree on — **for the SUPERSEDED design**.
These are `site_tree_ids()` + `claim_site_id()` figures, and they are retained
because they are what the shipped suite still asserts. **They are not the numbers
the closure-join design produces**; when W27 lands these rows are replaced by the
§6.6.4 numbers, and until then a green `test:rls` confirms only this table:

| Claim | Rows visible | Why |
|---|---|---|
| `site_id` = root | **3** | root + mid + leaf |
| `site_id` = mid | **2** | mid + leaf |
| `site_id` = unrelated | **1** | its own row only — the walk is self-inclusive |
| `site_id` = well-formed uuid, no such site | **0** | the walk is empty |
| `role: app_admin` | **all 5** | `current_user` branch |

### 6.6.1 The proof standard: the gate is verified, not asserted

`npm run test:rls` is step **7 of 8** in `verify`, and its claim is stronger than
"the tests pass": **the tests can go red when the control is removed.** A suite
that stays green whether or not the protection exists is worse than no suite,
because it converts an absent control into a documented one.

> **This table was measured against the SUPERSEDED schema, and that limits what it
> proves.** The original `12 / 2 / 3 of 33` figures described a suite exercising
> `site_tree_ids()` + a `site_id` claim. Two consequences, both required reading:
>
> 1. **The *method* is what transfers.** Removing a control and confirming the
>    gate goes red at step 7 is a procedure, not a number. It applies unchanged to
>    the closure-join schema.
> 2. **The *numbers* do not transfer, and neither does the green.** The suite has
>    since been rewritten and now runs **73** tests (68 in `rls.spec.ts` +
>    5 in `seed.spec.ts`) against the closure-join design. **Re-measured in W33
>    (2026-10-07); the table below is the current record. The old `12 / 2 / 3 of
>    33` figures are superseded and cannot be carried forward.**

Each row below was executed by removing one control from the shipped SQL, running
the full gate, and restoring the file byte-for-byte. In every case the run ended at
step 7 with the earlier steps green — which is the point: **typecheck, lint, unit
tests (both projects), integration tests and the smoke check cannot see any of
this.** Only step 7 can.

| Control removed | Result | Failing tests |
|---|---|---|
| *(baseline, nothing removed)* | `verify passed` | — (73 green: 68 `rls.spec.ts` + 5 `seed.spec.ts`; W33 re-measure, 2026-10-07) |
| `ALTER TABLE … ENABLE ROW LEVEL SECURITY` → `DISABLE` (all four tenant tables) | step 7 red | **19 of 73** — every scope assertion leaks: e.g. `a member of EU sees EU, UK and FR, and does not see HQ or US` received `project-APAC, project-EU, project-FR, project-HQ, project-UK, project-US…` |
| the two `REVOKE SELECT ON … FROM app_member` column-hide lines deleted | step 7 red | **3 of 73** — `internal_notes cannot be selected by app_member, and the secret is absent from the body`, plus the projects and cross-role variants |
| the boundary `GRANT` widened to name the table-owning role `app` | step 7 red | Bootstrap's own `pg_auth_members` assertion fails first (fixture refuses, **73 skipped**). With that assertion neutralized for the probe: **3 of 73** — the two escalation tests and `every role other than the three granted ones is refused, including the owner` |
| `ALTER TABLE groups FORCE ROW LEVEL SECURITY` added | step 7 red | **17 of 73** — and the data-level failure mode is the **empty closure**, verified in the database: `authz.org_closure` = **0 rows**, `groups` still holds its 7 rows, no error anywhere. The suite goes red only because scope tests observe the empty scope |
| closure query rewritten with `UNION ALL` | **step 7 green** | **0 of 73** — on the shipped acyclic fixture the two forms are indistinguishable, so the suite does **not** assert this control. The failure mode is real and bounded: with a two-row cycle inserted (`session_replication_role='replica'`), `UNION ALL` fails with `ERROR: temporary file size exceeds temp_file_limit (32768kB)` under `statement_timeout=3s`; the shipped `UNION` terminates with **4 rows** on the same cyclic data |
| `email_messages`: `authz.can_read_email()` removed from the read policy, leaving scope only | step 7 red | **5 of 21** in `email-messages.spec.ts` — a member holding **no** `email:read` received `[ 'reset-for-deep-member', …(3) ]` instead of `[]`, i.e. the full EU subtree's mail history; plus the `user:create`-but-not-`email:read` case, the one-policy structural gate, the `loops = 1`/call-count gate, and the tamper test itself. **This is the OR-ed-capability escalation ADR-0023 §Withdrawn describes, re-measured on a table that did not exist then** |
| `email_messages`: `contentClassFor`'s refusal removed from `src/email/email-content-class.ts` | step 7 red | **1 of 21** — `expected [Function] to throw an error`. The probe showed `password_reset` returning `{"contentClass":"full_body","body":"<a href=\"https://x/reset?token=SECRET\">Reset</a>"}`, i.e. a live reset token accepted for persistence |
| `email_messages`: the derived-scope subquery replaced by the inline correlated `EXISTS` over `user_groups` | step 7 red **and wrong answers** | Not a red-count row — a **correctness** row. A reader could no longer see a **colleague's** message in the **same group** (`visible: false`), while their own stayed visible: a silent under-read with no error, which is indistinguishable from a correctly scoped policy. Also 3,300 `can_read_email()` calls at 3,300 rows against 1, and 4.2 s against 7.6 ms |

Rows 7–9 were measured against the `email-messages` slice's own file (21 tests, baseline green) rather than against the 73-test suite, and each was run by editing the file, executing it, and restoring it byte-for-byte — verified afterwards with `diff` against a pre-tamper copy, because "restored" is a claim and this table is about claims. **`loops = 1` alone would not have caught row 7**: the subplan is a perfect `hashed SubPlan` either way, and only the `pg_stat_user_functions` call count shows the per-row cost.

The baseline for every row in this table is **73 tests** (68 in `rls.spec.ts` + 5 in `seed.spec.ts`). Per-tamper environment note: the boundary-`GRANT` tamper is cluster-global — after the W33 run the widened membership was undone with `REVOKE app FROM pgrst_authenticator` as a superuser and `pg_auth_members` re-checked (exactly `app_anon, app_member, app_admin`), not inferred from the diff.

Two things about that table are worth stating rather than leaving implicit:

- **`verify` stops at the first failing step, so step 8 never runs in a tampered
  run.** "The other seven steps stay green" means the six that run before it are
  green and the run never reaches the eighth. Read the numbers, not the slogan.
- **The boundary test is about the role that actually owns the tables.** The first
  attempt at that tamper granted a placeholder name — `app_migrator`, which **no
  longer exists**: `database/bootstrap/001_roles.sql` creates `pgrst_authenticator`,
  and the migration/owner role is the `DB_USER` in `.env` (`app`). It granted a role
  that owned nothing and held no grants. `verify` stayed **completely green**: the
  suite proves the boundary for the owning role, and granting an unused role is not
  an escalation. Recorded because "we tampered and it stayed green" is exactly the
  result that gets quietly dropped when it is inconvenient — and because the
  placeholder name outlived the role it named, which is the same drift in prose that
  this file exists to catch.
- **Restoring the file does not restore the cluster — and this one failed open.**
  Role membership is **cluster-scoped**, and `001_roles.sql` only ever `GRANT`s;
  it never revokes. So after the boundary tamper, restoring the SQL file left the
  live `pgrst_authenticator` **still a member of the table-owning role**, and the
  next full `verify` was **red at step 7 with the shipped, unmodified SQL in the
  tree** — the confirmed exploit, back again, with a clean checkout. The tamper has
  to be undone with `REVOKE <role> FROM pgrst_authenticator` as a superuser, and
  membership re-checked against `pg_auth_members` before the run counts as
  restored.
  > A tamper run that leaves the environment worse than it found it is not a
  > verification step. Check the *cluster*, not the diff.

Highest severity among these: H7. The mitigation this project documented — validate
the claim at mint — protects only the issuer. The real boundary is
`GRANT app_anon, app_member, app_admin TO pgrst_authenticator` and nothing else.
`REVOKE SET ON PARAMETER role` is inert on PG15. `REVOKE <owner> FROM <auth>` is a
denylist and is bypassed by any unlisted role. **It must be a test, not a migration
comment** — and it now is: `backend/test/rls/` runs as a gating step of `verify`.

Also confirmed: a token with **no `exp` claim is accepted**; forged, unsigned and
expired tokens are rejected. PostgREST caches **schema and grants** — `NOTIFY` is
required for both, but `postgrest.conf` and `db-pre-request` changes need a
restart.

### 6.6.2 Executed design testing — capability, and what was withdrawn

The §6.6 hypotheses were about RLS mechanics. These are about the **authorization
model** — executed against PostgreSQL 15.19 in `cap_proof`, and re-measured
against `hypothesis_test`. One finding is a **security bug caused by our own
documentation**, and it is the reason this section exists.

#### The rule that shipped a privilege escalation — WITHDRAWN

`AGENTS.md` B2 and ADR-0023 both said scope and capability must **"never appear in
the same expression"**, and `security.md` said the same. It read like a safety
property. It was a correctness hazard, because it is precisely the arrangement in
which a capability check gets OR-ed out of existence.

Splitting the axes across policies — the obvious reading of the rule — produces:

```sql
CREATE POLICY scope_only  ON t FOR ALL          USING (<scope>);        -- permissive
CREATE POLICY cap_delete  ON t FOR DELETE USING (<capability>);        -- permissive
```

**Multiple PERMISSIVE policies on one operation are OR-ed.** `scope_only` covers
`DELETE` by itself, so `cap_delete` can only widen the set. Executed, as a member
holding **zero** capabilities:

| | correct shape | rule-compliant shape |
|---|---|---|
| `DELETE` a row in its own unit | **0 rows** | **`DELETE 1`** |
| `INSERT` a row in its own unit | rejected | **`INSERT 0 1`** |
| errors raised | — | **none** |

`INSERT` fails the same way because a `FOR ALL` policy's `USING` expression is
reused as its `WITH CHECK`. The gate was not weak — it was absent, and every
component of it was individually correct.

Semantics, verified directly:

| Shape | Combination | Result |
|---|---|---|
| two **permissive** `SELECT` policies (`unit_id = 2`, `unit_id = 9`) | **OR** | member scoped to unit 2 saw **2** rows |
| + `CREATE POLICY … AS RESTRICTIVE … USING (unit_id = 2)` | **AND** | **1** row |

**What the fixture proves, and what it does not.** Two policies on one operation are
only correct with `AS RESTRICTIVE`, and that is a **Postgres fact** — it does not
change with the authorization model. What *is* now corrected is the design
conclusion this section previously drew from it. It read: *"scope and capability
COMPOSE, in one policy per operation."* The correct conclusion is: **the axes are
separate inputs and are not expressed as two competing policies on one operation at
all.** Scope is one policy per table; capability is object-level security — a grant,
or a `has_permission()` answer. Neither axis can widen the other, and there is no
`AND`/`OR` combiner to reconcile them. What survives from the fixture above is the
`AS RESTRICTIVE` semantics and the measured `OR` behaviour, both of which are why
the withdrawn arrangement was fatal. ADR-0023.

#### Capability: decided, and the alternatives enumerated

Enforced in the database, capability is **`resource` + `action` over a table**
(`actions`, `permissions`, `roles`, `role_permissions`, `user_roles`), resolved by
`has_permission(actor(), resource, action)` — never in database roles, and never
with a per-user override. `role_permissions.role_id` is a real FK to `roles.id`.

- **Confirmed expressible.** `FOR INSERT WITH CHECK` and `FOR DELETE USING`
  discriminate by operation. Verified against the four policies on `users`:
  `SELECT`, `UPDATE` (`USING` + `WITH CHECK`), `INSERT` (`WITH CHECK` only),
  `DELETE` (`USING` only), each with its own scope and capability terms.
- **Grants-as-capability is a dead end — enumerated, not asserted.** A policy can
  only test the serving identity, so a capability modelled as a role needs one
  database role per distinct set. With the **five** permissions in the fixture
  (`financial.read`, `user.create`, `user.deactivate`, `user.delete`, `user.read`)
  that is 2⁵ = 32 sets, the empty one already served by the base role, so **31
  additional roles** — each a policy per table plus an `ADMIN OPTION` cluster
  grant.
- **Role inheritance cannot help: it only adds, never subtracts.** Verified — a
  child inherits a parent's grant, then `REVOKE` from the child leaves it `t`.
  Every serving role is `NOINHERIT` (`rolinherit = f` for all six), so membership
  is inert for privilege resolution anyway. This is why `roles.parent_id` is
  application data in a table resolved by `has_permission()`, not database role
  membership.
- **A new permission inside an existing role = one inserted row, no migration.**
- **A new tier that is not a superset = a new database role** — a bootstrap change
  and an `ADMIN OPTION` grant.

> **SUPERSEDED by W08a.** The table above was originally specified as
> `role_capability(db_role, capability)` keyed on the **PostgreSQL role name**. That
> is withdrawn, and the reason is worth keeping: **it left the `roles` table
> referenced by nothing.** Nothing in the schema joined `roles` to the capability
> table, so no query, no constraint and no migration could answer *"what can this
> role do?"* — only application code could, and application code is where the old
> permissions module enforced nothing. The fix is the foreign key, plus replacing
> the fixed `ic` / `site_manager` label vocabulary with `resource` + `action`.
> **Also withdrawn with it:** per-user grants and denies (`user_permissions`,
> `is_granted`) and their precedence rules, the `permission_rules` AND/OR combiner,
> the permission cache database, and the `api_endpoints` / `frontend_routes` /
> `ui_components` object-scanning tables — PostgREST derives the API surface from
> the schema, so the permission surface is *which tables and which verbs* and there
> is nothing to scan. ADR-0023 §Capability.

#### Hierarchy: kept, and three alternatives built and rejected

> **REVERSED — see §6.6.4.** The "closure table — rejected" verdict below was a
> rejection of *incremental repair*, and it has been allowed to stand as a rejection
> of closure. Closure refreshed wholesale is now the design, and the recursive
> function it replaces is **superseded**, not kept.

- **SUPERSEDED: the recursive `STABLE` function.** Still in
  `0001_rls_foundation.sql` and still what the RLS suite exercises, but keyed on a
  token claim and called once per candidate row.
- **Per-session scope cache — REJECTED AS A VULNERABILITY, not a trade-off.** A
  member honestly scoped to one unit read **50** rows, then called
  `set_config('app.scope', '{150,…,159}', true)` on **its own** custom GUC and read
  **500**. Custom GUCs have no privilege control; `SET LOCAL` gives no protection
  because the caller is the one setting it. Strictly worse than the alternative
  and no faster.
- **Closure table with incremental repair — rejected, then reversed.** Its
  incremental repair **silently disagreed with the tree**: 5 ancestor/descendant
  pairs missing one way and 5 the other, across **9 roots, with zero errors
  raised**. Root 1 had the *same count* both sides (241) and different membership,
  so count-based checks pass. What survives the reversal: **compare membership, not
  counts**, when validating any denormalised scope.
- **`ltree` — rejected.** Its `UNIQUE` constraint on `path` makes the obvious
  repair fail outright: `duplicate key value violates unique constraint
  "org_ltree_path_key"`. Verified.
  > **A correction to an earlier draft of this record.** It justified rejecting
  > `ltree` by claiming `postgresql-contrib` is not installed on this host.
  > **That is false** — `postgresql-contrib 15+248+deb12u1` is installed and
  > `ltree 1.2` is already an extension in `cap_proof`. The real reason is the
  > `UNIQUE` constraint, and it stands alone.

#### Performance claims re-measured — two were false, one correction went further

Measured on PostgreSQL 15.19, 400,000 rows, identical function bodies, only the
declaration changed:

| Previously documented | Verdict | Measured |
|---|---|---|
| "400,000 rows cost 400,001 calls" | **TRUE — kept**, and the reason the design changed | 400,001 calls, via `pg_stat_user_functions` |
| "`PARALLEL SAFE` cost ~170×" | **FALSE — withdrawn** | `PARALLEL SAFE` **5.8 s** vs `PARALLEL UNSAFE` **12.5 s** — **faster** |
| "`PARALLEL SAFE` forces single-threaded evaluation" | **FALSE — withdrawn** | it permits `Gather` + `Parallel Seq Scan`, 4 workers launched |
| per-row evaluation is caused by `VOLATILE` | **FALSE — withdrawn** | `STABLE` **12.5 s** vs `VOLATILE` **21.9 s**; neither is hoisted |
| a `STABLE` function is "hoisted into a one-time InitPlan — 2 invocations for 20,040 rows" | **FALSE — withdrawn** | same function on 20,410 rows: **20,411 calls** |
| "denormalise the scope instead of recursing per row" | **WITHDRAWN as advice, then superseded by the design** | the scope *is* now denormalised, into `org_closure`. What was wrong was the *reason* — optimising a ~3 ms call. The reason that justified it is once-per-statement evaluation (`loops = 1`). See §6.6.4 |

`STABLE` means *"the same answer within this statement"* — **not** "called once".
In a qual that also references a column it is evaluated per candidate row.

> **A note on how this was checked, because it changed the outcome.** The first
> attempt instrumented the function with a `setval` side effect and produced a
> number that did not survive a second attempt. `pg_stat_user_functions.calls` is
> the authoritative counter and needs no cooperation from the function body. Any
> performance claim in this document that was not taken from it, or from
> `EXPLAIN (ANALYZE)`, should be treated as unverified.

### 6.6.3 Open: revocation while a session is live

**Nobody has tested what happens when a permission or a membership is revoked while
a session is live.**

> **PARTIALLY RESOLVED by §6.6.4 — and the premise has changed.** This item was
> written against a design where hierarchy scope rides in a **signed JWT claim**
> while capability resolves from a table, and that asymmetry — *different revocation
> latency by construction* — was the whole concern. It is gone: scope is now a
> **membership table read per statement**, exactly like capability. A membership
> change takes effect on the **next request with the same token**.
>
> **What remains open** is therefore smaller and should be re-stated before it is
> written as a test: the capability side, the token-lifetime question, and the
> refresh-rotation cases. The seam described above no longer exists, so a test
> written from the old text would be testing a design that is superseded.

Recorded as an explicit unknown, with the required cases listed as a specification
in `docs/testing.md` under *Required, and not yet written*. Until they are written
and executed, treat live-session revocation as **not implemented**.

### 6.6.4 Executed design testing — the closure-join row scope, and four reversals

A further round, executed against PostgreSQL 15.19. Four of its findings **reverse
decisions recorded earlier in this document**, which is why it is called out here
rather than folded into §6.6.2. Full narrative and SQL: ADR-0023.

**1. Row scope is a membership table, not a token claim.** `user_groups` joined to a
closure matview, with identity from the token's `sub`. Consequence that matters
operationally: **membership changes take effect on the next request with the same
token.** Scope behaviour, all measured: a member of `EU` sees `EU`, `UK`, `FR` and
**not** `HQ`, **not** `US`; a member of `HQ` sees everything beneath; a member of two
disjoint groups sees the **union** — `IN`/`ANY`, never `AND`. This retires §6.6.3's
premise.

**2. The scoping subquery is hoisted; it is a `hashed SubPlan`.** `loops = 1` at 305
rows and `loops = 1` at 3305 rows; a deliberately correlated variant gives
`loops = 305`. It appears as a **`hashed SubPlan`, not an `InitPlan`** — `x IN
(SELECT …)` yields the hashed form, `InitPlan` being for uncorrelated *scalar*
subqueries. **Uncorrelatedness is what buys once-per-statement**; the node name does
not, and the once-per-statement conclusion is unaffected by the naming correction.
> **For anyone benchmarking:** an `EXISTS`-shaped "correlated" variant is
> **simplified back into a hashed SubPlan**. Only `loops` in the plan reveals the
> truth, never the policy text.

**3. The previous capability resolver was dead — the capability axis was silently
absent.** Its body read `rc.db_role = current_user` inside a **`SECURITY DEFINER`**
function; `SECURITY DEFINER` rebinds `current_user` to the **function owner**, so
the predicate never matched a serving role. **Measured: `false` for `app_admin`
*while holding* the capability row.** Identity inside such a function comes from
the caller — the actor argument, or `current_setting('role', true)`, the only
role-valued setting that tracks impersonation. Measured inside one:
`current_user` = `app`, `current_role` = `app`, `session_user` =
`pgrst_authenticator`, `role` = `app_admin` — three plausible answers and one
correct. `SECURITY INVOKER` is **not** the alternative: it needs `SELECT` on the
capability tables for every serving role, publishing the whole permission matrix.
**See W08a** — the shipped design is `has_permission(who, …)` over `user_roles` /
`roles` / `role_permissions` / `permissions`, so there is no role-valued setting
inside the function to get wrong. **`who` is a parameter, not a verified identity**:
nothing supplies it from `actor()`, and over RPC it arrives in the request body
verbatim. See §6.6.5, finding 1.

**4. Referential-integrity checks bypass RLS and fail OPEN.** Not previously on the
list. Measured: a plain FK is an **existence oracle** (success vs `23503` reveals
any group id, including out-of-scope ones); an FK to a table the caller cannot read
escalates to a **content oracle** (a token value in an unreadable table was
confirmed); `UNIQUE` + `ON CONFLICT DO NOTHING` gives the same oracle with **no
error at all**, which is the most dangerous form; and `ON DELETE CASCADE` crosses
RLS — a member deleted a group they held and destroyed a row in a group they could
never see. Hence a design constraint, not a lint rule: *a group-scoped table may only
carry foreign keys that stay within the group-scoped set, and any FK leaving that
set must terminate at a table members cannot write to.* Scoping categories —
group-scoped (`projects`, `customers`, `PRIMARY KEY (group_id, id)`, `group_id` on
every FK), the hierarchy (`groups`, simple PK, admin-only self-FK), and unscoped
(`users`, `actions`, `permissions`, `roles`, `role_permissions`, `user_roles`,
`user_groups`, simple PKs) — are in ADR-0023.

**5. Cycle safety is a property of `UNION` with no accumulator, and nothing else.**
Same graph, same session: `UNION ALL` + `depth` on a cyclic tree is
**non-terminating** and exceeds `temp_file_limit` in **91 ms**; `UNION` with no
accumulator returns **384 rows in 12.7 ms**. On an *acyclic* tree both return **361
rows** — indistinguishable, which is how this gets got wrong. Defence in depth: a
write-time trigger rejects the cycle; `UNION` bounds it if the trigger is bypassed;
and **`temp_file_limit` must be set on the refreshing session**, or a
non-terminating closure exhausts the filesystem. `parent_id REFERENCES groups(id)`
does **not** enforce acyclicity, and a tolerated cycle makes each member inherit the
whole cycle's scope.

> **And the trigger is load-bearing for a reason nothing documents.** The shipped
> `assert_group_acyclic()` is `BEFORE … FOR EACH ROW`, and its `SELECT` sees rows
> written **earlier in the same command**, because the command counter advances
> between rows. That is the **only** thing stopping a single
> `INSERT INTO groups … SELECT` of two mutually-parenting rows from building a cyclic
> closure. Change the trigger to `FOR EACH STATEMENT` or to a `CONSTRAINT` trigger and
> the bulk form is admitted, with no other symptom. Any code that bulk-loads `groups`
> needs a test that loads it in **one statement**.

**6. The closure matview cannot be granted to nobody, and the `authz` schema exists
because of that.** A matview has no policy, it is auto-exposed as a first-class
resource, and under `openapi-mode = "ignore-privileges"` it appears in the served
spec **regardless of grants**. **A single `GRANT SELECT` served the entire org tree
to an anonymous caller.** So it lives in **`authz`**, outside `db-schemas`, and the
served spec cannot address it.

> **REVERSAL of "grant it to nobody. Not 'grant it narrowly' — nobody."** That was
> drawn from the hazards above and it is **unimplementable**: a policy expression's
> subquery runs with the **querying** role's privileges, so without a `SELECT` grant
> for every role whose requests evaluate the policy, **no scoped read evaluates at
> all** — measured as `permission denied for materialized view org_closure` on every
> insert, select and update. With the grant removed, row scoping is **100%
> non-functional** while every policy and grant still looks correct. The shipped
> answer is the schema for concealment and the grant for reachability, and
> `app_anon` is in the grant list because a policy is evaluated for every role that
> reaches the table.

Refresh it with `REFRESH MATERIALIZED VIEW CONCURRENTLY` (needs
`UNIQUE (ancestor, descendant)`) from a **statement-level** trigger on `groups`.

> **CORRECTED — two claims here were false.**
>
> 1. **"`CONCURRENTLY` cannot run inside a transaction block that has already
>    written", and therefore the trigger must be statement-level.** Does not
>    reproduce on 15.19: `CONCURRENTLY` **succeeds** from a row-level trigger inside
>    a transaction that has already written. The only two restrictions that bite are
>    a **read-only transaction** and a **missing unique index**. Statement-level is
>    still right — because **N group changes cost one rebuild instead of N**.
> 2. **The refresh timing table (13.5 ms baseline / 6.7 ms concurrent / 7,606 ms
>    plain / 8,466 ms trigger-held) is not reproducible.** On the shipped 12-row
>    closure the audit measured plain `REFRESH` at **36.5 ms** and `CONCURRENTLY` at
>    **27.5 ms**. The figures described whatever fixture was loaded, not the design.
>    **The argument is the lock:** a plain `REFRESH` holds an
>    **`AccessExclusiveLock`** for the whole rebuild and blocks every tenant read
>    behind it. Cite that; do not cite milliseconds without naming the fixture.

The refresh runs inside the writing transaction, so there is **no staleness window**.

> **REVERSAL — the blue/green matview swap is withdrawn, and it was also
> impossible.** There is no window to close, and `DROP MATERIALIZED VIEW
> authz.org_closure` is **rejected** because **RLS policies depend on it**. Both
> halves of the earlier proposal fail; only the first was visible without executing.

**7. Four small claims were wrong, in ways that get copied verbatim into SQL.**
`CREATE MATERIALIZED VIEW … AS WITH RECURSIVE …` is a **syntax error** on PG 15 when
the CTE is the whole query — the design parses only because of the trailing `SELECT
ancestor, descendant FROM t`. `actor()` as originally written does not compile:
`->> 'sub'` returns `text` against `RETURNS uuid`, and `->>'sub'::uuid` is *also*
wrong because `::` binds tighter than `->>` — the correct form is
`(… ->> 'sub')::uuid`, and it must be **cast-guarded** rather than left to raise.
`USING` alone **does** govern `INSERT` when no `WITH CHECK` is written (`polqual` is
reused), now confirmed by **denial** rather than by reading `pg_policy`. And a
non-uuid or empty `sub` yielded **`HTTP 500`, not `403`** — fail-closed, but the
wrong signal. **(That last one is now closed: `authz.actor()` catches the cast.)**

**7a. Two claims about the down script and the resolver were false, and both are the
kind that survives a rewrite because they read as measured.**

- **"`GRANT USAGE ON SCHEMA public TO PUBLIC` does NOT put schema usage back …
  Verified twice."** **False.** It emits **no warning at all**, exits 0, and
  `has_schema_privilege(role,'public','USAGE')` flips to **`true`**. The revert
  exists; the down script omits it while asserting it does not. Leaving the narrowing
  in place is the safe call and is right — but documenting a **non-existent**
  limitation is not, and *"verified twice"* on a negative result is a claim about an
  **absence**, which needs a positive assertion and not a warning that did not appear.
  Fix: **W36**.
- **The `has_permission` snippet recorded here used `UNION ALL` and joined
  `role_permissions` to the caller's own roles, then filtered on the ancestor list.**
  Both are wrong, and both are silent. `UNION ALL` with no accumulator does not
  reach a fixed point on a cyclic role graph — **verified: `has_permission` hung.**
  And the join-then-filter shape caps inheritance at the caller's own roles, because
  the join has already discarded every ancestor's rows: the filter is a no-op and
  resolution is silently **one level deep**. **An agent copying that snippet ships a
  hang and a one-level resolver.** The shipped body uses **`UNION`**, `$1`/`$2`/`$3`
  rather than parameter names that shadow columns, and **seeds the ancestor set in
  the CTE**. Fix in the shipped comment: **W35**.

**8. Two inverted research citations.** `InitPlan` was used for "an uncorrelated
subquery"; it is the node for an uncorrelated **scalar** subquery, and `x IN (SELECT
…)` gives a **`hashed SubPlan`**. The once-per-statement conclusion is unaffected.
And the claim that the **two-argument** `current_setting` is the safe form is
**inverted for this case**: measured, two-argument **raises** (`HTTP 500`) and the
**three-argument** form with `nullif` gives a **clean denial**. Keep the
three-argument form.

> **Migration status — read this before citing anything above.**
>
> - `backend/database/migrations/0001_rls_foundation.sql` **has been rewritten**
>   (**W26, done**). The recursive `site_tree_ids()` walk and the `sites` table are
>   **gone**; the executable-construct gate in **W26** below (`CREATE TABLE sites`,
>   `CREATE FUNCTION site_tree_ids` / `claim_site_id` / `request_claims`,
>   `CREATE VIEW`) returns **nothing**. The bare-substring gate that gate replaced
>   did **not** reproduce — it returned `0001_rls_foundation.sql:19` and `:21`,
>   which are the SUPERSEDED NOTE explaining the withdrawal, so under §6.0.1 it
>   read as a failure.
> - `backend/test/rls/` **has been rewritten too** (**W27, done**). It runs **68**
>   tests against the closure-join schema and `verify` is green at step 7 of 8. So
>   items 1–8 above are now **evidence for the shipped design**, which they were not
>   when they were written.
> - **The §6.6.1 tamper table has now been re-measured** (**W33**, 2026-10-07). Its
>   `12 / 2 / 3 of 33` figures belonged to the superseded suite and are superseded;
>   the current table sits in §6.6.1 with real failing-test counts against the
>   73-test suite.
> - **Three clauses of the shipped design are declared and not enforced**, and every
>   item above that depends on them inherits the gap: the **grant-subset trigger**
>   (**W08b**) and the
>   **identity source itself** — `request.jwt.claims` is a caller-writable GUC and
>   the only control is the absence of a request-reachable `SET`, which
>   `db-pre-request` would remove (**W37**).
> - W06 and W07 remain **superseded, not done** (§6.0.1). Their machinery stands;
>   what they were proved against does not.

### 6.6.5 Adversarial audit of the shipped W26/W27 artefacts

An audit of the shipped migration and suite against the documents that govern them
found eleven contradictions between the docs and the code, plus four findings about
the code itself. **The docs have been corrected to match the code.** The code-side
findings are work items: **W33**, **W35**–**W37**, and **W08b**; **W34** closed
during the same pass.

**F1 — scope is keyed on a setting any role can write. Not a bug today; the sharpest
edge in the design.** `request.jwt.claims` is a **custom GUC**, and PostgreSQL applies
no privilege control to custom dot-prefixed settings. **Verified: a member set it
directly and read another tenant's rows.** No grant, policy or constraint prevents
this — there is no such mechanism for a custom GUC. The only control is that **no
request-reachable SQL path can reach the `SET`**, and an absence is not a defence.
**Any `pg` client, RPC, or `db-pre-request` hook that can set it is a P0**, and
`db-pre-request` is planned work. Work item **W37**.

**The same class, second instance: `has_permission`'s `who` argument.** ADR-0023
claimed "`actor()` supplies it from the verified claims". **No such wiring exists.**
`has_permission(who, resource, action)` takes `who` as its first parameter, and
because PostgREST exposes it as an RPC in `public`, **`who` arrives in the request
body verbatim**. It is advisory for a self-check — CRUD capability is table grants —
and it must never be made the enforcement point. Same hazard class as F1.

**D2 — the closure-loss figure was wrong in the dangerous direction.** The migration
recorded that a `FORCE`d refresh *"wrote a closure containing 1 row instead of 2 —
the matview silently lost half the tree"*. Re-measured: the closure **empties
entirely — 0 rows**. Half-loss is the lucky case, and it is the figure most likely to
be copied forward as a tolerable degradation. Work item **W35**.

**M1 — the `down` script's "Verified twice" claim is false.** See item 7a above.
Work item **W36**.

**M11 — the refresh timing table is not reproducible.** See item 6 above. Replaced
throughout with the argument that actually holds: **`CONCURRENTLY` is chosen for the
lock it avoids**, and a plain `REFRESH` holds an `AccessExclusiveLock`.

**M9 — a fragile property nothing documented.** See item 5 above. The multi-row
cycle refusal rests entirely on the command counter advancing between rows of a
`BEFORE … FOR EACH ROW` trigger. W31 carries the missing test.

**F4 — `app_admin` reads the complete `user_groups` table.** The scope policy reads
`user_groups` with the **querying** role's privileges, so no serving role can be
denied `SELECT` on it. `app_member` is narrowed by its own policy; `app_admin` reads
**every user in every group**. That is the price of the superset on that table, and
the grants discussion previously omitted it. **No serving role may write it,
`app_admin` included** — that omission is the control that fails open if forgotten.

**The least-privilege invariant is not met, and the migration records no gap.**
`app_admin` holds full `INSERT`, `UPDATE` and `DELETE` on `role_permissions` and
`user_roles` with nothing filtering them. The ADR's sketch is also **vacuous for a
caller who already holds the permission being conferred**. Work item **W08b**.

**`is_system_role` and `is_system_group` were decorative; they are now enforced.**
Declared, read by nothing, `app_admin` holding `DELETE` on both tables. Closed by
**W34**: a `BEFORE` row trigger, `SECURITY INVOKER`, superuser carve-out recognised by
`current_setting('is_superuser')` rather than `current_user`. The refusal to leave it
as a column is the point: *a column documented as a control and enforced by nothing
is worse than no column, because the comment tells a reader the control is there.*

**`postgrest.conf` names a role that does not exist.** It documents `app_migrator`
as the migration/owner role; the bootstrap creates `pgrst_authenticator` and `.env`
uses `app`. The name appears nowhere else, so the comment is the only carrier of the
error. Work item **W36**.

> **The generalisable lesson, recorded because eleven of these had the same shape.**
> Every contradiction was a document asserting a fact about code, in the past tense,
> where the code had moved. The dangerous ones are not the ones that are obviously
> stale — they are the ones that read as *measured* (`Verified twice`, `half the
> tree`, `7,606 ms`, `UNION ALL`). **An agent copies a number; it does not
> re-measure it.** Prefer an argument that cannot go stale (the lock, the privilege
> mechanism, the query plan's `loops`) over a figure tied to a fixture, and where a
> figure is unavoidable, name the fixture beside it.

### 6.7 Raised to PostgreSQL 18, and a measurement that had been passing for the wrong reason

The move to **PostgreSQL 18** (ADR-0026) is a prerequisite for UUIDv7, not an
independent improvement: `uuidv7()` is core from 18 and there is no extension to
install. Everything in §6.6 that says "verified on 15.19" remains true **as a record
of that experiment**; the floor moved, and the historical measurements were not
re-run against 18 because none of them depend on the server version.

**The baseline was run before any schema change, and it earned its place.** The
first `npm run verify` on 18 failed at step 7 with one test red:
`can_read_email() ran 0 times over 3306 rows: expected 1`. With the schema
completely unchanged, that could only be the server version — so the question became
*which* behaviour changed, and the answer was neither the planner nor the policy.

**It was the test, and it had been green for the wrong reason.**
`test/rls/email-messages.spec.ts` asserts a `STABLE` function is resolved once per
statement by reading `pg_stat_user_functions`. That view is populated only when the
session has `track_functions` enabled, and the default is `none` — so the assertion
was reading an **empty view** and interpreting the absence of a row as zero calls.
It only ever passed because `ALTER SYSTEM SET track_functions = 'all'` had been run
by hand on the development machine and persisted in that cluster's
`postgresql.auto.conf`. A fresh cluster has an empty `auto.conf`.

The failure mode is the one this file exists to prevent: **a security assertion whose
result depended on undocumented manual machine state.** A stock checkout, a CI
runner, or a new contributor's laptop would have reported zero calls — the exact
tamper the assertion exists to catch — and a reviewer would have seen a green suite.
Verified directly: with tracking off the plan still shows `One-Time Filter:
authz.can_read_email()` executing over 3,300 rows, and the view still reads zero.

The fix is to make the measurement **hermetic rather than to relax it**. The throwaway
proof database sets `ALTER DATABASE … SET track_functions = 'all'` when it is created
and is dropped in `afterAll`, so the setting lives and dies with the database and no
box-level configuration is required. The assertion itself is unchanged and still
requires exactly one call.

> **The generalisable lesson.** A test that measures something through a
> **statistics view** inherits that view's configuration requirement. Assert on bodies
> and row counts wherever possible; where the only available measurement is a counter,
> the test must set up the conditions that make the counter meaningful, and *that
> setup is part of the test*. "It passed here" was never evidence — the evidence is
> that it passes on a cluster nobody configured.

**Two other corrections fell out of the same run, both now in the tree:**
`test/rls/email-messages.spec.ts` read its migration list from a hardcoded array of
five files, so `0006` would have been silently excluded and every assertion would
have run against a schema the application no longer ships; it now reads the
directory. And the documented provisioning order — `npm run migration:run` then
`npm run db:seed` — **cannot work on a fresh cluster**, because the migration runner
requires roles that only `db:seed` bootstraps. On a database that already had them
(from a previous provision) the order appeared to work, which is why it went
unnoticed.

---

**Everything in items 1–8 of §6.6.4 is implemented and proved by the shipped
suite.** None of it may be read as a *design that still has to be written* — but §6.6.5
lists the four places where the shipped implementation does not yet do what the
design says, and those must not be read as done either.

## 7. Verification gates

Per phase. Nothing advances until its gate passes.

```bash
# P0
npm run verify            # build + typecheck + lint + test + smoke

# P1 — API layer
npm run test:rls          # gating step 7 of 8: every policy permitted returns rows, denied returns none
                           # and the gate is proven able to fail — see §6.6.1 before trusting it
                           # CURRENTLY VALIDATES THE SUPERSEDED DESIGN (W27): a green run is
                           # not evidence for the closure-join model
npm run generate:client   # PostgREST spec → client regenerates cleanly
curl $PGRST_URL/ | jq .   # PostgREST is serving; OpenAPI is present
grep -rn "typeorm" package.json   # must be absent

# P1 — closure-join scope (W26–W32). Written before implementation so the rebase is
# auditable; none of these has been executed. Each is the verification its item
# claims, not an additional aspiration.
# Must be empty. Assert on the EXECUTABLE construct, not on the bare word: the
# superseded-design note in 0001_rls_foundation.sql quotes `sites`,
# `claim_site_id()` and `site_tree_ids()` in order to explain the withdrawal, so
# a substring gate returns three lines and reads as a failure under §6.0.1.
grep -rnE 'CREATE[[:space:]]+(TEMP(ORARY)?[[:space:]]+)?TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?sites\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[^[:space:]]*(site_tree_ids|claim_site_id|request_claims)\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?VIEW' backend/database/   # must be empty
# EXPLAIN the scoped SELECT: the policy subplan must be a hashed SubPlan with
#   loops = 1 at 305 rows AND at 3305 rows — assert on loops, never on the SQL's
#   apparent shape, because an EXISTS-shaped variant is simplified back to hashed.
# psql: has_table_privilege(<serving role>, 'org_closure', 'SELECT') must be false
#       for every serving role; the matview has no RLS and PostgREST auto-publishes it.
#
# W26 slice — email_messages (the DERIVED category). loops = 1 is NECESSARY BUT NOT
# SUFFICIENT: a STABLE helper BESIDE the hoisted subplan is still called once per
# candidate row. Measured on this table at 3300 rows, track_functions counting:
#   capability INSIDE the subquery   7.6 ms   can_read_email() =    1 call   <- shipped
#   capability BESIDE the IN         1.3 s    can_read_email() = 3300 calls
#   correlated EXISTS (as drafted)   4.2 s    can_read_email() = 3300 calls
# So assert the CALL COUNT from pg_stat_user_functions, not the plan alone — and read
# a MISSING row there as zero calls, since a function never invoked has no row. That
# distinction is load-bearing: removing the capability conjunct produced "ran
# undefined times", which reads as a broken measurement rather than as the escalation
# it had actually caught. email-messages.spec.ts asserts both.

# P2
npm run test -- --watch=false
grep -rn "detectChanges\|markForCheck" src/   # must be empty
grep -rn '\$any(' src/                        # must be empty

# P3
grep -rn "HttpClient" src/app --include=*.component.ts   # must be empty
grep -rn 'ChangeDetectionStrategy.Eager' src/            # must be empty

# P4
npm run build && npm run verify
```

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Two runtimes to run and understand** | High | The setup command starts both. Boundary rule in §6.1 keeps it unambiguous. PostgREST is a single binary — no new service to operate |
| **Two JWT secrets must stay in sync** (`PGRST_JWT_SECRET` and `JWT_SECRET`) | High | Fail loudly at boot if they differ. Documented in `.env.example` |
| API shape couples to schema shape — a column rename breaks the public API | Accepted as a breaking change, not mitigated (ADR-0022). Caught as a compile error by `verify` |
| An LLM writes an over-permissive `USING (true)` policy | High | RLS policy tests (W27) are the only defence — permitted case *and* denied case per policy, per access path, plus the cross-axis case a member with no capability is denied in its own scope. This is the same risk as with Nest; PostgREST does not add it |
| PostgREST does not rate-limit | High | W12 — edge limiter in front of it. Never rely on Postgres query volume as a throttle, and never on `db-pre-request`, which is read-only |
| **The shipped RLS suite is green against a design that has been replaced** | High | `test:rls` and `verify` both pass while the schema is the superseded one, and nothing in either output says so. Mitigation is W26 + W27 landing as one change: rewrite the migration and the suite together, re-measure the §6.6.1 tamper table against the rewritten file, and treat the interim green as **not evidence** (§6.0.1) |
| `angular/` is the only working reference — deleting it strands the work | High | Build in `angular_v2/` alongside; never edit `angular/` until v2 passes every gate |
| RLS rewrite is the highest-risk single item | High | Policies are testable in isolation; ship them before anything depends on them |
| Angular 22's `OnPush` default is a silent breaking change | Medium | Migrate on v18 where it is opt-in; upgrade last (P4) |
| NestJS 12.1 is ~1 week old; ecosystem compatibility unproven | Medium | Pin `@nestjs/config` and verify before adopting. Note `@nestjs/typeorm` and `@nestjs/swagger` are no longer needed, which removes two compatibility questions |
| No Docker — Postgres must be installed locally | Medium | Documented in `AGENTS.md` §1; `verify` fails loudly if the DB is unreachable rather than skipping |
| `embedded-postgres` as a no-Postgres fallback for a forker | Low | Evaluate in P0; do not commit before the gate passes |
| LLM-maintained forks will re-introduce fakes | Medium | `AGENTS.md` §2.2 + ESLint `no-restricted-imports` on mock paths |
| Scope is large enough to stall | Medium | Phases are independently shippable; P0 alone produces a better template than today |

### 8.1 Recorded correction

ADR-0004 originally recommended **against** PostgREST, on the reasoning that
PostgREST makes RLS policies the entire authorization boundary and therefore
carries more risk under agent maintenance than Nest does.

That reasoning was wrong. RLS is the authorization boundary whether or not
PostgREST is in front of it — a Nest + TypeORM query passes through the same
`CREATE POLICY`. The risk was a property of Postgres RLS, not of PostgREST, and
it is being fixed regardless.

The reasoning also inverted a point in PostgREST's favour that went
unacknowledged: **removing TypeORM removes the raw-query escape hatch.** 
`entityManager.query()` and `createQueryBuilder()` are precisely how the previous
implementation evaded its own RLS layer. With TypeORM gone, application code has
no SQL path at all.

ADR-0004 is rewritten accordingly. The correction is recorded here rather than
quietly swapped, because a decision record that hides its reversals is not a
record.