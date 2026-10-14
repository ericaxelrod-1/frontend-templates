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

---

## 9. The privacy module — assessment and port plan

Appended as a new top-level section rather than folded into §2 or §6, because it
is a **feature assessment**, not a finding in the general audit: §2 counts
defects across the whole tree, and this module's problem is not that it has many
defects but that **its centre of gravity does not exist**. It was built for an
application with a user population, a marketing programme and a jurisdictional
obligation, and then filed in a template that has none of those. Porting it as
written would import the obligation without the application.

Read against the tree on 2026-10-11. Nothing was executed; every claim below is
`file:line` in `angular/`.

> **SHIPPED — 2026-10-14, in migrations `0009`–`0014`, with the purge queue in
> §9A and the breaker in §9B.** `npm run verify` passed at that point with
> **264 unit / 39 e2e / 241 RLS / 3 smoke**. Everything below §9.0 is left as it
> was written, because a plan that was wrong is worth more to a reader than a
> plan that was quietly replaced — **but it is a plan, and four of its stated
> mechanisms are not what shipped.** **§9.8 is the reconciliation**: the shape
> that landed, the four places this section's mechanism was wrong, and the three
> things the implementation revealed that no amount of reading this section
> would have predicted. Read §9.8 before acting on anything below.

### 9.0 What was claimed, and by whom

Three commits describe this work. Their subjects are worth quoting in full,
because the plan below rejects most of what they claim:

| Commit | Subject |
|---|---|
| `eb5aebc` | `feat(privacy): complete verified implementation with 100% pass rate (Epics 2-6)` |
| `f28bfe5` | `feat(privacy): complete implementation of privacy system and sentinel (Epics 2-6)` |
| `e8172f9` | `feat(privacy): implement foundational registry and worker (Epic 1)` |

"100% pass rate" is measurable and the measurement is reproducible: **7 spec
files, 693 lines, 26 `it()` blocks, of which 7 are `should be defined`.** That is
a real suite against zero behaviour, and §2 finding 8 records 1,761 lines of
assertion-free tests elsewhere in the same tree for exactly this reason. The
frontend is thinner still: **3 spec files, 3 `it()` blocks, all three
`expect(component).toBeTruthy()`** (`privacy-dashboard.component.spec.ts:35`,
`privacy-settings.component.spec.ts:41`, `public-request.component.spec.ts:30`).

None of this means the code is bad. Some of it is careful work. It means the
commit subject is not evidence, and the rest of §9 is written against the code.

### 9.1 Inventory

**Backend** — `angular/backend/src/modules/privacy/`, 25 files, **2,500 lines**
(1,807 production, 693 spec):

| Piece | LOC | What it is |
|---|---|---|
| `privacy.service.ts` | 346 | Consent flags, export, `deleteAccount` |
| `privacy-housekeeping.service.ts` | 282 | 2 `@Cron` jobs, the provider fan-out worker |
| `privacy.controller.ts` | 198 | 11 routes, JWT-guarded, self-service |
| `privacy-ticket.service.ts` | 195 | Ticket lifecycle, public tickets, magic link |
| `privacy-cleanup.service.ts` | 74 | 2 more `@Cron` jobs |
| `privacy-jurisdiction.service.ts` | 79 | GeoIP → GDPR/CCPA, SLA arithmetic |
| `privacy-registry.service.ts` | 78 | `DiscoveryService` plugin registry |
| `privacy.module.ts` | 78 | Wiring |
| `privacy-public.controller.ts` | 80 | 3 **unauthenticated** routes |
| `privacy-ticket.controller.ts` | 66 | 4 routes, one `@RequirePermission('privacy:read')` |
| `privacy-audit.service.ts` | 46 | HMAC audit writer |
| `privacy-magic-link.service.ts` | 46 | JWT sign/verify |
| `entities/` | 158 | 3 TypeORM entities |
| `scripts/` | 81 | `generate-policy.ts`, `rotate-pepper.ts` |

**Frontend** — `angular/frontend/src/app/`, **1,978 lines**: dashboard (221),
settings (150 + template 173), public request (246), three dialogs (471), admin
table (149), NGXS `PrivacyState` (166) + actions (48), `PrivacyService` (131).

**Supporting**: 3 entities, 4 migrations
(`1777327198305`, `1777327198306`, `1777327370749`, `1777327370750`), a
`@PrivacyProvider()` decorator + `IPrivacyProvider`, `PRIVACY_POLICY.md` (451
bytes), `docs/PRIVACY_COMPLIANCE.md` (17.5 KB), `docs/implementation-plans/PRIVACY_COMPLIANCE_EPICS/`
(6 epics, ~20 stories).

**One provider exists.** `@PrivacyProvider()` is applied exactly once, to
`UsersService` (`users.service.ts:24`, `providerName = 'users'` at `:27`). The
registry discovers it; the registry's own test registers a *second* mock provider
to get a count of 2. **The polymorphic multi-source deletion machinery has one
member, and that member deletes the row that already exists.**

### 9.2 Built vs. not built

**The toast question, answered — the suspicion is correct, and narrower than
stated.**

Toasts were built, for the four **leaf dialogs**, and never for the two **page
components**. `MatSnackBar` is injected and `open()` is called in
`delete-account-dialog.component.ts:136,147`, `export-data-dialog.component.ts:111,147`,
`support-ticket-dialog.component.ts:132,144`, `public-request.component.ts:183,230`
and `privacy-settings.component.ts:62,92,104`. A shared
`core/services/notification.service.ts` exists and is used widely elsewhere
(`groups.component.ts` alone has 14 call sites). **Neither `privacy-dashboard.component.ts`
nor `privacy-admin.component.ts` imports it, or anything else that surfaces a
message.**

The two components that never got one are exactly the two where a privacy
request's *outcome* is reported, and both compensate by inventing a worse channel:

- `privacy-admin.component.ts:138` — `error: (err) => console.error('Failed to load tickets:', err)`. The operator
  sees an empty table and a server log.
- `privacy-dashboard.component.ts` routes everything through NGXS.
  `privacy.state.ts` catches every error and writes it to
  `state.error` (`fetchPreferences`, `updateMarketingConsent`, `updateDoNotSell`,
  `fetchActiveTickets`, `createTicket`, `exportData`, `deleteAccount` — six
  `catchError` blocks). `PrivacyState.getError` (`:48-51`) is a selector that
  **zero components select**. Verified: the only `PrivacyState` consumers are
  `header.component.ts:57,86`, `privacy-dashboard.component.ts:189-191` and
  `privacy-settings.component.ts:37-38`, and none reads `getError`.

So the precise statement is not "toasts never happened" — it is **"toasts
happened at the leaves and the page-level error channel is a store field that
nothing renders."** The NGXS error field is worse than no channel, because it is
a failure handler that provably executes and provably reaches no user, and it is
the reason the module can look complete in a code review: the `catchError` is
right there.

Two more page-level surfaces are inert:

- `privacy-dashboard.component.ts:85` — `VIEW ALL REQUESTS` is a `<button>` with
  **no `(click)` handler**.
- `privacy-admin.component.ts:81-83` — `View Details` is a `<button>` with **no
  `(click)` handler**. Every row has a button that does nothing.
- `privacy-dashboard.component.ts:48` — the "Privacy Score" widget renders a
  **hardcoded `85`/100** with the comment `<!-- Privacy Score Widget (Placeholder for now) -->`.
  Nothing anywhere computes a privacy score.

**What is genuinely built and working:** jurisdiction resolution
(`privacy-jurisdiction.service.ts` — declaration > profile > IP, with the priority
order asserted); the HMAC audit writer's *format*; the file-path sanitisation in
the export worker (`:142-145`); the atomic job claim (`privacy-housekeeping.service.ts:76-84`
— conditional `UPDATE`, `affected === 1`, genuinely race-safe); the `Promise.allSettled`
fan-out with per-provider error collection; the `HeavyRoute` → disk-usage
interceptor, which *is* wired end to end
(`system-resource.interceptor.ts:21-38`).

**What is not built, with evidence:**

| Claim implied by the commits | Evidence |
|---|---|
| "Data subject deletion" | `privacy.service.ts:235-244` is a **soft delete**: `isDeleted: true`, and the row is *retained* with `email`/`username` overwritten to `deleted_<id>_<ts>@deleted.local`. Nothing erases. `users.service.ts:862-877` (`onDelete`, the provider path) does the same and additionally sets `password: 'ANONYMIZED'` — a **literal string in the password column**, not a hash. |
| "Deletion timeout" | `privacy.service.ts:209-213` constructs an `AbortController` and arms `controller.abort()` — **`controller.signal` is never passed to `provider.onDelete`**. The `Promise.race` at `:216-224` is the only real timeout; the controller is dead code. Contrast `privacy-housekeeping.service.ts:161`, where the same pattern *is* wired (`{ signal: controller.signal }`). The delete path was written by copying the export path and dropping the wiring. |
| "Failures are handled" | `privacy.service.ts:207` `Promise.allSettled` + `:226-228` `console.error` per provider. Every provider can fail and `deleteAccount` still returns `success: true` with the message *"All personal data has been removed."* This is §2.3's "silently returning a success-shaped value is a bug", and it is what makes the erasure untestable — see below. |
| "Audit trail" | `PrivacyAuditService.logAction` is called from **exactly two places**, both `scripts/` (`generate-policy.ts:43`, `rotate-pepper.ts:18`). **No request path, ever, writes an audit row.** Worse: **`privacy_audit_logs` is created by no migration** — `1777327198305` creates `privacy_tickets` and `privacy_jobs` only, and `1777327370749` creates the same two. The entity exists and is registered in `privacy.module.ts:38`, so under `synchronize: true` (`config/database.config.ts:20`) the table appears, and under a migration-only provision **it does not exist**. |
| "Tamper-evident audit" | `privacy-audit.service.ts:31` computes an HMAC and stores it. **Nothing ever verifies it** — `grep -rn 'hmacHash\|verifyHmac'` over `backend/src/` returns only the entity, the writer, and the spec. A hash nobody checks is not tamper evidence. The pepper also defaults to `'default-pepper'` (`:25`) and the keyring reads `PRIVACY_PEPPER_${KID}` with no startup assertion, so a missing pepper silently produces HMACs under a known key. |
| "`partial_success` erasure policy" | The entity declares it (`privacy-job.entity.ts:13`), the worker writes it (`privacy-housekeeping.service.ts:208-210`), and **both migrations' CHECK constraints omit it**: `1777327198305:34` and `1777327370749:139` are both `CHECK ("status" IN ('pending','processing','completed','failed'))`. Under a migration-provisioned database, writing it raises a constraint violation. The one test that covers this path (`privacy-housekeeping.service.spec.ts:106`) mocks the repository, so it cannot see the constraint. |
| "Admin can review requests" | `privacy-ticket.service.ts:165-170` returns **every ticket, unscoped**. The only control is `@RequirePermission('privacy:read')` (`privacy-ticket.controller.ts:45`), and the grant is **order-dependent**: `1777327198306` inserts the permission rows at `:31-38`, *then* looks up the roles at `:41-48`, and at `:51-54` — if neither `'Administrator'` nor `'Super Administrator'` exists it `console.warn`s and **`return`s**, having already inserted the permissions. Roles are seeded (`database/seeds/`, `db/seeds/role-seed.service.ts`) and `data-source.ts:79` sets `migrationsRun: true` at startup, so on a database where migrations win the race **the permission exists and nobody holds it**, permanently. |
| "Sentinel monitors privacy health" | `system-health.controller.ts:18` — `getUserTickets(0) // Mock for global tickets`. User id `0` is a hardcoded magic value standing in for "all tickets"; `activeJobs` is derived from it. `:41` — `POST clear-temp` returns `{ message: 'Cleanup job triggered' }` and **triggers nothing**. `:23-25` — `disk.total/used/free` are hardcoded `0` beside a real `percentage`. |
| "Compliance documentation" | `backend/PRIVACY_POLICY.md` is 451 bytes and its §1 reads *"We collect data through the following services:"* followed immediately by §2 — an empty list under a heading that promises one. |

**Fields that exist and are written by nothing:** `verified_at` and
`accrued_paused_time` (`privacy-ticket.entity.ts:74-78`) are in the entity and in
both migrations and are never assigned — `verifyTicket` (`privacy-ticket.service.ts:130-155`)
sets `slaDeadline` and `status` and stops. `provider_results` is `simple-json`
(`privacy-job.entity.ts:38`), which `AGENTS.md` §B1 forbids outright.
`privacy.service.ts:58` computes `windowHours` and never uses it;
`createPublicTicket` recomputes it at `:106`.

**Security defects that would not survive a review, recorded because they change
what ports:**

- `privacy-magic-link.service.ts:22,29` — the magic-link JWT secret defaults to
  the literal `'privacy-magic-secret'`. `AGENTS.md` §2.3: *"No default fallbacks
  for security-critical config."* Forging a token for **any** `ticketId`+`email`
  pair passes `verifyToken`, and `GET privacy/tickets/public/verify` then advances
  the ticket and **starts the SLA clock and the erasure job**.
- `privacy.module.ts:44` — `JwtModule` defaults `JWT_SECRET` to `'your-secret-key'`.
- `privacy-ticket.service.ts:110-113` — `createPublicTicket` **`console.log`s the
  magic link** and returns it in the HTTP response body. §2.5 forbids logging
  tokens; returning it makes the emailed secret unnecessary.
- `privacy-public.controller.ts:30` — `@Body() body: any, // Use 'any' temporarily
  to debug the payload structure`. A debug marker left in reachable code, with
  the reason stated in the comment and never removed.
- `privacy-jurisdiction.service.ts:38` — `console.warn` in a catch.
- `privacy-housekeeping.service.ts:30-32` — `fs.mkdirSync` in a **constructor**,
  under `process.cwd()/data/privacy/exports`. Two services (`privacy-housekeeping`
  `:17`, `privacy-cleanup` `:12`) both write to the same undeclared path.
- The self-service admin listing is `@Get('all')` under `@Get()` — declared
  **before** `:id`, which is correct, and worth recording as the one place the
  route ordering was got right.

### 9.3 What does not port

| Legacy concern | Why not |
|---|---|
| **All three TypeORM entities** | No ORM (§B1). They become plain SQL in `backend/database/migrations/`. The entity files carry no logic — `privacy-job.entity.ts` is a column list. |
| **Both SQLite migrations + the third/fourth privacy migrations** | Postgres 18, `uuidv7()` keys, `timestamptz`, `jsonb` not `simple-json`. The `CHECK` constraints are also wrong (§9.2) and would be copied forward as a latent bug. |
| **The provider registry** (`IPrivacyProvider`, `@PrivacyProvider()`, `privacy-registry.service.ts`) | One member, and that member deletes a row that already exists. `DiscoveryService` + `Reflector` + metadata to discover a single hardcoded provider is the exact "looks finished and isn't" shape §2.1 forbids. **The extension point a forker actually needs is a foreign key**, not a DI plugin: to delete from a table you add, you add `ON DELETE CASCADE` from `users`, and §9.4's scope helper picks the row up for free. |
| **`privacy-jurisdiction.service.ts` in full** | It imports `geoip-lite` (§0: zero external credentials), maintains a **hand-rolled 27-country EU list** (`:53-60`) that will silently rot, and `GB` is in it with the comment *"technically UK but often follows similar GDPR"* — a legal determination made by a hardcoded array literal. It also resolves to `OTHER` in the overwhelmingly common case of no GeoIP hit. A jurisdiction column whose only reliable output is `"other"` is a column. |
| **SLA deadlines** | They are a function of the jurisdiction, so they inherit everything above, and they add `accrued_paused_time` — a column that exists for a pause/resume feature nobody implemented. |
| **`privacy-public.controller.ts` — all 3 routes** | The entire verification apparatus exists for one reason: to let an **unauthenticated** caller open an erasure request about an account they cannot authenticate as. In a template whose users authenticate, the correct design is that **there is no anonymous erasure path**. Dropping it removes the CAPTCHA integration, the magic link, the `UNVERIFIED` state, the 24-hour expiry cron, and the `verified_at` column in one move. |
| **`privacy-magic-link.service.ts`** | Same reason. A verification token is an authentication mechanism, and §2.4 says one mechanism per concern — `refresh_tokens` already is one. |
| **The job queue** — `privacy_jobs`, `privacy-housekeeping.service.ts`'s `processJobs`, `privacy-cleanup.service.ts`'s `staleJobMonitor`, the `PENDING→PROCESSING→lockedAt` claim, and the 4-counter reconciliation at `:238-280` | All of it exists to make a 30-second fan-out across N providers **resumable and idempotent**. The target operation is a single `DELETE` in a single transaction, which cannot half-finish. **Every `@Cron` in this module disappears**; `angular_v2` keeps none. |
| **`cleanupUnverifiedTickets`, `tempFileCleaner`** | Both delete things that no longer exist: unverified public tickets, and export files written to the local filesystem. The export path itself does not port (§9.4). |
| **`exportUserData`** (`privacy.service.ts:98-172`) and both export routes | It assembles profile + login history + **behaviour profile** + security alerts. Shipping a "your data" feature whose payload includes `typicalLoginHours`, `knownIps` and `knownUserAgents` (`privacy.service.ts:150-158`) teaches a forker to build a behavioural fingerprint and then hand it to the subject. That is a worse default than having no export. Deferred — §9.7 Q3. |
| **`updatePrivacyRestrictions`, `submitProcessingObjection`, `removeProcessingObjection`, `updateMarketingConsent`, `updateDoNotSell`** and their 4 routes | These are four CRUD endpoints over four `users` columns modelling obligations against processing this template **does not perform**. There is no marketing programme to consent to and nothing to sell. §9.7 Q2. |
| **All 3 controllers as controllers** | `privacy.controller.ts`'s 11 routes and `privacy-ticket.controller.ts`'s 4 are CRUD over tables. §6.1: a resource that is pure CRUD does not appear in the Nest application at all. |
| **`privacy-audit.service.ts` as written** | The HMAC keyring, `rotate-pepper.ts`, and `generate-policy.ts` go. The *audit trail* itself ports, in a different shape — §9.5. |
| **`scripts/`** | Both bootstrap a Nest context and write an audit row as a side effect. Neither has anything to do once the audit trail is written by the erasure itself. |
| **`PRIVACY_POLICY.md`, `docs/PRIVACY_COMPLIANCE*.md`, `PRIVACY_COMPLIANCE_EPICS/`** | 17.5 KB of prose describing an obligation structure the template does not adopt. `docs/` in `angular_v2` is rewritten against the built system (W25). |

### 9.4 What ports, and as what

Two tables. Names are proposals; the **category, policy and permission column is
the part that is load-bearing.**

#### `privacy_requests` — the request itself

- **Category: DERIVED.** No `group_id`, for the same two reasons
  `email_messages` has none (ADR-0025), and both apply here verbatim: a user may
  hold several groups (one column would mean duplicating a request per group, and
  "which groups is this request in?" becomes ambiguous), and an operator reading
  requests should not see them partitioned by a group they did not choose. Simple
  `PRIMARY KEY (id uuid DEFAULT uuidv7())`.
- **FK discipline:** `user_id uuid REFERENCES public.users (id)`. This leaves the
  DERIVED set, which is permitted **only at a table members cannot write to** —
  and no serving role holds `INSERT` on it except `app_admin` (W40). This is the
  one FK in the design and it is the one that makes `ON DELETE CASCADE` (§9.5)
  legal.
- **Scope policy — one predicate, both axes, uncorrelated, helper INSIDE the
  subquery**, copied from `email_read_scope`
  (`0005_email_messages.sql:277-299`) rather than invented:

  ```sql
  CREATE POLICY privacy_request_read ON public.privacy_requests FOR SELECT USING (
    privacy_requests.user_id IN (
      SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id)
       WHERE authz.can_read_privacy_request()
    )
  );
  ```

  `authz.visible_user_ids()` is the existing helper
  (`0005_email_messages.sql:237-251`) and it already carries the measurement
  that makes it mandatory rather than tidy: the inline `EXISTS` form **is
  correctness-broken**, because a policy subquery reads `user_groups` with the
  querying role's privileges and that table self-scopes to `user_id =
  authz.actor()`. `authz.can_read_privacy_request()` is a new
  `SECURITY DEFINER` wrapper over
  `has_permission(authz.actor(), 'privacy_request', 'read')`, cloned from
  `can_read_email()` (`0005_email_messages.sql:178-203`).
- **Capability: a NEW permission row, `privacy_request:read`.** Not `user:read`
  and not `privacy:read` — §B2's rule is that reusing a permission makes the
  grant invisible, and the legacy tree already demonstrates why: it shipped four
  permissions (`privacy:read/edit/delete/admin`) under one `privacy` resource and
  then gated one endpoint on one of them. Written by **both** the migration and
  `database/seed.ts`, both `ON CONFLICT DO NOTHING`, asserted from the live
  catalog.
- **Grants:** `SELECT, INSERT` to `app_member, app_admin`; **`DELETE` to nobody.**
  A member may open and read their own request; they may not delete it in
  isolation, because the deletion is atomic with the user row (§9.5) and a
  half-done erasure is exactly the state §2.1 is about.
- **Served by PostgREST.** Read via `GET /privacy_requests?select=*`; create via
  `POST /privacy_requests`. No Nest controller, no DTO, no hand-written URL
  (§B3/B4 — the Angular types come from the regenerated spec).

#### `privacy_request_events` — the audit trail

- **Category: unscoped**, and it is the first unscoped table that is *not*
  global reference data — it is global *record-keeping*. Simple `PRIMARY KEY (id)`.
- **Append-only, and therefore NOT PostgREST-writable.** `REVOKE INSERT, UPDATE,
  DELETE … FROM PUBLIC, app_anon, app_member, app_admin`, then
  `GRANT SELECT TO app_admin` only. Writes happen inside the `SECURITY DEFINER`
  erasure function only. This is the task's explicit check, and the answer is
  emphatic: **the legacy audit trail needs this and considerably more** — its
  table does not exist in any migration, nothing writes to it, and its integrity
  check is never performed. A table that can be mutated is an append-only table
  that isn't (§B2).
- **No FK to `privacy_requests` and no FK to `users`.** Both would defeat the
  purpose: the audit must survive the request's deletion, and an FK is checked
  outside RLS and fails open. The row carries `actor_id`, an
  `action`, and a **`subject_ref`** — a keyed digest of the user id, not the id
  itself, so the trail remains meaningful after the subject's row is gone
  without retaining a link to a person who has asked to be forgotten. The digest
  key is asserted present at boot (§2.3, no default), unlike the legacy's
  `'default-pepper'`.
- **Capability:** a second new row, `privacy_request_event:read`, admin-only.
  One permission per capability, never one row serving both.
- **Served by PostgREST** for read; **never** for write.

#### The deletion — thin Nest app, and why it cannot be PostgREST

`POST /privacy/erase` in the thin app. §3 already lists *"privacy workflows"*
among the ten things PostgREST cannot do, so this is not a new boundary — and
the reason it must be Nest is specific, not convenience:

1. `users` is `FORCE`d with `USING (current_user = 'app_admin')` and granted only
   to `app_admin` (`0002_refresh_tokens.sql:51-54`). A member **cannot** delete
   their own user row through PostgREST.
2. Escalating to the owner inside PostgREST would mean a `/rpc/` function, which
   means `current_user` is still `app_member` — so the delete is still
   policy-governed, and the policy reads `request.jwt.claims`. That is fine
   *if* the GUC is set by PostgREST from a verified JWT, which is exactly the
   mechanism §B2 F1 says is caller-writable by design and W37 is a P0 gate on.
   Putting a **destructive** function behind it raises the stakes without
   changing the guarantee.
3. The operation is not one statement. It revokes sessions, deletes the user row
   (which cascades to `email_messages`, `refresh_tokens`, `user_roles`,
   `user_groups` — §9.5), deletes the request, and appends the audit row. A
   partial erasure is the worst possible outcome, so it is one transaction in one
   place.

**The actor parameter is safe here and unsafe over PostgREST, and the difference
is worth stating precisely.** The function takes `p_actor uuid` explicitly rather
than reading `authz.actor()`, because the Nest connection cannot set the claims
GUC without becoming a W37 violation. That is safe *only because* `p_actor`
originates in a `JwtAuthGuard`-verified token inside Nest and never crosses an
HTTP body into SQL. The same signature exposed as `/rpc/erase_subject` would let
any caller name any `p_actor` and delete that user's account — the identical
hazard §B2 records for `has_permission(who, …)` (63 unauthenticated probes
recovered an administrator's full permission set). **One rule, stated once:
a `SECURITY DEFINER` function that mutates takes its actor from the verified
token, or takes no actor at all.**

The function itself must re-check what the guard decided, because a guard is
application code and §B2's governing claim is that RLS is not:
`has_permission(p_actor, 'privacy_request', 'erase')` **AND**
(`p_actor = p_subject` **OR** `p_subject` ∈ `authz.visible_user_ids()`). The
second disjunct is what makes an operator-initiated erasure possible without
widening the self-service path.

### 9.5 The deletion-request semantics

> *Delete the user record and the GDPR request itself. Nothing else.*

**What it plainly implies.** A template has no second data source, so the entire
jurisdiction/verification/SLA apparatus is solving a problem that does not exist
here — and every piece of it (GeoIP, a hand-maintained EU list, magic links, an
`UNVERIFIED` state, an expiry cron, a `PARTIAL_SUCCESS` ladder) is machinery whose
failure mode is silent. **Delete, retain, and make extensible** is the honest
split:

| | |
|---|---|
| **DELETE** | The `users` row. The `privacy_requests` row. Everything that cascades from `users`. |
| **RETAIN** | `privacy_request_events` — a keyed digest, never the id. `login_attempts` (`email_address`/`ip_address` are the subject's, but they are the security audit trail and `email_messages` is the mail history; both need a **decision**, §9.7 Q1, not a default). |
| **EXTENSIBLE** | A forker adds a table, adds `REFERENCES public.users (id) ON DELETE CASCADE`, and it is erased. No plugin, no provider registration, no code change. |

**What blocks the stated semantics today — this is the finding that matters most
for W40.** The deletion *cannot be implemented on the current schema*:

- `refresh_tokens.user_id uuid NOT NULL REFERENCES public.users (id)`
  (`0002_refresh_tokens.sql:73`) — **no `ON DELETE` clause**, so `NO ACTION`.
- `email_messages.user_id uuid NOT NULL REFERENCES public.users (id)`
  (`0005_email_messages.sql:56`) — same.
- `user_roles` and `user_groups` carried **no FK to `users` at all.**
  `0001_rls_foundation.sql:137-146` says so in a comment — *"No foreign key to
  `users`: the authentication tables are a later work item… When `users` lands this
  becomes `REFERENCES users (id)`"* — and **it was never done at the time this
  section was written.** `0002` created `users` and did not revisit it.

> **CORRECTED — 2026-10-12, by a migration that has since landed.** The third
> bullet is no longer true: `0008_user_identity.sql:242` declares
> `user_roles_user_id_fkey` and `user_groups_user_id_fkey` as
> `REFERENCES public.users (id) ON DELETE CASCADE`, which closes exactly the gap
> the paragraph below describes. The first two bullets are unchanged —
> `refresh_tokens` and `email_messages` are still `NO ACTION` — so the `23503`
> this section warns about is still live, and W38 survives as those two cascades
> only. §9A.1 records the correction where the consequence lands.

So `DELETE FROM users WHERE id = $1` raises **`23503`** the moment the user has a
single refresh token — which is every authenticated user. And were the FKs merely
absent rather than restrictive, the result would be worse and quieter: a deleted
user keeps a live `user_roles` row and live `user_groups` rows, and
`authz.visible_user_ids()` would keep resolving that id as a visible subject,
because it reads `user_groups` without ever joining `users`. **An erasure that
leaves the erased person's identity in the scope index has not erased it.**

**RLS: who may see a `privacy_requests` row, and how a request about user X is
scoped.**

- **The subject sees their own.** `authz.visible_user_ids()` is self-inclusive —
  it anchors on `mine.group_id` and the hierarchy walk includes the anchor's own
  group — so `authz.actor()`'s own id is in the returned set. **This must be
  asserted, not assumed** (§9.6, W43); "unrelated group → 0 rows" is a bug
  statement and "self → 1 row" is the property that makes self-service possible.
- **A colleague in the same group sees the request** if they hold
  `privacy_request:read`. A member **holding zero capabilities sees nothing**,
  including requests about themselves — scope AND capability in one predicate,
  never two `PERMISSIVE` policies (§B2, and the measured escalation that rule
  exists to prevent).
- **`app_admin` sees every request.** Note the shipped precedent is that
  `email_read_scope` carries **no** `current_user = 'app_admin'` branch; admin
  breadth comes from the admin's group placement in the closure. That is
  consistent, but it is an assumption about the seed, and W43 asserts it
  explicitly rather than letting it be true by accident.
- **A request about user X is scoped by X's membership**, not by the group's.
  The policy never reads `privacy_requests.group_id`, because there isn't one.
  That is the DERIVED category's whole point and it is what stops a request being
  visible in a group its subject never chose.
- **The FK is the residual.** `23503` vs. success reveals whether a given uuid is
  a live `users` row — the existence oracle §B2 names. For a table members hold
  `INSERT` on, that is reachable. It is bounded (the id is a 122-bit
  database-generated uuid) and should be **written down as an accepted trade**,
  in the shape W28 already uses for `projects_id_uniq`.

**Proving it.** Six assertions, each named after what it prevents, each with a
denied case **on row counts, not status codes** (§B8):

1. *A member with `privacy_request:read` sees their own request and a colleague's
   in the same group, and sees zero from an unrelated group.*
2. *A member holding no `privacy_request:read` sees zero requests about
   themselves, inside their own group.* (The cross-axis case; a status-only
   assertion passes on a leak.)
3. *Erasure deletes the user row, the request row and the cascaded children in
   one transaction, and leaves `privacy_request_events` intact* — asserted by an
   **unfiltered owner count**, because a filtered count cannot distinguish "not
   deleted" from "cannot see" (§B5).
4. *No serving role holds INSERT, UPDATE or DELETE on `privacy_request_events`.*
   Assert **per role**, and assert `TRUNCATE` too — it does not fire a row
   trigger (§B2).
5. *Erasing a user who has a refresh token and an email message succeeds* —
   this is the `23503` test, and it is the one that would have caught W40's
   absence.
6. *After erasure, `authz.visible_user_ids()` no longer returns the erased id* —
   the orphan-membership test. **This is the assertion that distinguishes
   "the user row is gone" from "the user is gone",** and it is the one to write
   first.

**Tamper proof.** Per §6.6.1 and B8, each control is removed in turn and the
suite must go red: drop the `can_read_privacy_request()` conjunct (a member with
no capability reads their own group's requests); `GRANT DELETE` to `app_member`
(the erasure becomes deletable in isolation); drop `ON DELETE CASCADE` from
`users → email_messages` (assertion 5 goes red with `23503`). A control that
cannot fail is not a control.

### 9.6 Work items

Same shape as §6; these extend that table and use its `W…` series.

| ID | Phase | Work | Verified by |
|---|---|---|---|
| W38 | N2 | **PARTLY DONE — what is left is two cascades, not four.** `0008_user_identity.sql:242` shipped `user_roles`/`user_groups` → `users(id) ON DELETE CASCADE`, so the two missing FKs are closed. **`refresh_tokens.user_id` (`0002_refresh_tokens.sql:73`) and `email_messages.user_id` (`0005_email_messages.sql:56`) are still `NO ACTION`, so `DELETE FROM users` still raises `23503` for any authenticated user.** Nothing is unimplementable yet, but nothing is finished either | *Erasing a user holding a refresh token and an email message succeeds; the cascaded child rows are gone by an unfiltered owner count; `user_roles`/`user_groups` hold no row for the erased id; and `authz.visible_user_ids()` no longer returns it.* The membership half of this **already passes** — `test/rls/user-identity.spec.ts` asserts it on the `DELETE` path, which §9A.1 supersedes with anonymisation |
| W39 | N2 | `privacy_requests`, **DERIVED**, no `group_id`, `uuidv7()` PK, `user_id → users(id)`. One policy, `USING (user_id IN (SELECT … FROM authz.visible_user_ids() WHERE authz.can_read_privacy_request()))` — capability **inside** the subquery | `EXPLAIN` shows a **hashed SubPlan with `loops = 1`**, *and* `pg_stat_user_functions` shows **1** `can_read_privacy_request()` call at N rows. `loops = 1` alone is **necessary and not sufficient** — measured 3,300 calls beside the `IN` against 1 inside it (§6.7). A missing row in `pg_stat_user_functions` reads as **zero**, not as a broken measurement |
| W40 | N2 | Capability: **new** rows `privacy_request:read` and `privacy_request_event:read` — never `user:read`, never a reuse of `email:read`. Grants: `SELECT, INSERT` on `privacy_requests` to `app_member`/`app_admin`; `SELECT` on `privacy_request_events` to `app_admin` **only**; **`DELETE` on `privacy_requests` to no serving role** | A member holding `user:read` but **not** `privacy_request:read` reads **zero** request rows *inside their own group*. Both permission rows and their grants are present after `db:seed` **and** after `migration:run` alone, read from the live catalog — the legacy's ordering bug (`1777327198306:31-54`) is the failure this prevents |
| W41 | N2 | `privacy_request_events`, append-only. `REVOKE INSERT, UPDATE, DELETE FROM PUBLIC, app_anon, app_member, app_admin`, then `GRANT SELECT TO app_admin`. No FK to `users` or `privacy_requests`. `subject_ref` is a keyed digest; the key is asserted present at boot | `has_table_privilege` for all four verbs **per role**, `TRUNCATE` included — asserted, not commented. Removing the `REVOKE` makes a direct `INSERT` succeed, so the test proves it can fail |
| W42 | N2 | The erasure: `SECURITY DEFINER` function in **`authz`** (outside `db-schemas`, so it is not published in `openapi.json`), taking `p_actor` from Nest's verified token and **re-checking** `has_permission(p_actor, 'privacy_request', 'erase') AND (p_actor = p_subject OR p_subject ∈ authz.visible_user_ids())`. One transaction: revoke sessions → delete user (cascades) → delete request → append event | A member naming **another** user's id gets a denial and **both rows survive**; a member naming themselves succeeds; an operator in scope succeeds; an operator **out of** scope is denied. The function is absent from `openapi.json` **and** absent from the served `/` spec |
| W43 | N2 | RLS suite for both tables: six assertions from §9.5, named after the attack, on **row counts and bodies** | `npm run test:rls` (gate 7 of 8). Explicitly assert the three properties that are **assumptions today**: self-visibility (`visible_user_ids()` includes `authz.actor()`), admin breadth without an admin policy branch, and the `23503` existence-oracle trade recorded in writing |
| W44 | N2 | Thin Nest route `POST /privacy/erase` + service + DTO with `@ApiProperty` on every field. **No `pg` client in this path may `SET request.jwt.claims`** — that is the W37 P0 and this is a new request-reachable SQL path | The W37 structural check stays green. `grep` for `set_config` / `SET request.jwt.claims` in `src/privacy/` returns nothing. The route is covered by `JwtAuthGuard` via `APP_GUARD` (default deny), not by a per-controller `@UseGuards` |
| W45 | N3 | Frontend: regenerate `openapi.json` + types; a `features/privacy/` folder — request list (own), request submit, and the erase confirmation. **Signals, no NGXS**, and a single notification path per §F4. **Every action surfaces a result** — the legacy's `getError` selector with no consumer is the defect to not reproduce | No hand-written URL or interface (`grep` for a literal API path in `src/` is empty); a component spec that renders the template and **asserts the error case surfaces**, not just `toBeTruthy()` |
| W46 | ALL | §6.6.1 tamper matrix re-measured for the two new tables, recorded in this file | Each control removed in turn, each with its real red count against the current suite. A carried-over number from a superseded schema is a fabricated result |

### 9.7 Open questions

Each of these is a decision a human should make. None has been chosen silently.

**Q1 — Does erasure cascade into `login_attempts` and `email_messages`, or do
they survive?** `login_attempts` carries the subject's IP and user agent;
`email_messages` is the mail history, including `password_reset` and
`email_verification` rows whose *recipients* are the subject. §9.5 currently
assumes both cascade with `users`. **Against that:** the security audit trail and
the mail log are exactly the records a regulator wants to see survive. **For it:**
`email_messages` is a `DERIVED` table whose whole point is a user's mail history
— retaining it after the user asks to be forgotten is the retention a GDPR
erasure complaint is about. **This is a legal call, not an engineering one**, and
it changes W38's `ON DELETE` clauses, so it should be answered before W38 lands
rather than after.

**Q2 — Do the four consent columns port at all?** `marketing_consent`,
`do_not_sell`, `privacy_restrictions`, `processing_objections` are four columns on
`users` in the legacy, fronted by four endpoints. This plan proposes **not**
porting them: they model obligations against marketing and sale that this
template performs neither of. **The cost of saying no:** a forker who sends
marketing mail adds four nullable columns and four `PATCH` routes — cheap, and
they can copy `email_messages`'s pattern. **The cost of saying yes:** four
columns and four endpoints ship in a template where every one is permanently
`false`, which is how `marketing_consent: false` becomes a default nobody
questions. Needs a human call on what the template is *for*.

**Q3 — Is a data-subject export in scope at all?** §9.3 defers it, on the grounds
that the legacy's version exports a behaviour profile and there is no second data
source here. **If it is wanted**, it is **not** a PostgREST resource (it is a
multi-table join, so it needs an algorithm → thin app; and it must not be a view,
§B1/ADR-0022), and it should assemble from `users`, `email_messages` and
`login_attempts` explicitly — with the behaviour profile left behind, along with
the `user_behavior_profile` table as a whole, which this plan does not port at all.

**Q4 — Is there a public, unauthenticated request path?** §9.4 drops it
completely, because an unauthenticated erasure is an account-takeover primitive and
the verification machinery is how the legacy tried to make that safe. **If a forker
needs public intake**, the honest shape is: a public request that **opens a
record and nothing else** — no `UNVERIFIED`-then-promote state machine, no SLA
clock that a token can start, no erasure until the subject authenticates through
the ordinary `refresh_tokens` path. That is much smaller than the legacy and is
the reason the legacy's version needs a magic-link service at all.

**Q5 — Should `users` gain a self-read policy?** Today `users` is
`FORCE`d with `USING (current_user = 'app_admin')` and granted only to
`app_admin`, so **a member cannot read their own user row through PostgREST.**
That is what forces erasure into Nest (§9.4). The alternative is a self-scoped
branch on `users` — `OR id = authz.actor()` — which would let `DELETE /users` be
pure CRUD in PostgREST and remove the Nest dependency entirely. **This is the
single decision with the largest effect on the design**, it was not chosen here,
and it belongs to whoever owns the authorization model.

> **ANSWERED — yes, and it landed in `0008_user_identity.sql`, before this section
> was written rather than as a result of it.** `users_read_scope` is
> `current_user = 'app_admin' OR id IN (SELECT authz.actor() AS actor_id WHERE
> authz.can_read_user())`. §9.8.2 covers what that did and did not change; the
> short version is that it is a *read* decision, and §9.4's reason for keeping
> the *write* in Nest is untouched by it.

### 9.8 As built — 2026-10-14

> Read this before §9.0–§9.7. Everything above is the plan as written on
> 2026-10-11 and is left that way on purpose. This subsection is the
> reconciliation: what shipped, which of the above was wrong about the mechanism,
> and what the implementation revealed that the plan could not have predicted.

#### 9.8.1 The shape that landed

| Object | Category | Where |
|---|---|---|
| `users.deleted_at`, `deletion_reason`, `email_anonymized` | — | `0009_anonymisation.sql` |
| `authz.revoke_subject_authority()` — a `BEFORE UPDATE` trigger on `users` | — | `0009` |
| `privacy_requests` | **DERIVED**, no `group_id` | `0010_privacy_requests.sql` |
| `privacy_request_regulations` | **DERIVED** | `0010` |
| `privacy_request_audits` | **unscoped**, append-only | `0010` |
| `authz.append_privacy_request_audit()` | — | `0010`, replaced by `0014` |
| `privacy_purge_queue` | **unscoped** | `0011_privacy_purge_queue.sql` (§9A) |
| `users.country_code`, `region_code`, `city`, `geo_source`, `geo_accuracy_km`, `geo_updated_at` | — | `0012_user_geo.sql` |
| `company_profile`, `company_addresses`, `public.ccpa_applicable()` | unscoped | `0013_company_profile.sql` |
| `authz.serving_role()` and the corrected audit-append body | — | `0014` |

Two naming changes and one addition the plan never named:

- **`privacy_request_events` → `privacy_request_audits`.** `0010`'s header says
  why: a table's name is what a forker greps for, and the compliance vocabulary
  uses the second.
- **`privacy_request_regulations` is a third table.** §9.4's own text names the
  reason it has to exist — *"GDPR Art. 12(3) and CCPA §1798.130(a)(2) run
  INDEPENDENT clocks… A single `regulation text` column on the request can hold
  exactly one of them and therefore cannot express the case that matters"* — and
  then does not name a shape. A plan that identifies a problem without designing
  for it hands the design to whoever writes the DDL. The shipped shape is one row
  per statute with `PRIMARY KEY (request_id, regulation)`, so **dedup is the
  primary key**: adding CCPA twice collides and is dropped by `ON CONFLICT DO
  NOTHING`, with no "does this regulation already exist" branch anywhere.

**And there is no `authz.erase_subject()`, and no `POST /privacy/erase`.** §9.4,
§9A.1 and W42/W44 all name the former as the thing that performs the erasure;
none of it exists. The four `authz.*` capability helpers, the audit-append
function and `authz.serving_role()` are the whole of the SQL-side surface.

#### 9.8.2 Where §9's stated mechanism is not what shipped

**(1) `email_anonymized` is derived from `deletion_reason`, not from `deleted_at`.**
§9A.1 and W65 both say `GENERATED ALWAYS AS (deleted_at IS NOT NULL) STORED`.
Shipped: `GENERATED ALWAYS AS (deletion_reason = 'rtbf') STORED`
(`0009:189-190`), and `0009:182-188` says why the plan was wrong:
`deletion_reason` is a closed vocabulary of `('rtbf', 'inactive', 'admin')`, so a
row can be soft-deleted `inactive` and **still have its email**. `deleted_at IS
NOT NULL` would have reported an erasure that did not happen for every such row —
a filter that is wrong in one direction only and is invisible from the row. The
narrower derivation is also the more useful one: it answers *was this account's
email erased because somebody asked to be forgotten*, which is the only question
an operator or a filter ever wanted answered.

**(2) Q5 was answered, and answering it did not do what this section predicted.**
Q5 called the `users` self-read "the single decision with the largest effect on
the design" and said the alternative would "let `DELETE /users` be pure CRUD in
PostgREST and remove the Nest dependency entirely". The self-read shipped, in
`0008`. What it did **not** do is make erasure pure CRUD, because a member still
cannot delete: `users` grants `DELETE` to `app_admin` alone (`0008:455`) and
`app_member` holds no verb at all beyond a four-column `SELECT`. So the read
branch and the write question were separate decisions all along, and this
section's "largest effect" ranking confused them. §9.4's three numbered reasons
for keeping the erasure in the thin Nest app survive intact — reason 1 in
particular is unchanged, because the reason a member cannot delete their own row
is a **grant**, and no self-read policy touches a grant.

**(3) The read policy is not §9.4's, and the reason is §B2's inheritance rule
plus a capability granted to every tier.** §9.4 specifies one branch —
`user_id IN (SELECT … FROM authz.visible_user_ids() WHERE authz.can_read_privacy_request())`
— and then claims "a colleague in the same group sees the request if they hold
`privacy_request:read`". **That cannot be expressed with capability as the
discriminator**, and `0010:508-530` spends a paragraph saying so:
`privacy_request:read` is conferred on `member`, `manager` and `admin`, and
`has_permission()` walks *up* `roles.parent_id`, so a member resolves the
ancestor set `{member, manager, admin}` and holds **every** row `admin` holds.
Capability cannot narrow anything when it saturates.

So the shipped predicate has two branches, and the operator discriminator comes
from the one thing capability does not own — the database role:

```sql
CREATE POLICY privacy_request_read ON public.privacy_requests FOR SELECT USING (
  privacy_requests.user_id IN (
    SELECT v.user_id
      FROM (
        SELECT authz.actor() AS user_id
        UNION
        SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id)
      ) AS v
     WHERE authz.can_read_privacy_request()
       AND (v.user_id = authz.actor() OR current_user = 'app_admin')
  )
);
```

The `UNION` is what keeps the subject's own row in the visible set while the
`current_user` test confines the operator branch to it; the capability conjunct
is inside the subquery, and the whole thing is uncorrelated with the table.

The plan had §9.5's assertion 1 — *"a member with `privacy_request:read` sees
their own request and a colleague's in the same group"* — and it still passes,
but for a reason the plan did not have: the **subject** conjunct, not the
capability. The two are jointly unsaturable and only one of them survives
contact with the resolver.

**(4) The audit-append gate was capability-only, and it took a second migration
to close.** `0010`'s `authz.append_privacy_request_audit()` asked one question —
`has_permission(actor, 'privacy_request', 'update')` — and `0010` confers that
capability on all three tiers. Two consequences, both integrity failures in the
statutory record, and neither visible in any status code:

1. a member could append a compliance record naming a **colleague** as
   `subject_user_id`; and
2. a member could append a `responded` / `fulfilled` event — i.e. **certify that
   a statutory obligation had been discharged, on their own request.** `0010`'s
   `privacy_request_update` policy carries a `WITH CHECK` for precisely that
   reason; the audit path had no equivalent, and no `CHECK` can see who wrote a
   row.

`0014` replaces the body: `is_operator OR (p_subject_user_id IS NOT NULL AND
p_subject_user_id = actor AND authz.can_update_privacy_request())`, plus an
operator gate keyed on `is_operator` rather than on the capability. `0010` is not
edited (§B1); `CREATE OR REPLACE` keeps the signature and the ACL.

**The trap that made `0014` necessary, measured on 18.6 and recorded at
`0014:43-50`: inside a `SECURITY DEFINER` function `current_user` rebinds to the
OWNER.**

```
SET ROLE app_anon   -> current_user=app | current_setting(role)=app_anon
SET ROLE app_member -> current_user=app | current_setting(role)=app_member
SET ROLE app_admin  -> current_user=app | current_setting(role)=app_admin
no SET ROLE         -> current_user=app | current_setting(role)=none
```

So the obvious translation of the policy into the function — `current_user =
'app_admin'` — answers `false` for **every** caller including `app_admin`, and the
audit path would have refused every operator event for the whole deployment, with
no error anywhere: a denial and a success are both a returned row count.
`0014` therefore reads the `role` GUC through `authz.serving_role()`, which is
**not** caller-writable in the `request.jwt.claims` sense that §B2 F1 is about:
`SET ROLE x` succeeds only for a principal that is a member of `x`, so it is bound
by the same escalation `GRANT` in `database/bootstrap/001_roles.sql` that every
`current_user = 'app_admin'` branch in this schema already depends on.

**And the measured reason the predicate is NOT shared with the policy as a
helper**, which is worth recording because the right instinct produced a
measurably worse design. One `UPDATE` over 1,200 rows as `app_member`, read from
`pg_stat_user_functions` (`0014:76-80`):

```
can_update_privacy_request | 1200 calls
has_permission             | 1202 calls
actor                      | 2416 calls
```

A `STABLE` helper in a policy qual is evaluated **once per candidate row**, and
`privacy_request_update`'s `USING` has no uncorrelated subquery — so there is
nothing for a shared helper to hide inside and be hoisted past. Pointing the
policy at `authz.may_act_on_privacy_request(privacy_requests.user_id)` would have
**added** a second per-row resolution to save one `OR`. The accepted drift is in
the other direction: the two spellings share `authz.actor()` and
`authz.can_update_privacy_request()`, and the comment is written on both sides.

#### 9.8.3 What the plan could not have predicted

**The recursion trap is the one that ruled out the plan's own design.** §9A.1
says anonymisation is "governed by §9.4's `authz.erase_subject()` + the
`deleted_at` / `deletion_reason` columns", and §9.5's assertion 6 says the point
is that "`authz.visible_user_ids()` no longer returns the erased id". The obvious
implementation is to make the two resolvers exclude soft-deleted users — and it
is **impossible** in this schema, for two different reasons (`0009:36-101`):

- `public.users` is `FORCE`d and `users_read_scope` calls
  `authz.can_read_user()` → `has_permission()`. A read of `users` from *inside*
  `has_permission()` re-enters its own policy, and PostgreSQL raises
  **`infinite recursion detected in policy for relation "users"`** — a hard
  failure on every call for every caller, not a denial.
- A read of `users` from inside `visible_user_ids()` does not recurse, but the
  owner reads `users` through the same policy, and in a claimless session — which
  is what a migration, a seed and the sweeper all are — sees **zero rows**.
  Measured: an orphan count taken from inside a migration reported **three**
  orphans against a `users` table holding one perfectly valid row. A helper built
  on that read cannot distinguish "this user is not deleted" from "this user is
  invisible", and the safe-looking answer is different for each.

So the shipped choke point is **the row set the two axes already resolve from**,
enforced at write time: `authz.revoke_subject_authority()` is a
`BEFORE UPDATE OF deleted_at, deletion_reason ON public.users` trigger that
deletes the subject's `user_roles` and `user_groups` rows in the same
transaction. Both axes then resolve to nothing by construction, with **no read of
`users` anywhere**, and the invariant holds for a future resolver nobody has
written yet — which no policy on two functions could promise.

The plan's own §9A.1 argument about the cascade is the part that was right and
load-bearing: `0008` gave both membership tables
`REFERENCES public.users (id) ON DELETE CASCADE`, and **a referential action fires
on `DELETE` while anonymisation is an `UPDATE`, so the cascade never runs.** An
erasure that trusted the FK would leave the erased person's capability set and
scope index fully live, with no database signal at all — the worst outcome a
deletion feature has, and a silent one.

**The measured cost of the shipped policies.** On 1,200 seeded rows plus the
suite's own fixtures (**1,205 rows**), `EXPLAIN (ANALYZE)` over the
`privacy_request_read` policy reports a hashed `SubPlan` with `loops = 1`, and
`pg_stat_user_functions` reports **1** call each to `can_read_privacy_request()`
and `visible_user_ids()` — against §B2's recorded 3,300-versus-1 on
`email_messages`. A missing row in `pg_stat_user_functions` reads as **zero**,
not as a broken measurement, and the suite says so at the assertion.

**`psql` cannot bind `$1`, and that shaped the RLS suite.** The sweeper's four
statements live in `src/purge/purge-claim.ts` and carry `$1`/`$2`/`$3`, because
they are written for `pg`. `psql` has no bind protocol: `$1` is neither a psql
variable nor a resolvable parameter outside an extended-protocol message, so the
server answers `there is no parameter $1` and every test touching the claim fails
in a way that looks like a schema problem. The suite imports the constants and
interpolates the values — with `quote()` on every value and a
placeholder/argument arity check that throws naming the parameter, so a statement
and its values cannot drift apart silently. Running them through `pg` instead was
considered and rejected: every other assertion in the file is written against
**psql's own output** (`UPDATE 0` versus `UPDATE 1`, `permission denied for table`
versus `permission denied for function`, named constraints), and rewriting that
error surface to accommodate four statements is a larger and riskier change than
the bug.

**`ccpa_applicable()` is a statutory predicate that is deliberately wrong about
the statute, and that is the decision.** ADR-0028. The statutory test is about a
"business" meeting revenue, consumer-count and data-selling thresholds, none of
which is about where the office is; a California address on a company with $200k
of revenue answers `true` and is wrong. It answers `true` **anyway**, because
over-applying costs an operator an afternoon once and is visible to a human who
can make that decision, while under-applying costs statutory damages and is
invisible — no request arrives that could have revealed it. There is deliberately
no `CCPA_COVERED_BUSINESS` config flag, and the absence is load-bearing: a flag is
a hand-maintained value answering a question whose data lives in Stripe or an ERP
and changes four times a year, and a wrong flag is not detectable by anything in
the system.

#### 9.8.4 Status of the work items in §9.6

| ID | Status as of 2026-10-14 |
|---|---|
| W38 | **SHIPPED, 2026-10-14, by `0015_purge_user_cascade.sql`.** `user_roles`/`user_groups` carried the `ON DELETE CASCADE` from `0008:242`; `refresh_tokens.user_id` (`0002:73`) and `email_messages.user_id` (`0005:56`) were the last two `NO ACTION` FKs naming `users`, and are now `CASCADE`. **They were the only reason the shipped purge executor could not complete**, and it was invisible because the RLS fixture user was deliberately given no refresh tokens and no mail history. ADR-0032 records why `email_messages` is deleted rather than retained; §9A.8.3 records the diagnosis; `test/rls/user-purge-end-to-end.spec.ts` proves it against a real database and gates the class. |
| W39 | **SHIPPED**, in `0010`. Predicated, uncorrelated, capability inside the subquery; `loops = 1` and one capability call at 1,205 rows. The shipped policy has the two-branch subject/operator shape of §9.8.2 (3), not §9.4's one-branch shape. |
| W40 | **SHIPPED with a difference.** `privacy_request:create/read/update` and `privacy_request_audit:read` are seeded, in both `0010` and `database/seed.ts`, both `ON CONFLICT DO NOTHING`; `privacy_request:delete` is absent from `permissions` entirely. The read grant is `SELECT, INSERT, UPDATE` — §9.6 says `SELECT, INSERT`, and `UPDATE` is required because self-service **withdrawal** is a member's own verb and the `WITH CHECK` on the update policy is what stops that same member writing `fulfilled`. |
| W41 | **SHIPPED.** `privacy_request_audits` has no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` grant for any serving role, `app_admin` included, and no write policy. Asserted per role, `TRUNCATE` included. **The `CHECK`-on-`INSERT`-only rationale in the spec is `0010:270-283` and is the reason the absence of grants is the control.** |
| W42 | **NOT LANDED.** No `authz.erase_subject()`. What shipped instead is §9.8.3's write-time choke point, which is a different mechanism solving the same invariant. |
| W43 | **SHIPPED.** `test/rls/privacy-requests.spec.ts` proves all six §9.5 assertions on row counts and bodies, including the orphan-membership assertion re-pointed at the anonymisation path, and including the two assertions that documented the `0014` defect. |
| W44 | **NOT LANDED.** No `POST /privacy/erase` route, no DTO, no service. Nothing in `src/` writes `privacy_request_audits`, and nothing writes `deleted_at`. **The schema is in place and no application path uses it** — the erasure is a migration-shaped capability with no caller yet. |
| W45 | **NOT LANDED.** No `features/privacy/` folder. The generated client is current with the three new resources; nothing consumes them. |
| W46 | **SUPERSEDED.** §6.6.1's tamper matrix was re-run for these tables as part of the RLS suite's construction (the negative controls are the assertions themselves — e.g. `privacy-requests.spec.ts` seeded the two `0014` cases deliberately red). The standalone matrix table was not reproduced here. |

---

## 9A. The purge mechanism

Appended as a numbered subsection of §9 because it answers a question §9 left
open, not because it is a new module: §9.5 designed the **erasure** and stopped
at "delete, retain, and make extensible", and this section adds the second half
of that sentence. Anonymisation answers *what does the person's erasure do to
their row*; purge answers *when does the retention we just wrote expire*. They
are different operations on different tables and they have opposite failure
modes.

Written against the tree on 2026-10-12. **Nothing was executed.** Every claim
about the shipped tree is `file:line`; every claim about the legacy is
`file:line` in `angular/`; nothing about a runtime, a plan or a measurement is
asserted without having been run, so there are no measurements to quote here and
the section says so rather than inventing some.

> **SHIPPED — 2026-10-14, in `0011_privacy_purge_queue.sql` and `src/purge/`.**
> The last sentence above is now false in the way that matters: this section was
> executed, and three of its stated mechanisms are not what shipped — **the
> schedule library, the `SECURITY DEFINER` writer, and the failure semantics.**
> It is left as written on purpose. **§9A.8 is the reconciliation.**
>
> **AND THE RECONCILIATION HAS BEEN RE-CHECKED.** On 2026-10-14, after `0015` and
> `0016`, §9A.8's first finding — *"**nothing in this tree enqueues.** The sweeper
> is a real, working drain over a queue that only the migration role and the test
> fixtures ever write to"* — **is no longer true and never will be again.**
> `PurgeEnqueuer` fills the queue hourly. The finding is kept rather than deleted
> because it is the clearest record in this document of what a careful audit found
> and how long the finding stood; it is marked **RESOLVED** with the migration that
> closed it, and the same has been done for the `23503` cascade defect in
> §9A.8.3. An empty admin list is still not evidence that retention is running —
> but that is now a weaker sentence, because the enqueuer logs every sweep
> including the empty ones.

### 9A.0 Why this is written at all

§9.3 removed every `@Cron` from the module and wrote:

> **Every `@Cron` in this module disappears**; `angular_v2` keeps none.

That was correct **about the jobs that existed then** — a resumable provider
fan-out over one provider, and two crons deleting things that no longer exist.
It reads as a general statement, and a reader (or an agent) applying it
generically concludes that retention is permanently deferred. It is not. The
statement was scoped to the legacy's job queue and nobody wrote down the
sentence that scopes it.

The user rejected the deferral in the right terms: *"this should exist, not be a
future enhancement."* That is correct and it is a **mechanism** claim, not a
policy claim. What a privacy module owes its reader is not a number — it is the
thing that deletes rows when a retention window expires, refuses to delete below
a floor, and shows an operator what it is about to delete. A template with none
of that ships a `RETENTION_DAYS` comment and a forker writes the delete.

**The mechanism ships complete. For a while one number did not ship, and §9A.6
records which one and why that deferral was defensible *while it was a
deferral*. It is now a decided number — 1825 days — and §9A.6 carries the
reversal rather than being quietly rewritten to read as though it had always
been decided. This repository records reversals; it does not hide them.**

### 9A.1 The invariant: anonymise and purge are different operations

> **Anonymisation rewrites a row in place. The row survives; the person does
> not. Purge deletes a row outright.**

Stated once, because the two failure modes are symmetric and both are silent:

| | **Anonymise** | **Purge** |
|---|---|---|
| Mechanism | `UPDATE` of columns in place | `DELETE` |
| Row survives? | **Yes** — as a tombstone | No |
| Reversible? | No (the values are gone) | No |
| Who initiates | A human, through `POST /privacy/erase` | Only the sweeper, from a queue row |
| Governed by | §9.4's `authz.erase_subject()` + the `deleted_at` / `deletion_reason` columns | §9A.3's queue + §9A.4's floors |

**Anonymise applies to.** `users` — `email`, `username` overwritten, password
hash replaced by a `NULL` and not a sentinel string (§9.2 records the legacy's
`'ANONYMIZED'` literal in the password column as a defect worth not copying),
`geo_*` columns cleared, `deleted_at` and `deletion_reason` set;
`login_attempts.username`. `email_anonymized` is a
`GENERATED ALWAYS AS (...) STORED` column derived from `deleted_at`, so no code
path can set it and disagree with it.

Two things are deleted *during* anonymisation, and neither is a purge:
`refresh_tokens` for the user (a session is a credential, and revoking it is
what "erasure" means operationally) and the user's `user_roles` / `user_groups`
rows (a capability binding and a scope index entry that would otherwise keep
resolving the erased id through `authz.visible_user_ids()`). **The line is
drawn at identity, not at rows:** a revocation is not a record of the person.

**Those two deletions stay explicit, and an agent will be tempted to delete
them.** `0008_user_identity.sql:242` now declares both membership tables
`REFERENCES public.users (id) ON DELETE CASCADE`, so on paper the `user_groups`
and `user_roles` deletes are redundant — and they are not, because **a
referential action fires on `DELETE FROM users` and anonymisation is an
`UPDATE`.** The cascade never runs. Removing those two statements on the
strength of the FK reintroduces exactly the orphan-membership bug
`0008:117-123` spends eleven lines describing, and it does so silently: the
erasure succeeds, the audit row is written, and the erased person's authority
is still resolvable.

**Purge applies to.** The tombstone `users` row (and everything that cascades
from it — `privacy_requests` first among them), `login_attempts` rows past their
window, unverified `privacy_requests` past theirs, export artefacts on disk.

**Why conflating them is dangerous in each direction.**

- **Anonymise-everything — i.e. never purge — is retention that never expires.**
  Every table that §9A.4 puts a window on grows without bound in a template
  nobody watches. The specific harm is not disk: it is that the policy the
  template *publishes* is one it does not *enforce*, and an auditor reads the
  policy. GDPR Art. 5(1)(e) storage limitation and CPRA §1798.100(a)(3) both
  work on the documented window, not the intended one.
- **Purge-everything — i.e. hard-delete at erasure time — destroys the
  compliance record.** CPRA §1798.105(c)(2) and 11 CCR §7101(a) both require
  the record of a consumer request to be **retained** for at least 24 months.
  Erasure that deletes the audit row destroys the only evidence that the request
  was honoured — which converts compliance from an obligation into an
  unverifiable claim. This is why `privacy_request_audits` is on **no purge
  path at all**, and why that absence is a design decision with a test rather
  than an omission.

**This supersedes one line of §9.5, and the correction is recorded here rather
than edited in.** §9.5's DELETE/RETAIN table has `users` on the DELETE side. Under
the decision recorded here, erasure **anonymises** `users` and defers the row's
deletion to purge. Three consequences, and W38 survives all three:

1. **W38 is not retired, and it is now half shipped.**
   `0008_user_identity.sql:242` closed the two missing foreign keys —
   `user_roles.user_id` and `user_groups.user_id` are now
   `REFERENCES public.users (id) ON DELETE CASCADE` — and that is **precisely
   what makes the purge cascade the membership rows**: without it a purged
   user's scope keeps resolving through `authz.visible_user_ids()`, which reads
   `user_groups` directly and never joins `users` (the failure `0008:117-123`
   spells out). What is still `NO ACTION` is `refresh_tokens.user_id`
   (`0002_refresh_tokens.sql:73`) and `email_messages.user_id`
   (`0005_email_messages.sql:56`), so **W38 survives as those two cascades and
   nothing else.** Purge deletes the tombstone; without those two it still
   raises `23503` for any user who has ever logged in.
2. **W42 changes shape.** Its `SECURITY DEFINER` function stops deleting the
   user row and starts rewriting it. Its actor-safety analysis is unchanged and
   is still the good part — `p_actor` from the verified token, re-checked
   against `has_permission(...)`, never crossing an HTTP body into SQL.
3. **The orphan-membership assertion gets stronger, not weaker.** §9.5's
   assertion 6 — *"after erasure, `authz.visible_user_ids()` no longer returns
   the erased id"* — was the assertion that distinguishes "the user row is gone"
   from "the user is gone". With a tombstone, **the row is always still there**,
   so a sweeper that forgets `user_groups` leaves a live capability set attached
   to a deleted person with no database signal at all. It stays assertion 6 and
   it is asserted on the anonymisation path, not the purge path.

#### Anonymisation is a **status**, not a second lifecycle

**The invariant above is unchanged and still load-bearing.** Anonymisation is an
`UPDATE` that scrubs a row; purge is a `DELETE` that removes one. Two statements,
two tables, two failure modes, and conflating them is exactly the mistake the
table above is for. Nothing in this subsection relaxes that.

What changed is everything built **on top** of the distinction. The reason code
`erasure_anonymized` was wrong not because it was incorrect — the sweep really
is deleting an anonymised row — but because **a reason code that names a
population implies that the population has its own lifecycle**, and it did not
need one. It implied a separate queue population, a separate admin list, and a
separate operator question ("who has been anonymised?" versus "who is being
purged?").

**The decision.** An anonymised tombstone is a `users` row like any other row,
and it becomes a purge candidate through **the same inactivity scan as every
other user**. One candidate query, one reason code (`inactivity_purge`), one
queue, one admin list (§9A.5, §9A.6).

**Why the reason code was over-modelled, stated against the alternative.** The
two populations differ by **one boolean**, and that boolean already exists on
the row: `email_anonymized`, a `GENERATED ALWAYS AS (...) STORED` column
derived from `deleted_at`, which no code path can set and disagree with.
Carrying `erasure_anonymized` in a queue row restates a fact the schema already
owns — and **a duplicated fact is a fact that drifts**: the queue's answer and
the row's answer can disagree, and nothing in either enforces the other.

**How the admin view labels them without a join.** The queue row carries **no FK
to `users`** (§9A.2), because it must outlive its target, so once the target is
gone the label cannot be read from it. `authz.enqueue_inactive_purges()`
therefore snapshots `email_anonymized` into
`privacy_purge_queue.subject_anonymized` at enqueue time — one boolean, one
column, written once, and **not derived from anything the sweep later changes.**

**What an operator sees: one list, one filter, two labels.** `reason =
'inactivity_purge'`, and each row reads *"being purged for inactivity"* or
*"anonymized by privacy"* according to `subject_anonymized`. Two labels because
the label is what an operator needs; one list because the question an operator
is actually asking during an incident is *"what is about to be deleted?"*, and a
second list makes them answer that question twice over two screens.

**The cost, stated rather than buried.** An operator can no longer ask *"show me
everyone who has been anonymised"* as one query, because the answer is now
*"every tombstone, plus the subset that has not yet aged out of retention."*
**That is the correct answer.** An anonymised user still inside the retention
window is retained, by decision, and a list that hid that would be the lie. The
list is one because the lifecycle is one, and the lifecycle is one because
anonymisation changed a row rather than a schedule.

### 9A.2 `privacy_purge_queue` — the queue

#### Category: **unscoped**, and the alternative was rejected on a specific row

§B2's four categories, chosen deliberately rather than by analogy:

| Category | Fit | Why not / why |
|---|---|---|
| Group-scoped | ✗ | A purge is not tenant data. It is infrastructure. |
| The hierarchy | ✗ | It is not a group. |
| **Unscoped** | ✓ | Global operational record-keeping, exactly like `privacy_request_audits` (§9.4). Simple `PRIMARY KEY (id uuid DEFAULT uuidv7())`, no `group_id`. |
| DERIVED | ✗ — **rejected** | See below. |

**Why DERIVED was rejected, precisely.** DERIVED is the right category for a row
whose scope resolves through a *user's membership* (`email_messages`,
`privacy_requests`). The purge queue is that shape for exactly half its rows and
has no possible shape for the other half: a retention sweep over
`login_attempts` past 365 days has **no subject**, so there is no
`target_user_id` to route through `authz.visible_user_ids()`. One table, two row
populations, one of them un-ownable by any user. Forcing the second population
into a `group_id` would be inventing a group nobody chose — the exact mistake
ADR-0025 warns about for `email_messages`.

The cost of unscoped is stated rather than hidden: **a member cannot read their
own pending purge**, because the queue is admin-readable only. That is
acceptable because the member's window into the same fact is their
`privacy_requests` row, which they can already read (§9.4), and the erasure is
recorded there. What is *not* acceptable would be inventing a member-scoped view
of a table whose other half has no subject — so there isn't one.

**The FK that must not exist.** `target_id` carries **no foreign key to
`users`**, and this is the load-bearing detail of the whole DDL: **the queue row
must outlive its target.** The `inactivity_purge` row exists to delete the
`users` row, so an FK would either block that delete or cascade the queue row
away with it — destroying the record that a purge was scheduled, which is the
record §9A.1 says must not be destroyed. Same reason §9A.4 gives for
`privacy_request_audits`: referential-integrity checks bypass RLS and fail open,
and here they additionally invert the direction of the operation.

The same fact is why `subject_anonymized` has to be a **snapshot** rather than a
join (§9A.1): once the tombstone is gone there is nothing to join to, and the
operator still needs to know whether the row they are about to delete was a live
account or a scrubbed one.

#### DDL

`0010_privacy_purge_queue.sql`, in the existing migration directory (§B1), with
a working `down()`.

> **Renumbered from `0008_privacy_purge_queue.sql`, and the collision is worth
> recording.** The queue table was designed when `0008` was the next free
> migration number. `0008_user_identity.sql` then landed first and took it. It
> was not renamed, because a shipped migration number that changes is a shipped
> migration that no longer matches what ran on somebody's database. The queue
> moves to `0010` behind W65's `users` columns, and the ordering is not
> arbitrary: the queue's `reason` enum and its `subject_anonymized` snapshot both
> reference `users.email_anonymized`, so the column must exist first.

```sql
-- Reason codes are CLOSED and each one names what gets deleted. An unknown
-- reason raises in authz.execute_purge(); it never falls through to a no-op
-- (§2.3 — silently succeeding is the defect this repo keeps finding).
--
--   inactivity_purge            a `users` row past RETENTION_TOMBSTONE_DAYS.
--                               ONE code for every user row, anonymised or
--                               not (§9A.1) — the distinction is the
--                               `subject_anonymized` snapshot below, not a
--                               second population with a second lifecycle.
--   retention_login_attempts login_attempts past RETENTION_LOGIN_ATTEMPTS_DAYS
--   retention_unverified_request
--                            privacy_requests still unverified past
--                            RETENTION_UNVERIFIED_REQUEST_HOURS
--   retention_export_artefact
--                            a data-subject export file nobody downloaded
--
-- There is deliberately NO reason for privacy_request_audits. §9A.4.
CREATE TABLE IF NOT EXISTS public.privacy_purge_queue (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  target_kind   text   NOT NULL CHECK (target_kind IN ('user', 'table', 'file')),
  target_id     uuid,                        -- iff target_kind = 'user'
  target_ref    text,                        -- iff target_kind <> 'user'
  -- Snapshot of public.users.email_anonymized, written once by
  -- authz.enqueue_inactive_purges(). NOT NULL and NOT a join: the queue row
  -- outlives its target (§9A.2), so this is the only record of which kind of
  -- row was scheduled — and a boolean the sweep later changes is not a label.
  subject_anonymized boolean NOT NULL DEFAULT false,
  reason        text   NOT NULL CHECK (reason IN (
                  'inactivity_purge',
                  'retention_login_attempts',
                  'retention_unverified_request',
                  'retention_export_artefact')),
  scheduled_for timestamptz NOT NULL,
  status        text   NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'claimed', 'done', 'cancelled', 'failed')),
  claimed_at    timestamptz,
  claimed_by    text,                        -- instance id; the ownership key
  attempt       integer NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  rows_deleted  integer,                     -- NULL until done. the proof
  error         text,
  supersedes    uuid REFERENCES public.privacy_purge_queue (id),

  -- Exactly one target column per kind. Two CHECKs rather than a boolean
  -- identity, so each is separately readable and separately removable.
  CHECK (target_kind <> 'user' OR target_id IS NOT NULL),
  CHECK (target_kind  = 'user' OR target_ref IS NOT NULL),

  -- A retention row has no subject, so "was it anonymised" is not a question
  -- about it. Asserting that here is what stops `subject_anonymized` drifting
  -- back into being a second classification axis (§9A.1's whole argument).
  CHECK (target_kind = 'user' OR subject_anonymized = false),

  -- rows_deleted is a count, never negative, and only a completed row has one.
  CHECK (rows_deleted IS NULL OR rows_deleted >= 0),
  CHECK (status <> 'done' OR (completed_at IS NOT NULL AND rows_deleted IS NOT NULL))
);

-- One OPEN purge per target, enforced by the database rather than by the
-- enqueue function remembering to check. Without it a sweeper that runs twice
-- inside one RETENTION_TOMBSTONE_DAYS window queues every tombstone twice and
-- the second attempt finds nothing to delete — `rows_deleted = 0`, which reads
-- in the admin view as "we deleted a row and it was already gone": a
-- success-shaped value for work that did not happen (§2.3).
--
-- `pending` AND `claimed`, because a claimed row is still work in flight and a
-- re-enqueue behind it would queue a second purge for a target being deleted.
-- `done`, `cancelled` and `failed` are terminal, so a later sweep may schedule
-- a fresh purge for the same target — carrying `supersedes`, §9A.5.
--
-- `target_id::text` because `COALESCE(uuid, text)` has no common type and the
-- statement would fail at creation; the cast is inside the index so the queue's
-- own columns stay uncast (§B1's snake_case rule is about identifiers, not
-- expressions, and this is an expression).
CREATE UNIQUE INDEX IF NOT EXISTS privacy_purge_queue_one_open_per_target
  ON public.privacy_purge_queue (target_kind, COALESCE(target_id::text, target_ref))
  WHERE status IN ('pending', 'claimed');

-- "What is due now" is the sweeper's only query, so it gets a PARTIAL index on
-- exactly its predicate. Done, cancelled and failed rows never enter it and
-- never bloat it; the index is small enough to live in cache for the life of the
-- table. (scheduled_for, id) rather than scheduled_for alone because the tie
-- break must be stable across two sweepers, and the ids are uuidv7 so the tie
-- break is mint order — which is also the btree-insertion order §B1's key rule
-- is built around.
CREATE INDEX IF NOT EXISTS privacy_purge_queue_due_idx
  ON public.privacy_purge_queue (scheduled_for, id)
  WHERE status = 'pending';

-- The admin table asks a DIFFERENT question — "everything still open, newest
-- first" — so it gets its own partial index. A partial index serves only the
-- predicate it names; reusing the first one would leave the DESC ordering to a
-- sort over the pending subset.
CREATE INDEX IF NOT EXISTS privacy_purge_queue_open_idx
  ON public.privacy_purge_queue (scheduled_for DESC, id DESC)
  WHERE status IN ('pending', 'claimed');
```

RLS and grants follow §9.4's `privacy_requests` shape exactly — one policy, total,
capability **inside** the predicate, and `FORCE` because the sweeper writes under
`app_admin` and the table's owner bypasses RLS without erroring:

```sql
CREATE POLICY privacy_purge_read ON public.privacy_purge_queue
  FOR SELECT USING (authz.can_read_privacy_purge());

REVOKE ALL ON public.privacy_purge_queue FROM PUBLIC, app_anon, app_member, app_admin;
GRANT  SELECT ON public.privacy_purge_queue TO app_admin;
```

**No serving role holds `INSERT`, `UPDATE` or `DELETE`** — not `app_admin`
included. Every write goes through a `SECURITY DEFINER` function in `authz`,
which is outside `db-schemas` and therefore unreachable from PostgREST's `/rpc/`
surface as well as from CRUD (§B2, and W42 asserts the absence of the erasure
function from both `openapi.json` and the served `/` spec; W49 asserts it for
these four). Assert `TRUNCATE` per role too — it does not fire a row trigger
(§B2).

#### The permission: `privacy_purge:read` and `privacy_purge:update`, and nothing else

§B2 requires a new capability to get its own row, so this is not `user:read`
and not `privacy_request:read`. The verb vocabulary is exactly
`create, read, update, delete`, and **two of the four are deliberately absent**:

| Verb | Present? | Why |
|---|---|---|
| `create` | **No** | Queues rows are written by the erasure path or by the sweeper. A human who can insert a purge row is an unaccountable deletion path wearing a queue as a disguise — it is §9A.1's invariant with the log file removed. |
| `read` | **Yes** | The admin view (§9A.5). Gated by `authz.can_read_privacy_purge()` in the policy, so an admin token whose role lacks the row reads **zero rows** despite holding the table grant. |
| `update` | **Yes** | **This is the cancel**, and it is the only reason it exists. |
| `delete` | **No** | Deleting a queue row is precisely the confusion this section exists to prevent: it looks like a purge, it is not a purge, and it destroys the record that a purge was scheduled. |

`update` meaning "cancel" is a semantic stretch and is called out in the comment
at both the permission row and the route. It buys the right thing: an operator
who can stop a purge holds one narrow, separately revocable capability, and
revoking it touches nothing else (§B2: "revoking it touches nothing else").

Rows and grants are written by **both** `0008` and `database/seed.ts`, both
`ON CONFLICT DO NOTHING` — the legacy's ordering bug
(`1777327198306:31-54` inserted permissions then `return`ed when no role
existed) is exactly the failure this pair prevents, and the acceptance criterion
reads the live catalog after `db:seed` **and** after `migration:run` alone.

### 9A.3 The sweeper

#### Where it runs, and `@nestjs/schedule` is **not** a dependency

`backend/package.json` dependencies are `@nestjs/common`, `@nestjs/config`,
`@nestjs/core`, `@nestjs/jwt`, `@nestjs/platform-fastify`, `@nestjs/swagger`,
`bcrypt`, `class-transformer`, `class-validator`, `handlebars`, `nodemailer`,
`pg`, `reflect-metadata`, `rxjs`. **`@nestjs/schedule` is not among them**, and
nor is `@nestjs/throttler`. The legacy ran its four `@Cron` handlers through
`@nestjs/schedule`; `angular_v2` does not have it.

**Recommendation: do not add it.** The reason is not style, it is ordering.
`@Cron` registers its handler during module initialisation — `OnModuleInit`,
which Nest runs **before** `OnApplicationBootstrap`. A plain interval started in
`onApplicationBootstrap` is strictly later, which means the sweeper cannot fire
before the retention configuration has been asserted (§9A.4) and before the
first pressure measurement has been taken. With `@Cron`, the first sweep is
scheduled against a configuration that has not been validated yet. For a job
whose entire value proposition is that it respects a floor, that ordering is the
design.

The interval is `unref()`ed so a hung sweep does not hold the process open at
shutdown, and cleared in `onModuleDestroy` — the hook `AuthService` already
implements correctly for its pool (`auth.service.ts:79-86`, including the
`destroyed` guard against `pg`'s second-`end()` rejection).

**One pool, not two — and there are already two.** `AuthService` builds its own
`new Pool({...})` in its constructor (`auth.service.ts:68-74`) with **no `max`**,
so it is running on `pg`'s default of 10 — an implicit literal nobody chose,
which §B6 forbids outright. `EmailAuditWriter` builds a **second** one on first
use (`email/email-audit.writer.ts:96-102`, also with no `max`). Two pools means
the process can hold up to `2 × 10` connections and **neither pool can see the
other's `waitingCount`**, which is how a service exceeds `max_connections` with
no alarm anywhere: both report themselves healthy while the database is
saturated. W50's sweeper takes the one injected pool, never a third.

> **CORRECTED — the sentence this replaced pointed at a `db_pool_waiting` breaker
> signal in §9B.1 that no longer exists.** The rewritten §9B trips on memory
> only (§9B.3): pool saturation is a *consequence* of the app doing too much, and
> the response to it is the same response — stop dispatching — so a second signal
> would have added a threshold to configure without adding a decision to make.
> The missing `max` is still a §B6 violation and still the reason the two pools
> have to be merged; it is simply no longer a prerequisite for a breaker.

#### Claiming work: `FOR UPDATE SKIP LOCKED`, and the legacy's bug

The legacy tree has a documented queue bug worth naming exactly, because the
claim it got right and the read it got wrong are four lines apart.

**What was right.** `angular/backend/src/modules/privacy/privacy-housekeeping.service.ts:76-83`
claims a job with a conditional `update({ id, status: PENDING }, …)` and checks
`result.affected === 1`. That is genuinely race-safe as a *claim*.

**What was wrong.** Three defects compose, and all three must be fixed together
— fixing any one leaves the bug live:

1. **The follow-up read is unguarded.**
   `privacy-housekeeping.service.ts:86-89` re-reads with
   `findOne({ where: { id: job.id } })`. **No status predicate and no ownership
   predicate** — it re-reads by primary key alone, so it will happily pick up a
   row that is no longer the row this sweeper claimed.
2. **There is no owner column.** `lockedAt` records *when*, never *who*. Two
   sweepers are indistinguishable, so no read can predicate on ownership even if
   it wanted to.
3. **The recovery path is unconditional.**
   `privacy-cleanup.service.ts:36-51` (`staleJobMonitor`) finds `PROCESSING`
   rows older than an hour and resets them to `PENDING` with a bare `save()` —
   no compare-and-set, no owner, no attempt counter.

**Composition.** Sweeper A claims row R and stalls past the one-hour threshold.
The monitor resets R to `PENDING`. Sweeper B claims R and starts. A's
unconditional re-fetch now reads R — `PROCESSING`, **under B** — and A processes
it too. Two erasures from one request. And because `handleJob` mutates the
in-memory entity and `save()`s the whole row (`privacy-housekeeping.service.ts:114-116`),
the two runs are last-write-wins on every column, so whichever finishes last
overwrites the other's status.

**The three-part fix, and all three land together:**

| Defect | Fix | Primitive |
|---|---|---|
| Exclusion by a timestamp that has to be reclaimed | Exclusion by the database | `FOR UPDATE SKIP LOCKED` — no `lockedAt`, no staleness window, no monitor |
| No owner column | `claimed_by text` | the sweeper's instance id |
| The unguarded re-read | **every** read after the claim carries `status = 'claimed' AND claimed_by = $instance` | ownership predicate, not a primary key |

`SKIP LOCKED` also removes the need for a leader: **N instances, one queue, no
election, no advisory lock.**

**Two different primitives, for two different jobs, and conflating them is the
mistake.** The legacy reached for `lockedAt` and got neither.

| Primitive | Where | What it is for |
|---|---|---|
| `UPDATE … WHERE id = $1 AND status = 'pending'`, `affected = 1` | `execute_purge` | **The claim.** Atomic compare-and-set on one row. Two sweepers race the same id; one wins, the loser sees zero rows and returns `false` without deleting. This is what makes execution safe. |
| `SELECT … FOR UPDATE SKIP LOCKED` | `claim_due_purges` | **The batch.** Splitting N due rows across N sweepers without stepping on each other, so the preview and the queue-drain do not collide. |

```sql
-- The batch view. Own short transaction; it claims NOTHING — it reports what
-- is due and which sweeper is entitled to take it. `claimed_by` is written by
-- execute_purge, not here.
CREATE FUNCTION authz.claim_due_purges(p_limit integer)
RETURNS SETOF public.privacy_purge_queue
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM public.privacy_purge_queue
  WHERE status = 'pending' AND scheduled_for <= now()
  ORDER BY scheduled_for, id
  FOR UPDATE SKIP LOCKED
  LIMIT $1
$$;
```

**The transaction boundary, stated once because getting it wrong reintroduces
the whole legacy bug.** `authz.execute_purge(p_instance text, p_purge_id uuid)
RETURNS integer` does **claim, delete and mark-done in a single transaction**,
and it begins with:

```sql
UPDATE public.privacy_purge_queue
   SET status = 'claimed', claimed_at = now(), claimed_by = $1, attempt = attempt + 1
 WHERE id = $2 AND status = 'pending'
```

**Zero rows affected means the row is no longer pending** — claimed by another
sweeper, cancelled, or already done — and the function returns without deleting
anything. It then dispatches on `reason` through a closed `CASE`, performs the
deletion, and writes back `status = 'done', completed_at = now(), rows_deleted =
<count>`. **An unrecognised reason raises**; a caller that reaches a reason this
function does not implement has found a bug, and returning success there is
§2.3's exact defect.

**Claim and execute in the same transaction is the whole point.** If the claim
committed first and the delete failed afterwards, the row would be stranded in
`claimed` with nothing to reclaim it — which is precisely the `lockedAt`
situation the legacy needed `staleJobMonitor` to clean up. One transaction per
purge means there is no window to strand a row in, so **`lockedAt` does not
exist here and there is no staleness monitor to be wrong.**

**One transaction per purge, N independent transactions per sweep.** If the
delete raises, that purge rolls back whole — the row is still `pending`, `attempt`
is *not* incremented (it rolled back with everything else, so the next attempt
re-increments it correctly), `error` is unset, and **nothing was deleted**. A
partial purge is not representable, which is why the legacy needed a four-counter
reconciliation ladder (`privacy-housekeeping.service.ts:238-280`) for a fan-out
this design does not have.

**Poison pill.** `RETENTION_PURGE_MAX_ATTEMPTS`, default 3, asserted at boot — a
sweeper key, not a `SENTINEL_` one (§9B owns that prefix). At the limit the row
becomes `failed`, keeps its `error`, and stays **visible in the admin view** for
an operator. An unbounded retry loop on a delete that keeps failing is a
resource leak of exactly the kind §9B is about, and this repository shares a
machine.

#### How it proves it did not over-delete

Five properties, each one assertable rather than asserted:

1. **The deletion count is a return value, never an estimate.**
   `rows_deleted` is what the `DELETE` returned. An operator can recompute the
   expected figure with the same predicate the sweeper used and compare.
2. **The claim bounds and the delete bounds are the same predicate.**
   *"a purge scheduled for user X deletes exactly user X's row and no other
   user's row"* — asserted by an **unfiltered owner count** before and after
   (§B5: a filtered count cannot distinguish "not deleted" from "cannot see",
   which is what makes a denial assertion vacuous).
3. **A failing purge deletes nothing.** Test: make the delete raise (a FK that
   does not cascade), run one sweep, assert the source rows are **all** still
   present by unfiltered count.
4. **The floor is refused at boot, not discovered mid-sweep** (§9A.4).
5. **Nothing is deleted that was never queued.** Test: the sweeper run against a
   table containing rows past every window, with an empty queue, deletes **zero**
   rows. This is the over-deletion test in its purest form and it is the one an
   agent rewriting the sweeper will break first.

### 9A.4 Retention floors

Every value comes from config and every key is asserted at boot (§B6, §2.3).
"Error" means the process refuses to start; "warning" means it starts and says
so, **on every boot**, not once — a retention policy nobody is told about is the
retention policy in force.

| Class | Config key | Floor / default | Configured value that violates it | Consequence |
|---|---|---|---|---|
| `login_attempts` | `RETENTION_LOGIN_ATTEMPTS_DAYS` | **365** days | < 30 | **warning**, every boot, with the effective value |
| unverified `privacy_requests` | `RETENTION_UNVERIFIED_REQUEST_HOURS` | **24** hours — a **ceiling**, not a floor | > 24 | **error** at boot |
| `privacy_request_audits` | `RETENTION_AUDIT_DAYS` | **730** days = 24 months, a **floor** | < 730 | **error** at boot |
| export artefacts | `RETENTION_EXPORT_ARTEFACTS_HOURS` | **72** hours | < 1 | **warning**, every boot |
| `users` tombstone **and** any dormant account | `RETENTION_TOMBSTONE_DAYS` | **1825** days = 5 years, a **floor**; absent → 1825 | < 1825 | **error** at boot, naming the effective value. See below — this row was `unset` until 2026-10-12 and the reversal is recorded in §9A.6 |
| verified `privacy_requests` | — | **no timer** | — | Retained until the tombstone purges; `privacy_requests.user_id → users(id)` takes it in the same transaction. It is not on a clock, so there is no key to misconfigure. |

**Why each is error-or-warning, not one rule for all:**

- **`privacy_request_audits` is an error because the law names the number.**
  CPRA §1798.105(c)(2) and 11 CCR §7101(a) both state 24 months as a *minimum
  retention* obligation. Going under it is a violation, not a preference. And
  the enforcement is stronger than a boot assertion: **there is no
  `retention_audits` reason code**, so the sweeper has nothing to run even if
  someone edits the config. The config key exists only so that a forker
  *extending* retention has one place to do it — and 730 is asserted as its
  minimum. *Named test: `RETENTION_AUDIT_DAYS=30` fails the boot assertion, and
  with it absent the queue's reason enum contains nothing that could target the
  table.*
- **Unverified requests are an error because the key is a ceiling and the row
  set holds a stranger's identifier.** Nothing requires 24 hours; the cost of
  holding it longer is pure accumulation of a name and email typed by someone
  with no relationship to the operator. Raising it should require somebody to
  make the decision out loud.
- **`login_attempts` is a warning because no law names the number.** GDPR
  Art. 5(1)(e) is principles-based. A template that asserted a specific figure
  as a floor would be inventing a legal rule; 365 is a defensible default, and
  the honest instrument is to print it.
- **The tombstone window is an error because a *decision* names the number, not
  a law.** This row is the one that changed, and the reason it is classified
  differently from `login_attempts` is not legal authority — no statute names
  five years — it is that **the number is now this repository's own recorded
  decision**, made on 2026-10-12 (§9A.6). A value below 1825 is therefore
  somebody overriding a decision they typed out loud, which is the same thing
  §9A.4 treats as an error for unverified requests. And an **absent key is no
  longer a risk at all** — it defaults to 1825 — so the only failure left to
  guard against is a too-short window, and a warning would let it through
  silently on a machine nobody is watching.
  *Named test: `RETENTION_TOMBSTONE_DAYS=1095` fails the boot naming the
  effective value; `RETENTION_TOMBSTONE_DAYS=3650` boots and warns that the
  window is **longer** than the floor, which is the one direction nobody
  configures by accident and the one an auditor reads first.*
- **Export artefacts are a warning because the real control is structural.**
  An export is deleted when it is downloaded; the timer only sweeps artefacts
  whose download never happened, so the value is a backstop against a leaked
  disk, not a retention commitment. (Legacy precedent: 24 h,
  `privacy-cleanup.service.ts:23`, and the on-demand path reusing the same
  method so an operator-triggered sweep cannot drift from the scheduled one.)

**Where the floors are asserted.** One `assertRetentionConfig()` called from
`app.module.ts` beside the existing `loadEnvironment`
(`app.module.ts:16`), so all of it fails as one attributed error naming every
problem rather than as a sequence of surprises — the same shape
`loadEnvironment` already has, for the same reason.

### 9A.5 What is being deleted, and when — the admin surface

The question was asked literally, and the answer is two pieces, because §B1
forbids a Nest controller for anything expressible as CRUD over a table.

**The read is the table.** `GET /privacy_purge_queue?status=in.(pending,claimed,failed)&order=scheduled_for.asc`
against PostgREST, with its own pagination and its own response shape (§B3 —
never a hand-rolled `{ items, total, page }`). The Angular types come from the
regenerated spec (§B4). **No controller, no DTO, no hand-written URL.**

The columns that answer the question are already the columns of the table:
`target_kind` + `target_ref`, `reason`, `subject_anonymized`, `scheduled_for`,
`status`, `claimed_at`, `completed_at`, `rows_deleted`, `error`. **"What is
being deleted" is `target_ref` + `reason`. "When" is `scheduled_for`.** No
join, no enrichment, no derived summary.

**One list, two labels — and the label is a column, not a second query**
(§9A.1). A row with `reason = 'inactivity_purge'` renders as *"being purged for
inactivity"* when `subject_anonymized` is false and *"anonymized by privacy"*
when it is true. Both arrive from the same `GET`, under the same filter, in the
same table order. **An operator is not asked to choose a list before they are
allowed to see what is about to be deleted**, because the two lists are
populations of one question and choosing between them was a decision the UI was
making on the operator's behalf.

The default filter is the open set — `pending`, `claimed`, `failed` — because
that is the question being asked. **`cancelled` and `done` stay visible behind
the filter, deliberately:** an operator who cancelled a purge and can no longer
see that they did has lost the audit trail the cancel was for.

| Action | Mechanism | Gated by |
|---|---|---|
| List / view | `SELECT` grant + one policy | `privacy_purge:read`, via `authz.can_read_privacy_purge()` |
| **Cancel a pending purge** | `POST /admin/privacy-purges/:id/cancel` (thin Nest) → `authz.cancel_purge(p_actor, p_id)` | `privacy_purge:update`, **re-checked inside the transaction** |
| Enqueue | erasure path or sweeper only | **no human path** |
| Execute | the sweeper only | **no human path** |

**The cancel is the reason this section exists.** An operator must be able to
stop an imminent purge, and "imminent" is precise: **between `scheduled_for` and
the sweeper's claim.** `authz.cancel_purge` re-checks
`has_permission(p_actor, 'privacy_purge', 'update')` and then updates
`WHERE id = $1 AND status = 'pending'`. **Zero rows affected means the sweeper
already claimed it, and the route returns `409`, not `200`.** A cancel that
reports success on a purge that is already running is the exact
success-shaped-value §2.3 forbids.

Cancellation is **terminal**. Rescheduling is not an update to the cancelled
row — it is a **new row carrying `supersedes`**, so the chain *this was
scheduled, then stopped, then this was scheduled* is reconstructible from the
table alone. That is also why the status enum has no path from `cancelled` back
to `pending`: a status machine with a cycle is a queue you cannot reason about.

**There is no kill path, and that is a decision rather than a gap.** A claimed
purge is one in-flight transaction; it commits or it rolls back, and a request
cannot interrupt a transaction in PostgreSQL without killing the connection
under it. The operator's levers once claimed are the configuration and the
process, not an endpoint. **Inventing an abort endpoint here would produce a
button that appears to work and does not** — the same shape as
`POST admin/system-health/clear-temp`, which returns
`{ message: 'Cleanup job triggered' }` and triggers nothing
(`system-health.controller.ts:41`).

### 9A.6 The inactivity policy — **decided**, and the reversal is recorded here

**This subsection was a deferral and is now a decision.** It is left in place
rather than rewritten to read as though the number had always been decided,
because §1.1 says a change here is judged once, at the fork — and a reader who
finds only the final text cannot tell which parts of the design are load-bearing
and which were arrived at by accident.

**What was decided, on 2026-10-12.** `RETENTION_TOMBSTONE_DAYS` defaults to
**1825** days — five years — is admin-configurable in `.env`, and is asserted as
a floor: below 1825 the process fails to boot (§9A.4). Anonymised tombstones and
dormant accounts are purged **automatically, by the same scan** (§9A.1).

**Why the earlier deferral was the right call *while it was a deferral*, because
that is the part worth keeping.** Three reasons, in order:

1. Deleting a person's row on an unreviewed heuristic is the irreversible
   mistake, and "retain indefinitely" is the only direction that cannot cause it.
2. The retained state is **lawful and honest** — the row survives with
   `deleted_at` and `deletion_reason` recorded — so indefinite retention was not
   a gap being papered over, it was a documented posture.
3. It was **not quiet.** The warning was per-boot and permanent, not a one-shot,
   because a configuration whose absence has consequences must announce them
   every time the process starts. An operator who set the key once in an incident
   and nobody ever read the log had still made a permanent retention decision —
   and the log said so, on every subsequent boot.

**Why it is superseded, which is not a criticism of the above.** The deferral did
not prevent the guess; **it moved the guess into a `.env` that nobody reviews.**
The moment a fork set `RETENTION_TOMBSTONE_DAYS`, the number became an
unreviewed choice made by the first person to type one — exactly the decision
the deferral was avoiding, wearing a `.env` as a disguise. The mechanism is built
end to end **for tombstones**, so the only thing the deferral still protected was
the operator's own convenience. And the decision is no longer hypothetical for the
schema: **`0008_user_identity.sql:115` already says "The planned 5-year
inactivity purge deletes user rows"**, and 1825 is now the number the committed
migration is written against. Leaving the rest of the section saying "unset"
while a shipped migration says "5-year" is the drift §2.4 exists to prevent.

> **CORRECTED, 2026-10-14: "built end to end" overstated it, and the two anchors
> are not equivalent.** The scan below reads **two** predicates — a tombstone on
> `deleted_at` **and** a dormant live account on `last_activity_at`. What shipped in
> `0016` is the first only: `authz.retention_due_tombstones()` selects
> `deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)`, and
> `users.last_activity_at` **is not in the schema at any point**. So the shipped
> producer enqueues a user whose erasure has already happened, and **does not
> enqueue an account that has merely gone quiet.** The reason code is still
> `inactivity_purge` for every row, which is §9A.1's one-population design; it is
> the *population* that is narrower than the reason code's name suggests. §9A.8.1
> says the same thing from the other direction.

#### The candidate scan — one population, one query, no per-class variant

```sql
-- ONE scan, ONE population, ONE reason code (§9A.1). There is no per-class
-- variant because there is no second class: `email_anonymized` is a derived
-- column on the same row, not a different kind of user.
--
-- The parentheses are not decoration. AGENTS.md §B2 requires every OR branch of
-- a predicate to be evaluated, and an agent reading A AND B OR C AND D will
-- correctly assume the author meant something else.
CREATE FUNCTION authz.enqueue_inactive_purges(p_days integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE enqueued integer;
BEGIN
  IF p_days IS NULL OR p_days < 0 THEN
    RAISE EXCEPTION 'authz.enqueue_inactive_purges: p_days must be >= 0, got %', p_days;
  END IF;

  INSERT INTO public.privacy_purge_queue
    (target_kind, target_id, subject_anonymized, reason, scheduled_for)
  SELECT 'user', u.id, u.email_anonymized, 'inactivity_purge', now()
    FROM public.users u
   WHERE (u.deleted_at IS NOT NULL
          AND u.deleted_at < now() - make_interval(days => p_days))
      OR (u.deleted_at IS NULL
          AND u.last_activity_at < now() - make_interval(days => p_days))
  -- The partial unique index privacy_purge_queue_one_open_per_target is the
  -- real guard against double-enqueue; ON CONFLICT DO NOTHING is here so a
  -- sweep that races itself returns a count rather than raising.
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS enqueued = ROW_COUNT;
  RETURN enqueued;
END $$;
```

**The two anchors, and why they are different columns.**

- **A tombstone ages on `users.deleted_at`** — the moment the erasure happened is
  the moment retention starts, which is the only defensible anchor: the clock on
  a scrubbed row must not restart every time somebody touches it.
- **A live account ages on `users.last_activity_at`**, which the thin app writes
  on every authenticated request — the only place in this architecture that
  observes activity at all (§B1's boundary: PostgREST serves CRUD and knows
  nothing about the passage of time).

**Why `last_activity_at` and not `created_at`, which exists today and is
tempting.** `users.created_at` is on the row right now
(`0002_refresh_tokens.sql:29-35`) and costs nothing to filter on. It is also
wrong in the worst possible direction: **a six-year-old account used every day
has a six-year-old `created_at`,** so the scan would purge the most active users
in the installation and retain the dormant ones. A retention window anchored on
account age is not inactivity, it is tenure. `last_activity_at` defaults to
`now()` so a row that predates the migration starts its clock at migration time
rather than at 1970 — which is a real grace period, not a rounding artefact, and
it is why the default is `now()` and not `created_at`.

**The residual, stated rather than discovered later.** `last_activity_at` is
written by application code, so a request served **entirely** by PostgREST — a
pure CRUD read, no Nest involvement at all — does not touch it. **The template
therefore measures application activity, not database activity.** A forker who
wants read access to count has a better anchor available: the `actions` table
already exists and is unscoped, so `MAX(created_at)` over a user's actions is a
truer last-activity signal than any column the thin app writes. This paragraph
is where they will find out why it matters, and it is why
`last_activity_at` is proposed rather than shipped.

#### What is *not* deferred, and never was

The table and its DDL, the reason enum, the partial indexes, the policy, the
permission, all the `authz.*` functions, the sweeper, the floors, the boot
assertions, the admin read, the cancel, the 409. The `inactivity_purge` reason
exists, the sweeper dispatches on it, the admin view lists it, the cancel stops
it, the floor logic covers it. **Setting `RETENTION_TOMBSTONE_DAYS=1095` no
longer turns retention on; it fails the boot.**

### 9A.7 Work items

Continues the `W…` series from §9.6. Verified-by names the step of
`npm run verify` that proves it, or says plainly that no automated step can.

**Numbering, stated once.** `W47`–`W55` below are the original §9A items and
keep their ids — they are cross-referenced from §9A.1, §9A.2 and §9A.3 and
renumbering live ids is its own kind of drift. The highest number in use before
this section was edited was **W64**, so the two items this section gained take
**W65** and **W66**, and §9B's rewritten items start at **W67**. `W56`–`W64`
are **withdrawn with the §9B rewrite** rather than reused: an id that pointed at
one design and then silently pointed at a different one is precisely how a plan
becomes untrustworthy.

| ID | Phase | Work | Verified by |
|---|---|---|---|
| W47 | N2 | Migration **`0010_privacy_purge_queue.sql`** (renumbered — `0008` was taken by `user_identity`; §9A.2) + `down()`. DDL above: `uuidv7()` PK, closed enums on `target_kind`/`reason`/`status`, `subject_anonymized boolean NOT NULL` with `CHECK (target_kind = 'user' OR subject_anonymized = false)`, the two `CHECK`s on target columns, `rows_deleted`/`completed_at` consistency, **no FK to `users`**, three partial indexes including the one-open-per-target `UNIQUE`, `FORCE`d RLS with one `USING (authz.can_read_privacy_purge())` policy, `REVOKE ALL` for every serving role then `GRANT SELECT TO app_admin` | `npm run test:rls` (step 7). `has_table_privilege` **per role** for `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`; `uuid-keys.spec.ts` covers the new PK with no table list to maintain. The `reason` CHECK contains **exactly one** `user`-row code — read from `pg_constraint`, not from this document |
| W48 | N2 | Permissions `privacy_purge:read` and `privacy_purge:update`. **No `create`, no `delete`.** Rows in `0010` **and** grants in `database/seed.ts`, both `ON CONFLICT DO NOTHING` | Live catalog after `db:seed` **and** after `migration:run` alone. An admin token whose role lacks the row reads **zero** rows inside its own scope; the `test:rls` tamper of dropping the policy conjunct makes it go red |
| W49 | N2 | `SECURITY DEFINER` functions in `authz`, `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE TO app_admin` (§B2: revoke and grant, always together): `can_read_privacy_purge()`, `enqueue_inactive_purges(p_days)`, `claim_due_purges(p_instance, p_limit)`, `execute_purge(p_instance, p_purge_id)`, `cancel_purge(p_actor, p_purge_id)` | Absent from `openapi.json` **and** from the served `/` spec. `test:rls`: an admin whose role lacks `privacy_purge:update` gets a denial from `cancel_purge` and the row survives by unfiltered owner count. `enqueue_inactive_purges(-1)` **raises** |
| W50 | N3 | The sweeper. **No `@nestjs/schedule`** — a plain `unref()`ed interval started in `onApplicationBootstrap`, cleared in `onModuleDestroy`. Shares the one injected `pg` pool | `npm run test:e2e`. *Two concurrent sweepers against a queue of N rows delete exactly N rows* — the `SKIP LOCKED` test, and the assertion the legacy's design cannot pass. Plus the four §9A.3 no-over-delete assertions |
| W51 | N2 | The `RETENTION_*` namespace and `assertRetentionConfig()`. Floors are errors, defaults are warnings, every warning repeats every boot. **The tombstone row changed:** `RETENTION_TOMBSTONE_DAYS` **defaults to 1825** and is a floor — `< 1825` is a boot error, not a per-boot warning (§9A.4, §9A.6) | `npm test` (step 4): `RETENTION_TOMBSTONE_DAYS=1095` **fails the boot naming the effective value**; `RETENTION_AUDIT_DAYS=30` fails the boot; `RETENTION_UNVERIFIED_REQUEST_HOURS=48` fails the boot; `RETENTION_LOGIN_ATTEMPTS_DAYS=7` boots and **warns with the effective value**; an absent `RETENTION_TOMBSTONE_DAYS` boots at **1825** and prints the effective value, because a retention policy in force must be announced even when it is the default |
| W52 | N3 | `POST /admin/privacy-purges/:id/cancel`, thin route + DTO with `@ApiProperty` on every field (§B3). Re-check inside the transaction, `409` when already claimed, **no kill path** | `npm run test:e2e`: cancel-pending → `200` and the row is `cancelled`; cancel-already-claimed → `409` and the row is unchanged. **Named: "a purge that has already started cannot be reported as cancelled"** |
| W53 | N2 | The RLS suite for the queue. Five assertions named after the attack | `npm run test:rls` (step 7), each with a permitted case on row counts and a denied case **per access path**. Includes *the sweeper run against an empty queue deletes zero rows*, *a cancel by a non-holder leaves the row `pending` with its `scheduled_for` untouched*, and **§9A.1's new one**: *an anonymised tombstone and a dormant live account both appear in the SAME result set under `reason = 'inactivity_purge'`, distinguished only by `subject_anonymized`* — asserted by counting both in one `GET`, because the two-list design passes every other test here |
| W54 | ALL | §9A.1's supersession applied to §9.5: W42's function rewrites the user row instead of deleting it; **W38 is now half shipped** — `user_roles`/`user_groups` carry `REFERENCES public.users (id) ON DELETE CASCADE` from `0008_user_identity.sql:242`, leaving only the two `NO ACTION` FKs for W38 — and the membership deletes in the anonymisation function stay **explicit**, because a referential action does not fire on an `UPDATE`. Assertion 6 moves to the anonymisation path | The §9.5 assertion 6 test, re-pointed: *"after erasure the `users` row is still present and anonymised, `email_anonymized` is true, and `authz.visible_user_ids()` no longer returns the id"*. A row that survives and a person that does not are asserted **separately**. Plus the tamper: **delete the two membership `DELETE`s** and the same assertion goes red — that is the test the FK's existence tempts an agent to remove |
| W55 | ALL | §9A.1 / §9A.2 reflected in `docs/security.md` and `AGENTS.md` §B2's four-category table, which currently names `email_messages` as the only DERIVED table and lists no purge table | **No automated step.** A prose table is not machine-checked; this is a review item and is listed as one rather than dressed up as a gate |
| **W65** | N2 | **`0009_user_anonymisation.sql`** + `down()`: `users.deleted_at timestamptz`, `users.deletion_reason text`, **`users.email_anonymized boolean GENERATED ALWAYS AS (deleted_at IS NOT NULL) STORED`** — derived, so no code path can set it and disagree with it — and `users.last_activity_at timestamptz NOT NULL DEFAULT now()`. **`users` today is `id, username, email, password_hash, created_at`** (`0002_refresh_tokens.sql:29-35`), so every column here is new. `last_activity_at` is written by the thin app on authenticated requests | `npm run test:rls` (step 7) for the generated column: setting `deleted_at` and reading `email_anonymized` in the same statement flips it, and **no serving role may write `email_anonymized`** (`has_column_privilege` false for `app_admin` included — a generated column a role can write is not derived). `npm test` (step 4) for the writer: an authenticated request advances `last_activity_at`; an unauthenticated one does not. **Named: "tenure is not inactivity"** — a row with `created_at` six years old and `last_activity_at` one minute old is **not** enqueued |
| **W66** | N3 | `authz.enqueue_inactive_purges(p_days)` — the scan in §9A.6 — called by the sweeper on its own schedule, and the **single** admin list rendered as one filterable table with the two labels from `subject_anonymized` (§9A.5) | `npm run test:e2e`: *the same `GET` returns an anonymised tombstone and a dormant live account under one `reason` filter, with `subject_anonymized` differing*; *a row with `target_kind <> 'user'` cannot carry `subject_anonymized = true`*; *running the scan twice inside one window enqueues once* (the partial `UNIQUE`, not the function's `ON CONFLICT DO NOTHING`, is what makes that true — assert the index, do not assert the `ON CONFLICT`) |

### 9A.8 As built — 2026-10-14

> Read this before §9A.0–§9A.7. They are the plan of 2026-10-12 and are left
> that way. This subsection is what landed, where the plan's mechanism was wrong,
> and — first, because it is the one an operator has to know — **the gap the
> shipped state leaves open.**

> **SECOND PASS — 2026-10-14, later the same day.** The gap this section leads
> with has since been closed by `0015` and `0016`, and so has the claim-path
> failure it records two subsections down. **§9A.8.1 and §9A.8.3 are resolved and
> their headings say so; §9A.8.2 (2) and (6) are partly resolved.** The
> reasoning inside them is kept rather than deleted, because a reader needs to
> know those defects existed, what each one cost, and which migration closed it —
> and because the failure mode of careful prose is that it is trusted after it
> stops being true. Every remaining present-tense claim in this subsection has
> been re-checked against the tree as it stands.

#### 9A.8.1 ~~Nothing enqueues~~ **RESOLVED — `PurgeEnqueuer` fills the queue**

**This subsection described a real defect. It does not describe the tree any
more.** Nothing is deleted from it, because the diagnosis was correct and a
reader who has to reason about retention needs to know what was broken and what
fixed it.

**What was true on 2026-10-14, before `0015` and `0016`.** There was no producer
for `privacy_purge_queue` in this tree. No enqueue function, no enqueue route, no
enqueue RPC, no seed row. `authz.enqueue_inactive_purges` (§9A.6, W66) had not
been built, and `database/seed.ts` wrote none. The only statements that `INSERT`
into the table anywhere in the repository were the RLS suite's own fixtures,
which enqueue as the **owner** because — as the suite says at its own helper — no
serving role holds `INSERT` and that refusal is the control under test.

So the shipped system was a **real, working drain over a queue nothing filled.**
The sweeper ticked, gated correctly, claimed atomically, deleted transactionally
and wrote `rows_deleted` truthfully; and on any installation it would report
`nothing_due` forever, because there was never anything due. **An empty admin
list was not evidence that retention was running**, and a `done` row in a
screenshot was a fixture.

**What is true now, and there are two fixes, not one.** The mechanism was inert
for two *independent* reasons, and closing only one would have produced a queue
that was filled but could not be drained:

| | Defect | Closed by | How |
|---|---|---|---|
| 1 | the `DELETE` could never complete — `refresh_tokens.user_id` and `email_messages.user_id` were `NO ACTION`, so purging any user who had ever authenticated raised `23503` (§9A.8.3) | `0015_purge_user_cascade.sql` | both FKs made `CASCADE`, with a preflight asserting the child tables are owned by the role whose privileges govern the referential action |
| 2 | the claim could never match — `privacy_purge_read` is `authz.can_read_privacy_purge()` alone, and `authz.actor()` is `NULL` in a claimless session, so the claim's inner `SELECT` was empty and the `UPDATE` affected `0` rows, silently | `0016_purge_machine_path.sql` | five narrowly-granted `SECURITY DEFINER` functions in `authz`, and `UPDATE` revoked from `app_admin` so the inert path now fails loudly instead of returning `UPDATE 0` |

**With both closed, there is a producer and a consumer.** `PurgeEnqueuer`
(`src/purge/purge-enqueuer.service.ts`) sweeps on its own hourly interval for
tombstones older than `RETENTION_TOMBSTONE_DAYS` and enqueues them in **one**
transaction through `authz.enqueue_inactive_purges(uuid[])` — the only `INSERT`
into the table in the tree. It logs every sweep including `scanned: 0,
enqueued: 0`, so the empty admin list and the dead enqueuer are distinguishable
from the log, which was the whole of what this subsection used to have to say.

**What is still missing, precisely, because "the mechanism is now built end to
end" overstates it.** The shipped scan is over `users.deleted_at` — **tombstones
only**. §9A.6's second anchor, the dormant *live* account on
`users.last_activity_at`, **still does not exist**: that column is not in the
schema at any point, and §9A.6 says so ("proposed rather than shipped"). So the
shipped producer enqueues a user whose erasure has already happened, not a user
who has merely gone quiet. The reason code is still `inactivity_purge` for every
row, which is §9A.1's one-population design and not a second one, but the
population is narrower than the design's name suggests. **A dormant live account
is not purged by this tree.**

There is still no erasure route (W44) and no cancel route (W52); those were never
touched by `0015`/`0016` and remain recorded in §9.8.4 and §9A.8.4.

#### 9A.8.2 Where §9A's stated mechanism is not what shipped

**(1) `@nestjs/schedule` was added, and §9A.3 and §9B.8 both said not to.** Both
sections say *"Recommendation: do not add it"* / *"**`@nestjs/schedule` is not a
dependency**"*, on an argument about **ordering**: `@Cron` binds its handler
during `OnModuleInit`, which Nest runs before `OnApplicationBootstrap`, so a job
registered with `@Cron` can take its first reading before the configuration has
been asserted.

**The argument was right and the conclusion drawn from it was wrong.** Shipped:
`@nestjs/schedule@12` **is** a dependency (v6 peers on Nest 10/11 and this tree
is Nest 12), and **neither job uses `@Cron`**. Both register a plain
`unref()`ed `setInterval` in `onApplicationBootstrap` and hand the handle to
`SchedulerRegistry.addInterval(name, timer)`. That is the strict ordering the plan
asked for, *plus* the registry that gives the interval a named lifecycle for
`onModuleDestroy` and for tests — neither of which `setInterval` alone provides
for free, and both of which §9A.3 had to invent a mechanism for ("cleared in
`onModuleDestroy`").

So the plan correctly refused `@Cron` and incorrectly refused the library. Recorded
rather than quietly corrected, because the next reader will otherwise re-derive the
"do not add it" sentence from a tree that plainly has the dependency.

**(2) ~~There is no `SECURITY DEFINER` writer~~ — **SUPERSEDED BY `0016`. What
§9A.2 and W49 described is now what shipped, with one deliberate difference.**
§9A.2 says *"**No serving role holds `INSERT`, `UPDATE` or `DELETE`** — not
`app_admin` included. Every write goes through a `SECURITY DEFINER` function in
`authz`"*, and W49 lists five of them: `enqueue_inactive_purges`,
`claim_due_purge`, `complete_purge`, `fail_purge`, `requeue_purge` (W49's spelling
`claim_due_purges` / `cancel_purge` / `execute_purge` did not survive; `cancel_purge`
and `execute_purge` are still unbuilt because W52 and §9A.1's executor call were
never implemented).

**What shipped, and it is very nearly the plan.** Five functions in `authz`,
all `SECURITY DEFINER`, all outside `db-schemas` so PostgREST cannot address
them at `/rpc/`, `EXECUTE` revoked from `PUBLIC` and granted to `app_admin` alone.
`app_admin` keeps `SELECT` — the admin list — and **loses `UPDATE`**. So the plan's
"not `app_admin` included" half is now literally true of all three verbs, and it
is enforced by the grant rather than by an absence: a bare `UPDATE` on this table
now fails with `permission denied for table` instead of matching zero rows.

**The difference, and it is a security decision rather than an oversight.** None of
the five functions reads `authz.actor()` or `current_user`. Identity is not their
business; they are reached by *identification* of the machine — the escalation
boundary `pgrst_authenticator` + `SET LOCAL ROLE app_admin`, which a token can
only assume if the signature verifies. **The two rejected alternatives are
recorded because they were the cheap ones:**

- **a `current_user = 'app_admin'` branch on `privacy_purge_read`** would have
  satisfied the claim with three words, and it contradicts the rule that capability
  resolves from role rows and never from the database role.
  `test/rls/privacy-purge-queue.spec.ts` asserts **against** it — an admin holding
  the table grant and lacking `privacy_purge:read` must read **zero** rows. Taking
  it would have meant weakening a security test.
- **a `request.jwt.claims` document written by the job** would also have worked,
  and §B2 F1 names it a **P0**: the GUC is a custom setting any role may `SET`,
  verified exploitable. The mitigation for that is architectural — *no
  request-reachable SQL path may write it* — and a cron entry that wrote its own
  identity document would be that path, promoted to a permanent P0 so a background
  job could drain a queue. It is the same defect as the `db-pre-request` hook F1
  warns about, wearing a cron expression. **Nothing in this tree sets one, and the
  end-to-end test that used to set one as a workaround was removed in `090ed5a`.**

ADR-0031 records the decision and the reasoning. The `0011` comments that
repeated the false part were corrected in place on 2026-10-14 (comments only; the
executable SQL is byte-identical) and corrected **again** the same day, once
`0016` made the first correction false as well. The second correction is recorded
in the file rather than the first being quietly overwritten.

**(3) The transaction boundary is right and the failure semantics are the
opposite of what §9A.3 argued.** §9A.3 is emphatic:

> *If the delete raises, that purge rolls back whole — the row is still `pending`,
> `attempt` is **not** incremented (it rolled back with everything else, so the
> next attempt re-increments it correctly), `error` is unset, and **nothing was
> deleted**.*

Shipped: the claim, the delete and the status write are still one transaction,
**and a failure is recorded rather than unwound.** `sweepOne` opens
`SAVEPOINT purge_work` before the delete; a failed delete does
`ROLLBACK TO SAVEPOINT purge_work`, which undoes the deletion alone and keeps the
claim, and then writes `FAIL_PURGE_SQL` (or `REQUEUE_PURGE_SQL`) **in the same
transaction**, so the row leaves it as `failed` or back as `pending` — never in
`claimed`.

**The plan's version is not merely different, it is broken, and the reason is the
ownership predicate.** A whole-transaction `ROLLBACK` restores the row to
`pending` with `claimed_by = NULL`, and every write after the claim predicates on
`status = 'claimed' AND claimed_by = $instance`. So the failure write would match
**zero rows**: the error is recorded nowhere, `attempt` never advances, and a purge
that always fails is retried forever with `failed: true` reported each time — a
success-shaped outcome for work that did not happen, and
`RETENTION_PURGE_MAX_ATTEMPTS` **unreachable code**.

So the plan's reasoning ("`attempt` must not advance for a purge that did not
happen") was a description of the bug, not a property worth keeping. The shipped
design answers a question the plan never asked: **an attempt is an attempt**, and
a failure that is not recorded is a failure that repeats. §9A.3's *other*
half — that an **abort** still rolls the whole thing back, so "aborting leaves no
partial state" and a partial purge is not representable — is unchanged and is what
makes the sweeper safe to put in the breaker's STOP set (§9B.5).

**(4) The `status` vocabulary has no `cancelled`, and `subject_anonymized` and
`supersedes` do not exist.** §9A.2's DDL declares
`status IN ('pending','claimed','done','cancelled','failed')`, a
`subject_anonymized boolean NOT NULL` with its own `CHECK`, and a
`supersedes uuid REFERENCES privacy_purge_queue (id)`. Shipped columns are
exactly:

```
id, target_kind, target_id, target_ref, reason, scheduled_for,
status, attempt, claimed_at, claimed_by, completed_at, rows_deleted, error
```

`status` is `('pending','claimed','done','failed')`. `0011:25-31` says why, and
the reason is §2.1: **`cancelled` has no writer**, because the cancel route (W52)
does not exist. An enum value nothing writes is a status the database appears to
support and nothing can produce. `supersedes` went with it, since the only thing
it recorded was the cancel chain. And `subject_anonymized` went because the whole
reason it existed — labelling an anonymised tombstone differently in the admin
list — presumes a second classification axis, and §9A.1's later argument is that
anonymisation is a **status, not a second lifecycle**: `users.email_anonymized`
is already a derived column, and a queue row that must outlive its target cannot
join to it after the target is gone.

That last one is a real loss of a real capability, and it should be read as one:
**an operator looking at the admin list can no longer tell a scrubbed tombstone
from a dormant live account.** `0011`'s reason table carries the distinction on
the target row instead, and the RLS suite's `anonymised` fixture exists to prove
the queue row survives its target — not to prove a label.

**(5) `FORCE` was not applied, and the reason recorded for it was false — twice.**
§9A.2 says *"`FORCE`d RLS"*. `0011` enables RLS and deliberately does not FORCE
it. The paragraph justifying that originally named a `SECURITY DEFINER` enqueue
function that did not exist; a 2026-10-14 correction repeated the same falsehood
one layer down; and `0016` then built the function.

**The corrected paragraph, as it now stands, is weaker than either.** `FORCE` binds
the table OWNER, not `app_admin`, and `app_admin` owns nothing. It also does not
need a verb to be relevant: since `0016` `app_admin` holds **no `UPDATE` at all**
on this table, so FORCE would change nothing for the machine path in either
direction — the writers are `SECURITY DEFINER` functions whose `current_user` is
the owner, and both with and without FORCE they read and write this table with no
policy applied to them.

**So the residual is now larger than this paragraph used to record, and it is
stated rather than assumed:** five `SECURITY DEFINER` functions have unrestricted
access to this table, including through `privacy_purge_read`'s capability gate,
because the owner bypasses RLS on a table that is enabled but not forced. That is
bounded by two facts and only two: the owner never receives a request, and each
function's `EXECUTE` is revoked from `PUBLIC` and granted to `app_admin` alone.
**The narrowness is carried entirely by `EXECUTE`** — which is a weaker control
than a policy, and the reason is worth naming: a policy cannot be applied to a
`SECURITY DEFINER` body, because that body *is* the owner. Forcing the table would
have closed the machine path entirely rather than narrowed it, which is the one
argument for FORCE that this design does not make and should not be mistaken for.

The RLS suite asserts the grant state and the policy set but **not**
`relforcerowsecurity` for this table, so this is a recorded trade rather than a
proven one.

**(6) The retention floors are still mostly missing, but the one that destroys
data is not.** §9A.4's seven-row table and W51's `assertRetentionConfig()` are
unbuilt. **What has changed is the one number that matters.**
`RETENTION_TOMBSTONE_DAYS` **now exists**, is required with **no default in any
of the six `.env*` files**, is validated at module-evaluation time by
`src/purge/retention-environment.ts` (bounds 1..36500, and `0` is refused with the
reason spelled out), and is bound as `RETENTION_ENV` into `purge.module.ts` — the
same shape as `APP_BREAKER_ENVIRONMENT`, for the same reason: a control whose
value proposition is refusing bad configuration must refuse it before it has acted
on it. §9A.4's floor below 1825 days is **still not enforced as a floor**; the
shipped bound is 1..36500, so the number is required and non-degenerate but a
fork may set it to 1.

The other four — `RETENTION_AUDIT_DAYS`, `RETENTION_LOGIN_ATTEMPTS_DAYS`,
`RETENTION_UNVERIFIED_REQUEST_HOURS`, `RETENTION_EXPORT_ARTEFACTS_HOURS` — are
four decisions still written down and not wired to anything, and the three reason
codes they would drive have no executor either (7). `RETENTION_PURGE_MAX_ATTEMPTS`
(default 3), `PURGE_POLL_SECONDS` and `PURGE_DRAIN_BUDGET` live in
`src/breaker/breaker-environment.ts`, which is where this paragraph already said
they were.

**(7) Three of the four reason codes have no executor, and say so by raising.**
`SqlPurgeExecutor` implements `inactivity_purge` and nothing else;
`retention_login_attempts`, `retention_unverified_request` and
`retention_export_artefact` raise `UnsupportedPurgeReasonError`. That is the right
answer — §9A.2 itself insists that a `rows_deleted = 0` for un-executed work is
§2.3's success-shaped value — and the CHECK and the executor disagree **on
purpose**: the CHECK admits four, the executor implements one, and a row for the
other three ends as `failed` with the reason attached.

#### 9A.8.3 ~~The live defect this leaves behind~~ **RESOLVED — `0015`, and proven end to end**

**This was the single reason code that had an executor could not succeed against a
real user.** It is closed. The analysis is kept in full because it is the clearest
example in this document of a defect that was invisible to every test that existed
at the time, and a reader deciding how much to trust this section should know that.

**The defect, as diagnosed.** `SqlPurgeExecutor.deleteUser()` is
`DELETE FROM users WHERE id = $1`. `refresh_tokens.user_id`
(`0002_refresh_tokens.sql:73`) and `email_messages.user_id`
(`0005_email_messages.sql:56`) were both `REFERENCES public.users (id)` with **no
`ON DELETE` clause**, i.e. `NO ACTION`. W38 recorded this as a half-closed item and
§9A.1 said "**W38 survives as those two cascades and nothing else**" — correct, and
nobody noticed what it now blocked, because at the time the consumer of that
`DELETE` was a function that had not been written.

So: purging any user who had ever authenticated raised **`23503`**, the sweeper's
savepoint unwound the deletion, the row was requeued, and after
`RETENTION_PURGE_MAX_ATTEMPTS` it was `failed` with the constraint violation in
`error`. **The failure was loud and attributable — which is the mechanism working
as designed — and the retention it was built to perform did not happen.**

It was untested end to end for an uninteresting reason: no suite ran a real purge
against a real user. `test/rls/privacy-purge-queue.spec.ts` exercised queue
mechanics (claims, the double-sweep `UNIQUE`, the CHECKs, the grant state, the
capability-gated read) and wrote its rows as the owner; the unit suite exercised
the sweeper through a structural port with no database at all. **The fixture user
was deliberately given no refresh tokens and no mail history**, so the one
combination that failed was the one the fixture avoided.

**The fix is W38's two remaining cascades and nothing else.**
`0015_purge_user_cascade.sql` makes both `CASCADE`, and two decisions inside it are
worth recording because both were the *other* obvious answer:

- **The explicit ordered child-delete was measured out and is not available.**
  `email_messages` is `FORCE`d RLS with `SELECT` and `INSERT` policies only, and
  `FORCE` binds the owner — so a `SECURITY DEFINER` helper does not help, because
  a definer *is* the owner. **The referential action is the only route**, and
  `0015` therefore preflights that the child tables are owned by the role whose
  privileges govern an `RI_Trigger`, so the documented behaviour is the actual
  behaviour rather than a coincidence of this cluster's grant history.
- **`email_messages` is cascade-deleted rather than retained.** ADR-0032 records
  the decision and the reason: the 24-month obligation already has its home in
  `privacy_request_audits`, which has no FK to `users` by design. A second,
  quieter retention on the mail log is a worse outcome than its absence, and
  `0008` already named leaving the rows behind as the defect.

**And it is proven, not asserted.** `test/rls/user-purge-end-to-end.spec.ts` drives
the **shipped** executor over a real pool with the shipped claim and complete SQL,
and asserts row counts read as a superuser — plus a **class-level gate**: every
foreign key naming `users` must be `CASCADE`, so a sixth referencing table added
later as `NO ACTION` fails the gate rather than waiting to be discovered by the
next real erasure. That gate is the difference between fixing this instance and
fixing the class.

#### 9A.8.4 Status of the work items in §9A.7

**Re-checked 2026-10-14 after `0015`/`0016`.** Two rows below changed on that day
and are marked.

| ID | Status as of 2026-10-14, re-checked after `0015`/`0016` |
|---|---|
| W38 | **SHIPPED, 2026-10-14, by `0015`.** `user_roles`/`user_groups` carried the `ON DELETE CASCADE` from `0008:242`; `refresh_tokens.user_id` and `email_messages.user_id` are now `CASCADE` as well, so **every FK naming `users` cascades**. §9.8.4 carries the same update. The class-level gate is in `test/rls/user-purge-end-to-end.spec.ts`: a new referencing table added as `NO ACTION` fails it. |
| W47 | **SHIPPED as `0011_privacy_purge_queue.sql`** (the plan's number, `0010`, was taken by `privacy_requests` — so the renumbering note above is itself out of date, and the file is `0011`). DDL as specified except: **not** `FORCE`d, `status` without `cancelled`, no `subject_anonymized`, no `supersedes`. Everything else — the `uuidv7()` PK, the closed enums, the two target-column `CHECK`s, the `rows_deleted`/`completed_at` consistency, no FK to `users`, and all three partial indexes including the one-open-per-target `UNIQUE` — is as written. Two of the shipped `CHECK`s are additions: a claimed row must name its owner, and a pending row must name none. **Its comments have been corrected twice** — once for the absent enqueue function, once when `0016` made the first correction false. Comments only; the comment-stripped checksum of the file is unchanged. |
| W48 | **SHIPPED.** `privacy_purge:read` and `privacy_purge:update`, in `0011` **and** `database/seed.ts`, both `ON CONFLICT DO NOTHING`; `create` and `delete` absent from `permissions` entirely, asserted from the live catalog. `update` currently gates a capability **no route implements** — the same §2.1 shape as `cancelled`, one layer up. |
| W49 | **SHIPPED, 2026-10-14, by `0016`.** `can_read_privacy_purge()` from `0011`, plus the five writers W49 asked for and §9A.2 described: `claim_due_purge`, `complete_purge`, `fail_purge`, `requeue_purge`, `enqueue_inactive_purges` — all `SECURITY DEFINER`, all in `authz`, `EXECUTE` revoked from `PUBLIC` and granted to `app_admin` alone. `cancel_purge` is still absent, because W52 is still absent. **ADR-0031** records why the machine path does not set `request.jwt.claims` and does not take a `current_user` branch on the policy. |
| W50 | **SHIPPED, with the plan's library decision reversed** — §9A.8.2 (1). The `unref()`ed interval in `onApplicationBootstrap` is exactly as specified; `SchedulerRegistry` was added around it. The `SKIP LOCKED` claim is one statement (`UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`) rather than the plan's separate batch-select and compare-and-set, which §9A.8.2 (3) explains is the only shape that can record a failure. **The statement moved into `authz.claim_due_purge()` in `0016` and is otherwise unchanged.** |
| W51 | **PARTIAL.** `RETENTION_TOMBSTONE_DAYS` is now a required key with no default in every `.env*` file, validated at module-evaluation time and bound through `RETENTION_ENV` (`src/purge/retention-environment.ts`). **§9A.4's 1825-day floor is not enforced as a floor** — the shipped bound is 1..36500 — and the other four `RETENTION_*` keys are still unbuilt. See §9A.8.2 (6). |
| W52 | **NOT LANDED.** No route, no `authz.cancel_purge`, no `cancelled` status. The 409-on-already-claimed design stands and is unimplemented. |
| W53 | **SHIPPED for everything that exists.** Permitted and denied cases per access path, on row counts and on bodies; the double-sweep `UNIQUE`, the CHECKs, the per-role grant state including `TRUNCATE`, and the capability-gated read (an admin whose role lacks the row reads **zero** rows despite holding the table grant). **The `subject_anonymized` half is not applicable** — the column does not exist. `test/rls/purge-machine-path.spec.ts` adds the `0016` grant state and the `authz` function surface. |
| W54 | **SUPERSEDED by a different mechanism.** The supersession §9A.1 describes happened; the membership deletes are explicit — but in `authz.revoke_subject_authority()`, a **trigger**, not the "anonymisation function" W42/W54 describe. Assertion 6 is asserted on the anonymisation path, and the tamper (remove the two `DELETE`s) is what the trigger's test does. |
| W55 | **PARTIAL, and still open.** `docs/security.md` and `docs/architecture.md` still do not mention a purge queue, a privacy module or a breaker. `architecture.md`'s `src/` tree names a `privacy/` directory that does not exist and omits the two that do; corrected in this change. `AGENTS.md` §B2's four-category table still lists only `email_messages` as DERIVED. |
| W65 | **SHIPPED as `0009_anonymisation.sql`**, with one substantive difference: `email_anonymized` is `GENERATED ALWAYS AS (deletion_reason = 'rtbf') STORED`, not `(deleted_at IS NOT NULL)` — §9.8.2 (1). **`users.last_activity_at` was not added, and still is not** — which is why the shipped enqueue covers tombstones only. §9A.8.1. |
| W66 | **LANDED, 2026-10-14, as half of W66.** `authz.enqueue_inactive_purges(uuid[])` exists (`0016`) and is driven hourly by `PurgeEnqueuer`; the single admin list renders as the PostgREST table itself, capability-gated. **The other half is still missing: the scan reads `users.deleted_at`, so a dormant *live* account on `users.last_activity_at` is not enqueued, and that column is not in the schema.** `subject_anonymized` is still absent, so an operator cannot tell a scrubbed tombstone from a dormant live account by reading the queue — the loss §9A.8.2 (4) records, and the reason `retention-environment`'s bounds are the only thing distinguishing them. |

---

## 9B. The app-level circuit breaker

Also appended to §9 because it answers a question §9 opened: §9.3 rejected the
legacy Sentinel wholesale, and `0007_resource_ceilings.sql:6-12` records why in
a comment that is **half right and reads as fully right**. §9B.0 separates the
two halves.

**This section was rewritten on 2026-10-12 against a superseded brief.** The
previous version classified on disk percentage alone, carried a `SENTINEL_*`
namespace with four trip signals, had no notion of a cgroup, and predated the
`BREAKER_PROTECTED` decision. It is not patched — it is replaced. **`W56`–`W64`
described a design that no longer exists and are withdrawn rather than reused:**
an id that pointed at one design and then quietly pointed at a different one is
how a plan stops being trustworthy. The live series is `W47`–`W55` and `W65`–`W66`
(§9A.7) and `W67`–`W74` (§9B.10).

Read against the tree on 2026-10-12. **Nothing in the shipped tree was
executed.** Every `file:line` below is verified; the two places where something
*was* run — §9B.2's cgroup probe and homegrown-etl's threshold values — say so
at the point the measurement is used.

> **SHIPPED — 2026-10-14, in `src/breaker/` and `0011`'s sweeper contract.** Every
> `file:line` above is still accurate, and the design landed essentially as
> written — the trip set, the state machine, GATE/STOP, the `current_user`-free
> identity, the cgroup resolution order and the disk-is-never-a-trip-input rule are
> all the mechanism this section describes. **Two of its claims are now false, one
> of them load-bearing**, and there is one defect it did not predict that broke a
> committed, previously-green test. **§9B.12 is the reconciliation**, and the
> headline is the cold-start window: §9B.6's own staleness rule, applied exactly
> as written, refused every non-protected dispatch with `202` for the first thirty
> seconds of every process's life.

### 9B.0 What stands, what `0007` got half right, and what the reference implementation actually built

**What stands — verified, and it is not a matter of opinion.** PostgREST serves
the CRUD surface from a **separate process**: `postgrest.conf:96-97` binds
`server-host = "127.0.0.1"` and `server-port = 3001`, and the thin Nest app is a
different process with a different entry point (`src/main.ts:17`, its own
`app.listen`). **No guard, interceptor or pipe in the thin app can observe a
PostgREST request.** An `APP_INTERCEPTOR` covers the thin app's own routes and
nothing else. The legacy's *global* gate therefore does not port, and no amount
of cleverness changes that — it is a process boundary, not a missing decorator.

**`0007_resource_ceilings.sql:6-12` is two claims and only one survives.** The
comment reads, in full:

> ```sql
> -- (ADR-0027). There is no health service and no interceptor here, and there is
> -- deliberately none to add: PostgREST serves the CRUD surface from a SEPARATE
> -- PROCESS, so no guard, interceptor or pipe in the thin Nest app can observe a
> -- PostgREST request. An application-level gate would cover four auth routes,
> -- report itself Healthy, and gate nothing anyone could attack. The ceiling has to
> -- sit below both runtimes.
> ```

- **The first claim is right and load-bearing.** The process boundary is real, and
  it is why the *database* ceilings — `statement_timeout = 30s`,
  `lock_timeout = 5s`, `idle_in_transaction_session_timeout = 60s` — sit where
  they do, below both runtimes. Nothing here disputes it.
- **The second claim is wrong, and wrong invisibly.** *"An application-level gate
  would cover four auth routes"* is **true of the tree as it stands** —
  `src/auth/auth.controller.ts:13-52` serves exactly four routes and §9B.9
  tabulates them — and **false the moment §9A lands**, because the erasure, the
  purge sweeper and the email sends are all Nest work (§9A.3, §9B.9), not
  PostgREST CRUD. The comment was written against a snapshot and reads as a
  permanent finding, which is how the previous version of this section came to
  reject an app-level breaker wholesale.
- It is also, strictly, **the wrong file to conclude it in.** `0007` is a
  *database* migration. Even a perfect app-level breaker could not live in a file
  whose job is `ALTER DATABASE`.

The corrected sentence, and it is much narrower than the one it replaces:
**there is no gate in `0007` because this file is a database migration and
PostgREST is out of reach; an app-level gate belongs in the thin app, covers the
thin app's own expensive work, and covers nothing PostgREST serves.** W73
amends the comment and gives it a `grep`.

#### The reference implementation, and why it is a reference and not a template

`/home/eaxelrod/GitHub/homegrown-etl` is the closest thing in the lab to a
working breaker, and reading it is where this design's shape came from.
**The shape is right.** `angular/backend/src/modules/etl/services/job-queue.service.ts:389-470`
is memory-aware dispatch control, and every structural decision in it survives
here:

| What it does | Where | Why it is right |
|---|---|---|
| An `isProcessing` latch around the whole body | `:394-396`, released in `finally` at `:586-588` | One tick cannot re-enter itself — **and the latch clears even when the body throws**, checked at `:587` rather than assumed, so a failed tick does not wedge the queue permanently |
| Measure **once**, at the top, before any work is selected | `:400-417` | A measurement taken after work is admitted measures the wrong thing |
| Three zones — green / yellow / red | `:437-451` | Hysteresis as three real bands rather than two thresholds and a magic ratio |
| Red zone → **early return**, before any job is selected | `:425-435` | Refusing *dispatch* is the cheap half of shedding, and it costs nothing to be wrong about |
| A concurrency ceiling independent of the memory zone | `:453-472` | Memory pressure and job count are different problems; one ceiling for both hides both |

**Four defects, and every one of them is a design instruction rather than a bug
report.**

**1 — The thresholds are object literals wearing a config factory.**
`angular/backend/src/config/etl.config.ts:16-20` is
`memoryThresholds: { greenZone: 60, yellowZone: 80, redZone: 90 }` and `:21-23`
is `concurrency: { maxConcurrentJobs: 3 }`. These are `registerAs` factory
return values, so they are indistinguishable from defaults, they are not
env-driven at all, and they are the numbers that decide whether the process stops
working. §B6 forbids hardcoded thresholds; this is a service that reads the
environment for everything else and reads two literals for the two things that
matter.

**2 — A second copy of the thresholds, with `||` fallbacks, and the two copies
disagree.** `health-check.service.ts:129-130`:

```ts
const greenZone = parseInt(process.env.ETL_MEMORY_GREEN_ZONE) || 60;
const redZone   = parseInt(process.env.ETL_MEMORY_RED_ZONE)   || 90;
```

Three faults in two lines. The fallbacks **hardcode the same numbers a second
time, in a second file**, so an operator who changes one has changed one of two.
**`ETL_MEMORY_YELLOW_ZONE` does not exist**, and `:133-139` classifies
`healthy` / `degraded` / `unhealthy` on green and red only — so the health surface
has two thresholds, the dispatcher has three, and **the middle band is
unconfigurable and different between the two consumers.** And the same function
computes its ratio as `memUsage().heapUsed / os.totalmem()` (`:124-126`), which
is the trap §9B.2 is about, already latent in the reference implementation.

**3 — A failed measurement is reported as a healthy one.**
`getMemoryUtilization()` asks the metrics service for the current usage and on
**any** failure returns a constant — `job-queue.service.ts:1481-1484`, ending in
`return 50; // Return safe default value`. 50 is below the green zone of 60, so
**an unreadable memory figure opens the gate and dispatches at full
concurrency.** The comment calls it safe; it is the unsafe direction, and §2.3's
rule is that anything which catches must rethrow, surface, or record. This
design fails **stopped** on a missing or stale reading, and the difference
between the two is the entire subject of §9B.6.

**4 — The breaker is a branch inside the thing it protects.** `processQueue` is
the `@Cron` (`:392`) *and* the memory check *and* the dispatcher. The entire
breaker is the `return` at `:434`. Two consequences, both made structural in
§9B.6 rather than incidental: there is **no breaker object to consult**, so any
work started by any other route is ungated by construction and no test would
notice, because there is nothing to test; and there is **no state**, so no
`opened_at`, no cooldown, no hysteresis — one tick at 91 % and the next at 89 %
resumes full dispatch immediately.

**And a fifth thing in that tree that is not a breaker at all.**
`oauth-token-lifecycle.service.ts:275-287`:

```ts
async resetCircuitBreaker(tokenId, adminUser) {
  await this.ensureTokenPermission(adminUser.id, 'oauth:refresh');
  const result = await this.manualRefresh(tokenId, adminUser);
  return {
    success: result.success,
    tokenId,
    message: result.success ? 'Circuit breaker reset by successful refresh.' : …,
    wasInCooldown: true,               // :284
    previousFailureCount: undefined,   // :285
  };
}
```

**There is no breaker state in that service or anywhere else in the tree.**
`wasInCooldown: true` and `previousFailureCount: undefined` are **literals**,
returned in answer to questions the process is not keeping. There is a route for
it — `admin-oauth-token.controller.ts:108-112` — so an operator who calls it is
told, in a structured response, that the token *was* in cooldown and has just
been reset. Both halves are invented. This is §2.1's "looks finished and isn't"
in its purest form, and it is named here because a method called
`resetCircuitBreaker` is exactly the kind of thing an agent finds, believes, and
builds on.

**Why the reference can only GATE, and why this design can also STOP.** The early
return at `:434` refuses *dispatch*; nothing in the file can cancel a job already
running, and that is forced rather than lazy. homegrown-etl's work is GA4
extraction into object storage (`job-queue.service.ts:1033,1047`; the mount is
checked as S3 at `health-check.service.ts:196`, `freeSpace: 'unlimited', // S3
mounts typically don't have size limits`), and **a half-written object cannot be
recalled** — killing mid-flight leaves a truncated artefact that nothing
downstream can distinguish from a complete one. So GATE is the only honest lever
that design has. `angular_v2` has no such payload: its expensive work is a set of
database transactions (§9B.5), where an aborted transaction is indistinguishable
from one that never started. **A design that only GATEs here would be leaving
half the available lever unused while claiming the omission was forced.**

### 9B.1 Config — `.env` only, asserted at boot, no silent defaults

Six keys. **One list, and the list is the design.**

```
BREAKER_MEMORY_GREEN=60
BREAKER_MEMORY_YELLOW=80
BREAKER_MEMORY_RED=90
BREAKER_POLL_SECONDS=30
BREAKER_PROTECTED=auth.login,auth.refresh,auth.logout,auth.me,breaker.meter,breaker.gate
```

**The single-list decision: default-STOP, not default-run.**
`BREAKER_PROTECTED` is the list of what **keeps running**. Everything not named
in it is sheddable. There is deliberately **no `BREAKER_STOMPABLE`** and no
per-service opt-out, and the reason is a growth argument rather than a taste
difference:

- **The protected set is short and stable.** Four auth routes and two breaker
  jobs. It was complete the day it was written and nothing a forker does to this
  application changes it.
- **A stoppable list grows every time somebody adds async work**, and **every
  omission is silently unsheddable.** The new report job, the webhook fan-out,
  the nightly reconciliation: each is added to the queue, none is added to any
  list, and the failure is completely invisible — the job simply keeps running
  through a memory crisis while the breaker reports that crisis accurately to
  everybody else. **Default-STOP inverts it: the new thing needs a line in
  `.env`, and the review of that line is the control.** A list that must be
  edited to be safe is a control; a list that must be edited to be fast is a
  liability.

**The cost, stated plainly because it is the price and not a footnote: an
operator can never shed auth, even under total memory exhaustion, and that is
deliberate.** Shedding `auth.login` under an OOM is not load shedding — it is
converting a resource incident into an authentication outage for every user in
the installation, including the operator whose next action is to log in and fix
it. The template chooses to stay reachable. **A forker who disagrees deletes
`auth.login` from `BREAKER_PROTECTED`: one line, reviewed.** The exception is
available and visible, and the default is the safe one — which is the property
that makes it safe to hand the decision to a stranger.

**Boot validation, in the shape this tree already uses.** `src/config/environment.ts`
collects every problem into an array and throws **once**, naming all of them:
`EnvironmentError` at `:179-190`, `loadEnvironment` at `:764-785`. `readString`
(`:192-204`) treats a missing or empty value as a *problem*, never as a default —
which is exactly the rule homegrown-etl's `|| 60` breaks. `.env.example:6` already
states the house position in one line — *"There is no default for any of them"* —
and the breaker keys are asserted in the same place, so a misconfigured breaker
is one attributed boot failure rather than a rejection from inside module
initialisation where nothing explains what went wrong.

What is asserted:

- every key present and non-empty;
- all four thresholds are finite integers with **`1 ≤ GREEN < YELLOW < RED ≤ 100`**;
- `BREAKER_POLL_SECONDS ≥ 1`;
- every token in `BREAKER_PROTECTED` parses as a known `service.method` — **an
  unknown token is a boot error, not a warning**, because a typo'd route name in
  a protection list means the route it was supposed to protect is now sheddable,
  and that is the dangerous direction;
- no duplicate tokens.

**Why the ordering assertion is not pedantry — stated as the exact failure it
prevents.** `90/60/60` is the plausible copy-paste: green set to red, yellow left
where it was. It is not a syntax error. **It boots.** And it produces a breaker
where red is never above yellow and yellow is never above green, so the yellow
band is empty and the trip condition is reached at the same value as green — **a
breaker that never trips, on a machine reporting itself healthy, with no warning
anywhere.** That is §2.3's failure mode wearing a passing boot, and the only
defence is to refuse the configuration rather than observe it.

### 9B.2 "90% of WHAT" — the denominator, containers, and bare metal

A percentage threshold means nothing until the thing it is a percentage **of** is
named, and Node offers two candidates that are wrong in opposite directions.

**The trap, concretely.** Inside a container, `os.totalmem()` reports the
**host's** memory, not the container's — Node reads it from the host kernel and
there is no cgroup translation on that path. On a **256 MB container on a 128 GB
host**, the process can exhaust its entire limit and `used / totalmem` reads at
most `100 × 256 / 131072` = **0.195 %**. The ratio can never approach 90 %. The
breaker is not wrong at any individual instant — it is **structurally incapable
of tripping**, and it reports a healthy machine on the way down. The legacy tree
has the same bug latent and even names it: `system-health.service.ts:175-176`
says the memory measure is *"Host-wide, the analogue of `statfs` for RAM"*, and
"host-wide" is correct on bare metal and fatal in a container.

**Resolution order, first hit wins — and the limit and the numerator always come
from the same source.** Mixing a cgroup limit with a host-wide usage figure is
the same error with more steps.

1. **`/sys/fs/cgroup/memory.max`** (cgroup v2). Rejected if unreadable **or if it
   reads the literal string `max`** — v2 spells "no limit" as text, and
   `parseInt('max')` is `NaN`, which is §2.3's silent degradation wearing a
   number.
2. **cgroup v1**: `/sys/fs/cgroup/memory/<this process's memory cgroup>/memory.limit_in_bytes`,
   with the path resolved from `/proc/self/cgroup` rather than assumed. Rejected
   if unreadable **or if the value is the v1 "no limit" sentinel** — a number
   within a page of `2^63`.
3. **`os.totalmem()`**, with `os.totalmem() - os.freemem()` as the numerator.

**Verified on this machine — and the measurement changed the design:**

| Probe | Result |
|---|---|
| `/sys/fs/cgroup/memory.max` | **does not exist** — this host is **cgroup v1** only; there is no `/sys/fs/cgroup/unified` |
| `/sys/fs/cgroup/memory/memory.limit_in_bytes` | `9223372036854771712` — the v1 "no limit" sentinel (`2^63` rounded down to a page) |
| `/proc/self/cgroup` line `7:memory:/user.slice/user-1000.slice/user@1000.service` → `/sys/fs/cgroup/memory/user.slice/user-1000.slice/user@1000.service/memory.limit_in_bytes` | the same sentinel |
| `…/memory.usage_in_bytes` on that same leaf path | `2336964608` (2.18 GiB) |
| `os.totalmem()` | `6784069632` (6.3 GiB) |

So on this host the v1 limit **must be treated as absent**, the meter falls
through to `os.totalmem()`, and the reported percentage is `2.18 / 6.3` ≈ **35 %**.
Had the sentinel been accepted, the ratio would have been
`2336964608 / 9223372036854771712` = **0.0000000253 %**, and the breaker would
have read as perfectly healthy forever. **An unrecognised sentinel is the same
defect as a wrong denominator** — both produce a number that is arithmetically
correct and operationally useless — which is why the assertion is *"the limit is
finite and the percentage lands in 1–100"* and **never** *"the limit is greater
than zero."* Zero passes the second test and produces a division by zero.

**The chosen source is always reported**, as
`memory_source: 'cgroup_v2' | 'cgroup_v1' | 'host_totalmem'`. "90 %" is
meaningless to an operator who does not know what the 90 % is of, and the report
is the cheapest available way to tell them. Bare metal is this template's stated
deployment (§0: local Postgres, no containers), so the fallback is the *normal*
case and the cgroup path is the one a forker running under systemd or a
scheduler actually gets.

### 9B.3 Memory trips. Disk is measured, reported, and is never a trip input

**The rule: memory is the only trip input. Disk appears in the health surface as
a measurement and nothing else.**

The reasoning, in the order it actually convinced me:

1. **Disk exhaustion is not this application's problem, and treating it as one
   produces a control that cannot work.** The app cleans up its own logs and its
   own temp files. Everything else on the volume belongs to the operating system,
   to Postgres, or to the operator. The app can delete what it wrote; it cannot
   delete a full `/`, and the remedy for that is a human with `df -h` and a
   shell.
2. **A disk trip converts a condition with an obvious manual remedy into an
   automated refusal that hides the condition.** The operator's correct action is
   to free space. A breaker that trips first and refuses work second removes the
   operator's ability to act *while the condition is still true*, and does it
   with a message shaped like an application error that mentions no filesystem.
3. **The trip the app can actually make is "stop allocating",** and the only
   lever an application has over memory is *not starting new work*. That is
   precisely what GATE and STOP are (§9B.4). A disk trip asks the app to refuse
   work it was never the right party to refuse, using a lever it does not hold.

`statfs('.')` still runs. `bavail × bsize` is still reported — **`bavail`, not
`bfree`**, because `bfree` counts blocks reserved for root that this process may
not use, so it overstates the space actually available — because an operator
looking at a green memory line beside a red disk line has learned something real.
What disk **cannot** do is refuse a request, and the serialised health response
carries no field that would let it.

**The limitation, stated rather than papered over: `statfs` measures *this*
filesystem.** If Postgres is on another host, the disk number says nothing about
the database, and this application must never be described as protecting it.
What protects the database is `0007_resource_ceilings.sql` — `statement_timeout`,
`lock_timeout`, `idle_in_transaction_session_timeout` — because those sit below
both runtimes and cannot be forgotten by a Nest interceptor.

**What is being rejected here, and why.** The legacy `angular/` tree's health
service collapses its classification to one scalar: `system-health.service.ts:119`
calls `this.classify(percentage)` on the **disk** percentage, and `classify` at
`:158-172` maps that single number onto `NORMAL | WARNING | CRITICAL | PANIC`.
Memory is measured (`:174-193`, host-wide), shipped in the snapshot (`:126`), and
**never affects enforcement at all** — a completely saturated process reports
`NORMAL`.

That design is not rejected because disk was the wrong signal for the legacy's
job; it had disk artefacts to write. It is rejected because **one scalar answers
one question, and the questions here need two answers** (§9B.4): "refuse
everything that allocates" and "refuse nothing" are not the same verdict, and no
three-state enum carries both. The design consequence is mechanical rather than
aspirational: the trip set is a set of **named** signals with **named**
responses, the health DTO has **no aggregate severity field**, and the test that
asserts the field set by name makes adding one back a red test instead of a code
review opinion.

### 9B.4 Two responses, and the distinction between them is the whole point

|  | **GATE** | **STOP** |
|---|---|---|
| Meaning | **never start new work** | **abort work in flight** |
| Scope | **universal** — every breakable service, no configuration, no exceptions | only services that have declared themselves individually recoverable (§9B.5) |
| Applied to | every dispatch: route, cron, queue drain | each stoppable service's abort handle |
| What the caller gets | `202 Accepted`, the job id, the queue position | `202 Accepted` for the next attempt; the aborted attempt is **re-queued, not lost** |
| Configurable per call site? | **no** | **no** — it is a property of the service, proven by its acceptance test |
| Can an operator turn it off? | **no** | **no** |

**Both are dispatch gates. Neither is an HTTP error, and that is the sentence
that has to survive this section.** The request is accepted. It is queued. It has
a place in the queue and it will run when the condition clears. **It simply is
not running.** There is no `503`, no `429`, no `Retry-After`, and no
`Retry-After`-shaped error body.

**Why not a `503`, which is the obvious thing and is wrong.** A `503` says *your
request failed*. That is false — the request was accepted and is durably queued —
and it has three second-order costs that compound exactly when the machine is
least able to absorb them:

1. **Clients retry.** A retry storm is a *second* load peak on a process already
   at its limit, and it arrives at the one component whose job is admitting work.
2. **The caller has nothing to wait on.** A job id is a thing to poll; a `503` is
   a thing to give up on and page somebody about.
3. **It converts a resource incident into a client-visible failure**, so the
   operator's dashboard fills with errors that are not errors, and the signal
   that actually matters — memory at 94 % — has to compete with them for
   attention.

**GATE is universal, and that is a property rather than a simplification.** Every
breakable service is gated, with no configuration, **because a gate with an
opt-out is a gate with a support ticket behind it** — and the opt-out is always
added during the incident it was needed for, by the person least able to think
about consequences. `BREAKER_PROTECTED` (§9B.1) is the whole of the exception
surface, and it is a *protection* list, so an exception is **additive and
reviewed** rather than subtractive and forgotten.

**STOP is narrower on purpose, and the narrowing is done by a contract rather
than by a flag.** A service is stoppable because it exposes an abort handle that
leaves no partial state (§9B.5). There is no runtime setting that turns STOP on
for a service that does not have one, and no service that has one and is
excluded. **A flag makes "is this safe to abort?" a deployment-time opinion; a
contract makes it a compile-time fact with a test attached.** Those do not fail
the same way, and only one of them fails before production.

### 9B.5 The per-service recoverability contract

Every stoppable service declares whether it is recoverable, and the declaration
is backed by exactly one acceptance test:

> **"Aborting leaves no partial state."**

Three assertions, and all three are load-bearing:

1. **Abort mid-operation** — not before it starts, and not at the end.
2. **The observable state is exactly the pre-operation state, asserted by
   unfiltered owner count.** §B5's rule, and here it is not pedantry: a filtered
   count cannot distinguish *"nothing happened"* from *"I cannot see that it
   happened"*, so a service that writes under a policy the test's role cannot
   read would sail through a filtered assertion having done the entire
   operation.
3. **Re-running to completion reaches the same end state as an un-aborted run.**
   This is what separates **recoverable** from **restorable**: recoverable means
   the retry is an ordinary run, not a repair.

| Service | Recoverable? | Why, in one line each |
|---|---|---|
| **data export** | **Yes — idempotent and killable** | It reads tables and assembles an artefact; interrupted, it leaves no artefact and no row, and the retry reads the same rows |
| **erasure** | **Yes — but only because it is transactional** | The whole operation is one transaction (§9A.1, and §9A.3: claim, delete and mark-done together). An aborted erasure is **not a partial erasure; it is no erasure** |
| **purge** | **Yes — but only because it is transactional** | Same reason, and the same reason `lockedAt` does not exist in this design |
| **email send** | **Between sends only. Never mid-send.** | `email.service.ts:223` is the single `send()` path; `:260` is the transport call and `:262`/`:290` write the attempt record. Once the SMTP conversation has left the process the message is delivered, so aborting there yields a delivered-and-unrecorded email — worse than either outcome on its own |

**The clause doing the real work in that table is "only because it is
transactional", and it is a constraint on the design rather than a description
of it.** A `DELETE` inside a transaction that is aborted is not a partial
deletion; it is no deletion. **That is why §9A.3 puts the entire purge in one
transaction rather than three, and why any future split of it must be accompanied
by an explicit decision that the split services are no longer stoppable.** A
design that split the purge into claim / delete / mark-done would fail this
contract, and the honest response is to drop it from the STOP set — **not** to add
a compensating "partial" mode, because a breaker that can produce half a purge is
worse than one that cannot purge.

**Email's contract is narrower, and that is not a defect to be engineered away.**
The abort handle is checked **before** each send in a batch and **never** during
one. `EmailService` takes the signal, stores it, and checks it at the top of
`send()` — so a queued batch of fifty verification emails aborts cleanly after
message 12 and message 13 is never started, while message 12, if it was in
flight when the signal fired, completes and is recorded. **The guarantee is "no
half-sent email", not "no email escapes during an abort"**, and the second is not
available to anyone.

#### The trap this contract exists to prevent, named with its file and line

`angular/backend/src/modules/privacy/privacy.service.ts:209-213` constructs an
`AbortController` and arms `controller.abort()` at `:211`, and then calls
`provider.onDelete(userIdStr)` at `:217` — **with no signal.** The controller is
created, armed, and never wired. `privacy-housekeeping.service.ts:130` has the
same shape with `controller.signal` **passed** at `:161`, four lines away in the
same module: the delete path was written by copying the export path and dropping
the wiring.

**An `AbortController` that is constructed and not passed is not a timeout — it is
a comment.** It produces the complete *appearance* of a recoverable abort and
none of the behaviour, and it survives review because the surrounding code is
correct: `clearTimeout(timeout)` in the `finally` at `:230` looks like precisely
the cleanup a timeout needs. **No test at all stays green against it.** The
acceptance test above goes red, because aborting an unwired controller changes
nothing and the post-assertion finds the operation completed.

That is why this is a contract and not a review instruction, and why the signal is
a **required constructor parameter**: a service that *cannot* be constructed
without one cannot have this bug at all. AGENTS.md §3's rule applies — a
convention with no mechanical enforcement does not survive the next agent.

### 9B.6 The breaker cannot stop itself

`breaker.meter` and `breaker.gate` are both in `BREAKER_PROTECTED` (§9B.1), and
they are **two separate cron jobs on separate schedules**:

- **`breaker.meter`** ticks every `BREAKER_POLL_SECONDS`. It reads memory,
  computes the zone, and publishes `{ state, percent, opened_at, measured_at }`.
  **It never consults the gate and never asks whether anything is running.** If
  every stoppable service in the process has been stopped, this job still ticks
  and still publishes.
- **`breaker.gate`** ticks on its own interval. Its entire input is the meter's
  **last published** state. While that state is OPEN it enqueues nothing; in
  HALF_OPEN it admits exactly one probe; in CLOSED it admits normally. It
  performs **no measurement of its own.**

**The failure this prevents — stated as it actually occurs, not as it was
described to me.** The obvious version, *"stopping dispatch stops the
measurement"*, is **not** what homegrown-etl does, and writing that paragraph
without checking would have been an easy way to produce a confident and false
claim. Its `processQueue` measures at `:403` and takes the red-zone return at
`:434`, so the measurement always precedes the refusal: **stopping dispatch does
not stop the meter there.** What `job-queue.service.ts:392-398` actually gets
wrong is that the breaker **is a branch inside the thing it protects**:

- **There is no breaker object**, so there is nothing for any other code path to
  consult. A report job, a webhook fan-out, a nightly reconciliation — anything
  not dispatched by `processQueue` is **ungated by construction**, not by
  accident, and no test would notice because there is no gate to test.
- **There is no state**, so there is no `opened_at`, no cooldown and no
  hysteresis. One tick at 91 % and the next at 89 % resumes full dispatch
  immediately (§9B.0, defect 4; and §9B.7 for why that is the flap this design
  refuses).

**And here is the real latching failure, which is what this section is built
around.** If the meter ever stops ticking, the gate keeps reading the **last
published** value. If that value was CLOSED, the gate admits everything and **the
system latches open — running at full concurrency — until the process restarts**,
while the health surface cheerfully reports the last known percent. Nothing in
the system knows it is flying blind, because nothing in the system is checking
whether the reading is current.

Two mechanisms close that, and they are deliberately different kinds:

1. **Separating the two jobs** is what stops the meter from being stopped *in the
   first place* by the dispatch decision it makes.
2. **Protecting both in `BREAKER_PROTECTED`** is what stops anything else from
   stopping them — including a forker who adds a service to a stoppable list, and
   including an operator who disables a job to "unstick" a queue.
3. **The staleness rule is the belt to that pair of braces:** if the meter's
   `measured_at` is older than **`2 × BREAKER_POLL_SECONDS`**, the gate treats
   the reading as **unmeasured**, and **unmeasured fails STOPPED**. A monitor
   that cannot see the resource cannot claim the resource is fine. homegrown-etl's
   `return 50` (§9B.0, defect 3) is the opposite decision made silently, and it
   is the decision that produces a machine dispatching at full concurrency with
   no memory reading at all.

### 9B.7 Half-open recovery, or it either latches or flaps

`CLOSED → OPEN → HALF_OPEN → CLOSED | OPEN`. **One machine, because there is one
trip signal** (§9B.3).

- **CLOSED.** Below `GREEN`. Everything admitted. No cost on the request path
  beyond reading a boolean the meter already maintains.
- **OPEN.** At or above `RED`. **GATE everything; STOP every stoppable service.**
  `opened_at` recorded, once.
- **HALF_OPEN** is entered when **both** of these hold:
  `now - opened_at >= BREAKER_COOLDOWN_SECONDS` — a value that, unlike the three
  zone thresholds, belongs in configuration rather than as a named constant, and
  is asserted `> 0` — **and** the current reading is **below `YELLOW`**.
- **Both conditions, because neither alone is sufficient.** Time alone re-probes
  into the same spike on the tick after the cooldown expires. Reading alone
  re-probes on *every* tick during the spike, because a reading below `RED` in a
  rising trend is common and momentary. Together they mean **settled**, which is
  what a probe needs.
- **In HALF_OPEN, exactly one job is admitted.** Every other job stays gated.
  The probe completes → `CLOSED`, `opened_at` cleared, `recovered_at` recorded.
  The probe fails, aborts, or exceeds `BREAKER_PROBE_TIMEOUT_SECONDS` → back to
  `OPEN` with the cooldown restarting from now.

**Why cooldown-then-probe rather than probe-immediately.** Without the half-open
there are exactly two available behaviours and both are wrong:

- **Latch everything off** until restart, because the first dip below `RED`
  re-opens and no further admission is ever permitted. A thirty-second memory
  spike becomes an outage that needs a deploy to clear, on a machine with no
  deploy.
- **Flap** — admit everything the instant memory dips below `RED` for one
  reading, stop it again on the next. This is precisely what homegrown-etl does
  (§9B.6: no state, no cooldown), and its operator-visible consequence is a queue
  that fills and empties several times a minute with **no error, no alert and no
  counter**: the flap is invisible unless somebody was already counting.

**Why exactly one probe and not a fraction.** A breaker that re-admits *N* jobs
re-creates the load that tripped it. One is the only admission count that is safe
by construction, and "safe by construction" is the property worth having here. A
percentage of the previous concurrency is the same design with a rounding error
attached, and a rounding error in a load-shedding decision is a rounding error in
the wrong direction.

**Hysteresis is the yellow zone, and that is why there is no `CLEAR_RATIO` key.**
Green/yellow/red *is* three-band hysteresis written down. Requiring `< YELLOW` to
leave OPEN is the clear threshold, so there is one band to configure rather than
two thresholds plus a ratio somebody chose — and the middle band is a **real,
reportable state** an operator can see on the health surface instead of an
arithmetic constant with no name. The cost is that yellow is a zone an operator
has to understand rather than a number they can ignore; §9B.3 is where they learn
it and the health DTO's `zone` field is where they see it.

### 9B.8 Placement and sequencing

#### `APP_INTERCEPTOR`, after the global `APP_GUARD`

Registered in `app.module.ts` beside the existing `APP_GUARD`
(`app.module.ts:30`). Nest's request order is **middleware → guards →
interceptors → pipes → handler**, so `JwtAuthGuard` runs first.

**Why that order is right, and it is not tidiness.** A resource gate registered
*before* the auth guard would hand an unauthenticated caller a capacity verdict:
`503 — memory critical` tells a prober that the system is under pressure, and
**capacity is the reconnaissance that makes a follow-up attack cheaper.** With
the interceptor, an unauthenticated `POST /privacy/export` is `401` and reveals
nothing at all. §B5's `APP_GUARD` default-deny is doing security work here, not
merely authentication work — which is a reason to *understand* the ordering
before changing it, not a reason to change it.

**The limitation, stated rather than papered over: the breaker cannot fire during
an auth flood.** `POST /auth/login` is `@Public()` (`auth.controller.ts:17-18`),
it runs before any expensive work exists, and it is the one request that most
directly consumes the DB pool — and it is protected, so the gate admits it at
every zone including `red`. So **the attack the resource control is least suited
to is the one that pressures the resource it watches.** Three responses, all
taken explicitly:

1. **Accept it and say so.** This is a *resource* control, not a DoS control.
   DoS is §B6's job and it belongs at the reverse proxy.
2. **Use the control that does work inside the app.** The per-account
   progressive delay runs before the credential check (`throttle.ts:24`), keyed
   on account first and IP subnet second. That is the auth-flood control that is
   real here, and it is a per-account counter rather than a global rate limiter —
   `@nestjs/throttler` is **not** a dependency and there is **no global
   application-level rate limiter in `angular_v2` today.** That is a recorded gap
   in §B6's baseline, not a claim that the requirement is met.
3. **Refuse the tempting fix.** Moving the breaker to a guard to "catch the
   flood" reintroduces exactly the oracle in the paragraph above. **An
   information disclosure to unauthenticated callers is a worse outcome than an
   un-gated flood**, which a proxy can absorb and this application cannot. The
   trade is refused on purpose and recorded here so nobody re-litigates it by
   accident.

**And once more, because this is where the scope gets misread:** as an
`APP_INTERCEPTOR` the breaker sees **only the thin app's routes**. It does not
see PostgREST, and no placement choice inside Nest changes that (§9B.0).

#### The schedule library, and what it is sequenced against

**`@nestjs/schedule` is not a dependency.** `backend/package.json:32-47` lists
`@nestjs/common`, `@nestjs/config`, `@nestjs/core`, `@nestjs/jwt`,
`@nestjs/platform-fastify`, `@nestjs/swagger`, `bcrypt`, `class-transformer`,
`class-validator`, `handlebars`, `nodemailer`, `pg`, `reflect-metadata`, `rxjs` —
and neither `@nestjs/schedule` nor `@nestjs/throttler` is among them. Neither is
`@Cron` used anywhere in `src/`.

**So it is a new dependency, and it lands WITH the first breakable job — not
before.** Two reasons, and the second is the one that bites:

1. **A breaker guarding nothing is §2.1's "looks finished and isn't" in its
   purest form.** A green health surface, a trip set, a state machine, and zero
   services for any of it to apply to is a mechanism that reads as complete and
   does nothing.
2. **`@Cron` registers its handler during module initialisation** —
   `OnModuleInit`, which Nest runs **before** `OnApplicationBootstrap`. So a
   meter registered with `@Cron` can take its first reading **before the breaker
   configuration has been asserted**, which for a control whose entire value
   proposition is refusing bad configuration is precisely the wrong order.
   §9A.3 reached the same conclusion for the sweeper from the other direction — a
   plain `unref()`ed interval started in `onApplicationBootstrap` is strictly
   later, and is the recommendation there. **The two jobs share one lifecycle and
   therefore must share one answer, and the meter must not be the one that is
   early.**

#### `angular_v2` has zero background work today

Verified against the tree: `backend/src/` is 28 `.ts` files across `auth/`,
`config/`, `email/` and the two module roots, and contains **one** `@Controller`
(`auth.controller.ts:13`). A search for `setInterval`, `@Cron`, `@Interval` and
`onApplicationBootstrap` across `src/` returns **nothing**; the only `setTimeout`
in the tree is the one-shot login delay at `auth.service.ts:116` —
`await new Promise<void>((resolve) => setTimeout(resolve, gate.delayMs))` — which
waits out a throttle delay and returns.

**So there is no job for the meter to meter and no interval for it to tick on.**
That is a finding, not a gap: it means the breaker cannot ship ahead of the work
it protects, and it is the entire reason the sequencing rule above exists rather
than being an ordering preference.

### 9B.9 The breakable set is small, and that is a finding

**The thin app serves exactly four routes, and every one of them is protected.**

| Route | `auth.controller.ts` | `@Public()` | Breakable? |
|---|---|---|---|
| `POST /auth/login` | `:17-19` | yes | **No** — the door |
| `POST /auth/refresh` | `:27-28` | yes | **No** — the cheapest authenticated operation, and the one keeping existing sessions alive; refusing it turns a resource incident into an authentication outage for everyone |
| `POST /auth/logout` | `:34-35` | yes | **No** — one row, one round trip |
| `GET /auth/me` | `:41` | no | **No** — one row, one round trip |

`@Controller('auth')` at `:13` is the only `@Controller` in `backend/src/` — one
match, verified. **The breakable set is therefore empty**, which is why §9B.8
sequences the schedule dependency with the first breakable job rather than after
it.

**The stoppable set is the privacy and email work — four services, three of which
do not exist yet.** Recording it as intended breakables with an existence column
is the honest shape; a table implying they are already in the tree is §2.1.

| Service | Stoppable? | Recoverability (§9B.5) | In the tree? |
|---|---|---|---|
| **data export** | yes | idempotent, killable | **No** — deferred, §9.7 Q3 |
| **erasure** (`POST /privacy/erase`) | yes | transactional | **No** — W44 |
| **purge sweeper** | yes | transactional | **No** — W50 |
| **email send** | yes | **between sends only** | **Yes** — `src/email/email.service.ts:223` |

The one that exists is the one with the narrowest contract, and that is not a
coincidence: it is the only one with a side effect the process cannot take back.

### 9B.10 Work items

Continues the series. **`W56`–`W64` are withdrawn** with the rewrite of this
section; the highest number in use before this table is **W66** (§9A.7), so this
runs **W67**–**W74**.

| ID | Phase | Work | Verified by |
|---|---|---|---|
| W67 | N3 | The `BREAKER_*` namespace in `src/config/environment.ts`, read and asserted in the existing `EnvironmentError` shape (`:179-190`, `loadEnvironment` at `:764-785`). All six keys present; `1 ≤ GREEN < YELLOW < RED ≤ 100`; `POLL_SECONDS ≥ 1`; every `BREAKER_PROTECTED` token parses as a known `service.method`; no duplicates. **No default for any key anywhere in the file** | `npm test` (step 4). Named: ***`GREEN=90 YELLOW=60 RED=60` fails the boot naming all three*** — the copy-paste that would otherwise yield a breaker which never trips; *`GREEN=60 YELLOW=80 RED=95` boots*; *an unknown token in `BREAKER_PROTECTED` fails the boot*; *an absent key fails the boot*, because `.env.example:6` already commits to "there is no default for any of them" and §2.3 forbids a fallback that masks a missing config |
| W68 | N3 | `MemoryMeter` — resolves the denominator per §9B.2 in order (v2 `memory.max`, rejecting the literal `max`; v1 `memory.limit_in_bytes` for **this process's** cgroup resolved from `/proc/self/cgroup`, rejecting the `2^63` sentinel; then `os.totalmem()`), takes the numerator from the **same** source, and reports `memory_source` | `npm test` (step 4), against a **fixture directory of fake cgroup roots**, so neither a container nor a host is needed to exercise either path. Named: ***given `memory.limit_in_bytes = 9223372036854771712` the meter reports `host_totalmem` and a ratio of ~35 %, not 0.0000000253 %*** — the two literal values measured on this host; *given a `memory.max` containing the string `max` the meter falls through*; *a cgroup limit of 0 is rejected, because it would divide by zero* |
| W69 | N3 | The breaker: one state machine (§9B.7), **GATE universal and unconfigurable**, **STOP restricted to services declaring recoverability**, and `AbortSignal` as a **required constructor parameter** on every stoppable service — stored and passed down, never constructed-and-dropped (§9B.5). Enforcement is mechanical per AGENTS.md §3: an ESLint rule over the stoppable services' constructors | `npm test` (step 4), per service, on the three §9B.5 assertions: abort mid-operation → observable state equals the pre-operation state **by unfiltered owner count**; re-run to completion reaches the un-aborted end state. Named: **"an `AbortController` that is constructed and never passed leaves no partial state — because it does nothing at all"**, which is the `privacy.service.ts:209-217` shape and goes red the moment that test exists. The lint rule is asserted by `test/unit/eslint-baseline.spec.ts`, which already fails if a listed rule is inactive |
| W70 | N3 | `ScheduleModule.forRoot()` and **two separate jobs** — `breaker.meter` on `BREAKER_POLL_SECONDS`, `breaker.gate` on its own interval — both named in `BREAKER_PROTECTED`, all in the **same change** as W69 and as the first breakable service (§9B.8). The gate fails **stopped** on a reading older than `2 × BREAKER_POLL_SECONDS` | `npm test` (step 4) with a fake clock. Named: **"stopping every stoppable service does not stop the meter — the reading keeps advancing"** (§9B.6); **"a meter that has not published for `2 × POLL_SECONDS` gates rather than admits"** — the latch-open failure; **"an unreadable memory figure gates; it never returns a safe default"** — homegrown-etl's `return 50` at `job-queue.service.ts:1483`, named so nobody reinvents it |
| W71 | N3 | `BREAKER_PROTECTED` enforced in the gate: a protected service is admitted at **every** zone including `RED`, **and its pressure is still reported** | `npm run test:e2e`. Named: ***"with the breaker OPEN at 99 %, `POST /auth/login` is admitted and the health surface still reports 99 %"*** — **bypass stops BLOCKING; it never stops REPORTING.** An override that removes the only instrument makes overriding unsurvivable, which is the legacy's real residual defect (`system-health.service.ts:79-86` warned about exactly this in a comment) |
| W72 | N3 | `GET /admin/system-health` plus a dedicated `system_health:read` permission row (migration **and** seed, both `ON CONFLICT DO NOTHING`): `memory` with `used` / `limit` / `percent` / `source` / `zone` / `measured_at`; `disk` with `free_bytes` and `free_ratio` **reported and never a trip input**; `breaker` with `state` / `opened_at` / `since` / `gated` / `stopped`. **No aggregate `status` field** | `npm test` (step 4) for the DTO, **asserted on the key set** so adding a `status` back makes the suite red — that assertion is what keeps §9B.3's "no collapse to one scalar" mechanical rather than aspirational. `npm run test:e2e` for the gate: a caller holding `user:read` and not `system_health:read` receives `403` **and an empty body**, and the service re-checks `has_permission(actor, 'system_health', 'read')` before assembling anything, because a guard is application code and §B2's governing claim is that RLS is not |
| W73 | N2 | Amend `0007_resource_ceilings.sql:6-12`, whose *"An application-level gate would cover four auth routes, report itself Healthy, and gate nothing anyone could attack"* is **half wrong**: the process boundary it names is load-bearing, the conclusion drawn from it is not, and §9B is the app-level gate it foreclosed. Narrow the sentence to what is true (§9B.0) | `grep -n 'gate nothing anyone could attack' backend/database/migrations/0007_resource_ceilings.sql` returns nothing. Mechanical and scriptable, so it becomes a `verify` step like §6.6's greps — **the alternative is a review item that decays** |
| W74 | ALL | Record §9B in `docs/security.md` and `docs/architecture.md`. **Neither file currently mentions a breaker at all**, which is why the design's only written record is the `0007` comment and this file — and why that comment could read as a blanket "does not port" for as long as it did. Add the `BREAKER_*` block to `.env.example` with values and to `.env.production.example` **present and blank**, so a reader learns the keys exist and there is no value to copy | **No automated step for the prose** — asserted instead by **W73's grep**, which covers the one artefact that is actually wrong today. Listed as a review item rather than dressed up as a gate, the same honesty as W55 |

### 9B.11 Deferred, and why — three items that are decisions rather than gaps

**1. Per-verb and per-route gating at the database.** *"Block exports, allow
reads, refuse writes"* cannot be expressed here. PostgREST is a **separate
process** (§9B.0), so no Nest interceptor reaches it; `db-pre-request` runs in a
**read-only transaction**, so it can neither throttle nor deny; and the only tier
that can is a **reverse proxy, which is not in this tree** — `.env.example` ships
none (`grep -i 'proxy\|nginx\|caddy' .env.example .env.production.example`
returns nothing). Recorded with its owner rather than left implicit, because §9B
is otherwise read as covering more than it does; `0007_resource_ceilings.sql:68-72`
already says the same thing about the tiers below this one.

**2. `temp_file_limit`.** `PGC_SUSET` — PostgreSQL 18 reports it as `superuser`
context, and the migration role is deliberately **not** a superuser, so a
migration cannot set it. It belongs in `database/bootstrap/001_roles.sql` with
the same cluster-scoped reasoning §B1 already records for the escalation
`GRANT`, and only if that file is run as a superuser.
`0007_resource_ceilings.sql:56-66` already records it as a known, documented gap
rather than a setting that silently does nothing; it is listed here for the same
reason — so nobody re-derives it from `PGC_SUSET` and concludes it was forgotten.

**3. Global Privacy Control.** GPC is a browser signal this application has no
way to honour and no obligation to honour. Implementing it in a template with no
marketing, no analytics and no third-party processing would be **a consent
framework for processing this template does not perform** — the same objection
§9.7 Q2 records for the four consent columns. It appears in no config key, no
route and no health field. Noted so its absence is a decision on the record
rather than an oversight waiting to be found.

### 9B.12 As built — 2026-10-14

> Read this before §9B.0–§9B.11. They are the plan of 2026-10-12 and are left
> that way. **The design landed.** The trip set, the state machine, the
> GATE/STOP distinction, `BREAKER_PROTECTED` as the whole exception surface, the
> cgroup resolution order with both sentinels rejected, and *disk is measured and
> reported and never a trip input* are all the mechanism §9B describes — ADR-0027
> records that decision and is the record `0007_resource_ceilings.sql` already
> forward-references. What follows is the four things that are not what this
> section said, and the one thing it could not have predicted.

#### 9B.12.1 The cold-start window — the defect this plan caused, and it broke a committed test

**§9B.6's staleness rule, applied exactly as written, refused every non-protected
dispatch with `202` for the first thirty seconds of every process's life.**

The rule as specified is *"if the meter's `measured_at` is older than `2 ×
BREAKER_POLL_SECONDS`, the gate treats the reading as **unmeasured**, and
**unmeasured fails STOPPED**."* The shipped implementation read that faithfully —
and then had to break it, because the plan never asked what `measured_at` is
**before the first reading has been taken**. There is none. So the pre-measurement
state was indistinguishable from a dead meter, `initialBreakerState()` answered
`stale: true` beside `sample: null`, and:

- `BREAKER_POLL_SECONDS` defaults to 30, and the meter's first publication was one
  whole interval after boot;
- between process start and that tick, **every non-protected dispatch site was
  refused** — `202 Accepted`, `queued: false`, handler never started — on a machine
  under **no** memory pressure whatsoever;
- it was the breaker's own cold boot that turned a committed, previously-green
  `test/e2e/email.e2e-spec.ts` **red**: a request arriving 300 ms after `init()`
  found a gate that had measured nothing, and the fixture route — a `@Controller`
  in a test module, therefore *not* in `BREAKER_PROTECTED` — was shed.

**The fix is two decisions, and the first is the one the plan was missing.**

1. **`sample === null` is its own condition, distinct from `stale`, and it is not a
   refusal.** `isStale(null, …)` answers `false` on purpose: nothing has been
   measured, so nothing can have gone quiet. Those are different faults — an
   instrument that has *died* versus one that has not *spoken yet* — and the
   dead-instrument refusal now lives on a sample that **exists** and has aged past
   the window. `decideDispatch` decides the never-measured case explicitly, before
   anything else, and admits it **only** while `mode === 'closed'`; a state that
   somehow claimed to be open with nothing measured is refused rather than admitted
   on the strength of an assumption. A meter that runs and cannot produce a figure
   publishes `usable: false` — never `null` — and **is** refused.
2. **The first reading is taken during bootstrap, before the interval exists.**
   `BreakerMeter.onApplicationBootstrap` is `async` and `await`s one `tick()`
   before it registers anything; Nest awaits every bootstrap hook before it opens
   the listener, so "never measured" is a state *before an app can serve a request
   over HTTP*, not a state it serves from. It is `tick()` and not a cheaper
   separate publication, because a second publication path is a second mechanism
   for one job (§2.4) and it would drift from the one that runs every 30 s after
   it.

**And it went in the meter rather than at the gate, for the reason §9B.6 is built
around.** Sampling on the way to dispatch is the exact defect the separate-meter
design exists to prevent: the gate would then measure, and a gate that measures is a
gate that can only observe what it lets through. This job takes its reading whether
or not anything is being dispatched. It costs one `tick()` per process, before
`listen()`: `resolveMemoryReading` is synchronous over at most four small files and
`statfs` is one syscall on a path Node has already opened.

The **generalisation**, which is the part worth carrying forward: *a
fail-closed rule needs a statement about the state it does not cover.* "No reading
is stale" and "no reading is healthy" are different sentences, and collapsing them
produces a control that fails **stopped** on a perfectly healthy machine that has
not finished starting.

#### 9B.12.2 Where §9B's stated mechanism is not what shipped

**(1) The config namespace is seven keys, not six.** §9B.1 lists `GREEN`, `YELLOW`,
`RED`, `POLL_SECONDS` and `PROTECTED`. Shipped: those **plus**
`BREAKER_COOLDOWN_SECONDS` (default 120) and `BREAKER_PROBE_TIMEOUT_SECONDS`
(default 60) — the two values §9B.7's state machine needs and §9B.1's list omitted,
which is why W67 says "all six keys" and the code requires seven.

**It is also not in `src/config/environment.ts`.** §9B.1 and W67 both put the
`BREAKER_*` namespace in the existing `EnvironmentError` shape, and both are wrong
about the mechanism for a good reason: `test/unit/environment.spec.ts` asserts
`Environment` key-for-key with a `toEqual` over the whole object, and extending
that shape meant editing a test this change did not own. So the breaker has its own
loader — `loadBreakerEnvironment()` in `src/breaker/breaker-environment.ts`, with
its own `BreakerEnvironmentError` — called from `app.module.ts` beside
`loadEnvironment`, **at module-evaluation time, before `ConfigModule.forRoot()`**.
Same moment, same shape, same reason; one namespace that refuses to be extended by
someone else's test is the smaller change, and the comment in the file says exactly
that rather than pretending the original plan was followed.

Everything else in W67 shipped and is asserted: every key required with **no
default**, `1 ≤ GREEN < YELLOW < RED ≤ 100`, an ordering violation failing the boot
with all three named, `POLL_SECONDS ≥ 1`, and every `BREAKER_PROTECTED` entry
parsed as a `service.method` **and** resolved against `KNOWN_DISPATCH_TOKENS`, with
duplicates refused. **The two operational sweeper keys are the documented
exception** — `PURGE_POLL_SECONDS`, `PURGE_DRAIN_BUDGET` and
`RETENTION_PURGE_MAX_ATTEMPTS` carry defaults, because they are scheduling facts
rather than decisions, and `SECURITY_DELAY_SCHEDULE_SECONDS` already sets that
precedent for the same reason.

**(2) The schedule library was added after all — see §9A.8.2 (1).** §9B.8's
"`@nestjs/schedule` is not a dependency" is false; `@nestjs/schedule@12` is. The
argument it makes about `@Cron` is **correct and was honoured**: neither
`breaker.meter`, `breaker.gate` nor `purge.sweeper` uses `@Cron`. Each registers a
plain `unref()`ed `setInterval` in `onApplicationBootstrap` and hands the handle to
`SchedulerRegistry`, which is how the plan's ordering requirement and a named
lifecycle are both satisfied. (v12, not v6 — v6 peers on Nest 10/11 and this tree is
Nest 12.)

**(3) The gate's schedule is a constant offset, not a configured key.** §9B.6 says
the two jobs are "two separate cron jobs on separate schedules". Shipped: the gate's
period is `pollSeconds × 1000 + GATE_INTERVAL_OFFSET_MS` (7,000 ms) — a named
constant, not a second key, because "a second key is a second number to get wrong,
and this one changes no decision". The offset is deliberately **not** a multiple of
the meter period, so the two do not land together and the gate does not always read
a reading that is up to a full poll interval old.

**(4) There is a third job and a fourth, and together they are the whole breakable
set.** §9B.8 says *"`angular_v2` has zero background work today"* and §9B.9 says
*"the breakable set is therefore empty"*. Shipped: **four** registered intervals —
`breaker.meter`, `breaker.gate`, **`purge.sweeper`** and **`purge.enqueuer`** — and
neither of the last two is in `BREAKER_PROTECTED`. So:

- the breakable set is exactly **{ `purge.sweeper`, `purge.enqueuer` }**, and the
  interceptor's refusal branch still has **no runtime exercise at all**, because
  all four thin-app routes are named in `BREAKER_PROTECTED` and therefore admitted
  at every zone;
- which means W71's named e2e assertion (*"with the breaker OPEN at 99 %,
  `POST /auth/login` is admitted and the health surface still reports 99 %"*) has no
  HTTP-level exercise, and the job dispatcher is what exercises GATE. The unit
  suite covers it with a fake clock instead.

**Both breakable jobs are absent from the protected list deliberately, and the
reason differs between them.** `purge.sweeper` drains the queue; `purge.enqueuer`
fills it (`0016`). Neither has a caller waiting, so shedding either under memory
pressure is correct behaviour rather than a gap, and **the four tokens an operator
would expect to find there are all request-path or instrument work**: the four
`auth.*` routes, plus `breaker.meter` and `breaker.gate`. ADR-0031 §Consequences
records the enqueuer's case in full, and
`test/unit/purge/purge-enqueuer-scheduling.spec.ts` asserts the omission against
the `.env*` files themselves — so "fixing" it is a decision somebody has to take
deliberately rather than a line they have to notice.

§9B.9's four-row table of *stoppable* services is also out of date in the same
direction: **the two retention jobs are the stoppable services that exist**, both
because each one's whole operation is one transaction, and they are the only
stoppable dispatches in the tree. `data export`, `erasure` and `email send` are
still exactly as the table says — two deferred, one present but not wired to a
signal.

**(5) The health surface is a snapshot builder and a log line, not a route.** W72
asks for `GET /admin/system-health` plus a `system_health:read` permission row in a
migration and the seed. Shipped: `buildHealthSnapshot()` in
`src/breaker/breaker-health.ts` produces the DTO with **no aggregate `status`
field**, `test/unit/breaker/breaker-health.spec.ts` asserts that key set by name
(which is what makes "no collapse to one scalar" mechanical rather than
aspirational), and the meter emits the snapshot as **one structured log line every
tick**. **No route, no controller and no permission row** — and `breaker-health.ts`
argues the choice at length: the thin app's routes are authenticated but not
authorized, so a `system_health:read` check would have to live in the thin app too,
which is a migration this change may not write, and shipping the route first would
put every member's memory pressure on the wire. W72 remains the work item, and it
correctly names the permission row it needs.

The field names differ from W72's by snake_case-in-the-DTO rather than by design:
`breaker` carries `state`, `opened_at`, `since_seconds`, `gated_dispatches`,
`stopped_dispatches`, `stale_reading`, `probe_in_flight` and `protected`
(the last echoes the exemption list back, so an operator can see *which* sites are
exempt at this moment).

#### 9B.12.3 Two things the plan got right for the wrong reason, and one claim that is simply false

**Right for the wrong reason — "the reference implementation gets away with
GATE-only".** §9B.0 argues that homegrown-etl can only GATE because a half-written
S3 object cannot be recalled, and that `angular_v2` has no such payload so it can
also STOP. That is still true and still the right trade. But §9B.5's stoppable set
turned out to be **one service, and it is recoverable for a reason the plan
predicted exactly**: the purge is one transaction, so an abort is not a partial
purge. The prediction held on the first implementation attempt, which is rarer than
it sounds and is the strongest thing in this section.

**Right for the wrong reason — the ESLint rule.** W69 asks for "an ESLint rule over
the stoppable services' constructors". What shipped is narrower and better: a
`no-restricted-syntax` ban on `new AbortController()` in **every** `src/**/*.ts`
except `src/breaker/breaker-gate.ts`, which does not check a constructor argument
at all — it makes the *shape* unrepresentable. The sweeper takes the signal off the
dispatch lease the gate handed it, so a controller constructed and not passed on
cannot be written, rather than merely being untested. That is the `privacy.service.ts:209-217`
defect (§9B.5's named trap) made impossible by the type system and the linter
together.

**Simply false — "`@Public()` means the interceptor never executes".** §9B.8 said
*"the interceptor never executes for it"* about `POST /auth/login`. **That is not
how Nest works, and it is corrected inline where it stood.** `@Public()` makes
`JwtAuthGuard` return immediately; it does not short-circuit the chain. The
interceptor runs, calls the gate, and is **admitted** — because `auth.login` is in
`BREAKER_PROTECTED`. The conclusion of that paragraph is unchanged (the breaker does
not shed the auth flood) and the shipped outcome is the same, but the mechanism was
wrong in a way that would have misled the next reader into believing public routes
are exempt from global interceptors. They are not.

#### 9B.12.4 `KNOWN_DISPATCH_TOKENS` is not a route census, and there is no coverage gate

**A route added without a line in `KNOWN_DISPATCH_TOKENS` is silently sheddable.**
`dispatchTokenForRoute()` returns `undefined` for anything this build cannot name;
no code path and no test walks the mounted routes and compares them. An earlier
version of that file's comment claimed a route added without a line *"fails the
boot"* — **nothing implemented that**, and the comment has been replaced with what
actually happens.

The one-directional check that **does** exist is the other way round:
`loadBreakerEnvironment()` refuses a `BREAKER_PROTECTED` entry that names no
dispatch site, so a typo in the *protection list* is a boot error. That catches
"you meant to protect this and misspelled it". It cannot catch "you added a route
and never named it".

**The obvious gate — a boot-time walk of the mounted routes — was not built, and
the reason is worth recording so it is not proposed as a one-liner.**
`test/e2e/email.e2e-spec.ts` mounts `EmailProbeController` into `AppModule`, and
by the same construction that is a dispatch site: the global interceptor really does
run on it, and it is what the cold-start defect broke. A gate that treats a test
route as a dispatch site fails the boot of a legitimate fixture, and the only two
ways to make it pass are the two that are refused:

- **add the fixture's routes to `BREAKER_PROTECTED`** — which makes the symptom
  vanish while the real defect, that no route is ever checked, stays exactly where
  it was, and makes a test controller permanently exempt in production too; or
- **exempt test environments** — a `NODE_ENV` branch around a security control, and
  therefore a silent weakening (§2.3).

So the honest statement, and the one now in the file: **a new route is breakable
until somebody names it, on purpose.** It is a review item and is recorded as one
rather than dressed up as a gate — the same honesty W55 and W74 already use.

#### 9B.12.5 Status of the work items in §9B.10

| ID | Status as of 2026-10-14 |
|---|---|
| W67 | **SHIPPED, relocated.** Seven keys rather than six (§9B.12.2 (1)), in `src/breaker/breaker-environment.ts` rather than `src/config/environment.ts`, called from `app.module.ts` at module-evaluation time. All five assertions hold. |
| W68 | **SHIPPED.** `resolveMemoryReading()` in `src/breaker/memory-reading.ts`, against injectable probe dependencies so the suite drives a **fixture cgroup root** rather than the host. Both sentinels rejected: the literal string `max`, and `CGROUP_V1_UNLIMITED_BYTES = 2**63 − PAGE_BYTES`. **§9B.2's "verified on this machine" table still reproduces exactly** — no `/sys/fs/cgroup/memory.max`, `memory.limit_in_bytes` = `9223372036854771712`, `os.totalmem()` = `6784069632`. `memory_source` is reported as `cgroup_v2 \| cgroup_v1 \| host_totalmem` and the value is a `STABLE` breaker health field. |
| W69 | **SHIPPED**, with a different and better enforcement mechanism (§9B.12.3). `decideDispatch()` recomputes staleness itself and never trusts a cached flag; `expireProbe()` is an addition the plan did not ask for — a half-open probe that never reported would otherwise latch forever with no admission and no alarm. |
| W70 | **SHIPPED**, with the cold-start fix the plan did not ask for and could not have predicted (§9B.12.1). Both jobs are separate, named, `unref()`ed, registry-registered, and protected. The gate **fails stopped on a stale reading**; it **admits a never-measured one**, which is the correction. |
| W71 | **SHIPPED in the gate**; `decideDispatch()` admits a protected token at every zone and `buildHealthSnapshot()` still reports the pressure, including `breaker.protected` echoing the exemption list back. **No e2e assertion** — with all four routes protected the refusal branch is unreachable over HTTP (§9B.12.2 (4)). |
| W72 | **HALF.** The snapshot and the no-aggregate-`status` assertion shipped. The route, the controller and the `system_health:read` permission row did not, for the reason the shipped file argues in full. |
| W73 | **NOT LANDED, and out of this change's ownership.** `0007_resource_ceilings.sql:6-12` still reads *"An application-level gate would cover four auth routes, report itself Healthy, and gate nothing anyone could attack"* — half wrong, exactly as §9B.0 says, now that the app-level gate exists and the thin app serves four routes plus four jobs (`breaker.meter`, `breaker.gate`, `purge.sweeper`, `purge.enqueuer`). **ADR-0027 is now the record that file forward-references**, so half of W73 is answered by the ADR and the other half — the amended comment and its `grep` — is still open. |
| W74 | **PARTIAL.** `architecture.md`'s `src/` tree was corrected in this change (it named a `privacy/` directory that does not exist and omitted `breaker/` and `purge/`). **`docs/security.md` still does not mention the breaker, a privacy module or a purge queue at all**, which is the actual substance of W74 and it is still open. The `.env` blocks shipped with values in both files; W74 asked for `.env.production.example` to be **present and blank**, and it is not blank. |
