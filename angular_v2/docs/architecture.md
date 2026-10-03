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
    ├── adr.md             21 decision records
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
    ▼
PostgreSQL
    ├─ RLS policies          which ROWS may this caller see?
    ├─ tables               no views — base tables only (ADR-0022)
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
       PostgreSQL            RLS applies here too
```

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

### Authorization is three axes, not two

Scope and capability are orthogonal, and forcing one mechanism to carry both is
why the previous permissions module could not express row-level security at all
(ADR-0023).

| Axis | Question | Mechanism | Keyed on |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | a **membership table** joined to a closure view |
| **Operation** | Which *verbs* and *columns*? | table + column `GRANT` | DB `role` claim |
| **Feature** | Which *features*? | per-operation RLS policies | `role_capability` table |

> **CORRECTED.** Scope was documented as keyed on a `site_id` **claim** — it is
> keyed on **membership in a table**, so revocation bites on the next request.
> Feature was documented as thin-app guards on a capability **role** — capability is
> a **row in a table**, checked in the database. Evidence in ADR-0023.

RLS sits below both runtimes, so it is a filter on **every** query rather than a
layer the application calls. Neither runtime needs to remember it — the
application supplies identity and the policy decides.

Object-level security is likewise in the database: `GRANT SELECT, INSERT ON
projects TO app_member` means members cannot UPDATE or DELETE, enforced by grants
rather than by a decorator someone can forget.

**An `ic` and a `site_manager` are the same DB role — `app_member`.** They reach
the same features and are scoped to their own group by the identical policy; their
only difference is capability, enforced in the database beside RLS.

> **WITHDRAWN — the invariant that used to be stated here.** This section read:
> *"no query or guard filters by site and by feature at the same time. The two keys
> never meet."* **That rule caused a silent privilege escalation.** Splitting the
> axes across two policies puts scope in a `FOR ALL` policy and each capability
> gate in its own per-operation policy; multiple permissive policies on one
> operation are **OR**ed, so the `FOR ALL` scope policy admits every in-scope
> `DELETE` on its own. Measured: a member holding **zero** capabilities deleted a
> row and inserted a row, **no error and no warning**.
>
> **The corrected rule: separate inputs, one composed expression.** Scope and
> capability must never be *derived from* one another — but they must **meet** in a
> single policy per operation. Two policies on one operation are only correct with
> `AS RESTRICTIVE`, which ANDs with the permissive set. Full record: ADR-0023.

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

**There are no views**, for two independent reasons that are easy to miss: a
superuser-created view bypasses RLS entirely and silently, and writes through
views are unreliable because views have no primary key. A view would reintroduce
exactly the failure mode the deleted RLS proxy had — a security mechanism that
reports success while enforcing nothing (ADR-0022).

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
| Coarse authorization | Global guard + permission decorator | Default deny |
| Fine scoping | Postgres RLS | Cannot be bypassed |
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
| Database views | Superuser-created views bypass RLS silently; writes are unreliable (ADR-0022) |
| Runtime key transform | `angular/` deleted one after a 35-task refactor. Naming is a build-time concern |
| Application-level permission guards on CRUD | PostgREST maps claims to a DB role; policies read them. Guards only remain on the thin app's own routes (ADR-0004) |
| Docker / compose | Too heavy for local dev (ADR-0018) |
| CI pipeline | Never a live app; `verify` is inherited by forks instead (ADR-0020) |
| Third-party services | No accounts, no API keys — the portability constraint. PostgREST is a local binary, not a service |
| NGXS / any store library | Signals cover it; two state systems was the defect (ADR-0012) |
| NgModules | Standalone only (ADR-0013) |
| Mock services | A mock claims work is done when it is not (ADR-0008) |
| Hand-written response types | Generated from the spec (ADR-0003) |