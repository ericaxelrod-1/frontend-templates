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

Adding a resource becomes **two** artifacts — a table (or view) and an RLS
policy — instead of five: DTO, entity, controller, service, module registration.

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
| `postgrest.conf` | **NEW** | DB role, `db-schemas`, `db-anon-role`, and the JWT role-claim mapping and `jwt-role-claim-key`. This is where JWT → identity reaches the policies |
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
DTO below is **DELETE, not REWRITE** — PostgREST serves those routes from tables
and views. What survives in Nest is only the logic PostgREST cannot express:
algorithms, secrets, sockets, schedules.

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
| **`permissions/`** | 71 | **SPLIT THREE WAYS by ADR-0023 — see the table below** |

Under ADR-0023 this module has not one disposition but three, because it
conflated the three authorization axes. Splitting it is the largest single win in
the rebase:

| What it did | Axis | Where it goes | Disposition |
|---|---|---|---|
| Injected row filters from group membership | Scope | `CREATE POLICY` migrations | **DELETE** — no application code writes scoping SQL |
| Gated endpoints by role | Operation | table + column `GRANT`s | **DELETE** — grants withhold the verb in the database |
| Gated endpoints by capability role | Feature | thin-app guards | **KEEP, rewritten** — the only axis that reads a capability role |
| Managed RLS rule/scope templates | Feature (admin) | thin app | **KEEP** — it *writes* policies, so it cannot go with them |
| Compiled join paths for policies | Scope | thin app + migrations | **KEEP** — genuine logic, with a spec |
| CRUD over actions, permissions, grants | — | tables | **DELETE** — PostgREST serves them |
| `actions.controller.ts` (top level) | | **DELETE** — duplicate of `controllers/actions.controller.ts` |
| `controllers/actions.controller.ts` | | **DELETE** — becomes an `actions` table; PostgREST serves it. Resolves the `/permissions/actions` collision by deleting both |
| `controllers/permissions.controller.ts` | | **DELETE** — becomes `permissions` + `role_permissions` tables. Resolves the 6 frontend 404s because the spec regenerates |
| `controllers/resources.controller.ts` | | **DELETE** — becomes a `resources` table |
| `controllers/permission-inspector.controller.ts` | | **DELETE** — becomes a view or a PostgREST embedding (`?select=*,roles(*)`). Kills the `/user/{id}` vs `/users/{id}` mismatch |
| `controllers/rls-rules.controller.ts` | | **DELETE** |
| `controllers/rls-*.controller.ts` (3) | | **REWRITE** — admin CRUD over RLS templates; RLS enforcement itself moves to SQL |
| `controllers/cache-sync.controller.ts` | | **DELETE** with the cache subsystem |
| `cache-entities/*` (4 + index) | | **DELETE** — cache-on-database is the wrong mechanism; use a computed/invalidation strategy |
| `guards/permission.guard.ts` (×2) | | **DELETE both** — two classes, and neither was ever applied. Verb-level access becomes table `GRANT`s (`GRANT SELECT, INSERT ... TO app_member` withholds UPDATE/DELETE at the database), which PostgREST cannot bypass. A *new* capability guard, keyed on capability role and applied only to thin-app routes, replaces them — see `Feature` in ADR-0023 |
| `decorators/require-permission*.ts` (2) | | **DELETE both as written** — they guard CRUD routes, which grants now govern, and they were never applied. Kills the 3-decorator / 2-`PERMISSIONS_KEY` drift. **Write exactly one replacement**, keyed on capability role, registered on the thin app only |
| `dtos/*.ts` (7) | | **DELETE** — replaced by PostgREST's generated types |
| `entities/*.ts` | | **REWRITE** — become table definitions in migrations |
| `scope-compiler.service.ts` | | **KEEP** — genuine logic; compiles join paths for the RLS policy generator; add spec |
| `rls-rule.service.ts`, `rls-scope-template.service.ts` | | **KEEP + REWRITE** — the admin surface that *writes policies* stays in Nest; the policy *evaluation* moves to SQL |
| `permissions.service.ts` (2,353 lines) | | **DELETE** — the single biggest deletion in the rebase. Row-injection logic moves to RLS policies; the raw query at `:729` disappears with TypeORM. **Note the split:** the row-scoping half becomes SQL, the capability half becomes guards on the thin app. Neither survives as application code writing filters |
| `permissions.module.ts` | | **REWRITE** — remove `RlsContextGuard` (never applied). Register the single capability guard, scoped to the thin app's own routes and keyed on capability role — never on CRUD routes |
| `cache-entities/*` (5) | | **DELETE** — cache-on-database is the wrong mechanism |
| **`users/`** | 19 | **MOSTLY DELETE** |
| `entities/*.entity.re-export.ts` (4) | | **DELETE** — alternate import paths make `Role`/`Group` ownership ambiguous |
| `services/groups.service.ts` vs `groups.service.ts` | | **DELETE both** — two `GroupsService` classes (490-line repo-based vs 68-line permission-based) with divergent authorization models, selected by import path. Membership becomes a `group_members` table; authorization becomes a policy |
| `users.service.ts` | | **REWRITE (thin)** — bcrypt cost 10 → configurable ≥12; password hashing only. All CRUD → PostgREST |
| `users.controller.ts`, `groups.controller.ts` | | **DELETE** — tables + policies |
| `dto/*.ts` (5) | | **DELETE** — generated types |
| **`roles/`** | 9 | **DELETE** — becomes `roles` + `role_permissions` tables. PostgREST serves them |
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

Every removed controller becomes a table or a view. Every removed DTO becomes a
generated type. Every removed authorization check becomes a `CREATE POLICY`.

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
`CREATE POLICY` in `src/database/migrations/` plus a `SET LOCAL app.user_id`
helper.

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
| `admin/rls-management/*` (6) | **REWRITE** | 5 of 6 inject `HttpClient` directly; each file declares 2 components |
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

| ID | Phase | Work | Verified by |
|---|---|---|---|
| W01 | N1 | ESLint baseline: `prefer-on-push`, `prefer-standalone`, `prefer-control-flow`, `conditional-complexity`, `no-empty-lifecycle-method`, `prefer-takeuntil-destroyed` | `npm run lint` reports zero errors with no `eslint-disable` added |
| W02 | N1 | `npm run verify`: build → typecheck → lint → test → smoke against live Postgres | Stop Postgres; assert **non-zero** exit rather than a skip |
| W03 | N1 | Document-level link checker: every relative link in `docs/` and `AGENTS.md` resolves | The checker runs in CI-equivalent `verify` |
| W04 | N1 | Doc-claims checker: every command in `development.md` exists in a `package.json` script | The checker runs in `verify` |
| W05 | N7 | **PostgREST/RLS spike** — table → policy → PostgREST → JWT → curl → `openapi.json` → types | Five curl checks: per-claim RLS, anon not a leak, spec served |
| W06 | N2 | `postgrest.conf`: `db-anon-role`, `jwt-role-claim-key`, shared secret. **Four** roles: a migration/owner role plus `app_anon`/`app_member`/`app_admin` | `curl /` returns the spec; a wrong secret is refused; **no request-serving role owns a table** |
| W07 | N2 | Native RLS policies per ADR-0023: one policy per table, `request.jwt.claims`, fail-closed, plus `FORCE ROW LEVEL SECURITY` | Permitted returns rows; denied returns none; per access path; **and the policy still applies when run as the owner role** |
| W08 | N2 | Column + table grants; `REVOKE ALL FROM PUBLIC` first, `REVOKE SELECT (secret)` for internal columns | Assert `SELECT` is **denied**, not merely omitted |
| W09 | N2 | Plain-SQL migrations, one directory, one table; `NOTIFY pgrst, 'reload schema'` after commit | Every migrated table is reachable at its endpoint |
| W10 | N2 | `seed.ts` using PostgREST or `psql`, never TypeORM; seeds the three DB roles and an admin user | A fresh `setup` reaches a logged-in state |
| W11 | N2 | Thin Nest app: JWT issuance, login orchestration, password reset, email, CAPTCHA, cron | Each route has a test; the six security tests in W13 |
| W12 | N2 | Rate limiting for PostgREST routes via `db-pre-request` or a reverse proxy | Sustained requests are throttled; PostgREST does not throttle alone |
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

### 6.0.1 Audit protocol

Each item is audited independently as **done / not started / blocked**, and **done
requires its verification column to have been executed and recorded** — not read,
not inferred. An item with no runnable verification is treated as not started.

`grep` gates are expected to return nothing; a non-empty result is a failure, not
a warning.

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
| Internal columns hidden | `REVOKE SELECT (col) FROM app_member` (W22) — **note: table-level grant must be revoked first, and `select=*` then breaks on that table** | Test asserts `select` is **denied** — not merely omitted |
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
| PostgREST does **not** rate-limit | **Confirmed.** Upstream states you must put a reverse proxy in front; docs ship an Nginx `limit_req` example. W8 stands |
| PostgREST emits column names verbatim, no auto-transform | **Confirmed.** The feature was explicitly declined upstream |
| Column renaming works on reads | **Confirmed, but read-only** — `?select=alias:column`. Writes still require real column names, so aliases cannot solve naming end-to-end |
| Column privileges replace views for hiding columns | **Confirmed with a caveat we under-weighted** — `select=*` breaks, and grant order matters |
| A client-side key transform corrupts `jsonb` passthrough | **Confirmed.** Reproduced by others; PostgREST returns `jsonb` as nested objects, so a recursive transform reaches inside them. Reinforces dropping the transform |

### 6.5 Verified on a live install

A spike ran against a real install, not documentation. Three of the four findings
change the design.

| | |
|---|---|
| PostgreSQL | **15.19** via `apt-get install postgresql` |
| PostgREST | **16.4**, static binary. The only OpenAPI settings are `openapi-mode`, `openapi-security-active`, `openapi-server-proxy-uri` — **no version switch** |
| RLS per-claim | **Works.** Site A token → only site A rows; site B token → only site B |
| Spec generation | **Works.** `GET /` serves the spec |
| Schema reload | `NOTIFY pgrst, 'reload schema'` is **mandatory and sufficient** — no restart (§5.3.1) |
| Contract chain | **Works.** Swagger 2.0 → OpenAPI 3.0 → types, spec-verbatim, zero camelCase leakage |

**1. A table's owner bypasses its RLS policies, silently.** The same JWT claim
returned 5 of 5 rows as owner and 2 of 5 as non-owner. No error, no warning. This
forces **four** roles — a migration/owner role that never serves requests, plus
`app_anon` / `app_member` / `app_admin` — and `FORCE ROW LEVEL SECURITY` on every
protected table. W06 and W07 now assert it.

**2. PostgREST emits Swagger 2.0, not OpenAPI 3.x.** `openapi-typescript` targets
3.x, so `swagger2openapi` is a required step in the contract chain (W15). The
converted spec is committed, so only the regenerator needs the tool.

**3. The JWT `role` claim selects the database role.** PostgREST issues
`SET ROLE` to it, so the issuer must validate on mint — an unknown role fails the
request rather than falling back.

Also noted: an unauthenticated `GET` returns **`200 []`**, not `401`. Correctly
fail-closed, because the denial comes from RLS and column privileges rather than
the auth layer — but tests must assert on the response **body**, never the status
code alone.

**Caveat.** The spike used throwaway secrets and passwords, and its database is
named `pgrst_smoke`. None of it is template material.

### 6.6 Verified by hypothesis testing

Ten hypotheses executed against PostgreSQL 15.19 + PostgREST 16.4, in a dedicated
`hypothesis_test` database. Three of my documented claims were **wrong**.

| # | Verdict |
|---|---|
| H1 `FORCE` blocks owner DML | **Confirmed** — `new row violates row-level security policy`; DDL unaffected; seeding works via `SET LOCAL request.jwt.claims` |
| H2 `WITH CHECK` omitted → `USING` governs inserts | **Confirmed** — `with_check IS NULL`, re-checked on `UPDATE` |
| H3 hierarchy policy | **REFUTED as written** — `SETOF uuid` is rejected in a policy expression. Scoping correct once it returns `uuid[]`; root→3, mid→2, unrelated→2, admin→5, unknown→0 |
| H4 `INVOKER` vs `DEFINER` | **Confirmed** — `INVOKER` returned 1 row, owner-owned `DEFINER` returned the whole tree |
| H5 column grants break `select=*` | **Confirmed** — `403 42501`; explicit columns `200`. Wrong grant order → **`200` with `secret` fully readable** |
| H6 table grants withhold verbs | **Confirmed** — GET 200, POST 201, PATCH/PUT/DELETE `403`, row unchanged |
| H7 role-claim safety | **REFUTED — escalation.** A token naming an owner role read everything and its `DELETE` **removed the row** |
| H8 `db-pre-request` | **Partial** — revocation clean `401`, but the hook is read-only, and an unreadable revocation table fails **open** |
| H9 `openapi-mode` | `follow-privileges` is role-dependent. **Recommend `ignore-privileges`** — deterministic, and it does not reflect column grants anyway |
| H10 denial signalling | **Partial** — no grant → `401`; RLS denial → `200 []`. **A status-only test passes on a real leak** |

**Five findings that were not on the list at all:**

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
   for an admin token. The `TRUE OR NULL` reasoning in ADR-0023 is invalid.
7. **The documented admin branch is dead code.** It matched
   `request_claims()->>'role' = 'admin'`, but no token ever carries `admin`; the DB
   role is `app_admin`. Verified over HTTP: a valid admin token got `200 []`.

**Corrected in W07**, which is where each of these was proven rather than
reasoned about. Beyond the list above, four further defects were found by
executing the corrected file — recorded here because the pattern, not the
instance, is the lesson:

8. **Revoking `EXECUTE` from `PUBLIC` and granting it to nobody** is worse than
   doing nothing: every scoped request became
   `403 permission denied for function request_claims`. A revoke is not a policy.
9. **Omitting `EXECUTE` for `app_anon`** made unauthenticated reads raise rather
   than deny. A policy is evaluated for every role that reaches the table.
10. **The column-grant order failed open.** With a table-level `SELECT` in place,
    `has_column_privilege(..., 'internal_notes', 'SELECT')` was `t`. A column
    revoke under a table grant is silently a no-op.
11. **The escalation-boundary `GRANT` cannot be run by a migration role** —
    `must have admin option on role "app_anon"`. The one statement that is the
    boundary is necessarily a superuser statement.

Highest severity: H7. The mitigation this project documented — validate the
claim at mint — protects only the issuer. The real boundary is
`GRANT app_anon, app_member, app_admin TO authenticator` and nothing else.
`REVOKE SET ON PARAMETER role` is inert on PG15. `REVOKE <owner> FROM <auth>` is a
denylist and is bypassed by any unlisted role. **It must be a test, not a
migration comment** — and it now is: `backend/test/rls/` runs as a gating step of
`verify`, and disabling `ENABLE ROW LEVEL SECURITY` fails 11 of its 33 tests.

Also confirmed: a token with **no `exp` claim is accepted**; forged, unsigned and
expired tokens are rejected. PostgREST caches **schema and grants** — `NOTIFY` is
required for both, but `postgrest.conf` and `db-pre-request` changes need a
restart.

---

## 7. Verification gates

Per phase. Nothing advances until its gate passes.

```bash
# P0
npm run verify            # build + typecheck + lint + test + smoke

# P1 — API layer
npm run test -- rls       # every policy: permitted returns rows, denied returns none
npm run generate:client   # PostgREST spec → client regenerates cleanly
curl $PGRST_URL/ | jq .   # PostgREST is serving; OpenAPI is present
grep -rn "typeorm" package.json   # must be absent

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
| An LLM writes an over-permissive `USING (true)` policy | High | RLS policy tests (W12) are the only defence — permitted case *and* denied case per policy, per access path. This is the same risk as with Nest; PostgREST does not add it |
| PostgREST does not rate-limit | High | W8 — edge limiter in front of it. Never rely on Postgres query volume as a throttle |
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