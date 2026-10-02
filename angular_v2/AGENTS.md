# AGENTS.md

Guidelines for agents operating in this repository.

This file is the single source of truth for both humans and automated agents
(Kilo, Cursor, Gemini, Copilot). **`GEMINI.md` imports this file** — do not
duplicate these rules elsewhere; update them here.

---

## 0. What this repository is

An **Angular 22 (SSR) frontend + NestJS 12 (Fastify) backend** template intended
to be forked and built upon.

Two consequences follow, and they drive most rules below:

1. **This repo is never a live app.** There is no production deployment, no
   accounts, no third-party API keys. Every feature must work with zero external
   credentials — self-hosted or purely local.
2. **Most changes here will be made by AI agents.** That makes *mechanical
   enforcement* far more important than documentation. An agent pattern-matches
   the nearest example and replicates it. The code is the instruction.

---

## 1. Commands

```bash
# Backend — backend/
npm run build
npm run lint
npm test
npm run migration:run        # apply migrations
npm run db:seed              # seed roles/permissions/admin user

# Frontend — frontend/
npm run lint
npm run test -- --watch=false
npm run build
npm run serve:ssr:frontend   # SSR on :4000 (primary way to run the app)
npm start                    # dev server on :4200 (no SSR)

# Database — a local PostgreSQL instance, connection via .env
psql -h localhost -U postgres -c 'select version();'
```

Postgres is expected to be running locally. Connection settings come from
`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` in `.env`.
Docker is not used and is not a supported path.

### The verification gate

```bash
npm run verify
```

**This is the most important command in the repository.** It runs typecheck,
lint, tests, and a smoke check against a live database. A change is not complete
until `verify` passes.

- Never report work as done on the basis of "it looks right."
- Never weaken a lint rule or delete a test to make `verify` pass. Fix the code.
- If you add a rule-worthy pattern, add the ESLint rule that enforces it (see §3).

---

## 2. Global rules

These apply to both frontend and backend.

### 2.1 Never ship something that looks finished and isn't

A stub, `// TODO`, hardcoded mock, or `of({...})` fake return is **worse than
absence**, because it reads as a working implementation. Agents and humans both
build on it.

- A function is either fully implemented or does not exist.
- No `// Implementation will be added later` in reachable code.
- No hardcoded expected values in client-side validation logic.
- Mock data belongs in test files or `*.stories.ts`, never in application code.
- If a feature is deliberately deferred, do not create the file.

### 2.2 No mock services. Ever.

**Mocks are the most common way an agent fakes progress.** Creating
`MockAuthService` to unblock a compile, then reporting the task complete, is the
single most frequent failure mode in this codebase's history. It is forbidden.

- **A mock service must never exist in application code.** Not in `src/` outside
  `*.spec.ts`, not in `*.service.ts`, not "temporarily". If a real service
  cannot be written yet, the consuming code does not get written either.
- **Never register a fake in the DI container.** No
  `{ provide: PermissionsService, useValue: {...} }` outside a test file. If
  production code imports a mock, the build is wrong.
- **No "temporarily for now" mocks.** The word "temporary" is how they survive.
  A mock that reaches a fork's `main` branch becomes the architecture.
- **Do not create a parallel fake implementation of something that already
  exists.** If `AuthService` exists, build on it. A second `MockAuthService`
  shadows the real contract and both get maintained.
- **Masks, stubs, and fixtures are for `*.spec.ts` and `*.stories.ts` only.**
  Fake data in application code is forbidden for the same reason.
- **Never bypass a real integration to "save time."** If Postgres is
  unavailable, the test fails or is skipped explicitly. It is never replaced
  with an in-memory fake.
- **Never declare a task complete while a mock is in the tree.** Report it as
  blocked instead. A truthful "this needs X" is a valid outcome; a mock plus a
  success message is a lie.

A mock is not a placeholder for work — it is a claim that the work is done. When
reviewing a diff, treat any new mock as a blocking finding.

### 2.3 Fail loudly, never silently

Silent degradation is the single most dangerous class of defect, because it
survives code review and produces confidently wrong behavior.

- **No default fallbacks for security-critical config.** If `JWT_SECRET` is
  missing, throw at bootstrap. Do not default it.
- No `process.env.X === 'development' || true`.
- No config keys read with a default that masks a missing config namespace.
  Assert required config at startup.
- No `synchronize: true` outside test/seed tooling.
- Anything that catches an error must either rethrow, surface it to the user, or
  record a metric. Silently returning a success-shaped value is a bug.

### 2.4 One mechanism per concern

Before adding anything, check whether it already exists. Duplicated mechanisms
are the main source of drift in this codebase's history.

- One auth service. One permission guard. One user entity.
- Before adding a controller, component, guard, or decorator: `grep` for the
  name and for its route/selector. Adding a second `@Controller('permissions')`
  or a second `selector: 'app-users'` silently breaks routing or rendering.
- Do not add a "temporary" re-export or compatibility shim. Fix the imports.

### 2.5 No secrets, no committed data

- `.env*` files are never committed. Only `*.example` files are.
- Never commit SQLite/Postgres database files. A committed DB contains real
  emails, password hashes, and IP/login history.
- Never log credentials, tokens, passwords, or full request bodies.
- Use the injected logger, never `console.log`.

### 2.6 TypeScript

- `strict: true` is on, including `strictTemplates`. Never use `any`.
  Use `unknown` and narrow it.
- Never use the `!` non-null assertion, `as any`, or `@ts-ignore`.
- No unused `ChangeDetectorRef`/`ElementRef` injections.
- One type per file unless they are trivially coupled value objects.

---

## 3. Enforcement is the point

A rule that only exists in prose does not survive. When you add a convention,
add the ESLint rule that enforces it in the same change.

Required baseline. One flat config only (`eslint.config.js`) — a second legacy
`.eslintrc.json` is a second source of truth and drifts:

```
@angular-eslint/prefer-on-push-component-change-detection
@angular-eslint/prefer-standalone
@angular-eslint/template/prefer-control-flow
@angular-eslint/template/conditional-complexity
@angular-eslint/no-empty-lifecycle-method
@angular-eslint/no-implicit-take-until-destroyed
@typescript-eslint/no-explicit-any
```

**`rxjs-angular/prefer-takeuntil-destroyed` does not exist and must not be
listed.** The `rxjs-angular` plugin ships only `prefer-async-pipe`,
`prefer-composition` and `prefer-takeuntil`. Its teardown rule reads
`context.parserServices`, which ESLint 9 removed, while `angular-eslint@22`
requires ESLint ^9||^10 — so enabling it aborts the entire lint run.
`@angular-eslint/no-implicit-take-until-destroyed` is the substitute. The plugin
may stay installed, but **no rule is enabled from it.**

Do not add a rule and then leave existing violations in place — fix them or
scope the rule to new code deliberately. `backend/test/unit/eslint-baseline.spec.ts`
asserts every rule in this list is actually active, and fails if one cannot be.

---

# BACKEND RULES

Location: `backend/`. NestJS 12, Fastify adapter, PostgREST + `pg` (no ORM).

## B1. Database

- **PostgreSQL.** Not SQLite. A locally-installed Postgres server is the
  baseline — it requires no container runtime and no external account.
- **No ORM.** TypeORM, Sequelize and Prisma are not dependencies. There is no
  `entityManager`, no `createQueryBuilder`, no raw-query escape hatch from
  application code. That absence is load-bearing: the previous implementation
  evaded its own security layer through `entityManager.query()`.
- **PostgREST serves base tables.** It is the API layer. Do not add a Nest
  controller for anything expressible as CRUD over a table.
- **No views.** No `CREATE VIEW` in any migration (ADR-0022). PostgREST serves
  base tables. A superuser-created view **bypasses all RLS silently**, and writes
  through views are unreliable (no primary key).
- **One naming convention, end to end.** Columns, the wire, and generated types
  are all `snake_case`. No client key transform, ever — it rewrites keys inside
  `jsonb` and breaks passthrough payloads.
- Derived field → `GENERATED ALWAYS AS (...) STORED` or a `STABLE` function via
  `/rpc/fn_name`.
- **Migrations are the only schema authority.** Plain SQL, one directory, one
  migrations table name. Never edit columns without a migration.
- Every migration needs a working `down()`.
- Store arrays and objects as `jsonb` (or a real Postgres array type). JSON blobs
  must be queryable.
- Timestamps are `timestamptz`. Booleans are `boolean`. UUIDs are `uuid`.
- Columns are `snake_case`. Never quote a camelCase identifier: Postgres folds
  `userId` to `userid`, and the mismatch only surfaces when something else
  references it.
- Index anything you filter or sort on, including `jsonb` paths (GIN).

## B2. Authorization — three axes, three mechanisms, never mixed

**Scope and capability are orthogonal.** A role-based check can be satisfied by a
valid role no matter which site the caller is standing in, so it can never express
"your site's rows." Forcing one mechanism to carry both is why the previous
permissions module could not do row-level security at all (ADR-0023).

| Axis | Question | Mechanism | Keyed on |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | `site_id` claim |
| **Operation** | Which *verbs*? | table + column `GRANT` | DB `role` claim |
| **Feature** | Which *features*? | guards in the thin app | capability role |

**The two role vocabularies are different things.**

| Vocabulary | Values | Used by |
|---|---|---|
| DB role (scope tier) | `app_anon`, `app_member`, `app_admin` | PostgREST impersonation, RLS, grants |
| Capability role | `ic`, `site_manager`, `admin` | thin-app guards, feature checks |

- **An `ic` and a `site_manager` are the *same* DB role — `app_member`.** They
  reach the same features and are scoped to their own site by the *identical*
  policy. Their only difference is capability, enforced above RLS.
- **Never create DB roles named after capabilities** (`ic`, `site_manager`). That
  fuses the axes, forces a policy per role per table, and reinvents the coupling
  this model exists to remove.
- **Never both.** If an operation is a table verb, the database grants it. If it
  is application logic, a guard checks it. Applying both to one operation means
  two places to update and two ways to disagree.
- **Invariant, and it is greppable:** you must be unable to write one query or
  guard that filters by site **and** by feature. Confirm no capability role appears
  in any policy or grant.

### Scope — Postgres RLS only

**Row-level security is enforced by Postgres policies. Never in application
code.**

- **VERIFIED ON A LIVE INSTALL: a table's owner bypasses its RLS policies.**
  Postgres exempts owners from RLS. If the migration role also serves requests,
  every policy is a no-op and **nothing errors** — verified: the same JWT claim
  returned 5 of 5 rows as owner and 2 of 5 as a non-owner.
  - **Two distinct roles, always.** A migration/owner role that never receives
    requests, and a request-serving role that owns nothing.
  - **`ALTER TABLE … FORCE ROW LEVEL SECURITY`** on every protected table, so
    even the owner is subject to the policy.
    - **`FORCE` does not bind a superuser or `BYPASSRLS` role** — verified: `postgres`
      read 5/5 from a `FORCE`d table. Every role that can reach a protected table
      must be `NOSUPERUSER NOBYPASSRLS`, asserted in a test.
  - **That includes the migration role for `DML`.** DDL is unaffected, but seeding
    is `INSERT`, so the owner is now rejected by the policy (`new row violates
    row-level security policy` — verified). Seed from a role that sets
    `request.jwt.claims` to a value the policy admits. **Never disable
    `row_security` to seed** — that reopens the bypass.
  - Omitting `WITH CHECK` is safe: Postgres falls back to the `USING` expression
    for inserts, so one expression governs both visibility and insertability.
  - A test asserts the policy applies when run as the migration role, not only as
    the request role.
- Write `CREATE POLICY` in a migration. RLS sits below the application, so no
  forgotten guard, new endpoint, or future runtime can bypass it.
- One policy per table, and it must be **total** — every `OR` branch is
  evaluated, so a cast in any branch can take the whole query down. Never write
  a bare `current_setting(...,true)::json`; it **raises** on an empty string
  rather than denying. Use a defensive accessor and `nullif` on the uuid cast:

```sql
CREATE FUNCTION request_claims() RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

CREATE POLICY row_scope ON projects USING (
    request_claims()->>'role' = 'admin'
    OR site_id = nullif(request_claims()->>'site_id', '')::uuid
);
```

- **An `admin` token carries no `site_id`**, so the admin branch matches every row
  and `nullif(...)::uuid` yields `NULL` — `TRUE OR NULL` is `TRUE`. A *malformed*
  `site_id` on an admin token is therefore harmless, because the right-hand cast
  never completes.
- Absent, empty, or `{}` claims → both branches false → **zero rows**, no error.
- **`SET LOCAL app.user_id` is not an alternative.** A policy reads the setting it
  names; `app.user_id` is invisible to a policy built on `request.jwt.claims`.
- **Hierarchy functions must return a scalar array, not `SETOF`.** Postgres rejects
  set-returning functions in policy expressions. Use `RETURNS uuid[]` with
  `array_agg`, and expect **per-row evaluation** — a 400k-row scan cost 400,001
  calls. Mark them `PARALLEL UNSAFE`; `PARALLEL SAFE` cost ~170× on the same scan.
- **`EXECUTE` is granted to `PUBLIC` on new functions by default.** `REVOKE
  EXECUTE … FROM PUBLIC` on every function, or any `SECURITY DEFINER` helper is
  anonymously reachable. Verified: 7 of 9 test functions had `NULL proacl`.
- **Hierarchy is a function, not a policy.** Scope derives from position in a tree
  via one recursive `customer_tree(root)` — `LANGUAGE sql STABLE`, `SECURITY
  INVOKER` (default), with an index on `customers(parent_id)`. Adding a level is a
  data change, not a code change.
- **Default deny.** `REVOKE ALL ... FROM PUBLIC` before any grant. Tables intended
  to be globally readable are listed explicitly.
- PostgREST exposes JWT claims as a transaction-scoped setting; policies read
  them with `current_setting('request.jwt.claims', true)::json->>'sub'`.
- The thin Nest app passes identity with `SET LOCAL app.user_id = ...` inside a
  transaction.
- `db-pre-request` is the hook for **revocation** — verified: a revoked token gets
  a clean `401`/`PT401`, no 500 loop. It is **not** a throttle (read-only
  transaction, above). An unreadable revocation table makes revocation **silently
  return `200` with data**, so the table must be `GRANT`ed to the authenticator.
- **No views.** A superuser-created view bypasses every RLS policy on its base
  table, silently. Never create one (ADR-0022).
- **Every policy has a test**: permitted case returns rows, denied case returns
  none, and the denied case is proven for each access path. An LLM writing
  `USING (true)` is otherwise invisible.

### Operation — Postgres grants, not app guards

Object-level security over CRUD belongs to grants, so PostgREST cannot offer an
operation the grants withhold even by accident:

```sql
REVOKE ALL ON projects FROM PUBLIC;                    -- default deny FIRST
GRANT SELECT, INSERT                ON projects TO app_member;  -- no UPDATE/DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_admin;

REVOKE SELECT ON projects FROM app_member;             -- then columns
GRANT  SELECT (id, site_id, name)  TO app_member;       -- `secret` unreadable
```

- Order matters: revoke the table-level grant **before** applying column grants,
  or the column revoke silently does nothing.
- A column-restricted role **cannot use `select=*`**, so requests against that
  table must name columns explicitly.
- Prefer keeping sensitive columns out of the readable set from the outset over
  revoking after the fact.
- **A test asserts `SELECT` is denied** — not merely omitted from a response.

### Feature — thin-app guards

Pages, exports and workflow actions are application logic, so they are guarded in
the thin app, keyed on capability role. This is the **only** axis that reads the
capability role.
- Do not build query-builder proxies, `Proxy` wrappers, or CLS-based scope
  propagation. The previous implementation of this was ~2,400 lines that
  silently enforced nothing.
- Tables intended to be globally readable must be listed explicitly in the
  policy set. Default is deny.
- **Every policy has a test**: permitted case returns rows, denied case returns
  none, and the denied case is proven for each access path. An LLM writing
  `USING (true)` is otherwise invisible.

## B3. API contract — the spec is generated from the live schema

- `openapi.json` is generated by PostgREST from the database and committed, with
  `openapi-mode = "ignore-privileges"` so the served spec does not vary by the
  requesting role.
- The frontend client is generated from it. **Never hand-write a URL, a response
  interface, or an HTTP call.** If the spec doesn't produce it, fix the schema.
- Regenerate after any schema or route change:
  ```bash
  npm run generate:client
  ```
- A change that alters the wire format without regenerating the client is
  incomplete.
- `@ApiProperty()` and explicit DTO classes apply **only** to the thin Nest app's
  own routes. There is no decorator-based contract for the CRUD surface.
- A column rename is a **breaking change**: migration and client regeneration in
  the same change. `verify` rejects the mismatch at compile time.
- Validation on the thin app's routes is global and strict:
  `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Pagination is a shared helper. Never hand-roll `{ items, total, page }`.

## B4. Frontend client generation

- The Angular types are **generated** by `openapi-typescript` from
  `openapi.json`, which PostgREST emits from the live schema. Both are committed.
- **Not Orval.** Its `namingConvention` covers file names and enum keys, not
  schema property keys; converting snake_case properties needs a custom mutator.
  `openapi-typescript` emits the spec verbatim with zero runtime dependencies.
- Never hand-write an API URL, a response interface, or an HTTP call in the
  frontend. If the spec doesn't produce it, fix the schema.
- **No runtime key transform.** Naming is resolved at build time. A runtime
  transform would rewrite keys inside `jsonb` and corrupt passthrough payloads —
  the `angular/` codebase deleted one for exactly this reason.
- Generated types are never hand-edited. `verify` fails if they are.
- Regenerate after any schema or route change:
  ```bash
  npm run generate:client     # openapi.json -> Angular types
  ```
- A change that alters the wire format without regenerating the client is
  incomplete.
- A column rename is a **breaking change**: migration and regeneration in the same
  change. `verify` rejects the mismatch at compile time.

## B5. Authentication

- **PostgREST verifies the JWT** from the shared secret and performs role
  impersonation via the `role` claim. Set `jwt-role-claim-key` explicitly.
- **The thin app registers `JwtAuthGuard` via `APP_GUARD`. Default deny.** Public
  routes opt out with `@Public()`. Per-controller `@UseGuards` is not an
  authorization model — a new controller that forgets the decorator is fully
  public.
- Both runtimes read the **same** secret. If `PGRST_JWT_SECRET` and `JWT_SECRET`
  diverge, fail loudly at boot rather than issuing tokens nothing accepts.
- **The `role` claim selects the database role — and it is an escalation vector.**
  PostgREST issues `SET ROLE` to whatever the token names. Verified: a
  validly-signed token naming a **table-owning** role got `200` with full read,
  and its `DELETE` returned `204` and **removed the row**.
  - **Validating the claim at mint is necessary but nowhere near sufficient.** The
    mitigation must hold even if another code path ever issues a token.
  - **The control is the grant, and nothing else:**
    `GRANT app_anon, app_member, app_admin TO authenticator;` — with that alone a
    token claiming an owner role gets `403` (verified).
  - **`REVOKE SET ON PARAMETER role` is inert on PostgreSQL 15.** Never rely on it.
  - **Never use `REVOKE <owner> FROM <authenticator>` as the boundary.** It is a
    per-role denylist, bypassed by any role not yet revoked.
  - Every serving role is `NOSUPERUSER NOBYPASSRLS NOINHERIT`.
  - **The issuer must always set `exp`** — a token with no `exp` is accepted.
  - A test asserts a token naming each non-granted role is refused, and checks the
    row count afterwards.
- **No default JWT secret.** Assert `JWT_SECRET` is present and sufficiently
  long at bootstrap; throw if not.
- Access tokens short-lived (~15–30 min). Permissions are read from the
  database on each token refresh, **not baked into the token**, so revocation
  takes effect promptly.
- Refresh tokens are persisted in the database, rotated on every use, and
  genuinely revocable. In-memory session state is forbidden — it breaks on
  restart and on more than one instance.
- Password hashing: bcrypt or argon2, cost ≥ 12, configurable.
- Logout must actually invalidate the refresh token.

## B6. Security baseline

Every app forked from this needs these. They must actually work.

- **Rate limiting is registered globally** and tightened per-route on
  `login`, `register`, and `forgot-password`. Use `@Throttle` / the exported
  `ThrottleSkip`, not a hand-rolled metadata key.
- **PostgREST does not rate-limit.** Upstream states you must put a reverse proxy
  in front of it. **`db-pre-request` cannot do it either** — it runs in a
  read-only transaction, so a write there fails `25006` and a working request
  returns `405`. Verified. Use the reverse proxy.
- **Failed logins are recorded before the credential check**, not from a route
  handler that only runs on success. There is no Passport strategy to hook — the
  check lives inside `POST /auth/login` itself.
- **Per-account failure counting** drives progressive delay and a
  risk-scoped challenge. Never a hard lock from unauthenticated traffic —
  that is a denial-of-service on every account.
- **IP reputation is a secondary signal**, not the primary control. Normalize
  IP addresses to a canonical form before keying counters (IPv4-mapped IPv6
  `::ffff:a.b.c.d` and `a.b.c.d` are the same host), and aggregate to a subnet.
- All thresholds come from config, never hardcoded literals.
- **Captcha is validated server-side.** The server issues a challenge, stores
  the answer, and verifies it. Never validate a challenge in the browser, and
  never return the answer in the challenge payload. Provide an accessible
  non-visual alternative.
- **Geo-blocking is off by default** and reads its config from the correct
  namespace. Any `isAllowlisted`-style flag must be consumed by a real
  decision, or the check is deleted.
- Security alerts persist to the database. Notification channels (webhook,
  email) are opt-in via config; remove channel stubs that log "would send".
- Behavioral/risk scoring is **triage**, not prevention. It informs a decision;
  it never silently blocks.

## B7. Modules and structure

- Feature modules are self-contained. A service that is shared by 2+ features
  goes in `common/`; anything else stays local.
- No compatibility re-export files. Import from the owning module.
- One service per concept, registered once. No duplicate DI tokens for the
  same thing.
- Controllers are thin: validate, delegate, return. Logic lives in services.
- Delete dead directories, empty modules, and orphan files as you encounter
  them.

## B8. Testing

- Unit tests for services and pure logic. Integration tests for auth, RLS
  policies, and anything touching the database.
- **Tests must assert.** A test that logs `✅ correct` and always exits 0 is
  not a test and is worse than no test.
- Tests run against a real Postgres instance, not mocks of the database. Mocks
  hide schema and policy bugs — the reason the previous security suite had
  1,700 lines of "tests" that could not fail. Use a dedicated test database or a
  throwaway schema per suite; never point tests at a developer's working data.
- **Every RLS policy has a test**: permitted case returns rows, denied case
  returns none, and the denied case is proven for each access path.
- No test targets a non-existent API. If a spec and an implementation
  disagree, the spec is wrong or the implementation is unfinished — resolve it,
  do not leave a false green.

---

# FRONTEND RULES

Location: `frontend/`. Angular 22, standalone components, zoneless, SSR.

## F1. Components

- **Always `standalone: true`.** Do not create or use NgModules. A component
  flag is redundant on Angular 19+, where standalone is the default — write it
  anyway so the intent is explicit and version-independent.
- Imports are per-component in the `imports` array.
- `templateUrl` for anything over ~15 lines. Inline templates only for trivial
  markup. Never both, never neither.
- One component per file. File name matches the class name.
- No `host:` metadata object — use host directives or `@HostBinding`.

## F2. Change detection

- **OnPush on every component.** It is the Angular 22 default, so you should never
  write the strategy at all. Never write `ChangeDetectionStrategy.Eager` —
  Angular's former `Default`, renamed so its cost is obvious.
- **Zero manual change detection.** No `ChangeDetectorRef.detectChanges()`,
  no `markForCheck()`, no `NgZone` injection. These exist only to compensate for
  mutable state the framework cannot see. If you need one, the state is wrong.
- The application is **zoneless**. `NgZone.onStable` and `NgZone.onMicrotaskEmpty`
  never emit and `NgZone.isStable` is always `true`; anything depending on them
  is broken.
- If a view fails to update, the cause is a mutated object identity or a plain
  field where a signal is required — fix that, don't force a detection pass.

## F3. State

- **`signal()` for local component state**, `computed()` for derived values,
  `input()` / `output()` for component I/O. Not decorators.
- No `BehaviorSubject` as component state. No `new Subject()` for view state.
- `toSignal()` to bridge an observable you must still consume (e.g. an
  `HttpClient` result) into template-readable state.
- One state mechanism for the whole app. Do not introduce a new state library
  for a feature.
- Session state (tokens, current user, permissions) lives in services backed by
  the backend — never duplicated in a second store.

## F4. Data and subscriptions

- **Every subscription has teardown.** `takeUntilDestroyed()` or the `async`
  pipe. Manual `subscribe()` into a field requires `takeUntilDestroyed()`.
- Prefer `| async` in templates over subscribe-into-field. Do not wrap a store
  or service observable in a manual subscription.
- No nested subscriptions. Compose with `switchMap` / `forkJoin` /
  `concatMap`. No subscriptions created inside a `next` callback.
- HTTP calls live in **services only**. A component that injects `HttpClient` is
  an architectural violation.
- One error-handling strategy. Errors surface through a shared interceptor and a
  notification service. Do not hand-roll `catchError` per service, and never
  swallow an error into a success-shaped value.

## F5. Templates

- **New control flow only:** `@if`, `@for`, `@switch`, `@defer`.
  No `*ngIf`, `*ngFor`, `*ngSwitch` in new code.
- **Every `@for` requires `track`.** It is a compile error without it; this is
  not optional.
- Narrow types with `@if (x; as y)` — never `*ngIf` + `$any()`. `$any()` disables
  `strictTemplates` and removes the compiler as a safety net.
- **No method calls in template bindings.** They re-evaluate every change
  detection pass.
  ```html
  {{ getPatternIcon(type) }}     ✗
  {{ iconFor(type) }}            ✓ pure pipe, memoized
  ```
- **Pure transformations are pure pipes**, not component methods and not
  inline expressions. No arithmetic or `.toFixed()` inside `{{ }}`.
- No `ngClass`/`ngStyle`. Use `[class.x]`, `[class]`, `[style.x]`.
- Getters are fine in templates only if trivially cheap; never getters that
  build arrays or call third-party libraries.
- Modals: never nest depth > 2. Extract the inner blocks into child components.
- Extract repeated markup into a component. **Do not copy a block.** If you
  find yourself pasting a 50-line table into a new page, the answer is a child
  component.
- Interactive elements are `<button>`. Never `(click)` on a `div`/`span`.
  Icon-only buttons carry `aria-label` or `matTooltip`.
- Every `<img>` has `alt`. Use `ngSrc` + `NgOptimizedImage` for static images.

## F6. SSR

- **Hydration is enabled** (`provideClientHydration(withEventReplay())`). If a
  guard is needed for a client-only path, the server must render a stable
  equivalent — do not render content that only appears after hydration.
- **No unguarded browser globals.** No `localStorage`, `sessionStorage`,
  `window`, `document`, `navigator`, or `matchMedia` in code paths the server
  executes. Use `isPlatformBrowser(this.platformId)` or inject `DOCUMENT`.
  Include SSR/prerendered routes in this rule — they will throw at build time.
- No `Date.now()`, `Math.random()`, or locale/timezone-dependent rendering in
  templates unless intentionally deterministic.
- `environment.production.ts` must not point at `localhost`. Use a relative path
  (`/api`) with a dev proxy.

## F7. Routing and guards

- **Routes are lazy.** `loadComponent` / `loadChildren` only.
- There is a catch-all `**` route rendering a Not Found page. No silent
  `redirectTo: '/'`.
- Route guards live in `core/guards/`, one concern per file.
- Permission checks in the frontend are **UX affordance only**. The backend is
  authoritative. A hidden button is not access control.

## F8. Structure

```
src/app/
  core/        singletons, interceptors, guards, config    (app-wide, no feature code)
  shared/      presentational components used by 2+ features
  features/    self-contained feature folders
  layouts/     shell components
```

- A service belongs to its feature unless 2+ features need it, in which case it
  moves to `shared/` or `core/`. There is no second `services/` folder.
- No `pages/`, no `modules/` alongside `features/`. Pick one word.
- One type per file. One barrel file per directory, re-exporting everything in
  that directory — partial barrels silently hide symbols.
- Feature-local components stay inside the feature.

## F9. Testing

- Test behaviour, not implementation.
- Every component with logic has a spec; every service has a spec.
- Use `TestBed` with standalone components and explicit `imports`.
- No `any` in specs. No assertion-free tests. A spec that cannot fail is a
  liability.
- Component specs render the template so template errors surface in tests.

---

## 4. Adding a feature — checklist

1. **Backend** — decide which runtime owns it. Pure CRUD over a table → a
   migration and nothing else; PostgREST serves it. Needs an algorithm, a secret,
   a socket, or a schedule → the thin Nest app (service, then thin controller,
   `@ApiProperty` on every DTO field). Either way: migration if the schema
   changes, and an RLS policy if it touches rows.
2. **Regenerate** `openapi.json` and the Angular types. Never hand-write the
   frontend types or URLs.
3. **Frontend**: create the feature folder. Standalone component, `OnPush`,
   signal state, service for HTTP, `| async` or `toSignal` for data.
4. **Tests**: service unit test, plus an integration test if auth or RLS is
   involved.
5. **Run `npm run verify`.** Fix what it reports. Don't silence it.

---

## 5. Before declaring work complete

- [ ] `npm run verify` passes
- [ ] No stub, TODO, or hardcoded mock in reachable code
- [ ] **No mock service, no fake DI registration, no in-memory stand-in for a
      real integration anywhere in the tree** (§2.2)
- [ ] No duplicated controller / component / guard / type
- [ ] `openapi.json` and the Angular types regenerated
- [ ] New conventions have an enforcing ESLint rule
- [ ] No secrets, no committed database files, no `console.log`
- [ ] Nothing added that silently degrades on misconfiguration
