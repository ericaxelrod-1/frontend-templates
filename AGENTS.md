# AGENTS.md

Guidelines for agents operating in this repository.

This file is the single source of truth for both humans and automated agents
(Kilo, Cursor, Gemini, Copilot). **`GEMINI.md` imports this file** — do not
duplicate these rules elsewhere; update them here.

---

## 0. What this repository is

An **Angular 18 (SSR) frontend + NestJS 11 (Fastify) backend** template intended
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
# Backend — angular/backend/
npm run build
npm run lint
npm test
npm run migration:run        # apply migrations
npm run db:seed              # seed roles/permissions/admin user

# Frontend — angular/frontend/
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
- Use the injected logger, never `console.log` (see §6.6).

### 2.6 TypeScript

- `strict: true` is on, including `strictTemplates`. Never use `any`.
  Use `unknown` and narrow it.
- Never use the `!` non-null assertion, `as any`, or `@ts-ignore`.
- No unused `ChangeDetectorRef`/`ElementRef` injections.
- One type per file unless they are trivially coupled value objects.

### 2.7 Work inside the repository, and do not leave it

The shell's working directory **persists between commands**, and it starts at
the repository root. It is the one piece of state nothing reports on, so it is
the one piece of state that goes wrong quietly.

- **Start every command from a known directory.** `cd "$(git rev-parse
  --show-toplevel)" && ...` at the front of a command makes the working
  directory a non-issue, because nothing depends on where the last one left it.
  This is the fix; the rest of this section is how to not need the fix.
- **Leaving the repository is allowed when there is a reason** — reading a
  harness's own state, clearing a package cache, configuring an application
  outside the tree. What is not allowed is **drifting**: a `cd` that leaves the
  directory and is never undone, so the next command lands somewhere you did
  not choose. When you go out, come back and re-anchor.
- **Never `cd ..` out of the repository** as a matter of habit. A relative path
  that walks upwards is the most common way out, because it looks harmless in
  isolation.
- **Reach other directories without moving.** `git rev-parse --show-toplevel`
  finds the root, `git -C <dir>` operates in a subdirectory, `npm --prefix <dir>`
  runs a subproject's scripts. None of them changes the working directory.
- **Scratch files go in `.tmp/` at the repository root**, which is gitignored
  and is the one place scratch belongs. **A file a dispatched agent must read
  goes in the project itself, not in `.tmp/`** — a relative path to a scratch
  area resolves to nothing, the agent cannot find its brief, and it will do the
  work from a brief it wrote itself. That happened here: a unit was dispatched
  with no spec at all because the spec had been written outside the project.
- **A command that reaches outside the repository will be refused.** That
  refusal is a report that the working directory has drifted, not an obstacle to
  route around. Re-anchor and continue; do not work around it.
- **`pwd` is a diagnostic, not a ritual.** Run it when a command did not do
  what you expected, and to confirm where a deliberate excursion ended. It is
  not a prefix for every command — anchoring at the start of a command is what
  makes the question unnecessary.

---

## 3. Enforcement is the point

A rule that only exists in prose does not survive. When you add a convention,
add the ESLint rule that enforces it in the same change.

Required baseline (`.eslintrc.json` / `eslint.config.js` — keep both consistent,
or delete the legacy one):

```
@angular-eslint/prefer-on-push-component-change-detection
@angular-eslint/prefer-standalone
@angular-eslint/template/prefer-control-flow
@angular-eslint/template/conditional-complexity
@angular-eslint/no-empty-lifecycle-method
@typescript-eslint/no-explicit-any
rxjs-angular/prefer-takeuntil-destroyed
```

Do not add a rule and then leave existing violations in place — fix them or
scope the rule to new code deliberately.

---

# BACKEND RULES

Location: `angular/backend/`. NestJS 11, Fastify adapter, TypeORM 0.3.

## B1. Database

- **PostgreSQL.** Not SQLite. A locally-installed Postgres server is the
  baseline — it requires no container runtime and no external account.
- **Migrations are the only schema authority.** Never edit entity columns
  without a migration. Never run `synchronize` against a dev database.
- One migration directory. One migrations table name. Migration class names are
  unique across the tree.
- Every migration needs a working `down()`.
- Store arrays and objects as `jsonb` (or a real Postgres array type), never
  `simple-json` or `simple-array`. JSON blobs must be queryable.
- Timestamps are `timestamptz`. Booleans are `boolean`. UUIDs are `uuid`.
- Index anything you filter or sort on, including `jsonb` paths (GIN).

## B2. Row-level and group scoping — Postgres RLS only

**Row-level security is enforced by Postgres policies. Never in application
code.**

- Write `CREATE POLICY` in a migration. RLS sits below the application, so no
  forgotten decorator, raw query, or new repository can bypass it.
- Pass the request identity to the database with
  `SET LOCAL app.user_id = ...` inside a transaction. Read it in policies with
  `current_setting('app.user_id', true)`.
- Do not build query-builder proxies, `Proxy` wrappers around `EntityManager`,
  or CLS-based scope propagation. The previous implementation of this was
  ~2,400 lines that silently enforced nothing.
- Tables intended to be globally readable must be listed explicitly in the
  policy set. Default is deny.

## B3. API contract — the OpenAPI spec is the contract

- Every response has a **DTO**. Never return a TypeORM entity directly; it
  leaks columns (`password` hashes included) and couples the API to the schema.
- Apply `ClassSerializerInterceptor` globally and use explicit DTO classes.
- Register a global `TransformInterceptor` so every response has the **same
  envelope**. One shape for paginated lists, one for single resources, one for
  errors. Per-controller ad-hoc shapes are forbidden.
- `@ApiProperty()` on **every** DTO field, without exception.
- `@ApiResponse({ ..., type: X })` — always supply `type`. A description-only
  `@ApiResponse` is useless to a generator.
- The CLI plugin must be enabled in `nest-cli.json` so decorators are generated
  from types:
  ```json
  "plugins": [{ "name": "@nestjs/swagger", "options": { "introspectComments": true } }]
  ```
- Validation is global and strict:
  `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Pagination is a shared helper. Never hand-roll `{ items, total, page }` per
  controller.

## B4. Frontend client generation

- The Angular client is **generated** from the backend OpenAPI spec. It is
  committed.
- Never hand-write an API URL, a response interface, or an HTTP call in the
  frontend. If the spec doesn't produce it, fix the spec.
- Regenerate after any DTO or route change:
  ```bash
  npm run generate:client     # backend spec -> frontend client
  ```
- A change that alters the wire format without regenerating the client is
  incomplete.

## B5. Authentication

- **Global `JwtAuthGuard` via `APP_GUARD`. Default deny.** Public routes opt out
  with `@Public()`. Per-controller `@UseGuards` is not an authorization model —
  a new controller that forgets the decorator is fully public.
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
- **Failed logins are recorded from the guard/strategy path**, not from the
  route handler. Guards run before handlers, so a handler never sees a bad
  credential.
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

Location: `angular/frontend/`. Angular 18.2, standalone components, SSR.

## F1. Components

- **Always `standalone: true`.** Do not create or use NgModules. A component
  without the flag is *not* standalone under Angular 18 and will silently
  change behavior on upgrade.
- Imports are per-component in the `imports` array.
- `templateUrl` for anything over ~15 lines. Inline templates only for trivial
  markup. Never both, never neither.
- One component per file. File name matches the class name.
- No `host:` metadata object — use host directives or `@HostBinding`.

## F2. Change detection

- **`changeDetection: ChangeDetectionStrategy.OnPush` on every component.**
- **Zero manual change detection.** No `ChangeDetectorRef.detectChanges()`,
  no `markForCheck()`, no `NgZone` injection. These exist only because the
  component is `Default`. If you need one, the component is wrong.
- If a view fails to update, the cause is missing signals or a mutated object
  identity — fix that, don't force a detection pass.

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

1. **Backend**: DTO first (`@ApiProperty` on every field), then service, then
   thin controller. Migration if schema changes. RLS policy if it touches rows.
2. **Regenerate the OpenAPI spec and the Angular client.** Never hand-write the
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
- [ ] OpenAPI spec regenerated; frontend client regenerated
- [ ] New conventions have an enforcing ESLint rule
- [ ] No secrets, no committed database files, no `console.log`
- [ ] Nothing added that silently degrades on misconfiguration
