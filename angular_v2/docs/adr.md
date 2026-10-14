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
| [0023](#adr-0023) | **Two orthogonal authorization axes** — scope in RLS, capability in OLS | Accepted (row scope, hierarchy and the capability resolver all revised after testing) |
| [0024](#adr-0024) | **One email provider, mode-driven transport**, handlebars, and templates that must reach `dist/` | Accepted |
| [0025](#adr-0025) | **`email_messages` is the FOURTH scoping category — "derived"**; scope resolves through the recipient user's memberships | Accepted |
| [0026](#adr-0026) | Every key is UUIDv7, and the server floor moves to PostgreSQL 18 | Accepted |
| [0027](#adr-0027) | **The app-level circuit breaker trips on memory alone**; disk is measured and reported and never a trip input | Accepted (shipped; the record `0007` forward-references) |
| [0028](#adr-0028) | **`ccpa_applicable()` is address-triggered and deliberately over-applies**, with no config flag | Accepted (shipped) |
| [0029](#adr-0029) | **Three privacy/DSAR tables, three scoping categories**, and a working copy that may be cascade-deleted | Accepted (shipped) |
| [0030](#adr-0030) | **`privacy_request_audits` carries no FK to `users`**, and append-only is enforced by the absence of grants | Accepted (shipped; the subject half of the append gate corrected by `0014`) |
| [0031](#adr-0031) | **The retention machine reaches `privacy_purge_queue` through narrowly-granted `SECURITY DEFINER` functions in `authz`** — never `request.jwt.claims`, never a `current_user` branch on the policy | Accepted (shipped in `0016`) |
| [0032](#adr-0032) | **`email_messages` is cascade-deleted with its subject**, and the 24-month obligation keeps its home in `privacy_request_audits` | Accepted (shipped in `0015`) |

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
floor, and it is the effective floor for the whole repository. The backend
separately declares `>=22.18.0` — above Nest 12's own ≥ 20.19 — because `npm run
dev` imports the local SMTP sink directly and relies on Node's native TypeScript
stripping (ADR-0024).
---

<a id="adr-0023"></a>
## ADR-0023: Two orthogonal authorization axes — scope in RLS, capability in OLS

**Status:** Accepted, and **shipped**. `backend/database/migrations/0001_rls_foundation.sql`
implements this design and `backend/test/rls/rls.spec.ts` proves it with **68**
tests run by `npm run verify`. One clause is **not** enforced yet and is marked where
it appears: the grant-subset rule (§Least privilege). The superseded claim-keyed design
is recorded below, labelled, because a decision record that deletes its own
reversals is not a record.

**Context.** `angular/` has a permissions module with object-level security —
which features and endpoints a role may reach. Its fine-grained permissions were
**role-based**, and they did not intersect with any row-level notion, because no
row-level mechanism existed to intersect with. Role-based object security was
also never implemented at all.

> **CORRECTION — "never applied" was wrong.** This ADR originally recorded that
> `PermissionGuard` *"was never applied"*, and `rebase.md` repeated it. That is
> **false**, and the correct figure is the more serious one: the guard is applied
> on **47 endpoints** across seven controllers in the reference tree —
> `modules/roles/roles.controller.ts` (14 `@RequirePermission`),
> `modules/users/users.controller.ts` (8), and the five security/admin controllers
> `login-monitoring` (12), `security-alert` (6, class-level guard),
> `pattern-detection` (4), `login-attempts` (2), `ip-reputation` (1).
> Counted with `grep -c '@RequirePermission'` per controller.
>
> **It is absent from exactly one controller: `modules/users/groups.controller.ts`,
> which carries `@UseGuards(JwtAuthGuard)` and nothing else** — and group
> management is where RLS-rule administration lived (`rls-rules.controller.ts`,
> `rls-scope-templates.controller.ts`, `rls-join-paths.controller.ts`, plus the
> `scope-compiler` service).
>
> **So the accurate statement is the opposite of "unimplemented":** the
> group-management and RLS-administration surface sat behind **authentication
> alone**. Every guarded endpoint was guarded; the surface that can define *who is
> scoped to what* was not. A guard on `users:update` protects nothing about the
> scope predicate that user update runs under.

The actual requirement is two-dimensional, and the two dimensions have different
key material:

- **Objects** = the permission surface: which tables, which verbs, which pages,
  which endpoints.
- **Rows** = customers, or levels of a customer hierarchy.
- **Roles** = individual contributor, account manager, admin.
- **Invariant required:** every member of a group sees only that group's rows; an
  admin sees everything; and nobody may grant a capability they do not themselves
  hold.

Forcing one mechanism to carry both is what made the old system unusable: a
role-based check can be satisfied by a valid role no matter which group the caller
is standing in, so it can never express "your group's rows."

**Decision.** **Two axes, two mechanisms, two different key materials, and they
never compete.** Groups are the scope axis and nothing else. Roles are the
capability axis and nothing else.

| Axis | Question | Mechanism | Key material |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` — RLS | `groups` / `user_groups` membership, joined to `org_closure` |
| **Capability** | Which *objects*? — tables, verbs, columns, pages, endpoints | Object-level security: Postgres `GRANT`, plus `has_permission()` | `roles` / `role_permissions` / `permissions`, resolved from `user_roles` |

Both are read in the database, and both resolve from the token's `sub`. Neither is
computed from the other: `has_permission()` never reads `user_groups`, and the
scope policy never reads `user_roles`. **There is no table in which the two
appear on one row, and no combiner that resolves them against each other.**

> ## WITHDRAWN — an earlier form of the rule above was wrong, and following it
> > shipped a **silent privilege escalation**. Do not implement it.
> >
> > **The rule as withdrawn.** An earlier version of this ADR said: *"Three axes,
> > three mechanisms, three different keys. They never appear in the same
> > expression."* The same rule was restated in `AGENTS.md` B2 as a greppable
> > invariant — *"you must be unable to write one query or guard that filters by
> > site **and** by feature"* — and in `security.md` as *"Row scope and capability
> > never appear in the same expression."*
> >
> > **The failure it produced.** It is the natural thing to do, and it is exactly
> > wrong. Splitting the axes across policies puts scope in one `FOR ALL` policy
> > and each capability gate in its own per-operation policy:
> >
> > ```sql
> > -- the WRONG shape
> > CREATE POLICY scope_only ON t FOR ALL          USING (<scope>);   -- permissive
> > CREATE POLICY cap_delete ON t FOR DELETE USING (<capability>);   -- permissive
> > ```
> >
> > **Multiple PERMISSIVE policies on one operation are OR-ed.** `scope_only`
> > covers `DELETE` on its own, so the capability policy can only widen the set,
> > never narrow it. Verified end to end against the executed fixture: a member
> > holding **zero** capabilities ran `DELETE` — **1 row deleted** — and `INSERT` —
> > **1 row inserted** — with **no error and no warning**. `INSERT` behaves the
> > same way, because a `FOR ALL` policy's `USING` expression is reused as the
> > `WITH CHECK` when none is given.
> >
> > The gate was not weak. It was absent. And every component of it was
> > individually correct: the scope policy was right, the capability policy was
> > right, and both halves passed their own tests.
> >
> > **Two policies on one operation are only correct with `AS RESTRICTIVE`, which
> > ANDs with the permissive set:**
> >
> > | Shape | Semantics | Verified result |
> > |---|---|---|
> > | two **permissive** policies on `SELECT` | **OR**ed | `unit_id = 2` and `unit_id = 9` → a member scoped to unit 2 saw **2** rows |
> > | permissive scope + `AS RESTRICTIVE` capability | **AND**ed | same table, restrictive added → **1** row |
> >
> > So: **two permissive policies on one operation always widen access.** Never
> > split one operation's requirements across two of them.
> >
> > **What survives, and it is a different rule from the one withdrawn.** The
> > axes are separate **inputs** — scope is never derived from capability, and
> > capability is never derived from scope. **What is withdrawn is the mandate to
> > express them as two competing policies on one operation**, because that is
> > the one arrangement in which a capability check is silently OR-ed out of
> > existence. Under the decision above this cannot arise: scope is *one policy
> > per table*, and capability is *object-level security* — a grant, not a
> > competing `USING`. Neither axis can widen the other, and there is no
> > `AND`/`OR` combiner that has to reconcile them.
> >
> > **CORRECTED after the capability proof:** this originally said `has_capability()`
> > reads `current_user`. It does not — a `SECURITY DEFINER` function rebinds
> > `current_user` to its owner, which made the capability check an unconditional
> > `false`. See §Capability.
> >
> > The failure mode is worth naming: the withdrawn rule looked like a *safety*
> > property ("these axes can never interact") when it was in fact a *correctness*
> > hazard.

> **CORRECTED after the closure-join design test.** Two cells of the earlier
> three-axis table were wrong. **Scope** was documented as keyed on `site_id` in
> the JWT; it is keyed on **membership in a table**, so a revoked membership bites
> on the next request rather than at token expiry. **Capability** was documented as
> a `role_capability(db_role, capability)` row keyed on the **PostgreSQL role
> name** — which left the `roles` table unconnected to authorization entirely.
> It is now a real FK chain, `role_permissions.role_id → roles.id`, resolved from
> the caller's `user_roles` rows. See §Capability.

### Roles are rows. Database roles are a separate, smaller thing.

Getting this wrong collapses the model, so it is stated as two namespaces with no
overlap:

| Namespace | Values | Used by |
|---|---|---|
| **Database role** | `app_anon`, `app_member`, `app_admin` | PostgREST impersonation, the boundary `GRANT`, table and column privileges |
| **Role** (a row in `roles`) | whatever the fork names them — `account_manager`, `support`, `administrator` | capability: `user_roles` → `roles` → `role_permissions` → `permissions` |

> **Corrected after execution.** This section originally read the second row as
> `ic` / `site_manager` / `admin` — a **fixed label vocabulary** held as
> `role_capability(db_role, capability)`, with the DB role as the key. Two things
> were wrong with it. The labels are gone: capability is now
> **`resource` + `action` over a table**, not a closed vocabulary of tier names,
> so a new capability is a new row rather than a new tier name. And the key was
> wrong in the way that mattered most — keying capability on a *PostgreSQL role
> name* means the `roles` table is not referenced by anything, so changing the
> schema cannot tell you what a role can do. `role_permissions.role_id` is now a
> real foreign key.
>
> **The DB role names are load-bearing, not shorthand.** The values that actually
> reach Postgres are the ones PostgREST `SET ROLE`s to, and they are the
> `app_`-prefixed names; a policy written against the bare vocabulary produces a
> branch that can never match (see §Why `current_user` discriminates the admin
> tier). Note that the word *admin* appears in both namespaces and means two
> unrelated things — which is exactly why collapsing them failed silently rather
> than loudly.

- *Two members of the same group holding different roles* → yes, and correctly so.
  Same rows, different capabilities.
- *Two members of different groups holding the same role* → yes. Same
  capabilities, different rows.
- *One member with both* → the normal case, and it is not a special case: **every
  user has at least one role and at least one group**, and each is resolved on its
  own axis.

**Named anti-pattern.** Do not create DB roles named after capabilities, and do
not store a PostgreSQL role name in the `roles` table. Both collapse the two axes
into one, force a policy per role per table, and reinvent the exact coupling this
ADR exists to remove.

### Row scope

One policy per table. It must be **total** — every `OR` branch is evaluated, so a
cast in any branch can take the whole query down.

> **SUPERSEDED — the identity source, not the mechanism.** The mechanism (RLS,
> below the application) stands and is why this section exists. The **key** does
> not: the claim-keyed, per-row-walk design first documented here has been
> **replaced**, and it is no longer in the tree. Membership is a **table read**,
> not a token claim, and the walk is **precomputed**. The old design is kept below,
> labelled, because a decision record that deletes its own reversals is not a
> record.

**WITHDRAWN — the claim-keyed, per-row-walk design. It does not ship:**

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

Its corrected descendant — admin branch on `current_user`, guarded `uuid` cast —
is also superseded:

```sql
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

**What replaces it — membership in a table, joined against a closure, in the `authz`
schema:**

```sql
-- Authorization internals live outside `db-schemas = "public"`, so PostgREST cannot
-- address them. A relation the policies must read has to be granted to every serving
-- role, and a relation in `db-schemas` with a grant is one GET away.
CREATE SCHEMA authz;
GRANT USAGE ON SCHEMA authz TO app_anon, app_member, app_admin;

-- group hierarchy (admin-writable), membership (NOT member-writable), closure matview
CREATE TABLE groups (id uuid PRIMARY KEY, parent_id uuid REFERENCES groups(id),
                     name text NOT NULL, is_system_group boolean NOT NULL DEFAULT false);
CREATE TABLE user_groups (user_id uuid NOT NULL, group_id uuid NOT NULL REFERENCES groups(id),
                          PRIMARY KEY (user_id, group_id));

-- The cast applies to the extracted text: parenthesise, because `::` binds tighter
-- than `->>`. And it is CAUGHT: a malformed `sub` is a denial, not a 500.
CREATE FUNCTION authz.actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE raw text;
BEGIN
  raw := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub');
  IF raw IS NULL OR raw = '' THEN RETURN NULL; END IF;
  RETURN raw::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE POLICY row_scope ON projects USING (
    current_user = 'app_admin'
    OR group_id IN (
        SELECT c.descendant FROM user_groups ug
        JOIN authz.org_closure c ON c.ancestor = ug.group_id
        WHERE ug.user_id = authz.actor()
    )
);
```

> **Migration status, stated plainly.** `0001_rls_foundation.sql` **has** been
> rewritten to this design and the RLS suite has been rewritten against it: **68
> tests**, green, run by `verify`. `grep -rnE 'CREATE[[:space:]]+(TEMP(ORARY)?[[:space:]]+)?TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?sites\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[^[:space:]]*(site_tree_ids|claim_site_id|request_claims)\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?VIEW' backend/database/`
> returns nothing — it asserts on the **executable construct**, not on the bare
> word, because the SUPERSEDED NOTE quotes `sites`, `claim_site_id()` and
> `site_tree_ids()` in order to explain the withdrawal, so a substring gate returns
> lines and reads as a failure. A green `test:rls` **is** evidence for this
> ADR, with two stated exceptions: the **grant-subset trigger** is **not** enforced
> (§Least privilege) and the whole scope axis rests on a caller-writable GUC (§F1).

| Input | Result |
|---|---|
| member of `EU` | `EU`, `UK`, `FR` — **not** `HQ`, **not** `US` |
| member of `HQ` | everything beneath `HQ` |
| member of two disjoint groups | the **union** — `IN`/`ANY`, never `AND` |
| no membership rows | **zero rows**, no error |
| a non-uuid or empty `sub` | **`HTTP 500`**, not `403` — fail-closed, wrong signal |
| membership changed since the token was minted | new scope on the **next request**, same token |

That last row is the operational payoff and it is why scope is a table read:
**membership changes take effect on the next request with the same token**, because
membership is looked up per statement rather than carried in a claim the issuer
controls.

#### F1 — scope is keyed on a setting the caller can write

**This is the sharpest edge in the design, it is not a bug today, and it is not
fixed by anything in the schema.**

`request.jwt.claims` is a **custom GUC**. PostgreSQL applies **no privilege control
to custom dot-prefixed settings**: any role that can run `SET` can set it. Verified
on the shipped schema — a member issued `SET request.jwt.claims = '{"sub":"…"}'`
for another tenant and **read that tenant's rows**. No error, no warning.

The same is true of the `role` GUC, and of any `app.*` GUC this design might
introduce.

| | |
|---|---|
| **What it would take to fix structurally** | something the database enforces rather than something the topology permits. There is no such mechanism for a custom GUC in PostgreSQL |
| **What the control actually is** | **the absence of a request-reachable SQL path that can `SET` it.** The thin app has no SQL path at all (no ORM), and PostgREST sets the claims itself from the verified token, so today nothing a caller controls reaches the setting |
| **Why that is fragile** | it is an *absence*, and absences do not survive the next feature. **`db-pre-request` is exactly such a path being planned** (revocation), and any `/rpc/` that takes SQL, any `pg` client, and any future `SET`-capable helper all re-open it |
| **Severity if it opens** | **P0.** Cross-tenant read for any authenticated principal, with no error |

Two rules follow, and they are not the same rule:

1. **Any `pg` client, RPC, or `db-pre-request` hook that can reach `SET` on
   `request.jwt.claims` is a P0**, and must be shown not to exist before that work
   lands — not after. Assert the absence.
2. **`has_permission(who, …)` taking `who` as a parameter is the same class of
   hazard.** See §Capability: nothing in the tree supplies `who` from the verified
   token. It arrives in the RPC body verbatim.

**Do not "fix" this by moving scope into a different custom GUC.** That design was
built and **rejected as a vulnerability, not a trade**: a member read 50 rows, called
`set_config('app.scope', …)` on its own GUC, and read **500**. Custom GUCs have no
privilege control and `SET LOCAL` gives no protection, because the caller is the one
setting it.

#### Why the subquery is evaluated once, and why that took a measurement

The scoping expression is **hoisted**: `loops = 1` at 305 rows and `loops = 1` at
3305 rows. A deliberately correlated variant of the same query gives `loops = 305`.
That is the whole performance argument, and it is two orders of magnitude, not the
~1.7× that the withdrawn recursive-walk benchmarks produced.

The plan node is a **`hashed SubPlan`**, not an `InitPlan`. Two things are being
conflated and both are load-bearing:

- **Uncorrelatedness is what buys once-per-statement**, not the node type. A
  `STABLE` function called per row (the withdrawn design) was never hoisted at all;
  `STABLE` means *"same answer within this statement"*, not *"called once"*.
- **`x IN (SELECT …)` specifically yields the hashed SubPlan form.** `InitPlan` is
  for **uncorrelated scalar** subqueries — the ones whose answer is one value used
  many times. A set-valued uncorrelated subquery is hashed instead.

> **Note for anyone benchmarking this.** An `EXISTS`-shaped "correlated" variant is
> **simplified back into a hashed SubPlan** by the planner. Reading the policy text
> and concluding it is correlated is therefore wrong; only `loops` in the plan
> reveals the truth. Assert on `loops`, not on the SQL's apparent shape.

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
> The discriminator is **`current_user`**, which Postgres sets from the
> `SET ROLE` PostgREST performs — and which the escalation boundary (below) has
> already constrained to three roles. That matters beyond correctness: **a claim is
> caller-supplied and signed by whoever holds the secret; `current_user` is
> neither.** A member who forges `"role":"admin"` into their own validly-signed
> token gets **zero rows** — verified — because nothing reads that field. Keying
> the admin tier on the token would re-open the exact escalation hole this policy
> exists to close.
>
> **`current_user` is read only outside a `SECURITY DEFINER` function.** Inside one
> it rebinds to the *function owner*, which is how the withdrawn capability check
> came to return `false` for a role that held the capability row. See §Capability.

#### Why a guarded accessor, not `nullif`

> **WITHDRAWN — and the conclusion changed too, not just the mechanism.** This ADR
> argued that a garbage `site_id` was harmless on an admin token because *"`TRUE OR
> NULL` is `TRUE`, so the failing cast on the right never matters."* That reasoning
> is invalid: `OR` does not short-circuit past an expression that raises, both
> operands are evaluated, and the error wins. Verified — in the withdrawn policy an
> admin token carrying `"site_id":"garbage"` returned
> `invalid input syntax for type uuid: "garbage"`, and so did a member token.
>
> The corrected claim in this section was that the **two-argument**
> `current_setting` is the dangerous form and the guarded accessor is the fix.
> **That is inverted for this case, and the inversion is measured.** The
> two-argument form **raises** — `HTTP 500`. The **three-argument** form with
> `nullif` and an exception-guarded cast gives a **clean denial**. Keep the
> three-argument form. The reason is that `missing_ok = true` is what turns "no such
> setting" into `NULL`; the `''`-instead-of-`NULL` behaviour appears once anything
> has been `SET LOCAL` in the session, and only a cast guarded by `nullif` **and** an
> exception handler survives that.
>
> **One residual, stated because it is a real defect and it is fail-closed.** A
> non-uuid or empty `sub` yields **`HTTP 500`**, not `403`. Nothing is disclosed and
> nothing is admitted, but the status is an internal error rather than an
> authorization decision, and an operator reading logs will chase the wrong thing.
> The fix is to catch the cast in `actor()` and return `NULL`; it is recorded here
> because a 500 is not an acceptable long-term denial signal even when it is safe.
>
> **CLOSED in the shipped migration.** `authz.actor()` wraps the cast in
> `EXCEPTION WHEN others THEN RETURN NULL`, and the suite asserts that `"sub":"garbage"`
> and a token with **no** `sub` both return **zero rows** for a member and do not
> break an admin. Recorded here because the shape of the fix — parenthesise the
> extraction, then catch the cast — is the part that gets re-broken.

### The hierarchy

"Levels of the customer hierarchy" is a function of position in a tree, so scope
is tree-derived rather than equality.

> **REVERSAL — a closure table was rejected by this ADR and is now the design.**
> See §The hierarchy decision below. The rejection was of *incremental repair*, not
> of closure: the repair silently disagreed with the tree in 5 places with no error.
> Replacing repair with **wholesale refresh of a closure matview** removes the
> failure mode rather than tolerating it. The earlier finding is kept and corrected
> in place rather than deleted.

**What the design is now — a closure materialized view in `authz`, refreshed, not
walked:**

```sql
-- `authz`, not `public`: the closure needs a SELECT grant for every role whose
-- requests evaluate the scope policy, and a relation in `db-schemas` with that
-- grant is the whole org tree, one GET away.
-- closure: NO accumulator column in the recursive row, UNION (not UNION ALL)
CREATE MATERIALIZED VIEW authz.org_closure AS
WITH RECURSIVE t AS (
    SELECT id AS ancestor, id AS descendant FROM groups
  UNION
    SELECT t.ancestor, g.id FROM t JOIN groups g ON g.parent_id = t.descendant
)
SELECT ancestor, descendant FROM t;

-- UNIQUE INDEX authz_org_closure_uniq ON authz.org_closure (ancestor, descendant)
--   -- required for CONCURRENTLY
-- statement-level trigger on groups issuing REFRESH MATERIALIZED VIEW CONCURRENTLY
```

Three details in that snippet are load-bearing and each has a section below:

- **`UNION`, not `UNION ALL`** — this is what terminates on a cycle. §Cycle safety.
- **No accumulator column** — an accumulator is exactly what makes `UNION` unable to
  deduplicate. §Cycle safety.
- **The trailing `SELECT ancestor, descendant FROM t`** — without it the statement
  is a syntax error. §Corrections to the record.

**Do not copy the shorthand.** `CREATE MATERIALIZED VIEW … AS WITH RECURSIVE …` is
a **syntax error in PostgreSQL 15** when the CTE is the whole query. The design above
parses only because of the trailing `SELECT`. That is recorded as a correction
rather than fixed in the snippet so the snippet stays diffable against what was
executed.

> **Corrected after execution.** `RETURNS SETOF uuid` **cannot be used in a policy
> expression** — Postgres rejects set-returning functions there with *"set-returning
> functions are not allowed in policy expressions"*. The original example was never
> executed, so **this policy never compiled**. A function in a policy must return a
> single scalar — an array — or the closure must be read directly by the policy,
> which is what the proven design does.

**WITHDRAWN — the example this section originally gave:**

```sql
CREATE INDEX ON customers(parent_id);

-- CORRECTED. This list originally read "Three defects ... PARALLEL SAFE costs
-- ~170x". Two of the three are real. The PARALLEL claim is WITHDRAWN as false:
-- measured, PARALLEL SAFE was FASTER (5.8 s vs 12.5 s), because it permits a
-- parallel plan. See "Performance: what is actually true" below.
-- The two real defects: SETOF cannot appear in a policy; and under the default
-- SECURITY INVOKER the walk recurses through its own policy until the stack dies
-- (see below).
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

**An earlier revision of `0001_rls_foundation.sql` contained this — SUPERSEDED, kept
for the record, and gone from the tree:**

```sql
CREATE INDEX IF NOT EXISTS sites_parent_id_idx ON sites (parent_id);

-- Returns uuid[] (a scalar), not SETOF uuid.
-- PARALLEL UNSAFE is the DEFAULT for a new function and is kept deliberately for
-- a SECURITY DEFINER helper. It is NOT here for performance -- the previous
-- comment said "PARALLEL SAFE forced single-threaded evaluation", which is
-- measured false.
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

**Verified row counts for the superseded claim-keyed design**, over a five-row
fixture (a root → mid → leaf chain, one unrelated site, one second root). These
figures describe `site_tree_ids()` + `claim_site_id()`, not the closure design
above; they are kept because they are the numbers the suite asserts and because
"unrelated → 1" is a property of *self-inclusion*, not of the storage.

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

**Performance: what is actually true, and what was withdrawn.** Re-measured on
PostgreSQL 15.19 against the 400,000-row fixture (`hypothesis_test.h3_big`) with
identical function bodies and only the declaration changing.

| Claim as previously written | Verdict | Measured |
|---|---|---|
| "a 400,000-row scan produced 400,001 calls" | **TRUE — keep it** | 400,001 calls, `pg_stat_user_functions` |
| "`PARALLEL SAFE` cost ~170× slower" | **FALSE — withdrawn** | `PARALLEL SAFE` **5.8 s** vs `PARALLEL UNSAFE` **12.5 s** — **faster** |
| "`PARALLEL SAFE` forces single-threaded evaluation" | **FALSE — withdrawn** | it permits `Gather` + `Parallel Seq Scan`, 4 workers launched |
| per-row evaluation is caused by `VOLATILE` | **FALSE — withdrawn** | `STABLE` **12.5 s** vs `VOLATILE` **21.9 s**; `VOLATILE` ≈1.7× slower and **neither is hoisted** |
| "a `STABLE` function is hoisted into a one-time InitPlan — 2 invocations for 20,040 rows" | **FALSE — withdrawn** | the same function on 20,410 rows: **20,411 calls** |
| "for large tables, denormalise the scope instead of recursing per row" | **WITHDRAWN as advice** | see below |

**The per-row evaluation is real; the reasons given for it were not.** Measured
directly with `pg_stat_user_functions`, on the **superseded** shape
(`STABLE SECURITY DEFINER`): 400,001 calls over 400,000 rows, 20,411 over 20,410,
and `EXPLAIN` places the call inside the Seq Scan's `Filter` rather than in an
`InitPlan`. `STABLE` guarantees only *"the same answer for the duration of this
statement"* — it does **not** mean "called once". A stable function appearing in a
qual that also references a column is evaluated per candidate row.

> **Terminology correction, because it was used wrongly elsewhere in this file.**
> `InitPlan` is not the word for "an uncorrelated subquery". It names the plan node
> for an uncorrelated **scalar** subquery — one row, one value. `x IN (SELECT …)` on
> a set-valued subquery is planned as a **`hashed SubPlan`**. Both are evaluated
> once per statement, so conclusions about *once per statement* are unaffected; only
> the node name was wrong. The measured contrast in this file is real and is not a
> naming artefact: the closure subplan shows `loops = 1` at 305 and at 3305 rows,
> the correlated variant shows `loops = 305`, and the superseded `STABLE` function
> shows one call per candidate row. See §Row scope.

**Why the "denormalise" advice is withdrawn.** It invited optimising a function
whose **single-call** cost is sub-millisecond, and it would not have bought
anything: the expense is per-row **repetition**, not per-call cost. Rewriting the
hierarchy's storage to reduce a repetition count is a data-model change made for a
benchmark number, and it trades a correct recursive walk for a cache that must be
repaired (see below, where repair is exactly what failed). The honest statement of
the trade is that the cost is **linear in rows scanned**; if that ever matters, the
answer is a narrower predicate or an index, measured — not a speculative rewrite.

> **CORRECTED — the reasoning above is sound but its premise is no longer
> operative.** "Denormalise the scope" is no longer *withdrawn advice*: the scope
> **is** denormalised, into `org_closure`. What is withdrawn is only the *reason*
> the paragraph gave — optimising a ~3 ms function call. The denormalisation that
> shipped is justified by **once-per-statement evaluation** (`loops = 1`), which the
> recursive walk never achieved. And the "repair is what failed" argument applies
> only to *incremental* repair: a closure refreshed wholesale from `groups` has no
> incremental repair to get wrong. See §The hierarchy decision.

`PARALLEL UNSAFE` is still correct for the shipped function, but on different
grounds: it is the **default** for a new function, and a `SECURITY DEFINER` helper
should not be relaxed to `PARALLEL SAFE` because one benchmark was faster. The
parallel plan measured above was only reachable after forcing
`parallel_setup_cost = 0` and `min_parallel_table_scan_size = 0` — hostile
settings that no real deployment runs.

`STABLE` is required so the planner may use the result for its stability
guarantees.
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

### The hierarchy decision, and the alternatives that were built and tested

**KEPT: the closure materialized view `org_closure`, refreshed wholesale.** The
scoping subquery is hoisted (`loops = 1` at 305 and at 3305 rows), scope is read
from a membership table rather than a token claim, and there is **no incremental
repair** — the view is rebuilt from `groups` — so the failure mode that rejected the
closure table below no longer exists.

**SUPERSEDED — and now gone from the tree: the recursive `STABLE` function.** It was
in `0001_rls_foundation.sql` and it was the shape the RLS suite exercised; the W26/W27
rewrite removed it. It was one call per candidate row (400,001 calls over 400,000
rows) and it was keyed on a claim rather than on membership. It was kept at the time
because every faster alternative introduced a way for the answer to be **wrong without
saying so**. The closure view is the alternative that turned out not to have that
property — because it is *rebuilt*, not *repaired*.

**1. Per-session scope cache — REJECTED AS A VULNERABILITY, not a trade-off.**

Cache the resolved scope once per session in a GUC and read it from the policy,
instead of re-deriving it per request. This is the obvious optimisation, and it is
**catastrophically unsafe**:

```sql
-- the rejected design
CREATE FUNCTION session_scope() RETURNS integer[]
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(nullif(current_setting('app.scope', true), '')::int[], '{}')
$$;
```

Verified, as a member holding no special privilege:

| | rows read |
|---|---|
| honestly scoped to unit 150 (`app.scope = '{150}'`) | **50** |
| after `set_config('app.scope', '{150,151,…,159}', true)` | **500** |

The member **widened its own scope by one call.** Custom, dot-prefixed GUCs have
**no privilege control whatsoever** — `GRANT`/`REVOKE` do not apply to them — and
`SET LOCAL` provides **no** protection, because the caller is the one setting it.
The policy cannot distinguish an operator-supplied scope from an attacker-supplied
one; there is nothing in the database left to distinguish.

It is therefore **strictly worse than the alternative and no faster**: the
superseded recursive walk costs ~3 ms, and the cache buys nothing while converting a
correct denial into a correct-looking escalation.

> **Rule: never cache authorization scope in a GUC the caller can set.** If scope
> must be cached, it has to be derived from something the caller cannot write —
> which, for JWT claims, means nothing at all. `request.jwt.claims` is safe
> precisely because PostgREST sets it from a verified token and the application
> role cannot reach `SET` on it in a way a caller can reach.

**2. Closure table with incremental repair — REJECTED, and the rejection is now
recorded as reversed.** Faster than the recursive walk, and it is the standard
answer. Its problem was repair. Executed against the fixture and compared against
the recursive walk for **every** unit:

| | |
|---|---|
| ancestor/descendant pairs the walk has and the closure does not | **5** |
| pairs the closure has and the walk does not | **5** |
| roots affected | **9** |
| errors raised | **0** |

The incremental repair **silently disagreed with the tree in 5 places**, with no
error, no constraint violation, and no observable symptom other than a policy
returning the wrong answer. Worse: root **1** had the *same count* on both sides
(**241**) and different membership, so any count-based sanity check passes. A
mechanism that can be wrong in several directions at once while reporting success
is the same failure class this whole ADR exists to reject.

> **REVERSED — and this is the most important reversal in this ADR.** The rejection
> above was of **incremental repair**, and this record let it stand as a rejection
> of *closure*. That was over-general: the finding was "repair can be wrong without
> saying so", not "a precomputed closure is unsafe". Rebuilding the closure
> wholesale — `CREATE MATERIALIZED VIEW org_closure AS WITH RECURSIVE …`, refreshed
> by a statement-level trigger on `groups` — has no repair step that can drift, and
> it is the design now kept.
>
> **What survives of the old finding, and is still true:** *any* mechanism that
> updates a denormalised scope incrementally must be proved to agree with the
> source, and a count comparison does not prove it. The 241-vs-241 result is the
> reason. If an incremental repair is ever reintroduced, the test must compare
> **membership**, not counts.
>
> The trade this reversal now carries: the closure is only as fresh as its last
> refresh. That is handled by refreshing **inside the writing transaction**, so
> there is no staleness window at all — see §Matview-specific hazards.

**3. `ltree` — rejected.** The natural fit for a hierarchy, and the fastest read
path. Its `UNIQUE` constraint on `path` makes the obvious repair **fail outright**:
re-parenting a node onto an already-occupied path raises
`duplicate key value violates unique constraint "org_ltree_path_key"` — verified.
Repair therefore needs a multi-statement dance (move the subtree aside, rewrite
every descendant prefix, move it back) that is only correct if nothing observes the
intermediate state.

> **A correction to the record.** An earlier draft of this section justified
> rejecting `ltree` by claiming `postgresql-contrib` is *not installed on this
> host*. That is **wrong**: `postgresql-contrib 15+248+deb12u1` is installed, and
> `ltree 1.2` is already an extension in the proof database. The genuine reason to
> reject `ltree` is the `UNIQUE` constraint above, and it stands on its own.
> (`ltree` is genuinely an optional contrib module, so a fresh host may lack it —
> but that is not this host, and it should not have been offered as evidence.)

### Capability is a table, resolved by `has_permission()` from the caller's roles

**Decided: capability is the OLS axis, expressed as `resource` + `action` over a
**table**, and resolved from the caller's role rows — never from a PostgreSQL role
name, never from a per-user override, and never from the group axis.

This supersedes two earlier answers. The first was "capability in the thin app's
guards"; the second was "capability in a `role_capability` table keyed on the
PostgreSQL role name". Both are withdrawn, for the reasons in the correction below.

#### The schema

```
CAPABILITY (OLS)                        SCOPE (RLS)
──────────────────                      ────────────────────────────
actions(name)                            groups(id, parent_id, is_system_group)
permissions(id, resource, action_id)     user_groups(user_id, group_id)
      UNIQUE (resource, action_id)       org_closure(ancestor, descendant)
roles(id, name, parent_id)                      UNIQUE (ancestor, descendant)
      is_system_role                     <scoped tables>(group_id, id, …)
role_permissions(role_id, permission_id)       composite PK, FKs stay in-set
user_roles(user_id, role_id)
```

- **Every user has at least one role and at least one group.** Neither axis has a
  "nobody" case, so there is no missing-permission state to represent.
- **Both hierarchies inherit downward from their parents.** `roles.parent_id` means
  a child role holds everything its parent holds, so the resolution walks *up*
  from the caller's roles and collects the union. `groups.parent_id` means a
  group's rows include its descendants' rows, which is the closure join.
- **`is_system_role` / `is_system_group` mark rows the application may not remove,
  and they are now ENFORCED.** They were declared and read by nothing — `app_admin`
  holds `DELETE` on both tables and `DELETE FROM roles WHERE is_system_role = true`
  returned `204` with the row gone. **A column documented as a control and enforced
  by nothing is worse than no column**, because the comment tells a reader the
  control is there. The shipped trigger:
  - **The rule:** a row that *is* a floor row may not be `UPDATE`d or `DELETE`d
    except from a superuser session. `INSERT` is deliberately **not** covered —
    the floor has to be creatable, and adding one is not the risk; removing or
    rewriting one is, since the floor is what capability resolution rests on.
  - **`SECURITY INVOKER`, and it must stay that way.** The whole function is a
    question about the caller, so a `DEFINER` body would answer about the **owner**
    and every check would pass. It reads no table — the row's own JSON is the input —
    so `INVOKER` costs it nothing. This is the same identity trap as the resolver,
    pointing the other way: `DEFINER` here would be a floor that never fires.
  - **The superuser path is `current_setting('is_superuser')`, NOT `current_user`.**
    `is_superuser` derives from `SESSION_USER` and is not changed by `SET ROLE`,
    which is precisely what is wanted: the check must survive the escalation
    boundary, or the provisioning path (`pgrst_authenticator` `SET ROLE app_admin`)
    would be indistinguishable from a request. Measured: `on` for a `postgres`
    session, `off` for `app`, `pgrst_authenticator`, and every serving role after
    `SET ROLE app_admin`.
  - **A trigger, not a grant**, because the floor is **per-ROW** and grants are
    **per-TABLE**. Withholding `DELETE` from `app_admin` would remove the capability
    from every ordinary row to protect one, and would break "superset, not a bypass"
    — which is asserted over every table in `pg_tables`.
  - **What it does not cover, stated rather than discovered later:** `TRUNCATE` does
    not fire a row trigger. It is closed by the grants instead — no serving role
    holds `TRUNCATE` on either table — and that is asserted per role rather than left
    in a comment, because a future table-level `TRUNCATE` grant is the change that
    would reopen this.
- **`UNIQUE (resource, action_id)` is what makes a capability addressable.** A
  capability is `('project', 'delete')`, resolved from two columns, not a string
  that has to be parsed at every call site.

```sql
CREATE TABLE actions (name text PRIMARY KEY);                    -- read, create, update, delete, …
CREATE TABLE permissions (
  id        uuid PRIMARY KEY,
  resource  text NOT NULL,
  action_id text NOT NULL REFERENCES actions(name),
  UNIQUE (resource, action_id)
);
CREATE TABLE roles (
  id            uuid PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  parent_id     uuid REFERENCES roles(id),
  is_system_role boolean NOT NULL DEFAULT false
);
CREATE TABLE role_permissions (role_id uuid REFERENCES roles(id),
                               permission_id uuid REFERENCES permissions(id),
                               PRIMARY KEY (role_id, permission_id));
CREATE TABLE user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL REFERENCES roles(id),
                         PRIMARY KEY (user_id, role_id));

-- Identity is the caller's, passed IN. Never current_user, never
-- current_setting('role'), and NOT wired to actor() -- see the corrections below.
--
-- THIS IS THE SHIPPED FORM. $1/$2/$3 rather than the parameter names, because in a
-- SQL function an unqualified name that also names a column in scope resolves to the
-- COLUMN: `p.resource = resource` parses as `p.resource = p.resource`, always true.
-- Measured: project/read answered true for a member whose role held only
-- customer/read.
--
-- The ancestor set is SEEDED in the CTE, and the join starts at role_permissions --
-- not at the caller's own roles with a filter on top. Joining role_permissions to
-- user_roles first and then filtering `rp.role_id IN (<ancestors>)` caps inheritance
-- at the caller's own roles: the join has already discarded every ancestor's rows, so
-- the filter is a no-op and resolution is silently ONE LEVEL DEEP. Measured: a
-- manager two levels below a role holding project/read was denied it.
--
-- UNION, not UNION ALL -- same reason as the closure. On a cyclic role graph the
-- UNION ALL form never reaches a fixed point. Verified: has_permission hung.
CREATE FUNCTION has_permission(who uuid, resource text, action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM  role_permissions rp
    JOIN  permissions p  ON p.id = rp.permission_id
    JOIN  actions a      ON a.name = p.action_id
    WHERE p.resource = $2
      AND a.name     = $3
      AND rp.role_id IN (          -- walk UP: a child holds what its ancestors hold
        WITH RECURSIVE up(id) AS (
          SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = $1
          UNION
          SELECT r.parent_id FROM roles r JOIN up ON up.id = r.id
          WHERE r.parent_id IS NOT NULL
        )
        SELECT id FROM up
      )
  )
$$;
```

> **Precomputing the role ancestor set into a second closure view is NOT done, and
> is not yet justified.** It is the same argument that decided `org_closure` — a
> `STABLE` function in a qual is evaluated once per candidate row (measured 400,001
> calls over 400,000 rows), not once per statement, so a precomputed set would show a
> hashed SubPlan with `loops = 1`. At a role count in the tens, a second denormalised
> view is not worth it. **Measure before adding one**; this is advice, not a shipped
> fact, and an earlier version of this ADR stated it as though the shipped function
> had already done it.

- **A new permission is one inserted row and no migration.** Verified in the
  executed design test: adding one permission to one role needed no DDL and no
  policy change, because nothing hard-codes a permission list.
- **Modelling a permission set as database roles is a dead end — enumerated, not
  asserted.** A policy can only test the serving identity, so a permission set
  expressed as roles needs one role per distinct set: the five permissions in the
  fixture are 2⁵ = **32** sets, the empty one already served by the base role, so
  **31 additional database roles**, each with a policy per table plus a
  cluster-scoped `GRANT … TO pgrst_authenticator` that requires `ADMIN OPTION` —
  the same class of superuser statement as the escalation boundary itself.
- **Database role inheritance cannot help — it only adds, never subtracts.**
  Verified: `REVOKE` a privilege *from the child* and it is still there, because
  inheritance puts it straight back. And every serving role is `NOINHERIT`
  (`rolinherit = f`), so role membership is inert for privilege resolution anyway.
  That is why `roles.parent_id` is **application data in a table**, resolved by
  `has_permission()`, and not PostgreSQL `GRANT`-based role membership.

- **`has_permission()` takes the actor as an argument**, so the caller is explicit
  and the function never has to guess who it is asking about. A check on behalf of
  another user is a different question and reads differently.
- **Identity inside a `SECURITY DEFINER` function comes from the verified token,
  never from `current_user`.** Measured, inside one: `current_user` = `app`,
  `current_role` = `app`, `session_user` = `pgrst_authenticator`, and only the
  claims setting and the `role` GUC track the caller. `current_user` rebinds to the
  **function owner**, so a body reading it returns the same answer for everyone —
  which is a check that denies everyone with an ordinary zero-row result, and is
  indistinguishable from a working one. **Assert the positive case: an actor
  holding a permission passes.**
- **`SECURITY INVOKER` is not the alternative.** It would need `SELECT` on
  `role_permissions` and `permissions` for every serving role, publishing the
  **entire permission matrix** — exactly what capability is meant to keep private.
  Keep `DEFINER` and pass the actor in.
- **`FOR INSERT WITH CHECK` and `FOR DELETE USING` discriminate by operation**, so
  an `INSERT` requirement cannot be satisfied by the `DELETE` one. Verified against
  all four policies on the fixture.

#### CORRECTED — the previous capability model left the `roles` table unconnected

> **The failure.** The previous design stored capability as
> `role_capability(db_role, capability)`, keyed on a **PostgreSQL role name**.
> Two things are wrong with it, and the second is the serious one.
>
> 1. **Capability was a closed vocabulary of tier labels** — `ic`, `site_manager`,
>    `admin` — so "which features exist" was a decision about tier names rather
>    than about the application. Adding a feature meant either inventing a tier or
>    editing a grant.
> 2. **The `roles` table was referenced by nothing.** A capability was matched
>    against `current_setting('role', true)`, i.e. the database role. Nothing in
>    the schema connected `roles` to `role_capability`, so no query, no constraint
>    and no migration could answer *"what can this role do?"* — the table and the
>    vocabulary were only joined by application code, which is where the old
>    permissions module lived and where it enforced nothing.
>
> **The correction is the foreign key.** `role_permissions.role_id` is now a real
> FK to `roles.id`, `user_roles` is a real FK to `roles.id`, and the permission
> surface is expressed directly as `resource` + `action`. **There is nothing to
> scan and nothing to cache:** PostgREST generates the API surface from the
> schema, so the permission surface is *which tables and which verbs*, and those
> are the columns.

#### CORRECTED — `has_capability()` was dead, and the capability axis was silently absent

> **The measurement, kept because it generalises.** The withdrawn function read
> `WHERE rc.db_role = current_user` inside a **`SECURITY DEFINER`** function.
> `SECURITY DEFINER` rebinds `current_user` to the **function owner**, so the
> predicate compared the capability table against the *owner's* role name, never
> against the serving role. **Measured: it returned `false` for `app_admin`
> *while holding* the capability row.** The function, the table, the policy and
> the grant were all present and all correct-looking; the check was an
> unconditional `false`.
>
> **Why it is the worst class of defect in this project.** The capability axis is
> not weakened — it is *absent*, and it is absent in the shape that *denies*.
> Every capability-gated operation is refused for every caller, including the ones
> who should have it. Nothing leaks. But nothing reports an error either: a policy
> reading `false` is a perfectly ordinary zero-row result, indistinguishable from a
> correct denial. A capability system that silently denies everyone looks exactly
> like a capability system that works.
>
> **Where the fix lives now — and the correction to it.** `has_permission()` takes
> `who` as a parameter rather than reading a role-valued setting inside a `DEFINER`
> body, so there is no `current_user` to get wrong. **The previous version of this
> section claimed that "`actor()` supplies it from the verified claims". That
> wiring does not exist in the tree, and nothing ever implemented it.** `has_permission`
> is a `SECURITY DEFINER` function whose first argument is `who`; `actor()` is a
> separate function used only by the scope policies and by
> `authz.visible_group_ids()`. PostgREST publishes `has_permission` as an RPC in
> `public`, so **`who` arrives in the request body verbatim** — caller-supplied,
> unsigned by anything the database checks.
>
> Consequence, stated rather than smoothed over: `has_permission` is **advisory for
> a caller checking itself** and must never be made the enforcement point for CRUD,
> which is table grants.
>
> **And it is a disclosure oracle, which is why `app_anon` is excluded.** Because
> `who` is an argument, a sweep of `(who, resource, action)` recovers any user's
> entire capability set. Measured on the grant this replaced: **63 probes,
> unauthenticated, recovered the administrator's complete permission set**, and the
> function became an oracle for *"does this uuid hold any role at all"*. The shipped
> grant is `TO app_member, app_admin` — **not** `app_anon`, and the file's own
> general rule about granting helpers to `app_anon` does not apply here because **no
> policy calls this function**.
>
> **What remains is a deliberate trade:** an authenticated member can still read
> somebody else's capabilities. Capability is data, not a secret, and a self-only
> wrapper cannot express *"may this user do X"* without the caller being that user.
> Narrower still (`app_admin` alone) is possible, was considered, and would remove
> the per-user capability surface the application needs.
>
> The `role` GUC finding still stands for any helper that does need it:
> **`current_setting('role', true)` tracks impersonation; `current_user`,
> `current_role` and `session_user` do not.** The admin branch in a *policy* is a
> different matter — a policy is not inside a function, so `current_user` is correct
> there.
>
> `SECURITY INVOKER` remains the rejected alternative, for the same reason: it
> publishes the whole permission matrix.

#### Withdrawn: per-user grants, denies, and any combiner

These are gone, deliberately, and none of them is to be reintroduced:

| Withdrawn | Why |
|---|---|
| `user_permissions` — a grant or deny attached to a person | Two members of the same role then differ, and every question about a capability needs "which person, which override, which order". **Every member of a role holds identical capabilities**, so the question does not arise |
| `is_granted` — a boolean that could be `false` | A deny is a second authorization model living in the same table. There is no *why* a person should be excepted from their role that the role system cannot express |
| Deny **precedence** resolution | Precedence rules are order-dependent, so the answer to "may this person do X" depends on row order. Two code paths reading the same rows can disagree |
| `permission_rules` — an AND/OR combiner over the axes | It put both axes on one row and made them compete. They answer different questions — *which rows* and *which objects* — and there is no expression that reconciles them. **Every user has a group and a role; the axes never compete** |
| The permission **cache database** (`cache/permissions.sqlite`, `cache_permission_maps`, `cache_sync_status`, sync endpoints) | A second copy of the authorization data, which is a second source of truth and a synchronisation problem. `has_permission()` reads the live rows. Nothing caches an authorization answer |
| The **object-scanning tables** (`api_endpoints`, `frontend_routes`, `ui_components` and their `*_permissions` join tables) | PostgREST derives the API surface from the schema, so there is nothing to scan. The permission surface is *which tables and which verbs*, and it is expressed directly in `permissions(resource, action_id)`. Scanning the running app to rediscover it could only ever be a snapshot of something the schema already states |

> **Record, do not restore.** Each of these existed to make RLS work on SQLite
> through an ORM. They are named here once, with the reason, so a reader who meets
> them in `rebase.md`'s inventory or in the old tree's schema recognises them as
> removed rather than as undocumented. **Do not add explanatory prose about the
> machinery** — it no longer exists and a long explanation of a dead design is
> how it comes back.

#### `app_admin` is a superset, not a bypass

**There is no admin flag that turns enforcement off.** `app_admin` is an ordinary
principal that holds more of everything, and it is a **superset across four
distinct mechanisms**, each with its own test — because a bypass is one mechanism
that has failed silently, while a superset is four mechanisms that have to be
removed separately:

| | Mechanism | Test that fails if it is removed |
|---|---|---|
| **All database rows** | the RLS admin branch — scope is not narrowed for this actor | a scope-restricted member sees a subset; `app_admin` sees every row |
| **All database tables** | every verb granted to the serving admin role, after `REVOKE ALL … FROM PUBLIC` | a table `SELECT`/`INSERT` returns `42501` for `app_admin` |
| **All pages** | the capability resolver: the admin role row carries the page permissions | `has_permission(admin, 'page', 'read')` returns `false` |
| **All endpoints** | PostgREST serves what the grants permit, and the boundary `GRANT` decides which role it may assume | the boundary `GRANT` widened or narrowed makes the wrong token succeed or fail |

If any one of the four is removed the administrator silently loses **one kind** of
access rather than **all** of it. That is the whole point of a superset over a
bypass: the failure is partial and visible.

#### Least privilege runs in both directions

The requirement that drove this redesign was two-sided. **Only one side is enforced.**

| Side | Mechanism | Status |
|---|---|---|
| "An account manager cannot create a user outside their own RLS scope" | the `user_groups` insert is a scoped write and the policy's `WITH CHECK` rejects an out-of-closure `group_id` | **Enforced.** (Omitting `WITH CHECK` is safe: Postgres reuses `USING` when none is written.) |
| "They cannot grant a capability they themselves do not have" | a `BEFORE INSERT OR UPDATE` trigger on `role_permissions` **and** `user_roles` | **NOT ENFORCED. Nothing implements it.** |

**The ADR's least-privilege invariant is therefore not met, and the migration records
no gap.** `app_admin` holds full `INSERT`, `UPDATE` and `DELETE` on `role_permissions`
and on `user_roles` with nothing filtering them, so today *any* account manager
confers *any* capability on *any* role. The requirement is still the requirement; it
is unenforced, not withdrawn. Tracked as `rebase.md` **W08b**.

The sketch:

```sql
  -- SKETCH ONLY. NOT IMPLEMENTED, and unimplementable as drawn -- see below.
  --
  -- IDENTITY. The actor must come from something the caller cannot forge. A
  -- caller-writable GUC is NOT acceptable: request.jwt.claims is exactly that, and
  -- it is what the scope policies read (see §F1). Reading the grantor from it
  -- reproduces the very hole this trigger is meant to close.
  --
  -- SEPARATION OF DUTY. The grant-subset check must not be able to grant itself:
  -- if the caller holds `roles.admin`, then `roles.admin` confers everything the
  -- caller has, and the check is vacuous for them. Pin the rule to a row that is
  -- not grantable. **The sketch below has this defect.**
  CREATE TRIGGER role_permissions_grant_subset
  BEFORE INSERT ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION assert_grant_is_subset();

  CREATE FUNCTION assert_grant_is_subset() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE grantor uuid := app_actor();   -- no such function exists either
  BEGIN
    IF NOT has_permission(grantor,
                          (SELECT resource FROM permissions WHERE id = NEW.permission_id),
                          (SELECT name FROM actions
                            WHERE name = (SELECT action_id FROM permissions
                                           WHERE id = NEW.permission_id))) THEN
      RAISE EXCEPTION 'insufficient privilege to grant %', NEW.permission_id
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END $$;
  ```

  **Three things this sketch must survive, and does not.**
  - **`BEFORE INSERT` only is not enough** — a `BEFORE UPDATE` that repoints a row to
    a different `permission_id` is the same escalation, and needs the same check.
    `OLD` is `NULL` on an insert, so the two cases must be branched rather than
    assumed.
  - **`role_permissions` and `user_roles` both need it.** The second table is the
    one that escalates: assigning a role confers everything that role holds, so the
    subset check there must be evaluated against the **role's** effective permission
    set, not against the role id.
  - **The check must be recomputed, not cached**, and it must not be bypassable by
    being satisfied through an ancestor role the grantor also holds — otherwise the
    rule reduces to "a superset of a superset".

  **`42501`, not a silent no-op.** A grant that quietly does nothing is how the
  capability axis ends up silently absent — the defect recorded twice above. A
  refused grant is an authorization decision and reads as one.

  **A trigger, not application code.** A check in a service is bypassed by the
  next service, by the seed script, and by anyone with `psql`. It is the same
  argument that puts row scope in `CREATE POLICY`.

### Referential-integrity checks bypass RLS — and they fail OPEN

**RLS governs `SELECT`, `INSERT`, `UPDATE` and `DELETE`. It does not govern foreign
key, unique or primary key checks.** Those are constraint triggers running with the
privileges of the constraint, against the *referenced* relation, outside any policy.
Every form below was measured, and every one leaks.

| Shape | What the caller learns | Signal |
|---|---|---|
| Plain FK on an otherwise unconstrained column | whether **any** group id exists — including one the caller can never see | success vs `23503` |
| FK to a table the caller cannot `SELECT` | whether a specific **value** is present in an unreadable table | a token value in an unreadable table was **confirmed** |
| `UNIQUE` + `ON CONFLICT DO NOTHING` | the same, with **no error at all** | silent |
| `ON DELETE CASCADE` | ability to destroy rows in a group the caller cannot see | a member deleted a group they held and the cascade removed an out-of-scope row |

The `ON CONFLICT DO NOTHING` row is the dangerous one. Every other shape at least
returns an error a caller can distinguish; that one returns **success either way**,
so an oracle exists with nothing to notice it by. And `ON DELETE CASCADE` is not an
oracle at all — it is a **write across RLS**, which is worse than disclosure.

**The rule.** This is a **design constraint, not a mechanical transform** — no
amount of care in the policy prevents it, because the policy is not evaluated:

> **A group-scoped table may only carry foreign keys that stay within the
> group-scoped set. Any FK leaving that set must terminate at a table members
> cannot write to.**

Which means every table must first be declared in one of three categories, and the
primary key follows from the category:

| Category | Tables | Primary key | FK discipline |
|---|---|---|---|
| **Group-scoped** | `projects`, `customers` | `PRIMARY KEY (group_id, id)` | carries `group_id`, and **every** FK carries `group_id` too — including the self-reference, so a row can never be attached to another group's row |
| **The hierarchy itself** | `groups` | simple `PRIMARY KEY (id)` | **not** scoped by `group_id` — it *is* the group. Its self-FK (`parent_id`) is admin-only-reachable |
| **Unscoped** | `users`, `roles`, `role_permissions`, `user_groups` | simple primary keys | global reference data, not tenant rows |

`PRIMARY KEY (group_id, id)` on the scoped tables is doing real work here, not
cosmetics: it makes "this row belongs to a group" part of the row's identity, so a
`UNIQUE` violation is itself group-scoped and a cross-group insert cannot collide
with — or probe — another group's rows. `groups` cannot take that shape, because
`group_id` would be the group and the FK from it to itself is the cycle the closure
depends on.

### Cycle safety — `UNION` terminates only when the recursive row carries no accumulator

The closure query uses `UNION`, not `UNION ALL`, and that choice is the *only* thing
stopping a cycle from being a denial-of-service. Measured, same graph, same session:

| variant | tree | result |
|---|---|---|
| `UNION ALL` + `depth` | cyclic | **non-terminating**; exceeds `temp_file_limit` in **91 ms** |
| `UNION`, no depth | cyclic | **384 rows in 12.7 ms** |
| `UNION ALL` + `depth` | acyclic | **361 rows** — fine |
| `UNION`, no depth | acyclic | **361 rows** — identical |

**On an acyclic tree the two variants are indistinguishable.** Both return 361 rows.
That is exactly how this gets got wrong: the cycle-safety property is invisible in
every healthy database, and only appears as a hang in the one that is broken.

**Why the accumulator is what breaks it.** `UNION` de-duplicates the recursive row.
Add a `depth` column and the row is no longer ever a duplicate — each pass carries a
new depth — so `UNION` degenerates to `UNION ALL` and the recursion never reaches a
fixed point. Carry no accumulator and the second visit to a cycle member produces
the row already produced, and the recursion stops.

**Defence in depth, in this order:**

1. **A write-time trigger rejects a cycle at insert.** The primary control, and the
   only one that stops the bad data from existing.
2. **`UNION` with no accumulator**, so a cycle that gets past the trigger costs 384
   rows and 12.7 ms rather than a hung session.
3. **`temp_file_limit` set on the refreshing session.** This is the one that is
   usually forgotten and it is the one that matters most: without it, a
   non-terminating closure exhausts the filesystem, and the failure is not a slow
   query — it is a full disk.

> **M9 — and the trigger is load-bearing for a reason nobody wrote down.** The
> shipped `assert_group_acyclic()` is `BEFORE INSERT OR UPDATE … FOR EACH ROW`, and
> its `SELECT` sees rows written **earlier in the same command**, because the
> **command counter advances between trigger firings**. That is the only thing
> preventing a single multi-row statement from building a cyclic closure.
>
> **Measured by shape, and the shape is the whole of it.** A **forward** chain —
> `(a→b), (b→c), (c→a)` with every parent written later in the same statement — is
> **refused**: the third row's walk finds the first two. A **backward** chain —
> `(a, no parent), (b→a), (c→b)` — is **admitted, and correctly so**, because it is
> genuinely acyclic at the moment each row is checked and no cycle exists afterwards.
>
> **It is fragile and it is invisible.** Change the trigger to `FOR EACH STATEMENT`,
> to a `CONSTRAINT` trigger, or route the read through anything that does not see
> the advanced command counter, and the forward form is admitted. Nothing in the DDL
> says so. Any code that bulk-loads `groups` needs a test that loads it in **one
> statement**, because that is the case the control is carrying.

> **`parent_id REFERENCES groups(id)` does not enforce acyclicity.** It is not even
> close: a self-referencing FK happily admits `A → B → A`. Nothing in the DDL
> prevents a cycle, which is why item 1 above is a trigger and not a constraint.
>
> **Why a tolerated cycle is worse than an outage.** It is fail-**closed** on the
> query and fail-**open** on the data: the closure still resolves, and **each cycle
> member inherits the entire cycle's scope**. A member of one group in a
> two-group cycle sees both. So an undetected cycle is an authorization bug wearing
> a data-integrity costume, and the 384-rows-in-12.7-ms result is the *correct*
> behaviour of a system that was handed a cycle it should have refused.

### The closure matview: keep it out of `db-schemas` — and note that "grant it to nobody" is unimplementable

A matview is not a table and it is not protected like one. Four hazards, all
measured:

| Hazard | Consequence |
|---|---|
| **No RLS and no policy.** `CREATE POLICY` on a matview does not exist | there is nothing to scope it *with*; the grant is the only control |
| PostgREST **auto-publishes** it as a resource | `org_closure` in `db-schemas` is reachable at `/org_closure` the moment the schema cache reloads |
| It appears in the served spec under `openapi-mode = "ignore-privileges"` **regardless of grants** | the spec advertises a resource the spec mode deliberately refuses to hide |
| **A single `GRANT SELECT` served the entire org tree to an anonymous caller** | the whole hierarchy, every group, to anyone |

> **REVERSAL — "grant it to nobody. Not 'grant it narrowly' — nobody" is withdrawn,
> and it was not a judgement call: it is unimplementable.**
>
> The hazards above are real, and the conclusion drawn from them was still wrong.
> **A policy expression's subquery runs with the QUERYING role's privileges**, not
> the table owner's. So a relation the scope policy reads must carry a `SELECT`
> grant for **every** role whose requests evaluate that policy. Measured on the
> shipped schema, before the `authz` schema existed: an `INSERT` as `app_admin`
> failed with `permission denied for materialized view org_closure` — and so did
> every scoped select and update. **With the grant removed to nobody, row scoping is
> 100% non-functional**, while the policy, the grants and every comment still look
> correct. That is the same shape as the "a revoke is not a policy" finding below,
> one level up.
>
> **The shipped answer is the schema, not the grant.** `org_closure` lives in
> **`authz`**, which is **outside** `db-schemas`, so PostgREST cannot address it and
> `ignore-privileges` cannot advertise it — and it carries
> `GRANT SELECT ON authz.org_closure TO app_anon, app_member, app_admin`. Both halves
> are required: the schema hides it, the grant lets the policy read it.
> `app_anon` is in the grant list because a policy expression is evaluated for every
> role that reaches the table; without it an unauthenticated read fails with
> `permission denied for materialized view` — a `42501` on a request that should
> have returned zero rows, which is a denial-of-service surface and an oracle.
>
> **Assert both halves in a test**: that the grant state is what it should be, *and*
> that the relation is absent from the served spec. The spec alone will not tell you
> about the grant, and the grant alone will not tell you it is hidden.

**Refresh: `REFRESH MATERIALIZED VIEW CONCURRENTLY` from a statement-level trigger
on `groups`.**

| Requirement | What it actually is |
|---|---|
| a `UNIQUE` index on the view | `authz_org_closure_uniq (ancestor, descendant)`. Without it the refresh is refused: `cannot refresh materialized view … concurrently` |
| inside the writing transaction | so a reader sees the pre-write closure or the post-write closure and **never an intermediate state**. Strictly better than any refresh schedule |
| `CONCURRENTLY` | **chosen for the lock it avoids.** A plain `REFRESH` holds an **`AccessExclusiveLock`** for the whole rebuild and blocks every tenant read behind it |
| statement-level | because **N group changes cost one rebuild instead of N** |

> **CORRECTED — the previously recorded justification for statement-level was
> false.** It said `CONCURRENTLY` *"cannot run inside a transaction block that has
> already written"*, therefore statement-level. **That does not reproduce on
> PostgreSQL 15.19.** Verified: `CONCURRENTLY` succeeds from a row-level trigger
> inside a transaction that has already written. The only two restrictions that do
> bite are a **read-only transaction** and a **missing unique index**. Statement-level
> is still the right choice — but for the rebuild-count reason above, not for
> legality. An earlier draft of the migration repeated the false claim as well.

> **WITHDRAWN — the refresh timing table is not reproducible.** This ADR, and two
> other documents, carried `13.5 ms` baseline / `6.7 ms` concurrent / `7,606 ms`
> plain / `8,466 ms` trigger-held. Re-measured on the **shipped** 12-row closure the
> audit got **plain `REFRESH` 36.5 ms** and **`CONCURRENTLY` 27.5 ms**. The figures do
> not describe the design; they described whatever fixture was loaded, and the
> 7,606 ms in particular is three orders of magnitude off anything a 12-row closure
> can cost. **The argument for `CONCURRENTLY` is the lock, and the lock is a
> property of the access mode rather than of elapsed time.** Cite
> `AccessExclusiveLock`; do not cite milliseconds without naming the fixture.

> **REVERSAL — the blue/green matview swap is withdrawn as unnecessary, and it was
> also impossible.** An earlier draft proposed building a second matview and swapping
> names, on the theory that a concurrent swap avoids a window. Both halves fail:
>
> 1. **Unnecessary.** There is no window to close. The refresh happens in the writing
>    transaction, and `CONCURRENTLY` keeps readers running at 6.7 ms.
> 2. **Impossible.** `DROP MATERIALIZED VIEW org_closure` is **rejected** because
>    **seven RLS policies depend on it.** A swap needs the old name dropped; seven
>    policies reference it; the drop is refused.
>
> Recorded as a reversal because the proposal was made here and is now wrong for a
> reason that only executing it revealed.

### Corrections to the record — six claims that were wrong in the small ways

Recorded as corrections because each was written down as fact and each is the kind of
detail that gets copied into a migration verbatim.

**1. `CREATE MATERIALIZED VIEW … AS WITH RECURSIVE …` is a syntax error on PG 15.**
When the `WITH RECURSIVE` CTE *is* the whole query, the statement does not parse. The
design above parses only because of the trailing `SELECT ancestor, descendant FROM t;`.
An earlier draft of this ADR omitted that line, so the snippet as written could not
have been executed.

**2. `actor()` as originally written does not compile.** `->> 'sub'` returns `text`
against a `RETURNS uuid`, so the cast is mandatory — and the obvious spelling is
wrong:

```sql
-- wrong: `::` binds tighter than `->>`, so this parses as
--   claims ->> ('sub'::uuid)   -- casting the LITERAL, not the extracted text
CREATE FUNCTION actor() RETURNS uuid … $$ …->>'sub'::uuid…

-- right: parenthesise, so the cast applies to the extracted text
CREATE FUNCTION actor() RETURNS uuid … $$ … (->> 'sub')::uuid …
```

Precedence is the whole trap: in PostgreSQL's table `::` sits near the top, above
"any other operator", which is where `->>` lives. The naive spelling does not do
what it looks like — it casts `'sub'`.

**3. `USING` alone does govern `INSERT`.** When no `WITH CHECK` is written, Postgres
reuses `polqual` for the check. Previously recorded as a catalog reading; it is now
**confirmed by denial**, which is the only kind of confirmation worth having — an
insert into an out-of-scope group is refused. A catalog entry is evidence that
something was set; a refused insert is evidence that something was *enforced*.

**4. A non-uuid or empty `sub` yielded `HTTP 500`, not `403`.** Fail-closed, but the
wrong signal: an operator reading logs investigates an internal error instead of an
authorization decision. Recorded in §Row scope as well, because it belongs with the
claim-accessor discussion rather than only here. **Closed** — `authz.actor()` catches
the cast, and the suite asserts both shapes deny.

**5. `GRANT USAGE ON SCHEMA public TO PUBLIC` does NOT put schema usage back.** The
`down` script recorded that it *"reports `WARNING: no privileges were granted for
"public"` and leaves the ACL unchanged. Verified twice."* **That claim is false, and
the "verified twice" is the load-bearing part of the error** — it is recorded as
measured when it was inferred. Re-measured: the statement emits **no warning at
all**, exits 0, and `has_schema_privilege(role, 'public', 'USAGE')` **flips to
`true`**. The revert of that particular revoke does exist, and the down script
omits it while asserting it does not.

The residual is a **narrowing**, which is the safe direction, and leaving it in place
rather than faking it was the right call. But the justification was invented, and a
down script that documents a non-existent limitation teaches the next reader that
the ACL is unrecoverable. Recorded because the pattern matters more than the
instance: **"verified twice" on a negative result is a claim about an absence, and an
absence needs a positive assertion, not a warning that did not appear.**

**6. `CONCURRENTLY` CAN run inside a transaction block that has already written.**
Recorded in §The closure matview above; listed here because it was written down as
settled fact in three documents and the migration repeated it as a "correction to
the record" while recording the same error.

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
   owner is subject to the policy too — **with two exceptions, and neither is a
   shortcut.**

Without both, every policy in this ADR is decorative. This is the same failure
class as the deleted RLS proxy: an enforcement mechanism that reports success
while enforcing nothing.

> **`FORCE` does not bind a superuser or a `BYPASSRLS` role.** Verified: a
> `postgres` session read 5 of 5 rows from a table that had both `ENABLE` and
> `FORCE` plus a working policy. `FORCE` closes the *owner* hole and nothing else.
> Every role that can reach a protected table must therefore also be
> `NOSUPERUSER NOBYPASSRLS`, and that is asserted in a test — not assumed.

#### The two tables that must NOT be FORCEd, and what happens if they are

| Table | `ENABLE` | `FORCE` | Why not |
|---|---|---|---|
| `projects`, `customers` | yes | **yes** | the owner is bound by the policy; the suite asserts it |
| `groups` | yes | **no** | the closure refresh runs as the **view owner**, and RLS applies to the owner under `FORCE` |
| `user_groups` | yes | **no** | the owner writes these rows (there is no serving-role write grant at all) and `FORCE` would refuse them |

**`FORCE` on `groups` is silent total closure loss — the highest-consequence
one-line edit available in this schema.** `REFRESH MATERIALIZED VIEW` evaluates the
view's query with the privileges of the view owner, so under `FORCE` the refresh
reads `groups` through a policy whose predicate `actor()` cannot satisfy. The
closure is rewritten **empty**. Every tenant's scope becomes zero rows. No error, no
warning, and a green `verify` is one test away.

> **D2 — CORRECTED, and the correction is worse than the original claim.** The
> migration recorded that a FORCE'd refresh *"wrote a closure containing 1 row
> instead of 2 — the matview silently lost half the tree"*. Re-measured by audit:
> the closure **empties entirely — 0 rows**. Half-loss was the lucky case, and it is
> the figure most likely to be copied forward as a tolerable degradation. It is not
> tolerable; it is total. **Do not describe it as partial.**

The trade, stated rather than buried: an owner can read the group tree
unrestricted. `groups` is the shape of the org chart and carries no tenant payload —
no names, contacts or records — so the blast radius is the hierarchy, not the data.
Every **request-serving** role is still bound by the policy. The owner never
receives a request; it exists to apply migrations. This is the weakest link in the
pattern; keep tenant payload out of `groups` and record the trade in a comment.

**This is not the same decision as the `SECURITY DEFINER` helper on `groups`.** Two
distinct mechanisms, two distinct measured reasons:

- **`authz.visible_group_ids()` is `SECURITY DEFINER`** because `REFRESH
  MATERIALIZED VIEW CONCURRENTLY` is refused *"because it is being used by active
  queries in this session"*. A group write fires the refresh trigger from **inside**
  the writing statement, and the `groups` policy's own join holds an active query on
  the closure for that whole statement. Behind a `DEFINER` helper the internal scan
  is closed when it returns. Inlining the join there fails the refresh on **every**
  insert, update and delete — verified.
- **`groups` is not `FORCE`d** because the refresh evaluates the view as the owner
  (the table above).

Neither reason implies the other. An earlier version of this ADR merged them into
"one decision, not two" and attributed both to a `stack depth limit exceeded` under
`SECURITY INVOKER` — which was the justification for a design that has since been
replaced. **Assert the two halves separately; either alone passes.**

It takes **no argument** and calls `actor()` itself, deliberately: a `who` parameter
would let any caller enumerate another user's group ids.

#### What `FORCE` costs: migrations and seeding

`FORCE ROW LEVEL SECURITY` subjects the **owner** to the policy, and that
includes the migration role. An owner running `INSERT` against a FORCE'd table whose
policy filters on `group_id` will have its rows rejected — there is no membership,
so the predicate is false.

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

### Capability for what is not a table verb

Pages, exports and workflow actions that are *not* expressible as CRUD still need
a decision. They get the **same** capability axis, resolved by `has_permission()`
against the same `permissions(resource, action_id)` rows — the surface is "which
objects", and a page is an object. What changes is only the mechanism that
consults it: PostgREST grants govern table verbs, and a thin-app guard or a
`/rpc/has_permission` call governs the rest.

> **CORRECTED, twice.** This section originally said feature security "is the only
> axis that reads the capability role at all" and placed it above the database; that
> was withdrawn because it made capability impossible to sit beside scope. It was
> then rewritten to *"a per-operation RLS policy reading a capability table,
> composed with the scope policy in one expression"* — which is also withdrawn, and
> is the arrangement recorded as the escalation at the top of this ADR. **What is
> correct now is the axis, not the mechanism**: capability is one table and one
> resolver, and neither the scope policy nor `has_permission()` reads the other's
> tables.

**Invariant, unchanged:** one mechanism per operation. If an operation is a table
verb, the database grants it. If it is application logic, a thin-app guard checks
it. Applying both means two places to update and two ways to disagree.

### The testable claim

> ~~You should be unable to write a single query or guard that filters by site
> **and** by feature. The axes never appear together.~~

**WITHDRAWN — this is the claim that produced the bug.** See the withdrawal at the
top of this ADR. Asserting it is worse than not asserting it, because it looks
like a safety property and reading it makes you *confident* in an arrangement that
discards a capability check.

The claims that replaced it, each directly checkable:

| Claim | How it is checked |
|---|---|
| **Neither axis is derived from the other** | `has_permission()` reads `user_roles` / `role_permissions` / `permissions` and nothing from `user_groups`; the scope policy reads `user_groups` / `org_closure` and nothing from `user_roles`. Grep both bodies. |
| **No per-user grant or deny exists** | `user_roles` is the only user↔capability link. A `user_permissions` table or an `is_granted` boolean is a regression: grep for both |
| **`has_permission()` returns `true` for an actor who HOLDS the permission** | The positive case. Its absence is not visible: a `SECURITY DEFINER` body reading `current_user` denies **everyone**, silently |
| **No operation's requirements are split across two permissive policies** | One policy per table for scope, and grants — not a second competing `USING` — for capability. Grep `pg_policy` for two permissive rows on the same `(relid, cmd)` |
| **A caller cannot grant a capability it does not hold** | Write a `role_permissions` row for a permission the caller lacks; the trigger must raise `42501`. This is the capability-side of least privilege, and it has no policy to fall back on |
| **A member with no membership rows is denied** | The scope-side cross test. Both withdrawn shapes pass every per-half test |

### Consequences

- **Scope is a membership table, not a claim.** `user_groups` joined to
  `org_closure`, with the caller's identity from `actor()`'s `sub`. Membership
  changes bite on the **next request with the same token**. ~~`site_id` is a JWT
  claim~~ was the earlier consequence; it is withdrawn, and the `user_groups`
  lookup it recommended is what the design now says.
- **The scoping subquery is hoisted** — `loops = 1` — and that, not per-call cost, is
  why the denormalised closure is the right trade. The same reasoning applies to the
  role-ancestor set `has_permission()` reads.
- **Capability is `resource` + `action` over a table, resolved from `user_roles` and
  `roles.parent_id`.** `role_permissions.role_id` is a real foreign key, so
  *"what can this role do?"* is answerable by the database and not only by
  application code. Inside the resolver, identity is the actor passed in from
  `actor()`, never `current_user` and never a role name.
- **`app_admin` is a superset across four mechanisms** — all rows (RLS), all tables
  (grants), all pages (the resolver), all endpoints (the boundary `GRANT`) — with
  four separate tests. No flag turns enforcement off.
- **Every user has at least one role and at least one group**, so neither axis has a
  "nobody" case and there is no combiner to resolve.
- **Every table is declared group-scoped, hierarchy, or unscoped**, and its primary
  key follows. Every FK on a group-scoped table carries `group_id`. Any FK leaving
  the scoped set terminates somewhere members cannot write.
- **`org_closure` lives in `authz`, outside `db-schemas`, and is granted to the
  three serving roles.** It cannot be granted to nobody: a policy expression's
  subquery runs with the querying role's privileges, so without the grant no scoped
  read evaluates at all. The schema is what hides it from PostgREST; the grant is
  what lets the policy read it. Both are asserted. §The closure matview.
- Every table needs a policy and grants. That is deliberate: default deny is
  cheaper to achieve than default allow.
- This ADR supersedes nothing, but it **does** retire the assumption that a
  permission system can express scoping. It cannot. Only a database policy can.

### Migration status, and what is still not built

**The design in this ADR is shipped.** `backend/database/migrations/0001_rls_foundation.sql`
implements it and `backend/test/rls/rls.spec.ts` proves it with **68** tests run by
`npm run verify`. `grep -rnE 'CREATE[[:space:]]+(TEMP(ORARY)?[[:space:]]+)?TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?sites\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[^[:space:]]*(site_tree_ids|claim_site_id|request_claims)\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?VIEW' backend/database/`
returns nothing — it asserts on the **executable construct**, not on the bare
word, because the SUPERSEDED NOTE quotes `sites`, `claim_site_id()` and
`site_tree_ids()` in order to explain the withdrawal, so a substring gate returns
lines and reads as a failure. A green `test:rls` **is** evidence for this ADR —
which it was not before the W26/W27 rewrite.

| Claim | Status |
|---|---|
| the grant-subset rule — a caller cannot grant a capability it does not hold | **NOT IMPLEMENTED.** `app_admin` holds full `INSERT` on `role_permissions` and `user_roles` with nothing filtering them. §Least privilege. **W08b** |
| scope is keyed on something the caller cannot forge | **IT IS NOT, AND CANNOT BE.** `request.jwt.claims` is a caller-writable GUC; the control is the absence of a request-reachable `SET` path. §F1. **P0 if that surface appears** |

One control that was decorative and is now enforced, and one trade that is not a
defect but is easy to mistake for one:

| | |
|---|---|
| **`is_system_role` / `is_system_group` were decorative and are now enforced** | a `BEFORE` row trigger on both tables: a floor row may not be `UPDATE`d or `DELETE`d except from a superuser session, and `INSERT` is uncovered so the floor is creatable. `SECURITY INVOKER`; superuser recognised by `current_setting('is_superuser')` rather than `current_user`. `TRUNCATE` does not fire a row trigger and is closed by the grants instead. §Capability |
| **`has_permission` is not executable by `app_anon`** | its `who` argument makes it a disclosure oracle — measured, **63 unauthenticated probes recovered an administrator's complete permission set**. Granted to `app_member`/`app_admin`; no policy calls it, so the "grant every policy helper to `app_anon`" rule does not apply. §Capability |
| **`app_admin` reads the complete `user_groups` table** | the scope policy reads `user_groups` with the **querying** role's privileges, so no serving role can be denied `SELECT` on it. `app_member` is restricted by its policy to its own membership rows; **`app_admin` reads every user in every group.** That is the price of the superset on this table, and the grants discussion used to omit it. **No serving role may `INSERT`/`UPDATE`/`DELETE` it, `app_admin` included** — that omission is the control that fails open if forgotten. |

> **The tamper table in `rebase.md` §6.6.1 was measured against the superseded
> suite and must be re-measured against the rewritten file.** A proof carried across
> a schema change is a stale result wearing a current one's clothes.

---

<a id="adr-0024"></a>
## ADR-0024: One email provider, one transport, two destinations, handlebars, and templates that must reach `dist/`

**Status:** Accepted, and **shipped**. `backend/src/email/` implements it;
`backend/test/unit/email/` (80 tests) and `backend/test/e2e/email.e2e-spec.ts`
(9 tests) prove it, both run by `npm run verify`. **Decision 2 was rewritten**:
the mode-driven three-transport table it originally carried is superseded by the
one-transport/two-destination shape below, and the rest of the ADR stands.

**Context.** `angular/` had two email implementations and both were wrong in
ways that compounded:

| | `backend/src/modules/email/` | `frontend/server/email-service/` |
|---|---|---|
| mechanism | nodemailer behind an `EmailProvider` interface | a **second** standalone nodemailer service |
| DI token | the bare string `'EmailProvider'` | its own, outside Nest's container |
| rendering | hand-rolled `{{var}}` loop | — |
| surfaces | 8 send methods | — |

Six of the eight send methods (`sendWelcomeEmail` plus five privacy-ticket
methods) had **zero callers**. `base-layout.html` was dead and broken: it used
a `{{{content}}}` triple-stash against a renderer that only understood
`{{var}}`, and had an unmatched CSS brace. `EmailProvider` and `EMAIL_ENABLED`
were defined in the configuration and read by nothing, so a deployment could
believe it had chosen a transport and had not. `FRONTEND_URL` defaulted to
`http://localhost:4200` and `EMAIL_HOST`/`EMAIL_USER`/`EMAIL_PASSWORD`/
`EMAIL_PORT`/`EMAIL_FROM` all had defaults, so a production deployment with no
mail configuration booted happily and mailed nobody.

**Decision.**

1. **One provider mechanism.** `EmailProvider` is a one-method port —
   `send(EmailMessage): Promise<SentEmail>` — registered once behind
   `EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER')`. Not the string token: a string
   token shares a process-global namespace with every other library, so a typo
   fails at runtime against somebody else's provider. The frontend's standalone
   service is **not** ported; `AGENTS.md` §2.4 has one mechanism per concern.

2. **One transport, two destinations, and the destination is configuration and
   nothing else.** There is exactly one transport — nodemailer's `smtpTransport`
   — built in development, in test and in production, from the same
   `EmailConfig.smtp`. No code path anywhere branches on the runtime mode to
   choose a transport, and there is no `EMAIL_TRANSPORT` / `EMAIL_PROVIDER` /
   `EMAIL_ENABLED` read anywhere: what differs between modes is **where the
   transport connects**.

   | mode | transport | destination |
   |---|---|---|
   | `development` | nodemailer `smtpTransport` | the local sink on `EMAIL_HOST`/`EMAIL_PORT` — `npm run dev` hosts it in-process |
   | `test` | nodemailer `smtpTransport` | a local sink the suite starts itself, on port `0` so it can never collide with another listener |
   | `production` | nodemailer `smtpTransport` | a managed relay, named by `EMAIL_HOST` |

   **This supersedes the earlier decision in this ADR**, which selected one of
   three transports by mode (`streamTransport` in development, `jsonTransport` in
   test, `smtpTransport` in production). That shape was wrong twice over. It was
   three mechanisms for one concern, which is the duplication `AGENTS.md` §2.4
   exists to remove. And because only production spoke SMTP, **the transport
   layer's first real run happened in production** — no development session and
   no test had ever opened a socket, so the EHLO, the `DATA` framing, the `250`
   and every handshake bug below it shipped unexercised. With one transport,
   development and test run the code path production runs, which is the only
   arrangement in which "the test suite passes" says anything about the deployed
   behaviour.

   **The local sink** is `startSmtpSink` in `backend/scripts/smtp-sink.ts` — one
   implementation, imported by both `scripts/dev.mjs` and the test suites, built
   on the `smtp-server` package. Not `maildev`: that ships a web UI, and this
   subsystem has no web UI and does not want one. Not a container and not an
   external binary: `npm run dev` is **one Node process** for the app plus
   PostgREST, and the sink is a listener inside it. It binds **127.0.0.1 only**,
   refuses a non-loopback address before a socket exists, and re-reads the bound
   address afterwards.

3. **Required configuration, no defaults — and production may not name a sink.**
   `EMAIL_HOST` and `EMAIL_PORT` are asserted in **every** mode: there is one
   transport, so every mode needs a destination, and a mode that guesses one picks
   something nobody is listening on. `EMAIL_USER`, `EMAIL_PASSWORD` and
   `EMAIL_FROM` are asserted in production only — a loopback sink may
   legitimately accept a message from an unauthenticated client, and demanding a
   credential there would be demanding a fake one (`AGENTS.md` §2.2).
   `EMAIL_SECURE` is configurable and defaults from the port (`465` → implicit
   TLS, otherwise STARTTLS). Missing in production throws `EnvironmentError` at
   bootstrap, naming every absent key at once, exactly as a missing `JWT_SECRET`
   does.

   **Production additionally refuses a non-routable `EMAIL_HOST`** — loopback
   (`127.0.0.0/8`, `::1`), the unspecified address (`0.0.0.0`, `::`), link-local
   (`169.254.0.0/16`, `fe80::/10`) or private (`10/8`, `172.16/12`, `192.168/16`,
   `fc00::/7`), and `localhost` by name — because of the next paragraph.

   **`EMAIL_TLS_REJECT_UNAUTHORIZED`** is the one added key. It defaults to `true`
   and is **refused as `false` in production**: it exists so the sink's
   run-time-generated self-signed certificate can be used, and a relay whose
   certificate cannot be verified is a relay whose traffic anyone can read. Same
   shape as the host refusal — a setting that only makes sense against a sink
   cannot be set in production.

   **`APP_BASE_URL` is required in every mode** with no default anywhere. It is
   the application's own public origin, and `http://localhost:4200` is the
   precise value that survives into a real deployment and mails every user a
   link to the developer's own machine. `EMAIL_FROM` defaults to
   `no-reply@<hostname of APP_BASE_URL>` outside production, so no mode invents a
   sender domain, and `APP_BASE_URL` must be `https:` in production because an
   emailed token over plain HTTP is readable by every hop in between.

4. **`250` is an acknowledgement, not a delivery, and configuration may not
   pretend otherwise.** SMTP's final reply means *"I accept responsibility for
   this message"*. It does not mean the recipient has it, that the domain exists,
   or that anything was relayed onward. A sink is the limiting case: it answers
   `250` to everything and stores it in an array in one process, and no user is
   ever contacted.

   Two consequences, and both are enforced rather than documented:

   - **`SentEmail` is a receipt, not a delivery confirmation.** It carries the
     `messageId` and nothing else. The previous `transport` and `serialised`
     fields are gone: one transport makes the label a constant, and the
     serialised MIME belonged to the deleted JSON transport, which has no
     analogue over SMTP. A field named like a delivery confirmation would be the
     wrong shape to keep. **Only bounce and delivery webhooks answer "did the
     recipient get it", and this subsystem has neither.**
   - **A production process cannot be pointed at a sink.** That is the loopback
     refusal in point 3. Without it, the failure mode is the worst kind: every
     password reset and every address verification mails into a void, every send
     "succeeds", and **nothing anywhere errors** — because from the application's
     point of view nothing did.

5. **Handlebars, auto-escaping on, and a typed context.** The previous renderer
   interpolated a context key into a `RegExp` **unescaped**, and its escape set
   covered `<`, `>` and `"` while omitting `&`. Handlebars with
   `Handlebars.compile<T>(source)` removes both failure modes: nothing is built
   from a caller-supplied string, and the escape set is the library's. Templates
   are `{{var}}` substitution only — no helper, no partial, no logic. The
   context is `VerifyEmailContext | PasswordResetContext`, never
   `Record<string, any>`.

6. **`sendEmail` throws; there is no failure-shaped success.** `EmailService`
   returns `SentEmail` only when the transport accepted the message, and rejects
   with `EmailDeliveryError` otherwise. It does not return a boolean and does
   not return a discriminated result. The old `boolean` was returned by all
   eight methods and discarded by `AuthService`, so a total send failure became
   **HTTP 200** with a user who never received their reset link. A discriminated
   result would fix the service while leaving every future caller free to ignore
   the `failed` arm; a throw cannot be ignored without a `catch` that visibly
   swallows it.

7. **A missing template is an error, not a paragraph.** The old renderer caught
   every failure and returned `<p>Email template error: …</p>`, which the
   provider then reported as `success: true`. `EmailTemplateError` replaces it.

8. **The templates must reach `dist/`, and that is asserted by a build.**
   `nest-cli.json` gains
   `"assets": [{ "include": "email/templates/*.html", "watchAssets": true }]`.
   `src/email/templates/*.html` lands in `dist/email/templates/`, which is where
   `import.meta.url` resolves it in a built process.

   **This is the regression the record exists for.** Without the `assets` entry
   the previous tree's renderer hit `ENOENT` on every send and shipped
   `<p>Email template error: …</p>` to every recipient while every log reported
   success. `backend/test/unit/email/email-assets.spec.ts` runs a real
   `nest build` and then **renders both templates from `dist/`** — not merely
   checks that the files exist — so a stale, truncated or absent copy fails too.

9. **Only what is live ships.** Exactly two templates: `verify-email.html` and
   `password-reset.html`. `base-layout.html` and the six orphan templates are
   not ported. A template with no caller is a maintenance surface that rots
   silently, and the previous nine proved it.

10. **What may be logged.** Recipient, subject, destination and message id on
    the success path; recipient, subject and destination on the failure path.
    **Never a body, and never a token — with no exception at all.** The deleted
    `stream` transport wrote the whole MIME at `debug`, and the rule needed an
    exception plus a structural argument about why production could not construct
    it. With one transport there is nothing to make safe: no configuration can
    put a verification or reset token into an application log, because no code
    path writes a body anywhere. Development reads the message out of the **sink
    it just talked to** — `scripts/dev.mjs` prints the accepted envelope, subject
    and plain-text part on a timer — which is a loopback listener in the
    developer's own terminal, not a log line in the application. A recipient that
    fails validation is **not** echoed into the error: it is attacker-controlled
    and may carry a CRLF, which would forge a log line in whatever handles the
    exception.

**Consequences.**

- `nodemailer` and `handlebars` are dependencies. `smtp-server`, `selfsigned`
  and `@types/smtp-server` are **dev** dependencies: the sink is test and
  development infrastructure and must never be reachable from a production
  bundle, which `test/unit/email/smtp-sink.spec.ts` asserts by scanning `src/`
  for any reference to it. `canvas` is **not** added in this slice.
- **`backend/package.json` requires Node ≥ 22.18.** `scripts/dev.mjs` imports
  `scripts/smtp-sink.ts` directly, so the dev orchestrator needs native type
  stripping. That is not a preference: the alternative was a second, hand-written
  copy of the sink in plain JavaScript, and two copies of one sink is precisely
  the failure this slice exists to remove.
- `EmailService` currently has **no production caller**. That is stated, not
  stubbed: the routes that will call it — registration and password reset — need
  a token table, and `backend/database/**` is not this slice's to touch.
  `AuthModule` imports `EmailModule` so the provider is configured and the
  wiring stops at the module edge. Writing a `sendVerificationEmail(...)` call
  with nowhere real to call from would be a stub that reads as a feature
  (`AGENTS.md` §2.1), so it does not exist.
- `verify` step 4 grows by roughly ten seconds: the build assertion runs
  `nest build` once. It is the cheapest possible insurance against a
  whole-subsystem silent failure.
- **SPF, DKIM and DMARC are not this subsystem's job.** They are DNS `TXT`
  records on the sending domain, published by whoever controls that domain, and
  an application cannot assert them. The application can only be configured to
  send *from* a domain that has them. The records, the `dig` verification
  command, provider-side domain verification for SES / SendGrid / Mailgun, and
  why a mail-catch sink is not a production transport are in
  [`deployment-guide.md`](./deployment-guide.md) §Transactional email in
  production. This ADR is not that document and does not drift into it.

---

<a id="adr-0025"></a>
## ADR-0025: `email_messages` is the FOURTH scoping category — "derived"

**Status:** Accepted, and **shipped**.
`backend/database/migrations/0005_email_messages.sql` implements it;
`backend/test/rls/email-messages.spec.ts` (**21 tests**) proves it, and it is a
gating step of `npm run verify`.

**Context.** ADR-0023 declared every table in one of **three** scoping categories,
and the category was load-bearing rather than descriptive: it determined the
primary key, and it determined the foreign-key discipline. Every table that
existed fitted. `email_messages` — one row per transactional email attempt, added
so a user's mail history is queryable — does not fit any of the three, and the
reason it does not fit is the design working correctly rather than a gap in it.

### The fourth category: derived

| Category | Scope key | Primary key | FK discipline |
|---|---|---|---|
| **Group-scoped** | its own `group_id` | `(group_id, id)` | every FK carries `group_id` |
| **The hierarchy** | it *is* the group | simple `(id)` | admin-only-reachable self-FK |
| **Unscoped** | none | simple | global reference data |
| **DERIVED** | **another table's membership** | simple `(id)` | may leave the set, at a non-member-writable table only |

**A derived row has no `group_id` column at all**, and that is the decision. Its
visibility is resolved through the **recipient user's** `user_groups`: an actor
sees the mail history of exactly those users whose groups they can see.

### Why a single `group_id` was rejected

It was the obvious design and it cannot express two real cases:

1. **A user belongs to several groups.** Duplicating one message row per group so
   a `group_id` can be carried makes *"which groups is this message in?"*
   ambiguous, and every read then has to de-duplicate or pick one arbitrarily —
   with a count that disagrees with the rows.
2. **A self-service password reset names no group at all.** The recipient is found
   by address; nobody decided which group the message belongs to. Putting the row
   in a group the reset never asked for invents a scope, and inventing a scope is
   how this repository's worst past defects happened.

Resolving through membership handles both: multi-group membership is the **union**
(never an intersection), and a group-less message simply has no rows pointing at
it.

### Capability: a dedicated `email:read`, not `user:create`

Capability is `resource` + `action` over a table, so `('email','read')` is one
inserted row, granted to the `admin` and `manager` roles and **not** to `member`.

**Why not reuse a user capability.** Reading a user's mail history is a different
question from reading the user row, and reusing an existing permission makes the
grant invisible: widening `user:read` for an unrelated reason would silently widen
email access, and nobody reading that diff would know. A dedicated row is a
separate line in `role_permissions`, so revoking email access touches nothing else.
The suite proves the two are distinct — a role holding `user:create` and not
`email:read` reads **zero** rows, inside its own group.

**The migration AND the seed both write it.** The migration owns the schema and
seeds the `permissions` row; the seed owns the `role_permissions` grant, because
`admin`/`manager` are seeded and never migrated (§B1 — roles are not a migration).
Both statements are `ON CONFLICT DO NOTHING`, so a fresh provision and a
re-migrated one agree; asserted from the live catalog.

### Scope and capability are AND-ed in ONE policy

```sql
CREATE POLICY email_read_scope ON public.email_messages FOR SELECT USING (
  email_messages.user_id IN (
    SELECT u.user_id
      FROM authz.visible_user_ids() AS u (user_id)
     WHERE authz.can_read_email()
  )
);
```

One predicate, both axes, never two PERMISSIVE policies on one operation — those
are **OR**-ed, so a scope policy covering `DELETE` admits it alone. The measured
failure that produced that rule: a member holding **zero** capabilities ran
`DELETE` and `INSERT` with no error and no warning (ADR-0023 §Withdrawn).

`authz.can_read_email()` is a **no-argument** `SECURITY DEFINER` function wrapping
`has_permission(authz.actor(), 'email', 'read')`. No `who` parameter — the same
rule as `authz.visible_group_ids()`, because a `who` parameter turns a policy helper
into a disclosure oracle that can enumerate another user's capabilities (measured
on `has_permission`: 63 unauthenticated probes recovered an administrator's whole
permission set). `EXECUTE` is revoked from `PUBLIC` and granted to `app_anon`,
`app_member` and `app_admin`: a policy expression is evaluated for **every** role
that reaches the table, so a helper it calls must be executable by the anonymous
role too, or an unauthenticated read fails with `permission denied for function` —
a denial-of-service surface that also names the policy to anyone probing.

`app_anon` gets **no** table grant at all, so its read is refused at the **grant**
layer (`permission denied for table`), never at the policy layer.

### The correlated `EXISTS` was wrong twice, and both are measured

The first draft of this policy was:

```sql
USING (
  authz.can_read_email()
  AND EXISTS (
    SELECT 1 FROM user_groups ug
    WHERE ug.user_id = email_messages.user_id
      AND ug.group_id IN (/* uncorrelated closure join */)
  )
);
```

**It is correctness-broken, not merely slow.** A policy expression's subquery runs
with the **querying** role's privileges, and `user_groups` carries its own policy
(`user_id = authz.actor()`, or every row for `app_admin`). For any role but the
admin it can therefore see only the **caller's own** membership rows, so
`ug.user_id = email_messages.user_id` degenerates to *"the recipient is me"*.

> **MEASURED.** A reader and a colleague in the **same** group: the colleague's
> message is visible under the shipped policy and **NOT visible** under the
> correlated form. No error, no warning — a silent under-read that looks exactly
> like a correctly scoped policy.

`authz.visible_user_ids()` is `SECURITY DEFINER` for the same reason
`has_permission()` is: it must read a table the caller cannot read in full.

**It is also the per-row cost, twice over.** A `STABLE` function in a qual means
*"the same answer within this statement"*, **not** *"called once"*. At 3,300 rows,
with `track_functions` counting:

| shape | exec | `can_read_email()` calls |
|---|---|---|
| **shipped** — capability **inside** the subquery | **7.6 ms** | **1** |
| capability **beside** the uncorrelated `IN` | 1.3 s | 3,300 |
| correlated `EXISTS` (as first drafted) | 4.2 s | 3,300 |

Beside the `IN` the planner emits `Filter: (hashed SubPlan 1) AND
authz.can_read_email()` and calls the function per candidate row; **inside**, it
becomes a `One-Time Filter` above the function scan and runs once. That is the
documented trap (ADR-0023: the withdrawn walk ran 400,001 times over 400,000
rows), and it is why the capability check sits where it does rather than where it
reads most naturally.

**`loops = 1`.** The scoping subplan is a `hashed SubPlan` with `loops=1` at 3,300
rows, and `visible_user_ids()` and `can_read_email()` are called **once each**.
Asserted on the plan *and* on the call counts, because a plan alone cannot tell you
how many times a function ran. This is the "assert on `loops`, not on the SQL's
apparent shape" rule paying out twice: the shape that reads as correct was the
broken one.

### The foreign key

`user_id uuid NOT NULL REFERENCES public.users (id)` **leaves** the group-scoped
set, which the referential-integrity rule forbids except at a table members cannot
write to. `users` is that table: `app_member` holds no `INSERT`/`UPDATE`/`DELETE`
on it, asserted per role. The residual is the documented one — FK checks bypass RLS
and fail **OPEN**, so this is an existence oracle over `users.id` — and it is
accepted because a nullable `user_id` would mean a message with **no derivable
scope**, which on a scoped table is worse than a narrow oracle. For `app_admin`,
which *does* hold write grants on `users` (0002, the provisioning path), the oracle
discloses nothing: it already reads the whole table. Asserted, because "it can read
users anyway" is the entire argument and an unasserted argument is not one.

### No DELETE, no TRUNCATE

Email history is an append-only audit trail: `app_admin` gets `SELECT, INSERT,
UPDATE` and nothing else. A future table-level `DELETE`/`TRUNCATE` grant is exactly
the change that would reopen it, so the absence is asserted **per role** and the
refusal is proven by executing it.

### Credential-bearing suppression

`password_reset` and `email_verification` carry a **bearer token** in the body —
the link *is* the credential. Persisting it would put a working token in a table
read over HTTP, in every backup and every replica, turning a leak of the mail
history into account takeover.

So those templates are forced to `content_class = 'metadata_only'` with `body` NULL,
and the rule **throws** rather than silently nulling the column: a caller must never
believe a body was stored when the column is empty. `contentClassFor` is the single
place the decision is made, it runs **before** the transaction opens (so a refusal
costs no round trip and is never partially applied), and both red/green proofs are
recorded in `rebase.md`. Other templates may set `full_body`; **no rendered body is
stored by default.**

### Consequences, stated rather than discovered later

- **`EmailService` records one row per attempt, sent and failed.** A provider that
  refuses still produces a row, because "this user was mailed a reset and it never
  arrived" is the first question an operator asks. A **rejected recipient** produces
  none: the address never became an envelope, and persisting an attacker-controlled
  string that failed validation is the one case where the audit table is the wrong
  place for it.
- **The write path carries no scope predicate, deliberately.** Scope is not knowable
  at write time: the send happens before the recipient's membership is consulted, and
  a password reset names no group. Scoping the insert would mean inventing a group,
  which is the design this category exists to avoid. The read policy is the
  authorization boundary; the write is reachable only through the escalation
  boundary, by the superset principal.
- **`sendVerificationEmail`/`sendPasswordResetEmail` take `userId` as an OPTIONAL
  fourth argument, and that is a documented residual, not a preference.** A row's
  scope is derived from the recipient user's memberships and `email_messages.user_id`
  is `NOT NULL`, so there is nothing to attach a message to without one. The methods
  are called with three arguments in **19 places** across
  `test/unit/email/email.service.spec.ts` and `test/e2e/email.e2e-spec.ts`, and that
  suite's environment names a database (`app_test`) that **does not exist** and
  deliberately opens no connection. A required fourth parameter would not compile it
  and an unconditional write would fail it for a reason unrelated to what it tests.
  So when `userId` is absent nothing is written **and a warning names exactly what was
  missing** — a hole in the trail, reported rather than swallowed. There is no
  production caller yet (ADR-0024 §Consequences), so it costs nothing today and
  closes when the registration and reset routes land, since they already hold the
  user row they are mailing. **Every production caller must pass `userId`.**
- **The migration disables `role_permissions`' grant-subset trigger for one
  statement**, because `assert_grant_subset()` (0004) refuses a write with no caller
  identity that is not the superset principal — which is exactly what a migration is,
  and a migration has no boundary connection. The window is a single `DO` block, so
  it is atomic under either caller: verified, a failure inside it rolls the disable
  back with it. A `BEGIN … COMMIT` pair would have closed the **runner's** transaction
  early and turned a partially applied migration into a committed one.
- **No route, no controller, no frontend.** PostgREST serves the table once a later
  slice exposes it and the spec and client are regenerated. The table is in `public`
  and PostgREST will publish it on the next `NOTIFY`; nothing in this slice depends
  on that.

---

<a id="adr-0026"></a>
## ADR-0026: Every key is UUIDv7, and the server floor moves to PostgreSQL 18

### The decision

Every primary key in `public` defaults to `uuidv7()`. The `refresh_tokens.jti`
column is retyped from `text` to `uuid` and defaults to `uuidv7()` too. The
PostgreSQL floor is **18**, because `uuidv7()` is a core function from 18 and there
is no extension to install — `gen_random_uuid()` has been core for far longer, so
the `pgcrypto` requirement older drafts of the deployment guide carried was already
false and is now gone as well.

### Why v7 and not v4

The reason is index locality, and it is worth being precise about that, because a
vague version of this argument is how a schema ends up on v7 for no reason.

`gen_random_uuid()` returns a v4: 122 random bits in random order. Every insert
therefore picks a random position in the btree, so a bulk load dirties pages all the
way across the index and leaves it fragmented. `uuidv7()` puts a 48-bit millisecond
timestamp in the leading bits, so ids minted now sort at the right-hand edge of the
index and inserts are close to sequential — which is the same locality a
`bigserial` would give, with ids that carry no enumeration.

This is a **write-amplification and bloat** argument. It is not a security argument,
and it does not make a v7 unguessable: the timestamp is public, so the unguessable
part is the remaining 74 random bits. That is still ample, and it is the number the
`projects` unique-index comment in `0001` now quotes instead of the v4's 122.

### Clock skew is accepted, not fixed

A v7 embeds the minting host's clock. Two hosts whose clocks disagree will mint ids
out of order relative to each other: an id from the slow host sorts *before* an id
the fast host minted a second earlier.

The consequence is bounded, and stating the bound is the point: **it costs index
locality and nothing else.** Uniqueness does not depend on the timestamp — 74 random
bits carry it — and no policy, foreign key or query reads the version nibble or
assumes monotonicity. So a skewed fleet gets a slightly less tidy index and correct
data.

It is therefore **documented rather than fixed.** The fixes all cost more than the
problem: a monotonic counter needs shared state to be correct across processes, and
taking the timestamp from the database's clock instead of the host's moves the skew
to the single database host without removing it. Neither is worth it for what is, in
the worst case, some extra page splits.

### One id cannot be left to a default

`refresh_tokens.jti` is the exception that proves the rule is a rule and not a
default-setting habit. The `jti` claim is **inside** the access token, and the
refresh-token row is written afterwards and keyed on that token — so the value has to
exist before the row does, and the database never gets the chance to mint it.

`src/auth/uuidv7.ts` mints it instead: `randomUUID()` for the random bits, then the
timestamp written into the leading 48 bits and the version and variant nibbles set,
which is the RFC 9562 layout. It produces the same kind of value a default would,
so a `jti` and a row id are not two different kinds of thing. The column is retyped
to `uuid` so the database validates and holds it rather than trusting an arbitrary
string, and the cast in the migration is deliberately unguarded — a `jti` that is not
a UUID aborts the migration rather than being silently rewritten, because coercing
it under a `NOT NULL` column or minting a replacement for a value already inside a
live token are both wrong answers delivered quietly.

The low bits are random, not a monotonic counter, so two ids minted in the same
millisecond do not order by creation. Accepted, for the same reason as the skew.

### What was rejected

- **Stay on `gen_random_uuid()`.** Free, and pays the random-insertion cost on every
  table forever.
- **Keep `jti` as `text`.** It is a key and was carrying **two** indexes on one
  column — `refresh_tokens_jti_key` (UNIQUE) and `refresh_tokens_jti_idx` (plain).
  A plain btree on a column that already has a unique btree is strictly a subset of
  it. Dropped here, where the change is visible.
- **Install the `uuid` npm package for the one id that needs minting.** A dependency
  and a runtime cost for a function that is a timestamp and two nibbles.

### No backfill

Existing rows keep their ids. A v4 and a v7 are both valid UUIDs, nothing reads the
version nibble, and rewriting keys would mean updating every referencing row and
rebuilding `authz.org_closure` — a large, lock-taking, irreversible operation bought
with the smallest possible benefit. New rows are v7; old ones age out.

This is also why the rollback is cheap: a forward migration that backfilled would
make `0006_uuidv7.down.sql` lossy, because a v7 in a `uuid` column is still a valid
uuid but a v4 written back into a `text` column is not recoverable.

### Measured

On a **fresh** provision through the real pipeline — bootstrap, every migration, then
the real `database/seed.ts` — every seeded key is a v7:

| Table | v7 / total |
|---|---|
| `users` | 1 / 1 |
| `groups` | 5 / 5 |
| `roles` | 3 / 3 |
| `permissions` | 25 / 25 |
| `projects` | 2 / 2 |
| `customers` | 1 / 1 |

The pre-`0006` development database still holds v4 rows, which is the no-backfill
decision and not a failure.

Getting to that number required removing four `gen_random_uuid()` calls from
`database/seed.ts` that named `id` explicitly. **A supplied value bypasses the
column default**, so those four inserts would have kept minting v4s indefinitely
while the catalog still read `uuidv7()` — the failure is invisible to any test that
looks at the schema. That is why the gate has a separate assertion on the seed's
source.

### The gate

`test/rls/uuid-keys.spec.ts` queries `pg_attrdef` and asserts that **every** uuid
default in `public` is `uuidv7()`, with no table names hardcoded. A test listing the
nine tables that existed when `0006` was written passes forever after a tenth table
is added with a v4 default, which is the exact regression worth catching. It also
reads a freshly inserted row's version nibble back — the default's *text* is not
evidence — checks the leading 48 bits against the wall clock, and asserts the seed
source carries no `gen_random_uuid`.

Proven able to fail: reverting one line of `0006` to `gen_random_uuid()` turns two
of its assertions red and names `users.id`.

---

<a id="adr-0027"></a>
## ADR-0027: The application-level circuit breaker trips on memory alone

**Status:** Accepted, and **shipped**.
`backend/src/breaker/` implements it and `backend/test/unit/breaker/` (seven
specs) proves it; `backend/database/migrations/0007_resource_ceilings.sql`
forward-references this record and is the layer that cannot be forgotten by a Nest
interceptor.

**Context.** `0007_resource_ceilings.sql:6-12` justified putting three PostgreSQL
session ceilings in a migration by claiming there was deliberately no application
gate, on two grounds: PostgREST serves the CRUD surface from a **separate process**,
and *"an application-level gate would cover four auth routes, report itself
Healthy, and gate nothing anyone could attack."* The first ground is load-bearing
and remains true. The second was written against a snapshot and is false as a
general finding — the thin app now has three background jobs whose whole job is to
be refused, plus a purge that is an unbounded `DELETE`. This record is the half of
`0007`'s comment that is right; the amended comment is still outstanding and is
recorded as such in `docs/rebase.md` W73.

### The decision

**Memory is the only trip input. Disk is measured, reported, and can never refuse
anything.**

The breaker's state machine is `closed → open → half_open → closed | open` because
there is exactly one signal. The health surface carries three *independent*
branches — `memory` against `GREEN`/`YELLOW`/`RED`, `disk` as two numbers, and
`breaker` as counts — and **no aggregate `status` field**, and
`test/unit/breaker/breaker-health.spec.ts` asserts that key set by name so adding
one back is a red test rather than a code-review opinion.

### Why one signal and not two

There is no correct function from N independent booleans to a three-state enum.
*"Refuse everything that allocates"* and *"refuse nothing"* are different verdicts
about different resources, and any aggregate forces one of them to lie. The
reference implementation this design came from collapsed exactly that way: it
classified on the **disk** percentage alone, and memory — measured and shipped —
never affected enforcement, so a completely saturated process reported `NORMAL`.

Disk stays measured because an operator looking at a green memory line beside a
red disk line has learned something real, and `bavail` rather than `bfree`, because
`bfree` counts blocks reserved for root this process may not use.

### Why disk could not be a trip input even if we wanted it to

- The app cleans up its own logs and its own temp files. Everything else on the
  volume belongs to the OS, to Postgres or to the operator, and the remedy is a
  human with `df -h`.
- A disk trip converts a condition with an obvious manual remedy into an automated
  refusal that **hides the condition while it is still true**, with a message that
  mentions no filesystem.
- The trip the app can actually make is *"stop allocating"*, and the only lever an
  application holds over memory is not starting new work. A disk trip asks the app
  to refuse work it was never the right party to refuse, using a lever it does not
  hold.

### What the trip set did not have to include, and why

**The database's own protection is below both runtimes, not above them.**
`0007_resource_ceilings.sql` sets `statement_timeout`, `lock_timeout` and
`idle_in_transaction_session_timeout` with `ALTER DATABASE` — database-scoped,
because every connection logs in as `pgrst_authenticator` and then `SET ROLE`s, so
`ALTER ROLE` would be a setting applied to nothing. Those cannot be forgotten by an
interceptor, which is the property the breaker cannot claim for itself. **The
breaker does not protect Postgres and nothing in this repository may be described as
doing so.**

### The cold-start correction, which this record exists partly to preserve

The design's own staleness rule — *a reading older than `2 × BREAKER_POLL_SECONDS`
is unmeasured, and unmeasured fails stopped* — applied exactly as written **refused
every non-protected dispatch with `202` for the first thirty seconds of every
process's life**, and turned a committed, previously-green e2e test red.

`sample === null` is now its own condition, distinct from `stale`, and it is
**admitted**; the dead-instrument refusal lives on a sample that *exists* and has
aged. The first reading is taken in `onApplicationBootstrap` before the interval is
registered, so "never measured" is a state before an app can serve an HTTP request.

**The general rule, which is the part to carry to the next control: a fail-closed
rule needs an explicit statement about the state it does not cover.** "No reading is
stale" and "no reading is healthy" are different sentences, and collapsing them
produces a control that fails **stopped** on a healthy machine that has not finished
starting. ADR-0023 already records the mirror image — a failed measurement reported
as a healthy one.

### What was rejected

- **A second trip signal (`db_pool_waiting`, load average).** Pool saturation is a
  *consequence* of the app doing too much, and the response is the same response, so
  it adds a threshold to configure without adding a decision to make.
- **A health DTO with an aggregate `status`.** Refused for the enum reason above,
  and refused mechanically.
- **`@Cron` for either job.** `@Cron` binds during `OnModuleInit`, which Nest runs
  before `OnApplicationBootstrap`, so a meter registered that way can take its first
  reading before the configuration has been asserted. Both jobs register a plain
  `unref()`ed `setInterval` in `onApplicationBootstrap` and hand the handle to
  `SchedulerRegistry`. **`@nestjs/schedule` is a dependency** — v12, not v6, which
  peers on Nest 10/11 while this tree is Nest 12 — and `docs/rebase.md` §9A.3 and
  §9B.8 both said not to add it. The plan's *argument* (ordering) was right and its
  *conclusion* (the library) was wrong; both are recorded there.
- **The breaker as a guard.** Refused: a capacity verdict ahead of authentication
  hands an unauthenticated prober the reconnaissance that makes a follow-up attack
  cheaper. An information disclosure to anonymous callers is worse than an un-gated
  flood a reverse proxy could absorb.
- **A per-service "is this abortable" flag.** STOP is a contract: a site is
  stoppable because it takes an `AbortSignal` and its acceptance test is *"aborting
  leaves no partial state"*. A flag makes that a deployment-time opinion; a contract
  makes it a fact with a test attached.

### The gap this record leaves open

**`KNOWN_DISPATCH_TOKENS` is not a route census and nothing enforces that it is.**
`dispatchTokenForRoute()` returns `undefined` for a route this build cannot name,
and no code path walks the mounted routes — so **a new route is silently
sheddable**. The boot-time check that does exist runs the other way: an entry in
`BREAKER_PROTECTED` naming no known token is refused, which catches a typo in the
protection list and cannot catch a route that was never listed.

The obvious gate is a boot-time route walk, and it is not built because
`test/e2e/email.e2e-spec.ts` mounts `EmailProbeController` into `AppModule` — by the
same construction, a dispatch site. The only two ways to make such a gate pass are
adding the fixture's routes to `BREAKER_PROTECTED` (which hides the defect rather
than closing it) or exempting test environments (a `NODE_ENV` branch around a
security control). Both are refused. Recorded as a review item; the file says so.

---

<a id="adr-0028"></a>
## ADR-0028: `ccpa_applicable()` is address-triggered, deliberately over-applies, and has no config flag

**Status:** Accepted, and **shipped**.
`backend/database/migrations/0013_company_profile.sql` implements it and
`backend/test/rls/geo-profile.spec.ts` proves it, asserting the constraint, the
function and the two together.

**Context.** A template that ships a statutory predicate needs to answer *"is the
CCPA reached?"* somewhere. The obvious design is a configuration flag: an operator
answers the question once, in `.env`. That design is refused here, and the refusal
is the decision.

### The decision

```sql
CREATE FUNCTION public.ccpa_applicable() RETURNS boolean … AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_addresses a
     WHERE a.region_code = 'CA' AND a.country_code = 'US')
$$;
```

**It answers `true` when the company holds an address in California, and it does
not care whether the company is a covered business.** There is deliberately **no**
`CCPA_COVERED_BUSINESS` flag anywhere in this repository.

### Why over-application is the correct direction

The statutory test is not about the address. CCPA §1798.140 covers a "business" —
one meeting revenue, consumer-count and data-selling thresholds, none of which is
about where its office is. A California address on a company with $200k of revenue
and eleven employees is not a covered business, and this function answers `true`
for it. The asymmetry decides it:

| | Cost | Visible to |
|---|---|---|
| **Over-apply** | An operator receives a CCPA-flavoured data-subject request, reads the thresholds, and replies that the business is not covered. An afternoon, once. | a human, who can make that decision |
| **Under-apply** | Statutory damages. | **nobody** — no request arrives that could have revealed it, and the regulator finds it |

Under-application is the failure mode with no signal. There is a second-order
reason worth more than the first: **over-applying builds the muscle memory.** A
team that has handled the request once knows what it takes; the day the thresholds
*are* met, the machinery is already running. A team that has never run it is
discovering a statutory deadline under one.

### Why there is no config flag

A flag would be a hand-maintained value answering a question **that is not ours to
answer from this repository.** The threshold data lives in Stripe, QuickBooks or an
ERP; it changes four times a year; whoever set the flag last is gone. And the
failure is undetectable: `ccpa_applicable()` returns `false`, the notice does not
render, and **no test fails** — a statutory determination has become an operator
preference with no signal. No configuration can talk us out of getting this wrong in
the direction that matters, so nothing here tries.

**When the threshold test does land, it is not a boolean on this table.** It is a
decision made from a system of record that holds the numbers, recorded with a date
and a reason, so that *"why did we think we were covered on the 3rd of March"* has
an answer. That is a different table with a different owner, and pretending a
column here is that table is how it gets done wrong quietly.

### Why `company_addresses` is a child table

Because "several" must be representable for the predicate to be correct. A single
`region_code` column on `company_profile` would force a choice between recording
one address honestly and recording all of them falsely: a company with an office in
California and a head office in Delaware has to write down one of them, and
whichever it writes down is a claim about the whole company that is not true. The
child table makes *"any one of these is in California"* a question the schema can
answer, and `EXISTS` is therefore correct where `country_code = (SELECT …)` on a
single profile row would not be.

### Two consequences a reader must know

- **`= 'CA'` is an exact comparison, not `upper(...) = 'CA'`.** The `CHECK`
  constraints make the stored form canonical, so the exact form is sound, and
  `upper(btrim(...))` would hide a data-quality bug rather than surface it: the same
  `'ca'` would then work here and break every other query written against the
  column. The dependency is real and the suite asserts the constraint, the function
  and the two together so it fails loudly rather than silently under-applying.
- **This function does not answer GDPR.** Art. 3(2) reaches a controller outside
  the Union that **offers goods or services to persons in the Union**, and no
  predicate over `company_addresses` can detect it — there is no row to find. That
  closes through the **user's own declaration**: `users.region_code` and
  `users.geo_source` (`0012_user_geo.sql`) record where the person is, and the
  assessment is made from that row. Stated here because the failure mode of a
  compliance table is somebody later reading `ccpa_applicable()` and concluding
  that geographic scope is solved here. It is not.

### Why the function is anonymous-reachable

A contact address and a company name are printed on a letterhead, and the
disclosure is owed to anybody **including someone who is not signed in** — a `401`
on a public privacy-policy page is not a security control, it is a denial of the
disclosure itself. An anon-reachable `SECURITY DEFINER` function is normally a red
flag in this schema (`0001` measured 63 unauthenticated probes recovering an
administrator's whole permission set through one). It is safe here for a specific
reason: the function takes **no argument**, reads **no caller identity**, and its
answer is a function of table content that is public anyway. There is no `who` to
launder an identity through, no GUC to set, and no grant to reach past. **It is a
predicate over two columns.**

### One subtle dependency that fails in a way nobody would look for

`ccpa_applicable()` is `SECURITY DEFINER`, so `current_user` inside its body is the
**function owner**, never `app_admin`, whoever called it — and both tables are
`FORCE ROW LEVEL SECURITY`, which binds the owner to their policies. The read
policy is therefore `USING (true)`. **Had it been written
`current_user = 'app_admin'` — the shape every other table in this schema uses —
this function would return `false` for everyone, with no error, on every
deployment, and the privacy notice would never render.** Same failure ADR-0023
records for a definer function that reads `current_user` instead of its argument.
The two statements are one decision: if a future migration narrows the read policy
on either table, this function must be re-read in the same change.

---

<a id="adr-0029"></a>
## ADR-0029: Three privacy/DSAR tables, three scoping categories, and a working copy that may be cascade-deleted

**Status:** Accepted, and **shipped**.
`backend/database/migrations/0010_privacy_requests.sql` implements it;
`backend/test/rls/privacy-requests.spec.ts` proves it and is a gating step of
`npm run verify`.

**Context.** `docs/rebase.md` §9 ported the legacy privacy module and rejected most
of it — its soft delete, its unwired `AbortController`, its audit table that no
migration created, its jurisdiction list hardcoded as an array literal. What
survived was a request, its clocks, and a compliance record. Getting those three
into this schema is mostly ADR-0025 and ADR-0023 applied to a new subject; the parts
that were genuinely decided here are recorded below.

### The three tables and their categories

| Table | Category | Primary key | Why that category |
|---|---|---|---|
| `privacy_requests` | **DERIVED** | simple `(id)` | its scope is the **subject's** membership |
| `privacy_request_regulations` | **DERIVED** | `(request_id, regulation)` | visible exactly when its request is |
| `privacy_request_audits` | **unscoped** | simple `(id)` | global *record-keeping*, not tenant data |

**`privacy_requests` has no `group_id`**, for ADR-0025's two reasons, both of which
apply verbatim: a user may hold several groups (one column means duplicating a
request per group, after which *"which groups is this request in?"* is ambiguous),
and a data-subject request names **no group at all** — inventing one puts the row
in a scope nobody chose.

**Its one foreign key leaves the derived set**, which ADR-0023's rule permits only
at a table members cannot write to, and `app_member` holds no write verb on `users`
at all. `user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE`.
The residual is the usual one and it is recorded in the migration: FK checks bypass
RLS and fail **open**, so this is an existence oracle over `users.id` (`23503`
versus success). Accepted, bounded by a 122-bit database-generated key, asserted.

**`ON DELETE CASCADE` and not `NO ACTION`, because of the erasure.** Both
alternatives forbid the orphan by *refusing the delete*, which moves the guarantee
into a two-statement ordering contract that exists only in code nobody has written
yet. `CASCADE` makes the outcome a property of the schema rather than a property of
a future caller.

### The regulations table exists because the clocks are independent

GDPR Art. 12(3) and CCPA §1798.130(a)(2) run on independent deadlines. One person
can be under both, on different dates, with one extension granted and the other not.
A single `regulation text` column on the request can hold exactly one of them and
therefore cannot express the case that matters.

**Dedup is the primary key.** `PRIMARY KEY (request_id, regulation)` means a user
who picks CCPA when CCPA is already there writes a colliding row, dropped by
`ON CONFLICT (request_id, regulation) DO NOTHING`. There is no *"does this
regulation already exist"* branch to get wrong and no second spelling of it in the
application. `extension_used` is `NOT NULL DEFAULT false` and not nullable: a
nullable flag has three states, and *"we do not know whether we extended this"* is
a state an auditor reads as *"we did not"*.

### The read policy needed two branches, and capability cannot be the discriminator

`privacy_request:read` is conferred on `member`, `manager` and `admin` — a subject
who cannot read their own request cannot exercise the right they are exercising.
**And `has_permission()` walks *up* `roles.parent_id`**, so a member resolves the
ancestor set `{member, manager, admin}` and holds **every** row `admin` holds.
Capability is therefore the *gate* and can never be the *filter*.

The shipped predicate puts both axes in one uncorrelated subquery, with the subject
branch inside the union so it survives the `current_user` test:

```sql
CREATE POLICY privacy_request_read ON public.privacy_requests FOR SELECT USING (
  privacy_requests.user_id IN (
    SELECT v.user_id FROM (
      SELECT authz.actor() AS user_id
      UNION
      SELECT u.user_id FROM authz.visible_user_ids() AS u (user_id)
    ) AS v
     WHERE authz.can_read_privacy_request()
       AND (v.user_id = authz.actor() OR current_user = 'app_admin')));
```

Everything lives **inside** the subquery, which is what buys one capability
resolution per statement: a `STABLE` function beside the `IN` is still evaluated
once per candidate row. Measured on this policy at 1,205 rows: `loops = 1`, and
**one** call each to `can_read_privacy_request()` and `visible_user_ids()`, against
ADR-0025's recorded 3,300-versus-1.

`privacy_request_create` is self-service (`user_id = authz.actor()`), and
`privacy_request_update` carries a `WITH CHECK` that confines a member to
`status IN ('open','withdrawn')`. **A member who could take their own row to
`fulfilled` would manufacture a compliance claim**, and nothing else in the schema
would notice.

### `delete` is absent, and it is the load-bearing omission

CPRA §1798.105(c)(2) and 11 CCR §7101(a) require the record of a consumer request
to be **retained** for at least 24 months. A `delete` capability on the request
table would be a capability to erase a compliance obligation — and it would be the
**first** such capability anybody reaches for, because deleting the thing the user
asked you to do is the most intuitive response to a user asking to be forgotten.

**So `privacy_requests` is the working copy and `privacy_request_audits` is the
record.** The working copy is allowed to be cascade-deleted with its subject. The
row count asserted from `permissions` is `read`/`create`/`update` and **no
`delete`**, and `DELETE` is withheld from every serving role including `app_admin`.

### What was rejected

- **A `regulation text` column on the request.** §9.4's own text names the reason it
  cannot work (independent clocks) and then does not name a shape. Naming the
  problem without designing for it hands the design to whoever writes the DDL.
- **A fourth table for the SLA ladder** with an accumulated pause. `accrued_paused_time`
  is a column that exists for a pause/resume feature nobody implemented, and a
  deadline `CHECK` would make a row expire by sitting still.
- **Reusing `user:read` or `privacy:read`.** ADR-0023: reusing a permission makes
  the grant invisible, because widening it for an unrelated reason silently widens
  request visibility and nobody reading that diff would know.
- **An `authz.erase_subject()` in this design** (planned as W42). See
  `0009_anonymisation.sql` and `docs/rebase.md` §9.8.3: the obvious implementation
  is *impossible* here, because a read of `users` from inside `has_permission()`
  re-enters its own policy and PostgreSQL raises
  `infinite recursion detected in policy for relation "users"` — a hard failure on
  every call, for every caller. The shipped choke point is a write-time trigger over
  the row set the two axes already resolve from, and **a referential action fires
  on `DELETE` while anonymisation is an `UPDATE`, so the `ON DELETE CASCADE` from
  `0008` never runs.**

---

<a id="adr-0030"></a>
## ADR-0030: `privacy_request_audits` carries no foreign key to `users`, and append-only is enforced by the absence of grants

**Status:** Accepted, and **shipped** — with the subject half of the append gate
corrected by `0014_privacy_request_audit_subject_gate.sql`.

**Context.** This is the table that has to survive everything else, and it is the
only table in the schema where *mutation* rather than *deletion* is the threat.

### No foreign key to `users`, and no foreign key to `privacy_requests`

**Both referential actions fail, for different reasons, and both fail silently in
the design sense.**

- **`ON DELETE CASCADE` would erase the compliance record.** The user's row is
  deleted by the erasure and by the purge. The record of what was asked, when, and
  what was answered is the only evidence that the request was honoured — deleting
  it converts compliance from an obligation into an unverifiable claim.
- **`ON DELETE SET NULL` is worse, because it does not work at all.** `SET NULL`
  performs an `UPDATE`, and **no serving role holds `UPDATE` on this table** — that
  is the append-only property below. So `DELETE FROM privacy_requests` would raise
  **`23503`** and block deletion for the whole 24-month retention window: the one
  operation the feature exists to perform would be the one thing it could not do.

So the row carries **`request_key`** — a second uuid on `privacy_requests`, minted
by the column default, which is *not* the primary key — as the correlation id.
**`request_key` is the join that survives the join being impossible.** It is not an
FK to `privacy_requests` either, for the same reason: those rows are deleted by the
erasure, by the purge and by housekeeping, and the record has to outlive them.

### Subject identity is a keyed digest, never the id

`subject_hmac bytea NOT NULL` is the HMAC of the subject's user id under a pepper
named by `pepper_kid`. That is what lets an auditor answer *"were all requests from
this subject answered?"* **after the subject's row is gone**, without retaining a
link to a person who asked to be forgotten — which is the tension the two retention
obligations create, and the reason the id is not a column on the record.

`pepper_kid` is on the row rather than in configuration alone because **a pepper
that rotates makes every historical row unverifiable** unless the reader can tell
*which* pepper signed it. A single global "current pepper" is exactly the answer
that stops existing the first time it rotates.

`subject_user_id` is a **nullable** convenience column for the window in which the
row still exists, and it is nullable on purpose: an audit row that must be written
**before** the subject's `users` row is gone cannot be a constraint on a row that
follows it.

### Append-only is a mechanism here, not a nicety — because a `CHECK` only fires on `INSERT`

**This is the whole reason.** The table's §7101(b) completeness requirements —
`responded` implies a response time and a response nature, a denial implies a
statutory basis, a response cannot predate its request — are `CHECK` constraints.
And a `CHECK` is evaluated **only on `INSERT`**.

That is fine for an immutable row and catastrophic for a mutable one: a row could
satisfy every constraint at the moment it is written and be **emptied afterwards** by
an `UPDATE`, at which point nothing re-evaluates anything and the constraint that
was supposed to be the guarantee has already done its only job. **There is no way to
write a constraint that survives a mutation of the row it constrains.**

So append-only is the only shape in which those constraints mean anything, and it is
enforced by the **absence of grants**: `REVOKE ALL … FROM PUBLIC, app_anon,
app_member, app_admin` and then `GRANT SELECT TO app_admin` and nothing else. **No
serving role holds `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` — `app_admin`
included**, which is the half that is actually load-bearing, because `app_admin`
holds the full verb set on every other table in this schema. `TRUNCATE` does not fire
a row trigger, so it is closed by the grant alone and asserted **per role** rather
than left in a comment.

**Both halves are there on purpose:** there is no write *policy* and there is no
write *grant*. Either alone would do; a single forgotten word in one of them would
be invisible.

### Why the six §7101(b) fields are repeated on every row

The obvious design is a header row carrying the intake facts and detail rows
carrying only the response. It is wrong, because **a compliance record is read row
by row**: a record whose intake facts live on a sibling row is incomplete the moment
that sibling is not in the extract, and *"not in the extract"* is every export,
every pagination page and every single-row query.

So each row independently satisfies §7101(b). **The repetition is the mechanism, not
a duplicated fact that can drift**: the response row repeats the intake fields of
the *same* request, and the single write function that appends it is the only
writer, so the two copies are written by one caller in one transaction or not at
all.

### One write function, and what only it can enforce

`authz.append_privacy_request_audit()` is `SECURITY DEFINER`, in `authz` (outside
`db-schemas`, so PostgREST cannot address it from `/rpc/` either), granted to
`app_member` and `app_admin` and **not** to `app_anon`. It enforces the two things
no `CHECK` can see:

1. **WHO the record is about.** A member may file for themselves and not for a
   colleague. `0010` checked the `privacy_request:update` **capability alone** —
   which that capability does not distinguish, because `0010` confers it on all
   three tiers and the resolver inherits upward. A member could therefore append a
   record naming a colleague, **and** append a `responded`/`fulfilled` event, i.e.
   certify that their own statutory obligation had been discharged.
2. **WHICH events are an operator's to write.** `received` is the subject's own act;
   everything past intake is the business answering a request *about* somebody.

`0014` fixes both, as a **new migration** rather than an edit of an applied one.
Its body reads the `role` GUC through `authz.serving_role()` rather than
`current_user`, because **inside a `SECURITY DEFINER` function `current_user`
rebinds to the OWNER** — measured on this cluster:

```
SET ROLE app_anon   -> current_user=app | current_setting(role)=app_anon
SET ROLE app_member -> current_user=app | current_setting(role)=app_member
SET ROLE app_admin  -> current_user=app | current_setting(role)=app_admin
```

A body testing `current_user = 'app_admin'` answers `false` for **every** caller
including `app_admin`, so the obvious translation would have refused every operator
event in the deployment — **with no error anywhere, because a denial and a success
are both a returned row count.** The `role` GUC is not caller-writable in the
`request.jwt.claims` sense ADR-0023 §F1 is about: `SET ROLE x` succeeds only for a
principal that is a member of `x`, so it is bound by the same escalation `GRANT` in
`database/bootstrap/001_roles.sql` that every `current_user = 'app_admin'` branch in
this schema already depends on.

**And the predicate is deliberately NOT shared with the policy as a helper**, which
is the surprising part and is worth recording because the right instinct produced a
measurably worse design. One `UPDATE` over 1,200 rows as `app_member`, from
`pg_stat_user_functions`:

```
can_update_privacy_request | 1200 calls
has_permission             | 1202 calls
actor                      | 2416 calls
```

`privacy_request_update`'s `USING` has no uncorrelated subquery, so there is nothing
for a shared `STABLE` helper to hide inside and be hoisted past — pointing the policy
at one would have **added** a second per-row resolution to save one `OR`. The
accepted drift runs the other way: the policy stays as `0010` shipped it, the
function is the copy changed to match, and the comment is written on both sides.

---

<a id="adr-0031"></a>
## ADR-0031: The retention machine writes the queue through `authz`, not through a claims document and not through a policy branch

**Status:** Accepted, and **shipped** — `0016_purge_machine_path.sql`, with the
claim proven in `test/rls/purge-machine-path.spec.ts` and the control path in
`test/unit/purge/purge-enqueuer-scheduling.spec.ts`.

**Context.** `0011` built `privacy_purge_queue` with two policies and granted
`SELECT, UPDATE` to `app_admin`, because `PurgeSweeper` issues four ordinary
`UPDATE`s on it. That grant let the claim be *attempted*. The attempt matched
nothing, silently:

```
-- pgrst_authenticator, SET LOCAL ROLE app_admin, NO claims in scope,
-- exactly PurgeSweeper.sweepOne()'s session:
UPDATE privacy_purge_queue AS q SET status = 'claimed', … RETURNING q.id;
=>  UPDATE 0
```

The claim's inner `SELECT … FOR UPDATE SKIP LOCKED` is a plain `SELECT`, so it is
governed by `privacy_purge_read`, which is `authz.can_read_privacy_purge()` alone.
`authz.actor()` is `NULL` in a claimless session, `has_permission(NULL, …)` is
false, the sub-select is empty, and the retention job drains nothing — with no
error anywhere. **An `UPDATE 0` is indistinguishable from an empty queue.**

### The three routes out, and why two are closed

**1. A `current_user = 'app_admin'` branch on `privacy_purge_read`. CLOSED.**
Three words, and it contradicts the shipped rule that capability resolves from
`role_permissions` → `roles` and never from the database role. It is worse than
contradictory: `test/rls/privacy-purge-queue.spec.ts` asserts **against** it — an
admin holding the table grant whose role lacks `privacy_purge:read` must read
**zero** rows. Satisfying the machine would have meant weakening a security test to
admit a background job, which is the trade ADR-0023 §Withdrawn already records going
the other way.

**2. A `request.jwt.claims` document written by the job. CLOSED, and this is the
important one.** `AGENTS.md` §B2 F1 records that `request.jwt.claims` is a **custom
GUC and that any role may `SET` it** — verified exploitable: a member set it
directly and read another tenant's rows. Nothing in the schema prevents it, and
**no grant, policy or constraint can restrict a custom GUC.** The only control is
architectural: *no request-reachable SQL path may write it*, which is an absence
rather than a defence.

A scheduled job that wrote its own claims document would be exactly such a path,
promoted to a standing P0 so that a cron entry could drain a queue. `AGENTS.md`
F1 already names a `db-pre-request` hook that can reach that `SET` a P0; this
would be the same defect wearing a cron expression, and it would be **permanent** —
a cron expression is not something a security review declines. The end-to-end test
that had been setting a claims document as a workaround was removed rather than
kept, and `test/unit/claims-write-surface.spec.ts` asserts the whole `src/` and
`database/` trees reach no such `SET`.

**3. A narrowly-granted `SECURITY DEFINER` function in `authz`. TAKEN.** It is the
seam the schema already had: `authz.append_privacy_request_audit()` (`0010`) is the
working precedent for a write through exactly this route, and `0011` had already
named `authz.enqueue_inactive_purges` as the enqueue writer — a function that did
not exist until this decision was taken.

**Why `authz` and not `public`:** `db-schemas = "public"` (`postgrest.conf`), so
nothing in `authz` is addressable at `/rpc/…` and nothing in it appears in the
generated OpenAPI contract. A write seam PostgREST can address is a write seam a
token can reach.

### What shipped

Five functions — `claim_due_purge`, `complete_purge`, `fail_purge`,
`requeue_purge`, `enqueue_inactive_purges` — plus `retention_due_tombstones`, which
is `SECURITY INVOKER` because a definer cannot read `users` (see below).

**`UPDATE` is revoked from `app_admin`.** This is not a tidy-up. With the grant
still held, the four bare `UPDATE`s remain a second, *working* way to do the same
job (§2.4), and the one that is inert fails **silently** — `UPDATE 0`, read as
"nothing due". Revoking turns it into `permission denied for table`, which names
the defect at the statement that caused it, and leaves the seam as the only writer.
`privacy_purge_write` is **kept**: it is the second half of the control, so a
future table-level `GRANT UPDATE` cannot open a write by itself.

**Four functions rather than one `settle_purge(id, instance, status, …)`.** A
status *parameter* turns a closed set of transitions into an open one at the
function boundary, and `done` without a count or `failed` without a reason are
exactly the two shapes the table's `CHECK`s exist to refuse (§2.3's success-shaped
value, expressible one argument away).

**Each returns the number of rows it matched, not `void`.** `pg` reports
`rowCount === 1` for a `SELECT` whether or not the function found anything, so a
void function would make "matched nothing" and "succeeded" the same value — and
"matched nothing" is what says a sweeper no longer owns the row.

**`retention_due_tombstones` is INVOKER, the other five are DEFINER, and that
asymmetry is measured rather than stylistic.** `public.users` is FORCE ROW LEVEL
SECURITY, so the table OWNER is bound by `users_read_scope`; and inside a
`SECURITY DEFINER` body `current_user` *is* the owner. A definer scan therefore
reads **zero** tombstones: measured on this schema, 0 rows against a table holding
1, where `app_admin` returns 1. The read has to run as `app_admin` — the superset
principal, for which `users_read_scope` deliberately keeps the admin branch first —
while the write has to run as the owner, which is the only principal with `EXECUTE`.

### Consequences

- **The machine is identified, not authenticated.** The boundary is
  `pgrst_authenticator` + `SET LOCAL ROLE app_admin`, the same one
  `database/seed.ts` and `AuthService` use, which a token can only assume if the
  signature verifies. None of the five functions reads `authz.actor()` or
  `current_user`: identity is not their business.
- **These functions have no policy applied to them at all.** The table is enabled
  but not forced (`0011`), and a definer body *is* the owner. Bounded by two facts
  and only two: the owner never receives a request, and each function's `EXECUTE`
  is revoked from `PUBLIC` and granted to `app_admin` alone. **The narrowness is
  carried entirely by `EXECUTE`, which is a weaker control than a policy** — a
  policy cannot be applied to a `SECURITY DEFINER` body, and forcing the table
  would have closed the machine path entirely rather than narrowed it.
- **A dormant live account is still not purged.** The scan reads `users.deleted_at`
  — tombstones only. `users.last_activity_at` is not in the schema, and the reason
  is §9A.6's: it would have to be written by application code on every
  authenticated request, so the template would be measuring application activity
  and not database activity. `docs/rebase.md` §9A.8.1 says so in the same words.

---

<a id="adr-0032"></a>
## ADR-0032: `email_messages` is cascade-deleted with its subject, and the 24-month obligation keeps its home in `privacy_request_audits`

**Status:** Accepted, and **shipped** — `0015_purge_user_cascade.sql`, proven in
`test/rls/user-purge-end-to-end.spec.ts`.

**Context.** `SqlPurgeExecutor.deleteUser()` issues `DELETE FROM users WHERE id = $1`.
`refresh_tokens.user_id` (`0002:73`) and `email_messages.user_id` (`0005:56`) were
both `REFERENCES public.users (id)` with no `ON DELETE` clause — `NO ACTION`. So
**every real purge raised `23503`**: the sweeper's savepoint unwound the deletion,
the row was requeued, and after `RETENTION_PURGE_MAX_ATTEMPTS` it sat in the admin
list as `failed` with the constraint violation in `error`. The failure was loud and
attributable, which is the mechanism working as designed — and the retention it
was built to perform did not happen.

**Why this was invisible to every test that existed.** The RLS fixture user was
deliberately given no refresh tokens and no mail history, so the one combination
that failed was the one the fixture avoided. `privacy-purge-queue.spec.ts` exercised
queue mechanics and wrote its rows as the owner; the unit suite drove the sweeper
through a structural port with no database at all. Neither could observe an FK.

### The decision that was actually available

**It was not "add a CASCADE or fix the SQL".** The explicit ordered child-delete
was measured first and **is not available**:

- `email_messages` is **FORCE**d RLS with `SELECT` and `INSERT` policies only;
- `FORCE` binds the table **owner** — and `SECURITY DEFINER` does not help, because
  a definer *is* the owner, so it reads the table through the very policies the
  child-delete would be violating.

**The referential action is the only route.** `CASCADE` on both FKs is what closes
it, and `0015` **preflights that the child tables are owned by the role whose
privileges govern an `RI_Trigger`**, because that is what makes the documented
behaviour the actual behaviour rather than a coincidence of this cluster's grant
history. An `RI_Trigger` runs as the *table owner* and is exempt from RLS — so
FORCE on the child does not bind it, and a forker who changes the owner breaks
this silently. The preflight is the assertion.

### Why `email_messages` is deleted rather than retained

The obvious counter-argument is that a mail log should outlive the person: a
24-month obligation exists somewhere, and cascading the mail away looks like
destroying evidence.

**The obligation already has its correct home, and it is not the mail log.**
ADR-0030 is why: CPRA §1798.130(a)(2) requires the *record of a consumer request*
to be retained for at least 24 months, and `privacy_request_audits` is that record —
which is exactly why it carries **no foreign key to `users`**, carries a keyed
digest as `subject_hmac` rather than the id, and is append-only by the absence of
grants. An audit row can answer *"were all requests from this subject answered?"*
long after the subject's row is gone, and that is the obligation.

So keeping `email_messages` would have created **a second, quieter retention on the
mail log** — one with no obligation attached, no clock, no audit, and no reader —
which is worse than its absence. `0008` had already named leaving those rows behind
as the defect: a mail body is personal data, it is the copy that actually contains
what the user wrote, and "retain it because the user asked to be forgotten" is the
outcome the whole module exists to prevent.

### Consequences

- **The cascade is a property of the schema, not of a caller's discipline.** Both
  `privacy_requests` (ADR-0029) and `email_messages` cascade; that is the second
  precedent for *working copy versus record* in this schema, and the pattern is:
  the working copy may follow its subject out, the record may not.
- **The trade is stated rather than assumed.** The mail history of a purged user is
  gone, and if a fork needs it for abuse investigation it has to retain an
  *encrypted copy in a system that is not reachable by the purge* — which is a
  decision to make deliberately, not a default to inherit.
- **It is gated as a class.** `test/rls/user-purge-end-to-end.spec.ts` asserts that
  **every foreign key naming `users` is `CASCADE`**, so a sixth referencing table
  added later as `NO ACTION` fails the gate rather than waiting to be discovered by
  the next real erasure. That gate is the difference between fixing this instance
  and fixing the family.
