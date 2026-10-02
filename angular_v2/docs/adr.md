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
as `openapi.json`. `openapi-typescript` generates the Angular types from it.
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
Angular rules live in ESLint. Node ≥ 20.19 / 22.12 required.
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
| **DB role** (scope tier) | `anon`, `member`, `admin` | PostgREST impersonation, RLS, grants |
| **Capability role** | `ic`, `site_manager`, `admin` | app guards, feature checks |

**An IC and a site manager are the *same* DB role — `member`.** They differ *only*
in capability, which lives above RLS. So:

- *Same features* → yes, because both are `member` and both reach the same tables.
- *Same rows* → no, and correctly so; both are scoped to their own site by the
  identical policy.
- *Different capabilities* → yes, distinguished only in the app layer.

**Named anti-pattern.** Do not create DB roles `ic` and `site_manager`. That
collapses the two axes into one, forces a policy per role per table, and reinvents
the exact coupling this ADR exists to remove.

### Row scope

One policy per table, one readable expression, fail-closed on missing claims:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY row_scope ON projects USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'admin'
    OR site_id = (current_setting('request.jwt.claims', true)::json->>'site_id')::uuid
);
```

- A `member` matches only the second branch — their site.
- An `admin` matches the first — every site. **An admin token carries no
  `site_id`**, so the second branch cannot narrow them.
- Missing claims → both branches false → **zero rows**, not an error. Fail-closed
  by construction, with no `NULL`-comparison trap.

### The hierarchy

"Levels of the customer hierarchy" is a function of position in a tree, so scope
is tree-derived rather than equality. One recursive function is the single place
that changes:

```sql
CREATE INDEX ON customers(parent_id);

CREATE FUNCTION customer_tree(root uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE t AS (
    SELECT id, parent_id FROM customers WHERE id = root
    UNION ALL
    SELECT c.id, c.parent_id FROM customers c JOIN t ON c.parent_id = t.id
  )
  SELECT id FROM t
$$;

CREATE POLICY row_scope ON projects USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'admin'
    OR site_id = ANY (customer_tree(
         (current_setting('request.jwt.claims', true)::json->>'site_id')::uuid))
);
```

`STABLE` and `SECURITY INVOKER` (the default) are required: `STABLE` so the
planner may call it once per query, `INVOKER` so RLS on `customers` still applies
inside it. Adding a level to the hierarchy is a **data** change, not a code
change — which is what "hierarchical foundation" has to mean if the hierarchy is
data-driven.

Direction is a product decision, not a mechanism one: descendants by default (a
regional manager sees their region's sites). Change the function, not the policy.

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

### The role claim is caller-supplied

PostgREST performs role impersonation by issuing `SET ROLE` to the value of the
JWT's `role` claim. The claim originates from the caller, so **the token issuer
must validate it** and emit only `app_anon`, `app_member`, `app_admin`. An
unrecognised role must fail the request rather than fall back to a default.

### Anonymous requests return 200 with an empty array

Verified: an unauthenticated `GET` returns `200 []`, not `401`. The denial comes
from RLS and column privileges, not from the auth layer. That is correctly
fail-closed, but **a 200 must not be read as success** — the response body is the
only signal. Tests assert on the body, never the status code alone.

### Operation-level security, also in the database

Object-level security over CRUD belongs to Postgres grants, not app guards:

```sql
GRANT USAGE ON SCHEMA public TO app_anon, app_member, app_admin;
REVOKE ALL ON projects FROM PUBLIC;          -- default deny first

GRANT SELECT, INSERT              ON projects TO app_member;   -- no UPDATE, no DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_admin;

REVOKE SELECT (secret) ON projects TO app_member;             -- column-level
GRANT  SELECT (id, site_id, name)  TO app_member;
```

PostgREST then cannot offer an operation the grants withhold, even by accident.
Order matters — revoke the table-level grant **before** applying column grants, or
the column revoke silently does nothing (`AGENTS.md` B1).

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
  `capability_role → db_role`. `ic` and `site_manager` both map to `member`.
- Every table needs a policy and grants. That is deliberate: default deny is
  cheaper to achieve than default allow.
- This ADR supersedes nothing, but it **does** retire the assumption that a
  permission system can express scoping. It cannot. Only a database policy can.
