# Architecture

Target architecture for `angular_v2/`. The full migration plan and per-file
inventory are in [`rebase.md`](./rebase.md); the reasoning behind each choice is
in [`adr.md`](./adr.md).

---

## Shape

```
angular_v2/
├── AGENTS.md              rules — single source of truth for every agent
├── GEMINI.md              imports AGENTS.md
├── README.md              fork-time entry point
├── openapi.json           generated contract, committed
└── docs/
    ├── rebase.md          migration scope + full file inventory
    ├── adr.md             decision records, with their reversals kept
    ├── architecture.md    this file
    ├── development.md     setup + verify
    ├── security.md        threat model + controls
    ├── api-contract.md    the generated-contract pipeline
    └── testing.md         what must be tested, and what a test is
```

---

## The three properties that drive every decision

1. **Forked, never deployed.** No accounts, no third-party API keys, no external
   services. Every feature works with zero credentials.
2. **Fork-time state is the deliverable.** `git clone` → running app with a
   working authenticated user, in one command. Not "stays green over time."
3. **Extended by LLMs.** Mechanical enforcement outranks documentation. An agent
   copies the nearest example, so the code is the instruction.

---

## Backend

**Two runtimes. PostgREST is the API layer; a thin NestJS application sits beside
it.** Not a Nest API over TypeORM — that was the previous decision, reversed in
ADR-0004.

The distinction matters enough to state plainly: PostgREST does not merely
simplify NestJS, it **replaces its API role entirely**. NestJS survives for the
work that requires an algorithm, a secret, a socket, or a schedule.

### Request paths

Most of the application — every CRUD operation — goes straight through:

```
HTTP request
    │
    ▼
PostgREST                    verifies the JWT from PGRST_JWT_SECRET
    │                        maps claims to request.jwt.claims
    │                        SET ROLE to the token's role claim
    ▼
PostgreSQL
    ├─ RLS policies          which ROWS may this caller see?
    │    └─ actor()          the token's `sub` — a uuid, nothing else
    │       └─ user_groups   membership, read fresh on every statement
    │          └─ org_closure  ancestors → descendants, precomputed
    │             └─ group_id IN ( … )   evaluated ONCE per statement
    ├─ tables                base tables only — no CREATE VIEW (ADR-0022)
    └─ constraints, jsonb, GIN indexes
```

Everything PostgREST cannot express goes around it:

```
HTTP request
    │
    ▼
Thin NestJS app              ~3–5k LOC — not the API layer
    ├─ JwtAuthGuard          coarse — may this caller invoke this endpoint?
    ├─ ValidationPipe        strict, whitelisted, transformed
    ├─ controller            thin — validate, delegate, return
    └─ service               JWT issuance · login · captcha · email · jobs
         │
         ▼
       PostgreSQL            RLS applies here too — but the thin app has no SQL
                             path, so it passes no identity. PostgREST supplies
                             the claims; the policy reads them, not the app.
```

Both runtimes land in the same policy. The difference is only *how the caller
reaches it*: most traffic never enters the Nest process at all.

### Where the boundary sits

| If the route needs… | It belongs to |
|---|---|
| A table, CRUD-shaped | **PostgREST** |
| A JWT signed with the private key | Nest |
| A password comparison | Nest |
| An SMTP connection | Nest |
| A canvas-rendered image | Nest |
| A schedule | Nest |
| A multi-step workflow | Nest |

Nothing is served by both. A resource that is pure CRUD does not appear in the
Nest application at all.

### The thin app

```
nest/
├── main.ts  app.module.ts
├── config/            registerAs namespaces, validated at boot
├── common/            guards, interceptors, decorators, filters
├── database/
│   ├── migrations/    ONE directory, ONE table, plain SQL
│   └── seed.ts
└── modules/
    ├── auth/          JWT issuance, refresh rotation, login orchestration
    ├── security/      rate limiting, IP reputation, pattern detection, cron
    ├── captcha/       server-side challenge (unchanged — it is correct)
    ├── email/         provider interface + console/mailpit default
    └── privacy/       export, delete workflows
```

**TypeORM, Passport and `@nestjs/swagger` are not dependencies.** That removes
`entityManager.query()` and `createQueryBuilder()` from application code
entirely — which is how the previous implementation evaded its own RLS layer.
Without an ORM there is no SQL path from application code; every read goes
through PostgREST's uniform interface.

### The data model

Every table is declared in one of three categories before anything is written
about it, because the category determines its primary key and its foreign-key
discipline (ADR-0023).

| Category | Tables | Primary key |
|---|---|---|
| **Group-scoped** | `projects`, `customers`, and every future tenant table | `PRIMARY KEY (group_id, id)` |
| **The hierarchy** | `groups` | simple `PRIMARY KEY (id)` |
| **Unscoped** | `users`, `actions`, `permissions`, `roles`, `role_permissions`, `user_roles`, `user_groups` | simple primary keys |

```
groups (parent_id → groups)              admin-writable; the hierarchy itself
   │
   ├──► user_groups (user_id, group_id)   membership — NOT member-writable
   │        │
   │        └──► org_closure               matview: (ancestor, descendant)
   │             UNIQUE, refreshed CONCURRENTLY from a statement trigger
   │
   └──◄ group_id on every group-scoped table

users ──► user_groups                     membership, not a token claim
roles (parent_id → roles) ──► user_roles  capability axis — a role is a ROW
   └──► role_permissions ──► permissions ──► actions   (resource, action)
```

**Scope is a table read, not a claim.** `user_groups` holds who belongs where and
is not writable by the members in it; `groups` is admin-writable. Neither is
carried in the token, so a membership change takes effect on the **next request
with the same token** rather than at token expiry.

**Capability is a table read too, keyed on a role row.** `role_permissions.role_id`
is a real foreign key to `roles.id`, so *"what can this role do?"* is answerable by
a query — the previous design kept a PostgreSQL role name in the capability table
and left `roles` referenced by nothing. Capability is `resource` + `action`, not a
closed vocabulary of tier labels. There are **no per-user grants and no denies**, so
every member of a role holds identical capabilities.

**The hierarchy is precomputed, not walked.** `org_closure` is a materialized
view holding every ancestor/descendant pair, refreshed inside the writing
transaction, so there is no staleness window and no per-row walk. It is **not a
table**: it has no RLS and no policy, PostgREST auto-publishes it, and the served
spec advertises it regardless of grants — so it is **granted to nobody**, and a
test asserts that rather than trusting the spec.

> **CORRECTED — none of the above is in the shipped database.** The shape in this
> section is the design ADR-0023 settled on.
> `backend/database/migrations/0001_rls_foundation.sql` still creates a `sites`
> table and keys scope on a `site_id` **token claim**, walking the hierarchy per
> candidate row. `groups`, `user_groups`, `org_closure`, `actions`, `permissions`,
> `roles`, `role_permissions` and `user_roles` **do not exist in the tree today**,
> and neither does any `has_permission()`. Nothing above is a description of the
> shipped SQL until that migration is rewritten (`rebase.md` W26) and the RLS suite
> alongside it (W27). Stated here rather than only in the ADR, because this is the
> section a reader would otherwise take as a description of what is in the
> database.

**The referential-integrity constraint, in one line:** *a group-scoped table may
only carry foreign keys that stay within the group-scoped set; any FK leaving that
set must terminate at a table members cannot write to.* It is a design constraint,
not something a policy can fix — FK, unique and primary-key checks are not
policy-governed, so every shape outside that line is an oracle or a write across
RLS. Measured evidence in ADR-0023.

### Authorization is two axes, not one

Scope and capability are orthogonal, and forcing one mechanism to carry both is
why the previous permissions module could not express row-level security at all
(ADR-0023). The organising frame is one sentence: **groups = RLS (which rows),
roles = OLS (which objects).**

| Axis | Question | Mechanism | Key material |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | the token's `sub` → `user_groups` → `org_closure` |
| **Capability** | Which *objects*? — tables, verbs, columns, pages, endpoints | OLS: table + column `GRANT`, and `has_permission()` | the token's `sub` → `user_roles` → `roles` → `role_permissions` |

Each axis has its **own** key material, and neither is derived from the other.

- **Scope** resolves `sub` through `actor()` to a set of group ids. The
  subquery is **uncorrelated**, so the planner hoists it: measured `loops = 1` at
  305 rows and at 3305 rows, against `loops = 305` for a deliberately
  correlated variant. It appears as a `hashed SubPlan` — `x IN (SELECT …)` yields
  that form. **Uncorrelatedness is what buys once-per-statement; the node name
  does not.** Assert on `loops`, not on the apparent shape of the SQL.
- **Capability** resolves the same `sub` through `user_roles`, walking
  `roles.parent_id` **upward**, then `role_permissions` → `permissions` →
  `actions`. Inside its `SECURITY DEFINER` function identity is the **actor
  argument**, never `current_user` — which rebinds to the *function owner*.
  Measured: a body using `current_user` returned `false` for a caller **while
  holding** the permission row — the whole capability axis silently absent, in the
  shape that denies, so nothing reported it. The fix is the argument, not
  `SECURITY INVOKER`, which would publish the entire permission matrix.
- **Nothing intersects the two.** There is no `permission_rules` table, no AND/OR
  combiner, and no row carrying both a group and a permission. Scope is one policy
  per table; capability is a grant. Neither can widen the other.

Object-level security is likewise in the database: `GRANT SELECT, INSERT ON
projects TO app_member` means members cannot UPDATE or DELETE, enforced by grants
rather than by a decorator someone can forget.

**`app_admin` is a superset, not a bypass** — all rows, all tables, all pages, all
endpoints, by four distinct mechanisms with four tests. **Every user has at least
one role and at least one group**, so there is no "nobody" case on either axis.
Least privilege runs both ways: scope is bounded for free by the policy's
`WITH CHECK`, and the grant-subset rule — *a caller cannot grant a capability it
does not hold* — is bounded by a trigger on `role_permissions` and `user_roles`
raising `42501`.

> **WITHDRAWN — the invariant that used to be stated here.** This section read:
> *"no query or guard filters by site and by feature at the same time. The two keys
> never meet."* **That rule caused a silent privilege escalation.** Splitting the
> axes across two policies on one operation puts scope in a `FOR ALL` policy and a
> capability gate in its own per-operation policy; multiple permissive policies on
> one operation are **OR**ed, so the `FOR ALL` scope policy admits every in-scope
> `DELETE` on its own. Measured: a member holding **zero** capabilities deleted a
> row and inserted a row, **no error and no warning**.
>
> **What replaced it:** the axes are separate *inputs* — neither derived from the
> other — and they are **not** expressed as two competing policies on one
> operation. Full record: ADR-0023.

The previous design attempted this in application code via a 2,411-line
`Proxy`-wrapped `EntityManager`. It enforced nothing, and it failed silently.

### The contract pipeline

```
tables  ──▶  PostgREST  ──▶  openapi.json  ──▶  openapi-typescript  ──▶  types
(PostgreSQL)          (live)          (committed)              (committed)
```

One direction. The frontend never hand-writes a URL or a response type; if the
spec does not produce it, the schema is wrong. Changing the wire format without
regenerating the client is an incomplete change. See ADR-0003.

The pipeline is stronger than the previous one: the spec is generated from the
**live** database, so it cannot drift from the schema. The old pipeline described
Swagger that was never switched on.

**Naming is one convention, with no translation anywhere.** Columns are
`snake_case`; PostgREST emits them verbatim; `openapi-typescript` emits them
verbatim. No view, no client transform, no per-model mapping — so nothing can
corrupt a `jsonb` payload at runtime. Internal columns are removed with
**column-level privileges**. Derived fields are `GENERATED ... STORED` columns or
`STABLE` functions via RPC.

**There are no `CREATE VIEW`s**, for two independent reasons that are easy to
miss: a superuser-created view bypasses RLS entirely and silently, and writes
through views are unreliable because views have no primary key. A view would
reintroduce exactly the failure mode the deleted RLS proxy had — a security
mechanism that reports success while enforcing nothing (ADR-0022).

> **A materialized view is a different object, and the rule is not the same.**
> `org_closure` is a `CREATE MATERIALIZED VIEW`. It has **no RLS and no policy** —
> there is nothing to scope it *with*, and PostgREST auto-publishes it as a
> first-class resource. Its only control is the grant, and a single
> `GRANT SELECT` served the entire org tree to an anonymous caller. So it is
> granted to **nobody**, and a test asserts that grant state, because the served
> spec advertises the resource regardless of grants. If a client needs the
> closure, expose it through an RPC or a policy-governed table — never by granting
> on the matview.

### Database

PostgreSQL, local instance, no container. One baseline migration chain, every
migration with a working `down()`, every new policy with a test. `jsonb` for
structured data so it stays queryable. Timestamps are `timestamptz`. Identifiers
are `uuid` — the UUID→integer conversions that SQLite forced were 1,487 lines of
migration that never executed against the intended target.

---

## Frontend

### Four directories, one home per file

```
src/app/
├── core/       singletons, interceptors, guards, config — no feature code
├── shared/     pipes + presentational components used by 2+ features
├── features/   self-contained; services stay local to their feature
└── layouts/    shells
```

A service belongs to its feature unless two or more features need it. There is no
second `services/` folder, no `pages/`, and no `modules/` alongside `features/`.
Admin lives in `features/admin/` and nowhere else.

### State

Signals, exclusively. `signal()` for local state, `computed()` for derived,
`input()`/`output()` for I/O, `toSignal()` to bridge an `HttpClient` result. No
`BehaviorSubject`, no store library. Session state lives in one service.

### Change detection

`OnPush` on every component. Zero manual change detection — no
`ChangeDetectorRef.detectChanges()`, no `markForCheck()`, no `NgZone`. In Angular
22 the previous `Default` is renamed `Eager` and OnPush is the default, so the
anti-pattern becomes explicitly named. Zoneless is enabled once the migration is
complete: `NgZone.onStable` then never emits, which converts silent state bugs into
thrown errors.

### Templates

New control flow only — `@if`, `@for`, `@switch`, `@defer`. Every `@for` carries
`track`. `@if (x; as y)` narrows types instead of `$any()`, which keeps
`strictTemplates` working as the compiler-level safety net. Pure transformations
are pure pipes, which Angular memoises; no method calls in bindings.
`templateUrl` for anything over ~15 lines. Interactive elements are `<button>`.

### SSR

`provideClientHydration(withEventReplay())`, one server entrypoint, and no
unguarded browser globals on any route the server executes. The server must
render markup equivalent to the client's — client-only guards are the classic
hydration-mismatch source and are replaced by signals.

---

## Security posture

Full model in [`security.md`](./security.md). The structural summary:

| Layer | Mechanism | Property |
|---|---|---|
| Coarse authorization | Global `JwtAuthGuard` + the boundary `GRANT` | Default deny |
| Fine scoping | Postgres RLS over `user_groups` → `org_closure` | Cannot be bypassed; resolved once per statement |
| Verbs and columns | Postgres `GRANT` | Cannot be bypassed; default deny |
| Capability | `role_permissions` → `permissions`, resolved by `has_permission()` | Enforced in the database; `role_id` is a real FK to `roles.id` |
| Grant subset | `BEFORE INSERT OR UPDATE` trigger on `role_permissions` / `user_roles` | A caller cannot grant what it does not hold (`42501`) |
| Admin | A superset across all four of the above | Not a bypass: no flag disables enforcement |
| Brute force | Per-account counter → progressive delay + risk challenge | Cannot be weaponised into a DoS |
| IP | Normalized, subnet-aggregated reputation | Secondary corroboration |
| Challenge | Server-side CAPTCHA, single-use, expiring | Validated server-side |
| Detection | Behavioural scoring | Triage only — informs, never blocks |
| Contract | Generated client + committed spec | Drift becomes a compile error |

Failures are recorded **above** credential validation, so bad credentials still
produce audit rows and still count toward throttling. See ADR-0011.

---

## What is deliberately absent

| Absent | Why |
|---|---|
| TypeORM / any ORM | The raw-query escape hatch is how the old RLS layer was evaded. No ORM, no SQL path from application code (ADR-0004) |
| Passport | PostgREST verifies JWTs from the shared secret; Nest only issues them |
| Swagger decorators | PostgREST emits OpenAPI from the live schema — it cannot drift |
| Application-level RLS | Unbypassable enforcement belongs in the database (ADR-0002) |
| `CREATE VIEW` | Superuser-created views bypass RLS silently; writes are unreliable (ADR-0022) |
| Scope in a token claim | Membership is a **table read**, so a revoked membership bites on the next request instead of at token expiry. A claim is also caller-supplied (ADR-0023) |
| Recursive per-row hierarchy walk | It was one call per candidate row — 400,001 calls over 400,000 rows. The closure matview is hoisted to `loops = 1` |
| `GRANT`s on the closure matview | No RLS protects a matview and PostgREST publishes it; a single grant served the whole org tree anonymously |
| **The ORM-driven scope engine** — `rls_rules`, `rls_join_paths`, `rls_join_conditions`, `rls_scope_templates`, `rls_condition_groups`, `rls_rule_conditions`, and the `sql` / `parameters` / `scope_sql` raw-SQL columns | It existed to make RLS work on SQLite through an ORM. On PostgreSQL the policy *is* the join, written as SQL; a data-driven engine that assembles it adds a second source of truth for the one thing that must not have one. Scope is `user_groups` ⨝ `org_closure` (ADR-0023) |
| **`permission_rules`** and its AND/OR combiner | It put both axes on one row and made them compete. They answer different questions and never do (ADR-0023) |
| **`group_permissions`, `user_permissions`, `is_granted`**, and deny-precedence resolution | Per-user grants and denies make a capability answer order-dependent, and two readers of the same rows can disagree. **Every member of a role holds identical capabilities** (ADR-0023) |
| **The permission cache database** — `cache/permissions.sqlite`, `cache_permission_maps`, `cache_sync_status`, sync endpoints | A second copy of the authorization data. `has_permission()` reads the live rows; nothing caches an authorization answer (ADR-0023) |
| **Object-scanning tables** — `api_endpoints`, `frontend_routes`, `ui_components` and their `*_permissions` joins | PostgREST derives the API surface from the schema, so there is nothing to scan. The permission surface is *which tables and which verbs*, expressed directly as `permissions(resource, action_id)` (ADR-0023) |
| Runtime key transform | `angular/` deleted one after a 35-task refactor. Naming is a build-time concern |
| Application-level permission guards on CRUD | PostgREST maps claims to a DB role; policies read them. Guards only remain on the thin app's own non-CRUD routes (ADR-0004) |
| Docker / compose | Too heavy for local dev (ADR-0018) |
| CI pipeline | Never a live app; `verify` is inherited by forks instead (ADR-0020) |
| Third-party services | No accounts, no API keys — the portability constraint. PostgREST is a local binary, not a service |
| NGXS / any store library | Signals cover it; two state systems was the defect (ADR-0012) |
| NgModules | Standalone only (ADR-0013) |
| Mock services | A mock claims work is done when it is not (ADR-0008) |
| Hand-written response types | Generated from the spec (ADR-0003) |