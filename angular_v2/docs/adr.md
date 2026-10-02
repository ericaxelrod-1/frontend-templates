# Architecture Decision Records

Decisions taken during the `angular/` → `angular_v2/` review, 2026-10-01.
Each record states what was decided, why, and what it costs.

Status key: **Accepted** — settled, to be implemented as written.

---

## Table of contents

| # | Decision | Status |
|---|---|---|
| [0001](#adr-0001) | PostgreSQL replaces SQLite | Accepted |
| [0002](#adr-0002) | Native Postgres RLS replaces the application proxy | Accepted |
| [0003](#adr-0003) | OpenAPI is the contract; the client is generated | Accepted |
| [0004](#adr-0004) | **PostgREST is the API layer**; NestJS becomes a thin app | Accepted (reverses an earlier rejection) |
| [0005](#adr-0005) | Angular 22 with OnPush, signals and zoneless | Accepted |
| [0006](#adr-0006) | Migrate before upgrading | Accepted |
| [0007](#adr-0007) | ESLint rules before code changes | Accepted |
| [0008](#adr-0008) | No mock services, ever | Accepted |
| [0009](#adr-0009) | Global deny-by-default authorization | Accepted |
| [0010](#adr-0010) | Per-account primary, IP secondary, behavioural is triage | Accepted |
| [0011](#adr-0011) | Security controls live above credential validation | Accepted |
| [0012](#adr-0012) | Signals only; remove NGXS | Accepted |
| [0013](#adr-0013) | Standalone only; no NgModules | Accepted |
| [0014](#adr-0014) | One directory layout | Accepted |
| [0015](#adr-0015) | Extraction over duplication | Accepted |
| [0016](#adr-0016) | SSR with hydration, properly configured | Accepted |
| [0017](#adr-0017) | Keep the self-rolled CAPTCHA; delete the fake | Accepted |
| [0018](#adr-0018) | No Docker; local PostgreSQL instance | Accepted |
| [0019](#adr-0019) | One baseline migration chain | Accepted |
| [0020](#adr-0020) | Optimise for fork-time state | Accepted |
| [0021](#adr-0021) | Keep NestJS 11 → 12 upgrade in the final phase | Accepted |
| [0022](#adr-0022) | **One naming convention end to end** — no views, no transform | Accepted (reverses an earlier view/transform decision) |
| [0023](#adr-0023) | **Two orthogonal authorization axes** — scope in RLS, capability in grants/guards | Accepted |

---

<a id="adr-0001"></a>
## ADR-0001: PostgreSQL replaces SQLite

**Context.** SQLite was chosen for portability — no service to install, no
account. It also forced workarounds throughout: UUID→integer conversions (6
migrations, 1,487 lines), table rebuilds for `DROP COLUMN`, `simple-json` blobs
instead of queryable JSON, and a composite-primary-key rebuild migration.

**Decision.** PostgreSQL, installed locally per developer. No container runtime.

**Rationale.** The portability benefit was real but small — one command — and the
cost was 2,400+ lines of workaround machinery that every fork inherits.
Postgres additionally enables ADR-0002, which is the largest single simplification
available. Row-level locking also resolves a hand-rolled race-condition
workaround in `pattern-detection.service.ts` that used a fuzzy 5-minute window
because SQLite lacks MVCC.

**Consequences.** ~2,850 lines deleted outright (ADR-0019, ADR-0002). Requires a
local Postgres install — a barrier SQLite did not have, accepted deliberately.

---

<a id="adr-0002"></a>
## ADR-0002: Native Postgres RLS replaces the application proxy

**Context.** `packages/nestjs-typeorm-rls/` is 2,411 lines wrapping
`EntityManager` and `SelectQueryBuilder` in JS `Proxy` objects to inject row
filters. It enforces nothing:

- Zero `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` anywhere in the repository.
- `RlsContextGuard` is declared but applied in no `@UseGuards` and no `APP_GUARD`,
  so `activeGroupIds` is always `[]` — and the proxy's fail-closed path is
  `target.andWhere('1=0')`.
- The proxied `EntityManager` is injected by nobody; repositories resolve
  `dataSource.manager`, which is unproxied.
- The one globally-live piece (`patchDataSourceQueryRunner`, which throws on raw
  `query()`) should be breaking `permissions.service.ts:729` — an untested,
  unbypassed path.

**Decision.** Delete the package. Enforce scoping with `CREATE POLICY` in
migrations, passing identity via `SET LOCAL app.user_id` and reading it with
`current_setting('app.user_id', true)`.

> **Corrected after execution — the identity mechanism, not the layer.** The
> *decision* (RLS in the database, below the application) stands and is the reason
> this ADR exists. The **mechanism** named above does not: PostgREST exposes the
> verified JWT claims as `request.jwt.claims`, and **a policy reads the setting it
> names.** A policy built on `request.jwt.claims` is completely blind to
> `app.user_id`, so setting it admits nothing — verified: the owner is still
> rejected under `FORCE`, and seeding still fails. ADR-0023 now reads the claims
> setting and derives identity from the token PostgREST actually verified, which
> is also what makes the boundary auditable from one place.

**Rationale.** Three reasons, in order of weight:

1. **Wrong layer.** Application enforcement is only as strong as every future
   line of code that remembers to use it. Database enforcement sits below the
   application; a forgotten decorator cannot bypass it.
2. **It failed silently.** The failure mode is worse than absence — it created
   false confidence in a feature that did not exist.
3. **Premature abstraction.** The goal was portability across databases, paid for
   with permanent maintenance cost to avoid a one-time problem.

**Consequences.** ~2,400 lines replaced by ~150 lines of SQL, readable with
`psql`. Every policy becomes independently testable, which is the precondition
for ADR-0004.

---

<a id="adr-0003"></a>
## ADR-0003: OpenAPI is the contract; the client is generated

**Status:** Accepted — **contract source changed by ADR-0004.** The requirement
stands; the mechanism moved from Swagger decorators to PostgREST.

**Context.** `@nestjs/swagger` is installed, decorators sit on 34 backend files,
and `SwaggerModule` is imported in `main.ts:11` — never called. No spec is
generated. The frontend hand-declares types and URLs: ~126 hand-written HTTP
calls, `Role` declared 4× with `id` typed `number`, `string`, and `number?`, and
6 calls to endpoints that do not exist.

**Decision.** The spec is generated from the **live database** by PostgREST,
converted from **Swagger 2.0 to OpenAPI 3.0** by `swagger2openapi`, and committed
as `openapi.json`. Set **`openapi-mode = "ignore-privileges"`**, not
`follow-privileges` — the latter makes the served spec depend on the requesting
role (verified: 9.5 KB as anon, different as a member), which makes code
generation non-deterministic. It also does not reflect column grants: `secret`
still appears in the spec either way. `openapi-typescript` generates the Angular types from it.
Hand-written URLs and response interfaces are forbidden. Where a public shape must
differ from the stored shape — camelCase columns, computed fields, redacted
columns — expose a **generated column** or a `STABLE` function via RPC. Naming is
one convention end to end; see ADR-0022.

**Tooling for the generated client.** `openapi-typescript`, not Orval.

Orval has a first-class Angular generator, and its `httpResource` retrieval mode
is signal-first — genuinely attractive for this architecture. It is not the tool
here, because of what `namingConvention` actually covers:

```ts
output.namingConvention                    // FILE names — camelCase | PascalCase | snake_case | kebab-case
output.override.namingConvention.enum       // ENUM KEYS only
```

There is **no option for schema property keys.** Converting snake_case properties
requires a mutator — explicitly requested in [orval#2381](https://github.com/orval-labs/orval/issues/2381)
and, per that discussion, still requiring *"complex workarounds using mutators and
transformers."* A mutator is compile-time and would technically work, but it is
custom machinery this template would have to maintain.

`openapi-typescript` emits types exactly as the spec states — snake_case — with
**zero runtime dependencies** and no assumed data-fetching library.

**PostgREST emits Swagger 2.0, not OpenAPI 3.x — a conversion step is required.**
Verified on PostgREST 16.4: `GET /` returns `{"swagger": "2.0", …}` with
`definitions` and `basePath`, despite the `application/openapi+json` content type.
No PostgREST config option changes this (`openapi-mode`,
`openapi-security-active`, `openapi-server-proxy-uri` are the only OpenAPI
settings). The chain was verified end to end:

```
PostgREST 16.4 → Swagger 2.0 → swagger2openapi → OpenAPI 3.0.0
              → openapi-typescript 7.13.0 → snake_case types
```

Conversion preserved all definitions and paths, and generated field names were
**spec-verbatim with zero camelCase leakage** — which is the property ADR-0022
depends on. The converted spec is committed, so only the regenerator needs
`swagger2openapi`; frontend builds do not. That is
exactly the requirement: naming decided at build time, nothing at runtime, so
nothing can corrupt a `jsonb` payload on the way through.

**Rationale.** Converting recurring human chore into a build step. Drift becomes
a **compile error** rather than a production 404 — the only kind that actually
gets fixed.

Generating from the database rather than from decorators is strictly stronger:
the spec is derived from what actually exists, so it cannot describe an endpoint
that was never implemented. The old pipeline could not have caught the six 404s,
because the decorators were written by hand and independently of the routes.

**Consequences.** `app/models/**` and every hand-written URL are deleted.
`@nestjs/swagger`, `@ApiProperty` and DTO classes are no longer needed for the
CRUD surface — they remain only on the thin Nest app's own routes, where a
hand-written spec fragment is still required. The generated client is committed
so the frontend builds without either runtime running.

---

<a id="adr-0022"></a>
## ADR-0022: One naming convention, end to end. No views, no transform.

**Status:** Accepted. Supersedes the earlier ADR-0022, which proposed replacing
views with a client-side key transform. That transform is rejected here.

**Context.** PostgREST emits **column names verbatim** — no case translation, and
the feature was explicitly declined upstream. Three ways to get camelCase onto the
wire were considered: database views, a client-side key transform, and camelCase
columns. A fourth — accepting snake_case everywhere — requires no machinery.

**Decision.** **snake_case in the database, on the wire, and in generated
TypeScript. No views. No transform. One schema object per resource.**

```
PostgreSQL   user_id, created_at, is_active
PostgREST    user_id, created_at, is_active        ← verbatim
generated TS user_id, created_at, is_active        ← as the spec says
```

**Rationale — views are disqualified on two independent technical barriers.**

**Barrier 1: views silently bypass RLS.** PostgREST's authorization docs:

> Views are invoked with the privileges of the view owner, much like functions
> with the `SECURITY DEFINER` option. **When created by a SUPERUSER role, all
> row-level security policies will be bypassed.**

This has already caused a production-adjacent leak — [PostgREST #2124](https://github.com/PostgREST/postgrest/issues/2124):

> I have seen developers create views, not knowing that RLS wouldn't be enforced
> and thereby **leaking data**.

The escape hatch is version-gated: `CREATE VIEW ... WITH (security_invoker = true)`
on PG ≥ 15, or a `NOSUPERUSER NOBYPASSRLS` view owner below that. Since migrations
run as `postgres`, every view created by a migration would bypass RLS entirely,
with no error. **That is the exact failure mode of the 2,411-line RLS proxy this
rebase deletes** — a security mechanism that reports success while enforcing
nothing. For a project whose entire authorization model is database-enforced, an
object that can silently disable it is not an acceptable trade for a naming
convention.

**Barrier 2: writes through views are unreliable.** [PostgREST PR #2195](https://github.com/PostgREST/postgrest/pull/2195):

> **This feature only works for tables, not views**

> as soon as you have multiple tables in the FROM or have set-returning functions —
> this is not guaranteed to work anymore: The columns in the view might be based on
> the tables PK columns - but they are **not necessarily unique** anymore

> Deleting **more** rows than were requested

Plus: views have no primary key, so upsert "operates based on the primary key
columns, so you must specify all of them"; PK detection in views is demonstrably
wrong ([#2458](https://github.com/PostgREST/postgrest/issues/2458) — *"returning
`/v?pk1=eq.1` is just wrong"*); and auto-updatable views require exactly one table
in `FROM` with no aggregates or `DISTINCT`. Every write path would need individual
verification.

**Rationale — the transform is rejected because `angular/` already tried it.**
`angular/frontend/src/app/core/interceptors/case-transform.interceptor.ts` existed
and was deleted after a 35-task refactor, 13 of which were repairs. Its objective
record states the problem plainly:

> This removes the **asymmetric transformation layer** between frontend and
> backend, **eliminating the entire class of camelCase/snake_case bugs**

That refactor succeeded only because TypeORM sat in between, laundering snake_case
columns into camelCase entity properties before serialization. Removing TypeORM
removes the launderer — but it does not reinstate the transform.

The `jsonb` failure mode is independently confirmed: a recursive client transform
rewrites keys *inside* `jsonb` columns, breaking payloads that must round-trip
verbatim ([porsager/postgres#983](https://github.com/porsager/postgres/issues/983)),
and PostgREST returns `jsonb` as nested objects, so the transform reaches inside
them. `angular/`'s own `AGENTS.md` (§2.3) classifies silent degradation as the
defect class this template exists to eliminate.

**Rationale — codegen makes naming a build-time concern.** With no runtime
transform, the wire format is whatever the database says, and the generated types
state it plainly. Renaming a column is a **breaking change** requiring a migration
**and** a client regeneration in the same change; `npm run verify` rejects the
mismatch at compile time. That is a weaker guarantee than a view's decoupling and
a far stronger one than a silent transform.

**Consequences.**

- `AGENTS.md` B1 forbids `CREATE VIEW` **and** quoted camelCase identifiers.
- The generated client is never hand-edited; `verify` fails if it is.
- Column renames are breaking changes. Documented in the contributing guide.
- Naming is a compile-time question. If camelCase output is ever wanted, it is one
  codegen setting — never a runtime transform.

### ADR-0022 §2 — Recorded reversal

The earlier ADR-0022 recommended a **configured key transform** in the generated
Angular HTTP client, citing views only to explain why they were rejected. That was
wrong on the mechanism: the transform is the highest-risk option, not the middle
one. Views were rejected for being *"a second schema object that drifts from its
table"* — but the transform was a second schema object drifting from the wire at
**runtime, in TypeScript, on every request**, and it had already been tried and
removed in this very repository.

It also leaned on the PostgREST maintainer's own recommendation of views without
checking whether views are safe under RLS. They are not, by default, and the
disqualification is recorded above.

Recorded rather than quietly swapped, because a decision record that hides its
reversals is not a record.

---

<a id="adr-0004"></a>
## ADR-0004: PostgREST is the API layer; NestJS becomes a thin application server

**Status:** Accepted — **supersedes an earlier decision to reject PostgREST.**
See §4.

**Context.** PostgreSQL can serve as the API directly via PostgREST, which would
remove the CRUD controllers, services and DTOs from NestJS. The dominant
constraint is that this template will be extended by LLMs.

**Decision.** PostgREST serves everything expressible as CRUD over a table or
view. A thin NestJS application remains beside it for the ten things PostgREST
cannot do:

| Remains in Nest | Why PostgREST cannot |
|---|---|
| JWT **issuance** | PostgREST *verifies* tokens; something must sign them |
| Login orchestration | Verify password, check block, validate captcha, record the attempt |
| Password reset / verify-email | Requires email delivery |
| Email service | SMTP credentials |
| CAPTCHA generation | `canvas` is a native Node module |
| Rate limiting | Postgres has no throttle primitive |
| Pattern detection + cron | Application logic on a schedule |
| Privacy export/delete | Multi-step workflows |

**Rationale.**

1. **The reduction is real.** ~6,000 LOC of genuinely CRUD-servable code,
   ~11,200 lines deletable in total. About 25% of the backend.
2. **It removes the raw-query bypass surface.** TypeORM is deleted, so
   `entityManager.query()` and `createQueryBuilder()` no longer exist in
   application code. Those are precisely how the previous implementation evaded
   its own RLS layer. Without TypeORM there is no SQL path from application code;
   every read goes through PostgREST's uniform interface.
3. **Better for agent extension.** Adding a resource becomes **two** artifacts —
   a table or view and an RLS policy — instead of five: DTO, entity, controller,
   service, module registration. The schema also becomes the single declarative
   artifact an LLM reads, rather than 63 files under `modules/permissions/`.
4. **The contract pipeline gets stronger.** PostgREST emits OpenAPI from the live
   schema, so `openapi.json` cannot drift from the database.
5. **Fewer concepts.** No Passport, no entities, no `data-source.ts`, no
   `DB_TYPE` switch between SQLite and Postgres.

**Costs, stated honestly.**

| Cost | Mitigation |
|---|---|
| Two runtimes to run and understand | PostgREST is a single binary, not a service to operate. Setup starts both |
| Two JWT secrets to keep in sync (`PGRST_JWT_SECRET`, `JWT_SECRET`) | Fail loudly at boot if they differ |
| A column rename breaks the public API | Accepted as a breaking change, not mitigated — see ADR-0022. Caught as a compile error by `verify`; never incidental |
| PostgREST does not rate-limit | An edge limiter in front of it; never rely on query volume as a throttle |

**Why Nest rather than a lighter Node app for the remainder.** The remaining work
is ~3–5k lines of non-trivial logic. An LLM extending a framework-less Node app
has no conventions to follow, so it re-accumulates the duplication problem this
rebase exists to remove. Nest gives the remainder a shape without giving it the
CRUD work.

**Consequences.** TypeORM, Passport and `@nestjs/swagger` are removed. Plain-SQL
migrations replace the ORM-coupled tree. §6.1 of `rebase.md` defines the
boundary rule so nothing is served by both runtimes.

---

### ADR-0004 §4 — Recorded reversal

This ADR originally **recommended against PostgREST**, reasoning that because
PostgREST makes RLS policies the entire authorization boundary, it carries more
risk under agent maintenance than Nest does — and that with no RLS policy tests
in existence, adopting it would mean an LLM-authored authorization model with no
verification.

That reasoning was wrong in two ways:

1. **RLS is the authorization boundary either way.** A Nest + TypeORM query
   passes through the same `CREATE POLICY`. An LLM writing `USING (true)` is
   equally unverified in both architectures. The risk was a property of Postgres
   RLS — being fixed regardless — not of PostgREST.
2. **It inverted a point in PostgREST's favour.** Removing TypeORM eliminates the
   raw-query bypass surface. That is a *hardening*, and it went uncredited.

The conclusion that PostgREST "simplifies but does not eliminate" the backend was
correct about the backend and wrong about the framework: PostgREST replaces
NestJS's API role entirely. What remains is a small application server, not a
web framework's worth of API layer.

Recorded rather than quietly swapped, because a decision record that hides its
reversals is not a record.

---

<a id="adr-0005"></a>
## ADR-0005: Angular 22 with OnPush, signals and zoneless

**Context.** Angular 18.2.13 (EOL). Four majors behind. Migration state: standalone
94% done, control flow 23% done, **OnPush 0%**, **signals 0%**, hydration 0%.

Angular 22 makes `OnPush` the default and renames `Default` → `Eager`. Zoneless
is stable and default from v21.

**Decision.** Target Angular 22. `ChangeDetectionStrategy.OnPush` everywhere,
signals for state, `provideClientHydration(withEventReplay())`, zoneless
opt-in last.

**Rationale.** Zoneless makes mutation-based bugs **fail loudly**:
`NgZone.onStable` never emits, `NgZone.isStable` is always `true`. Silent
state bugs become thrown errors. The `Eager` rename also makes the cost of the
current default explicit rather than invisible.

**Consequences.** 25 manual change-detection calls deleted along with the
hand-rolled infinite-loop circuit breaker. Zone.js removed from the bundle.

---

<a id="adr-0006"></a>
## ADR-0006: Migrate before upgrading

**Context.** Upgrading to Angular 22 makes OnPush the default. This codebase is
at 0% OnPush across 78 components.

**Decision.** Perform the OnPush + signals migration on v18, then upgrade.

**Rationale.** On v18, `OnPush` is opt-in, so migration is incremental and safe
component-by-component. On v22 it is the default with no per-component opt-out —
so the upgrade becomes a **silent behavioural change disguised as a version
bump**. Also, the v19 `standalone` default flip already breaks the 5 components
missing the flag. Doing the migration first makes the upgrade a no-op.

**Consequences.** Slower to reach v22, but the upgrade carries no behavioural
risk. Two codemods are harvested during the upgrade: control-flow migration
(147 `*ngIf` + 26 `*ngFor`) and `standalone` flag insertion.

---

<a id="adr-0007"></a>
## ADR-0007: ESLint rules before code changes

**Context.** Two competing ESLint configs; `angular-eslint` 19 against Angular 18
(major skew). Neither enables `prefer-on-push`, `prefer-standalone`,
`prefer-control-flow`, `conditional-complexity`, or any teardown rule. 21
`detectChanges()` calls exist because nothing prevents them.

**Decision.** Enable the rule baseline first, in the same change that adds the
convention. Fix or deliberately scope existing violations.

**Rationale.** An agent copies the nearest example. Today the nearest example
fights the framework, so the copy reinforces the defect. Rules convert convention
into a compile or lint failure — the only kind of guidance that survives a model
with no persistent memory of the codebase.

**Consequences.** Existing violations must be fixed rather than suppressed.
Deleting a rule to make a build pass is explicitly forbidden.

---

<a id="adr-0008"></a>
## ADR-0008: No mock services, ever

**Context.** Mocks are the most common way an agent fakes progress: create
`MockAuthService` to unblock a compile, then report the task complete. Four
instances exist in this repository.

**Decision.** Forbidden in application code. Fixtures live only in `*.spec.ts`
and `*.stories.ts`. No fake in the DI container. No real integration may be
bypassed to save time.

**Rationale.** A mock is not a placeholder — it is a claim that the work is
done. It reads as a working implementation to the next agent, so it compounds.
A truthful "this needs X" is a valid outcome; a mock plus a success message is a
lie.

**Consequences.** Declaring a task complete while a mock is in the tree is a
blocking review finding. `no-restricted-imports` enforces it on mock paths.

---

<a id="adr-0009"></a>
## ADR-0009: Global deny-by-default authorization

**Context.** No `APP_GUARD` anywhere. Every endpoint must remember its own
decorator. `schema.controller.ts` serves 7 unauthenticated endpoints returning
the full database map — table names, columns, types, primary keys, foreign keys
— and the frontend actively calls them.

**Decision.** Register `JwtAuthGuard` globally via `APP_GUARD`. Public routes opt
out with an explicit `@Public()` decorator. Delete `/schema/**` and
`/auth/diag/db-check`.

**Rationale.** Forgetting auth is currently silent. Inverting the default makes
it loud. `/schema/**` is removed rather than guarded because the committed
`openapi.json` already carries that information — serving it unauthenticated is
pure exposure.

**Consequences.** Every controller gets audited once. New controllers are secure
by default, so the class of defect cannot recur.

---

<a id="adr-0010"></a>
## ADR-0010: Per-account primary, IP secondary, behavioural is triage

**Context.** Login blocking is keyed on IP only. IPs are a poor identity in 2026:
an IPv6 subscriber holds a `/64`, CGNAT shares one IPv4 across thousands of users,
and credential stuffing is distributed by definition. No IP normalization exists,
so `1.2.3.4` and `::ffff:1.2.3.4` are separate counters. Thresholds are hardcoded
(5, 30 min, 3).

**Decision.** Per-account failure counting as the primary control, driving
**progressive delay** and a **risk-scoped challenge** — never a hard lockout from
unauthenticated traffic. IP reputation is corroborating. Behavioural scoring is
triage: it informs a decision, it never blocks. All thresholds from config.

**Rationale.** Hard lockout from anonymous traffic is itself an attack: anyone can
lock any account by attempting it N times. Only a party who proves knowledge of
the correct password clears the penalty. Behavioural detection has real limits —
cold start, false-positive dominance, and detection lagging a fast attack — so
positioning it as prevention is the error, not the technique.

**Consequences.** Adds a per-account counter. Requires an account-throttling
mechanism that cannot itself be weaponised.

---

<a id="adr-0011"></a>
## ADR-0011: Security controls live above credential validation

**Context.** `@UseGuards(LocalAuthGuard)` sits on `@Post('login')`. Guards run
before handlers, so the handler — containing the IP-block check, the CAPTCHA
gate, and the `status: 'failed'` audit write — is reached only when credentials
are already correct. This one misplaced decorator explains three separately
reported bypasses: the CAPTCHA never validates, failed logins are never recorded,
and IP blocking never triggers.

**Decision.** Guard chain `@UseGuards(IpBlockGuard, CaptchaGuard,
LocalAuthGuard)`. Record the failed attempt inside `LocalStrategy`'s existing
`catch` block.

**Rationale.** Guards in `@UseGuards()` execute left to right, so both checks
run before credentials are examined. Interceptors cannot be used — in NestJS the
order is middleware → guards → interceptors → handler, so an interceptor still
runs after the guard.

**Consequences.** One decorator reordering plus one `catch` block makes captcha,
audit logging, IP reputation and pattern detection all receive real input for the
first time.

---

<a id="adr-0012"></a>
## ADR-0012: Signals only; remove NGXS

**Context.** Three unreconciled state systems. NGXS holds one state slice (auth)
with a 700-line state file. Fourteen `BehaviorSubject`s. Plain mutable component
fields. Auth truth exists in **both** NGXS and `core/services/auth.service.ts`
with no bridge — `permission.guard.ts` reads `selectSnapshot(AuthState)` while
`permission.service.ts` reads its own `BehaviorSubject`.

**Decision.** Signals for all state. NGXS removed.

**Rationale.** Two sources of truth for one fact, read by different code, with no
rule for choosing — is the worst outcome. NGXS's value scales with the number of
state slices; there is one. Signals are what the framework documentation teaches,
so they are also what a model will pattern-match correctly.

**Consequences.** 14 `BehaviorSubject`s become signals. 33 `@Input()`/`@Output()`
declarations move to `input()`/`output()`. The duplicated auth state disappears.

---

<a id="adr-0013"></a>
## ADR-0013: Standalone only; no NgModules

**Context.** 73 of 78 components are standalone. Four of six NgModules are
imported by nobody. Two components lack the `standalone` flag, so on Angular
19+ they silently become standalone and break on missing `imports:`.

**Decision.** `standalone: true` on every component. Delete all six NgModules.

**Rationale.** In v18 the absence of a flag means non-standalone; in v19 it means
standalone. The current state is ambiguous and version-dependent, which is how a
tree ends up half-migrated. Explicit is safe across both.

**Consequences.** `login-monitoring-shared.module.ts` — a 19-Material-module
re-export barrel — becomes a plain `const MATERIAL_IMPORTS` array.

---

<a id="adr-0014"></a>
## ADR-0014: One directory layout

**Context.** 26 services across 7 directories; 78 components across 6. Admin
exists in both `features/admin/rls-management/` (routed) and `modules/admin/`
(routed). Two `AuthService` classes exist, both `providedIn: 'root'`, sharing one
DI token. Two `GroupsService` classes with divergent authorization models,
selected by import path. `pages/` alongside `features/`.

**Decision.** Four roots: `core/`, `shared/`, `features/`, `layouts/`. One
service per concept. Delete `pages/`, `modules/`, the second `AuthService`, and
merge the two `GroupsService` classes.

**Rationale.** A layout that offers two plausible homes for a new file is a coin
flip that every agent loses. "Add an admin feature" currently has no correct
answer.

**Consequences.** Large mechanical move. Two `PermissionGuard` classes collapse to
one — the legacy one has no AND support, throws the wrong exception, and is
**still actively imported**.

---

<a id="adr-0015"></a>
## ADR-0015: Extraction over duplication

**Context.** ~500 lines of duplicated template markup. The security-alerts table
exists twice; the pattern-detection table twice (~100 lines); the IP reputation
card twice within one file plus once more; the test-data panel five times; the
auth header six times, byte-identical; the error block seven times.
`login-monitoring.component.html` reaches 504 lines partly because it contains
copies of three other admin screens.

**Decision.** Extract shared tables, cards, headers, filter panels and feedback
blocks into components. No pipes means no memoisation, so also add five pure
pipes (`percent`, `truncate`, `fullName`, `iconFor`, `severityClass`).

**Rationale.** The largest and most complete-looking file in the repo is a
directory of other files. That is what an agent will copy. Pure pipes are
memoised by Angular, so this also deletes 46 per-change-detection method calls.

**Consequences.** Component count rises, per-file size falls sharply.

---

<a id="adr-0016"></a>
## ADR-0016: SSR with hydration, properly configured

**Context.** SSR is configured (`ssr.entry`, `/register` marked
`prerender: true`) but `provideClientHydration` appears **zero** times. The
server DOM is discarded and re-rendered client-side — full cost, no benefit.
Three unguarded `localStorage` reads in `register.component.ts` throw
`ReferenceError` during prerender. Six components gate data loading on
`isPlatformBrowser`, so the server renders a different DOM than the client — a
second blocker. Two competing server entrypoints exist; `angular.json` points at
the root scaffold, leaving 9.9 KB of Express with four duplicate auth handlers
dead.

**Decision.** `provideClientHydration(withEventReplay())`. Delete `src/server.ts`.
Remove all client-only template guards. Keep SSR.

**Rationale.** Hydration is the reason to have SSR. Shipping it configured but
disabled is the worst of both worlds — prerender cost with no return, plus a
crash on `/register`.

**Consequences.** Server and client must render equivalent markup, which forces
the `isPlatformBrowser` guards to be replaced with signals and
`TransferState`-aware patterns.

---

<a id="adr-0017"></a>
## ADR-0017: Keep the self-rolled CAPTCHA; delete the fake

**Context.** Three implementations exist. `modules/captcha/` generates a canvas
image server-side with a `crypto.randomUUID()` id, 5-minute expiry, single-use
deletion on verify, and per-character rotation — the correct zero-signup
substitute for reCAPTCHA. `auth/services/captcha.service.ts` returns
`{ challenge: solution, solution }`, making it self-solving. The frontend
`captcha.service.ts` is a correct HTTP client that is **never called**; login
instead uses `advanced-captcha.service.ts`, which hardcodes its answers in client
JavaScript.

**Decision.** Keep `modules/captcha/` unchanged. Delete the self-solving variant
and the frontend fake. Wire the existing HTTP client into the login and register
forms. Provide an accessible non-visual alternative.

**Rationale.** Self-rolling was the right call for the portability constraint, and
one of the three implementations is genuinely correct. The failure was wiring,
not the choice. Validating in the browser is not a gap to be filled later — it is
impossible; there is nothing to validate.

**Consequences.** The real CAPTCHA becomes load-bearing for the first time. Its
single-use and expiry guarantees now matter.

---

<a id="adr-0018"></a>
## ADR-0018: No Docker; local PostgreSQL instance

**Context.** `docker compose up -d db` was the stated portability mechanism.

**Decision.** A locally-installed PostgreSQL instance, connected via `.env`
(`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`). Docker is not a
supported path.

**Rationale.** Containers are heavy for local development. A local server removes
the runtime dependency entirely.

**Consequences.** Documented in `AGENTS.md` §1. `npm run verify` fails loudly when
the database is unreachable rather than skipping. `embedded-postgres` remains a
candidate fallback if a forker lacks Postgres — evaluate, do not commit yet.

---

<a id="adr-0019"></a>
## ADR-0019: One baseline migration chain

**Context.** 50 migrations across two trees — 28 in `src/migrations/`, 22 in
`src/database/migrations/` — loaded by different entry points, with four
identical class names in both and duplicate timestamps (`1720000000003`,
`1720000000004` each mapping to two files). Three bookkeeping table names. One
migration manually inserts rows into the migration table to trick the CLI. Six
migrations are UUID→integer conversions written in PostgreSQL dialect that
therefore never ran. `FixSqliteTimestampIssues` is a verified no-op whose body is
a comment. Meanwhile `database.config.ts` sets `migrations: []` for the SQLite
runtime, so the application executes no migrations at all.

**Decision.** Delete both trees. Generate one baseline from entities, then add
native `CREATE POLICY` migrations. One directory, one table, unique class names,
working `down()`.

**Rationale.** The two trees are divergent forks that could not be combined —
TypeORM would reject the duplicate class names. Regenerating produces something
smaller and honest.

**Consequences.** Existing local databases cannot be migrated forward; they are
recreated. Acceptable — the committed `db.sqlite` contains development data only.

---

<a id="adr-0020"></a>
## ADR-0020: Optimise for fork-time state

**Context.** This repository will never run in production. It has no CI, no
deployment, and no user accounts.

**Decision.** No continuous integration pipeline. A single root-level
`npm run verify` is the gate, and it is inherited by forks. Optimise the moment
of the fork, not the life of the template.

**Rationale.** Judged once, at the fork, then it belongs to someone else. The
`verify` command is a gift to forks, not infrastructure for this repository — so
it must be self-contained and runnable with no external service.

**Consequences.** A GitHub Actions workflow is optional garnish rather than a
pillar. Documentation becomes part of the product, because a forker reads docs
before code — which is why the 55 existing markdown files, several describing
features that do not exist, are deleted rather than left to mislead.

---

<a id="adr-0021"></a>
## ADR-0021: Keep the NestJS 11 → 12 upgrade in the final phase

**Context.** NestJS 12.1.1 released 2026-09-28. Adds built-in CSRF protection and
security headers, built-in signed cookies, Fastify file uploads, and route
conflict diagnostics (`routeConflictPolicy: { duplicate: 'error', shadow: 'warn'}`)
— which would turn the four duplicate controllers into a boot-time error. Packages
are ESM-ready; `require(esm)` keeps CommonJS applications working.

**Decision.** Upgrade in the final phase, after the rewrite. Use
`nest upgrade --dry-run` first.

**Rationale.** The built-in CSRF replaces the ceremonial implementation, and route
conflict diagnostics directly address a live finding. But 12.1 is roughly one week
old, so ecosystem compatibility (`@nestjs/swagger`, `@nestjs/config`,
`@nestjs/typeorm`) must be verified before adoption.

**Consequences.** Keep ESLint rather than adopting the oxlint default, since the
Angular rules live in ESLint. Node `^22.22.3 || ^24.15.0 || >=26` is Angular 22's
floor; Nest 12 additionally requires ≥ 20.19 and does not support 21.x.
---

<a id="adr-0023"></a>
## ADR-0023: Two orthogonal authorization axes — scope in RLS, capability in grants and guards

**Status:** Accepted. This is the model the template's authorization is built on.

**Context.** `angular/` has a permissions module with object-level security —
which features and endpoints a role may reach. Its fine-grained permissions were
**role-based**, and they did not intersect with any row-level notion, because no
row-level mechanism existed to intersect with. Role-based object security was
also never implemented at all (`PermissionGuard` was never applied).

The actual requirement is two-dimensional, and the two dimensions have different
key material:

- **Objects** = app features: pages, endpoints, actions.
- **Rows** = customers, or levels of a customer hierarchy.
- **Roles** = individual contributor, site manager, admin.
- **Invariant required:** an IC and a site manager must reach the *same*
  features, but must each see *only their own site*. An admin sees everything.

Forcing one mechanism to carry both is what made the old system unusable: a
role-based check can be satisfied by a valid role no matter which site the caller
is standing in, so it can never express "your site's rows."

**Decision.** Three axes, three mechanisms, three **different keys**. They never
appear in the same expression.

| Axis | Question | Mechanism | Keyed on |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | `site_id` in the JWT |
| **Operation** | Which *verbs*? | Postgres table `GRANT` | DB `role` claim |
| **Feature** | Which *features/pages*? | guards in the thin app | capability role |

### The two role vocabularies are different things

This is the crux of the answer, and getting it wrong collapses the model.

| Vocabulary | Values | Used by |
|---|---|---|
| **DB role** (scope tier) | `app_anon`, `app_member`, `app_admin` | PostgREST impersonation, RLS, grants |
| **Capability role** | `ic`, `site_manager`, `admin` | app guards, feature checks |

> **Corrected after execution.** This table originally read `anon` / `member` /
> `admin` for the DB role vocabulary. **The names are load-bearing, not
> shorthand.** The values that actually reach Postgres are the ones PostgREST
> `SET ROLE`s to, and they are the `app_`-prefixed names; a policy written against
> the bare vocabulary produces a branch that can never match (see §Why
> `current_user` discriminates the admin tier). Note that `admin` appears in
> *both* columns and means two unrelated things — which is exactly why collapsing
> them failed silently rather than loudly.

**An IC and a site manager are the *same* DB role — `app_member`.** They differ
*only* in capability, which lives above RLS. So:

- *Same features* → yes, because both are `app_member` and both reach the same
  tables.
- *Same rows* → no, and correctly so; both are scoped to their own site by the
  identical policy.
- *Different capabilities* → yes, distinguished only in the app layer.

**Named anti-pattern.** Do not create DB roles `ic` and `site_manager`. That
collapses the two axes into one, forces a policy per role per table, and reinvents
the exact coupling this ADR exists to remove.

### Row scope

> **Withdrawn after execution.** The policy this section originally prescribed was
> written from documentation and had three defects that only a live test exposed:
> it **errored** instead of failing closed when the claims setting was empty, its
> admin branch never matched anything, and its `site_id` cast could raise on
> caller-supplied input. None of the three was visible by reading it. It is kept
> below, labelled, because a decision record that deletes its own reversals is not
> a record. See `rebase.md` §6.6.

One policy per table. It must be **total** — every `OR` branch is evaluated, so a
cast in any branch can take the whole query down.

**WITHDRAWN — this is what this ADR originally prescribed, and it does not ship:**

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Read the claims once, defensively. current_setting(..., true) returns '' rather
-- than NULL once anything has been SET LOCAL in the session, and ''::json raises.
CREATE FUNCTION request_claims() RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- BOTH BRANCHES ARE WRONG, in ways reading this cannot tell you:
--   the admin branch never matches a real token, and
--   the right-hand cast raises on a malformed site_id.
CREATE POLICY row_scope ON projects USING (
    request_claims()->>'role' = 'admin'
    OR site_id = nullif(request_claims()->>'site_id', '')::uuid
);
```

**What ships** (`backend/database/migrations/0001_rls_foundation.sql`):

```sql
-- Total by construction: the uuid cast is inside an EXCEPTION block, so a
-- malformed claim returns NULL instead of raising. NULL flows into
-- site_tree_ids(NULL), which walks no rows — a denial, not an error.
CREATE FUNCTION claim_site_id() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE raw text;
BEGIN
  raw := request_claims()->>'site_id';
  IF raw IS NULL OR raw = '' THEN RETURN NULL; END IF;
  RETURN raw::uuid;
EXCEPTION WHEN others THEN RETURN NULL;   -- never raise on attacker input
END $$;

CREATE POLICY row_scope ON projects USING (
    current_user = 'app_admin'
    OR site_id = ANY (site_tree_ids(claim_site_id()))
);
```

The `coalesce`/`nullif` pair in `request_claims()` is load-bearing and survives:
without it a bare `current_setting(...,true)::json` **raises**
`invalid input syntax for type json` rather than denying — verified.

| Input | Result |
|---|---|
| `{"role":"app_member","site_id":"…"}` | that site's rows and subtree only |
| `{"role":"app_admin"}` | **every row** |
| `{"role":"app_admin","site_id":"garbage"}` | **every row**, no error — see §Why a guarded accessor, not `nullif` |
| absent, `''`, or `{}` | **zero rows** — both branches false, nothing casts |
| `{"role":"app_member","site_id":"garbage"}` | **zero rows**, no error |

#### Why `current_user` discriminates the admin tier

> **Corrected after the W07 proof.** The withdrawn policy above keyed its admin
> branch on `request_claims()->>'role' = 'admin'`. **That branch was dead code.**
> The role claim PostgREST actually receives is the DB role name — `app_admin`,
> `app_member`, `app_anon` — never the bare capability name `admin`. The two role
> vocabularies (above) had been collapsed into one, and the result was a policy
> whose admin tier matched nothing: **verified over HTTP, a valid `app_admin` token
> received `200 []` and saw no rows at all.** A policy that grants no access to the
> administrator is not a defect that announces itself.
>
> The discriminator is now **`current_user`**, which Postgres sets from the
> `SET ROLE` PostgREST performs — and which the escalation boundary (below) has
> already constrained to three roles. That matters beyond correctness: **a claim is
> caller-supplied and signed by whoever holds the secret; `current_user` is
> neither.** A member who forges `"role":"admin"` into their own validly-signed
> token gets **zero rows** — verified — because nothing reads that field. Keying
> the admin tier on the token would re-open the exact escalation hole this policy
> exists to close.

#### Why a guarded accessor, not `nullif`

> **WITHDRAWN.** This ADR argued that a garbage `site_id` was harmless on an admin
> token because *"`TRUE OR NULL` is `TRUE`, so the failing cast on the right never
> matters."* **That reasoning is invalid and is withdrawn.** `OR` does not
> short-circuit past an expression that raises: both operands are evaluated and
> the error wins. **Verified — in the withdrawn policy, an admin token carrying
> `"site_id":"garbage"` returned
> `invalid input syntax for type uuid: "garbage"`, and so did a member token.**
> The admin branch being `TRUE` changed nothing: the cast was evaluated anyway and
> the error won. `TRUE OR NULL` is only true for an operand that yields `NULL`,
> which requires the cast to *succeed* and return `NULL` — never for one that
> raises.
>
> **What the implementation does instead.** Totality comes from a **guarded
> accessor**, not from defensive `nullif`: `claim_site_id()` returns `NULL` for an
> absent, empty or malformed value by catching the cast failure, and `NULL` flows
> into `site_tree_ids(NULL)`, which walks no rows. The admin branch is then
> `TRUE OR FALSE` — decided by a predicate that cannot raise — so the admin keeps
> unrestricted access while a member with a malformed claim is denied. Every
> claims shape a caller can send is asserted in `backend/test/rls/rls.spec.ts`,
> under each serving role, including `'not json at all'`.

### The hierarchy

"Levels of the customer hierarchy" is a function of position in a tree, so scope
is tree-derived rather than equality.

> **Corrected after execution.** `RETURNS SETOF uuid` **cannot be used in a policy
> expression** — Postgres rejects set-returning functions there with *"set-returning
> functions are not allowed in policy expressions"*. The original example was never
> executed, so **this policy never compiled**. The function must return a single
> array value.

**WITHDRAWN — the example this section originally gave:**

```sql
CREATE INDEX ON customers(parent_id);

-- Three defects, all invisible by reading: SETOF cannot appear in a policy;
-- PARALLEL SAFE costs ~170x; and under the default SECURITY INVOKER the walk
-- recurses through its own policy until the stack dies (see below).
CREATE FUNCTION customer_tree_ids(root uuid) RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH RECURSIVE t AS (
    SELECT id, parent_id FROM customers WHERE id = root
    UNION ALL
    SELECT c.id, c.parent_id FROM customers c JOIN t ON c.parent_id = t.id
  )
  SELECT coalesce(array_agg(id), '{}') FROM t
$$;

CREATE POLICY row_scope ON projects USING (
    request_claims()->>'role' = 'admin'
    OR site_id = ANY (customer_tree_ids(nullif(request_claims()->>'site_id','')::uuid))
);
```

**What ships** (`backend/database/migrations/0001_rls_foundation.sql`):

```sql
CREATE INDEX IF NOT EXISTS sites_parent_id_idx ON sites (parent_id);

-- Returns uuid[] (a scalar), not SETOF uuid.
-- PARALLEL UNSAFE is deliberate: PARALLEL SAFE forced single-threaded evaluation.
-- SECURITY DEFINER is load-bearing — see the note below. It is safe here only
-- because the function reads no caller-supplied table and returns no
-- caller-supplied data: it walks from `root` and returns ids.
CREATE FUNCTION site_tree_ids(root uuid) RETURNS uuid[]
LANGUAGE sql STABLE PARALLEL UNSAFE SECURITY DEFINER AS $$
  WITH RECURSIVE t AS (
    SELECT id, parent_id FROM sites WHERE id = root
    UNION ALL
    SELECT s.id, s.parent_id FROM sites s JOIN t ON s.parent_id = t.id
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) FROM t
$$;

CREATE POLICY row_scope ON projects USING (
    current_user = 'app_admin'
    OR site_id = ANY (site_tree_ids(claim_site_id()))
);
```

**Verified row counts** over a five-row fixture (a root → mid → leaf chain, one
unrelated site, one second root):

| Claim | Rows | Note |
|---|---|---|
| `site_id` = root | **3** | the whole subtree |
| `site_id` = mid | **2** | mid + leaf |
| `site_id` = unrelated | **1** | **its own row, and none of the subtree** |
| `site_id` = a well-formed uuid matching no site | **0** | the walk is empty |
| `role: app_admin` | **all 5** | the admin branch |

> **Corrected after execution.** The original claim here was *"root→3, mid→2,
> unrelated→2"*, and the **unrelated→2 figure is wrong**. `site_tree_ids()` is
> **self-inclusive**: its anchor selects the `root` row itself, so a member scoped
> to a site outside the tree sees its **own** row and none of its subtree — one
> row, not two and not zero. This is correct behaviour, not a leak (the site is
> the caller's own), and the suite asserts it explicitly so it cannot drift
> silently in either direction. "Unrelated→0" would be wrong too: the test is what
> distinguishes *scoped* from *broken*.

**Performance is a real constraint, not a footnote.** The function is evaluated
**per row**: a 400,000-row scan produced **400,001 calls**. And `PARALLEL SAFE`
must be omitted (`PARALLEL UNSAFE`) or the planner falls back to single-threaded
evaluation — measured at roughly **170× slower**. For large tables, denormalise the
scope instead of recursing per row.

`STABLE` is required so the planner may call it once per query.
Adding a level to the hierarchy is a **data** change, not a code change — which is
what "hierarchical foundation" has to mean if the hierarchy is data-driven.

> **Corrected after the W07 proof: `SECURITY INVOKER` is not usable here.** A
> hierarchy function walks the tree table, and the tree table's own policy calls
> the hierarchy function. Under `INVOKER` that is unbounded recursion — verified,
> **every query as a non-superuser role aborted with
> `stack depth limit exceeded` after roughly 100 frames**, with no policy error
> and no partial result. The whole API was dead, and the only symptom was a stack
> trace in the server log.
>
> **These are one decision, not two:** the function is `SECURITY DEFINER` **and**
> the tree table is deliberately **not `FORCE`d**. `FORCE` on that table does not
> fix the recursion — it *causes* it, because the owner inside the function would
> then be subject to the very policy the function is called from. Only DEFINER
> plus leaving that table un-`FORCE`d terminates, and the suite asserts both halves
> together, because either one alone passes.
>
> **Why `SECURITY DEFINER` is safe here and nowhere else by default:** the function
> reads no caller-supplied table and returns no caller-supplied data. `root` is a
> uuid, not a query. It is not a general licence to make helpers privileged — a
> function that interpolated a claim into SQL would be an anonymous escalation the
> moment `PUBLIC` could execute it.
>
> **The cost is real, and this is the weakest link in the pattern:** because `sites`
> is not `FORCE`d, an owner can read it unrestricted. `sites` is the tree itself
> and holds no tenant payload — no names, contacts or records — so the blast radius
> is the shape of the org chart. A deployment that cannot accept even that must
> move the tree into a `SECURITY DEFINER`-only function over a table with RLS
> disabled and re-derive scope from a signed claim. Either way, record the trade in
> a comment where the next maintainer will trip over it.

Direction is a product decision, not a mechanism one: descendants by default (a
regional manager sees their region's sites). Change the function, not the policy.

### Function privileges are part of the boundary, and a revoke is not a policy

The policies above call three helper functions. Those calls are subject to
Postgres function privileges, which means **a policy can be correct and still not
evaluate at all** — and the failure looks nothing like a policy bug.

| Statement | Verified result |
|---|---|
| *(nothing)* | Postgres grants `EXECUTE` on a new function to `PUBLIC` by default. **7 of 9** functions in the spike had `NULL proacl`, so `request_claims()` and the `SECURITY DEFINER` tree walk were anonymously callable — the latter is an anonymous privilege escalation, not just a read leak |
| `REVOKE EXECUTE … FROM PUBLIC` and **nothing else** | **Every scoped request `403`s**: `permission denied for function request_claims`. Row scoping was **100% non-functional** while every policy, grant and test on the page still looked correct |
| revoke + `GRANT EXECUTE … TO app_anon, app_member, app_admin` | works |

> **Corrected after the W07 proof.** Two defects, in opposite directions, both
> invisible by reading the policy.
>
> 1. **A revoke is not a policy.** The obvious fix for the `PUBLIC` grant is to
>    revoke it. Revoking from `PUBLIC` and granting to *nobody* is strictly worse
>    than doing nothing: it converts every scoped request into a `42501` at
>    `permission denied for function …`. Both halves are required, in this order,
>    and the second half is the one that is easy to forget.
> 2. **`app_anon` needs `EXECUTE` too.** A policy expression is evaluated for
>    **every** role that reaches the table, the anonymous one included — and that
>    expression calls the tree walk. Without the anonymous grant, an
>    unauthenticated read fails with `permission denied for function
>    site_tree_ids`: a **`42501` on a read that should have returned zero rows**.
>    A denial must arrive as a denial. An erroring policy is a denial-of-service
>    surface and an oracle — it tells an unauthenticated caller that a policy
>    exists, and which function to look for.
>
> The suite asserts both halves separately: no function in the schema is executable
> by `PUBLIC`, **and** all three helpers are executable by each role whose requests
> evaluate the policy, `app_anon` included. Either assertion alone passes against a
> broken configuration.

### RLS does not apply to the table owner — verified

This was found empirically on a live PostgREST 16.4 + PostgreSQL 15.19 install,
and it invalidates the naive reading of every example above:

> Postgres exempts a table's owner from its row-level security policies.

A smoke test using the same JWT claim returned **5 of 5 rows** when queried as the
table owner and **2 of 5** as a non-owner. No error, no warning — the policy
simply did not apply.

Two consequences, both mandatory:

1. **Two distinct roles, always.** A migration/owner role that never serves
   requests, and a request-serving role that owns no tables. Collapsing them —
   which is the obvious thing to do for a template — disables RLS entirely.
2. **`ALTER TABLE … FORCE ROW LEVEL SECURITY`** on every protected table, so the
   owner is subject to the policy too.

Without both, every policy in this ADR is decorative. This is the same failure
class as the deleted RLS proxy: an enforcement mechanism that reports success
while enforcing nothing.

> **`FORCE` does not bind a superuser or a `BYPASSRLS` role.** Verified: a
> `postgres` session read 5 of 5 rows from a table that had both `ENABLE` and
> `FORCE` plus a working policy. `FORCE` closes the *owner* hole and nothing else.
> Every role that can reach a protected table must therefore also be
> `NOSUPERUSER NOBYPASSRLS`, and that is asserted in a test — not assumed.

#### What `FORCE` costs: migrations and seeding

`FORCE ROW LEVEL SECURITY` subjects the **owner** to the policy, and that
includes the migration role. An owner running `INSERT` against a table whose
policy filters on `site_id` will have its rows rejected — there is no claim, so
the predicate is false.

This is not a reason to drop `FORCE`. It is a reason to decide where writes come
from:

- **Preferred:** the migration role owns the schema but does not write rows. Seeding
  runs **through the escalation boundary** as `pgrst_authenticator`, which
  `SET ROLE app_admin` for the duration of one transaction.
- **Acceptable for DDL migrations:** DDL is not subject to RLS. Only `DML` is, so
  `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY` and index changes are unaffected.
- **Not acceptable:** disabling `row_security` during seeding. It reopens the owner
  bypass, and leaves it open.

Omitting `WITH CHECK` from a policy is safe — verified: `with_check IS NULL` and
the `USING` expression governs inserts (and is re-checked on `UPDATE`). The
examples in this ADR rely on that deliberately, so one expression governs both
visibility and insertability.

**Confirmed by execution.** Owner `INSERT` is rejected with `new row violates
row-level security policy`; DDL is unaffected; and seeding succeeds by assuming
`app_admin` through the boundary.

> **Correction (1).** This section previously offered `SET LOCAL app.user_id` as an
> alternative. It is **not** one. A policy reads the GUC it names — a policy built
> on `request.jwt.claims` ignores `app.user_id` entirely. Seed by setting the same
> setting the policy reads.

> **Correction (2) — the seeding route changed, and the old one stopped working.**
> The route above used to be "set `request.jwt.claims` to a value the policy
> admits". **That no longer admits anything.** The admin branch discriminates on
> `current_user`, not on a claim (see §Why `current_user` discriminates the admin
> tier), so a claim can no longer buy write access — which is the point of that
> correction, applied consistently. Claims alone now only ever *narrow* scope.
>
> So the sanctioned seed is: connect as `pgrst_authenticator`, the one role allowed
> to receive a request and granted nothing else, and `SET LOCAL ROLE app_admin`
> inside the transaction. It goes **through** the boundary, not around it, and the
> suite proves the owner is rejected and this path is accepted — two tests, because
> "the owner is refused" and "the documented workaround works" are separate claims.
> `SET row_security = off` would also make the insert succeed and is used nowhere:
> it reopens the owner bypass for every later session on that backend.

### The role claim is an escalation vector — GRANT is the control

> **This section originally asserted that validating the claim at mint was the
> mitigation. That was wrong, and a live test proved it.**

PostgREST performs role impersonation by issuing `SET ROLE` to the value of the
JWT's `role` claim. Verified behaviour:

| Token `role` claim | Result |
|---|---|
| `app_member` | correct scoping |
| a **table-owning** role | **`200`, full read — and `DELETE` returned `204` and removed the row** |
| `postgres` | `403` |
| a nonexistent role | `401` |

A validly-signed token naming an owning role **full escalates**. Validating the
claim at mint protects only the issuer — it is necessary but nowhere near
sufficient, because the mitigation has to hold even if some other code path ever
issues a token.

**The actual control is which roles the authenticator may assume, and nothing
else:**

```sql
-- The authenticator PostgREST connects as may assume these three roles.
-- NOT in a migration — see the correction below. This lives in
-- backend/database/bootstrap/001_roles.sql and runs once as a superuser.
GRANT app_anon, app_member, app_admin TO authenticator;
```

With that alone, a token claiming an owner role gets `403` — verified. Two
non-solutions, both confirmed inert:

- **`REVOKE SET ON PARAMETER role`** does nothing on PostgreSQL 15.
- **`REVOKE hyp_owner FROM hyp_auth`** works, but it is a per-role denylist and is
  bypassed by any role not yet revoked. **Never use it as the boundary.**

Every serving role must additionally be `NOSUPERUSER NOBYPASSRLS NOINHERIT` —
a role with `BYPASSRLS` ignores policies entirely.

This belongs in a **test**, not a migration comment: assert that a token naming
each non-granted role is refused, and assert the row count afterwards.

> **Corrected after the W07 proof: this statement cannot run in a migration.**
> `GRANT <role> TO <role>` requires **ADMIN OPTION on every role granted**, and a
> migration role has none of it — **verified: applying it as the migration/owner
> role fails with `must have admin option on role "app_anon"`.** Only a superuser
> can build the grant chain.
>
> That is an uncomfortable result and it should not be smoothed over: **the one
> statement that *is* the security boundary is a superuser statement**, and it
> cannot live in the file that a forker is most likely to re-run. It therefore
> lives in `database/bootstrap/001_roles.sql`, which runs once, as a superuser,
> before any migration. Two things follow, both mandatory:
>
> 1. **Assert the boundary where it is granted.** The bootstrap ends with a `DO`
>    block that reads `pg_auth_members` and raises unless the reachable set is
>    exactly `app_admin, app_anon, app_member`. Without it, a missing or altered
>    `GRANT` surfaces much later as an unrelated-looking
>    `permission denied to set role "app_admin"` from inside a test fixture, and
>    the suite reports a fixture error instead of naming the missing control.
> 2. **Prove it can fail.** Adding the table-owning role to that `GRANT` turns
>    `verify` red at the RLS step — three tests, including the one asserting the
>    row survives the escalation attempt (`rebase.md` §6.6.1).

Also verified: forged, unsigned and expired tokens are rejected — **but a token
with no `exp` claim is accepted.** The issuer must always set `exp`.

### Denials are invisible in the status code

> **Corrected after execution.** The original claim here was wrong in both halves.

| Case | Actual |
|---|---|
| no grant at all | **`401`** — not `200 []` |
| grant present, RLS denies | **`200 []`** |

And the decisive result: **a status-only test passes on a real leak.** A correct
denial, a full `USING (true)` leak, and a *partial* 3-of-5 leak were **all HTTP
200**. Tests must assert on the response **body** — row count and content — never
the status code alone.

### Operation-level security, also in the database

Object-level security over CRUD belongs to Postgres grants, not app guards:

```sql
GRANT USAGE ON SCHEMA public TO app_anon, app_member, app_admin;
REVOKE ALL ON projects FROM PUBLIC;          -- default deny first

GRANT SELECT, INSERT              ON projects TO app_member;   -- no UPDATE, no DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_admin;

REVOKE SELECT ON projects FROM app_member;                  -- table level, FIRST
GRANT  SELECT (id, site_id, name)  TO app_member;           -- then columns
```

PostgREST then cannot offer an operation the grants withhold, even by accident.
Order matters — revoke the table-level grant **before** applying column grants, or
the column revoke silently does nothing (`AGENTS.md` B1).

> **Corrected after the W07 proof: `REVOKE SELECT (col)` is not a way to hide a
> column.** The example this section originally carried hid `secret` with
> `REVOKE SELECT (secret) ON projects FROM app_member;` **on top of** a standing
> table-level `SELECT`. A column privilege can only **narrow** a table grant that
> has already been taken away; it cannot **subtract** from one. The statement is
> accepted, exits 0, and changes nothing.
>
> **Verified: with the table grant still in place,
> `has_column_privilege('app_member','customers','internal_notes','SELECT')` was
> `t`** — `internal_notes` fully readable, returned at **HTTP 200 with its value
> intact**, and a status-only assertion passed on the leak. `t` before the
> table-level revoke, `f` after.
>
> So the shape above — `REVOKE ALL`, then the verb grants, then **`REVOKE SELECT` at
> table level**, and only then the column list — is the one that works, and both
> orders are asserted against each other in the suite so they cannot both be
> "right". One consequence to design around: a column-restricted role cannot use
> `select=*`, so requests against that table must name columns explicitly.

### Feature-level security, above the database

Pages, exports, and workflow actions are application logic, so they are the thin
app's guards, keyed on capability role. This is the only axis that reads the
capability role at all.

**Invariant: never both.** If an operation is a table verb, the database grants
it. If it is application logic, a guard checks it. Applying both to one operation
means two places to update and two ways to disagree.

### The testable claim

> You should be unable to write a single query or guard that filters by site
> **and** by feature. The axes never appear together.

This is the property the old system lacked and it is directly checkable: grep for
policies and grants, and confirm no capability role appears in any of them.

### Consequences

- `site_id` is a JWT claim. For users in many sites, or membership that must
  reflect instantly, replace it with a `site_members` lookup and an `EXISTS`
  subquery — same policy shape, always current.
- Capability roles are a separate table from DB roles, and a documented mapping
  `capability_role → db_role`. `ic` and `site_manager` both map to `app_member`.
- Every table needs a policy and grants. That is deliberate: default deny is
  cheaper to achieve than default allow.
- This ADR supersedes nothing, but it **does** retire the assumption that a
  permission system can express scoping. It cannot. Only a database policy can.
