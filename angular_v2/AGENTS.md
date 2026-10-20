# AGENTS.md

Guidelines for agents operating in this repository.

This file is the single source of truth for both humans and automated agents
(Kilo, Cursor, Gemini, Copilot). **`GEMINI.md` imports this file** — do not
duplicate these rules elsewhere; update them here.

---

## 0. What this repository is

An **Angular 22 (SSR) frontend + NestJS 12 (Fastify) backend** template intended to
be forked and built upon. Two consequences drive most rules below:

1. **This repo is never a live app.** No production deployment, no accounts, no
   third-party API keys. Every feature must work with zero external credentials.
2. **Most changes here will be made by AI agents**, so *mechanical enforcement*
   matters more than documentation. An agent pattern-matches the nearest example
   and replicates it. **The code is the instruction.**

---

## 1. Commands

```bash
# Backend — backend/
npm run build && npm run lint && npm test
npm run db:seed              # provision: roles, then migrations, then data
npm run migration:run        # re-migrate a database whose roles already exist

# Frontend — frontend/
npm run lint
npm run test -- --watch=false
npm run build
npm run serve:ssr:frontend   # SSR on :4000 (primary way to run the app)
npm start                    # dev server on :4200 (no SSR)

# Database — a local PostgreSQL instance, connection via .env
psql -h localhost -U postgres -c 'select version();'
```

Postgres is expected to be running locally, from `DB_HOST` / `DB_PORT` / `DB_USER` /
`DB_PASSWORD` / `DB_NAME` in `.env`. **Docker is not used and is not a supported
path.**

### Provisioning order

**`database/seed.ts` never creates the database.** It connects to `DB_NAME`
(`app_dev`) via `psql -d app_dev` and will fail immediately if the database
does not exist (`FATAL: database app_dev does not exist`).

Furthermore, **creating the database as the `postgres` superuser is also
wrong**: every migration will then fail with `permission denied for schema public`.
PostgreSQL 15 and later removed `CREATE` on schema `public` from `PUBLIC`. The
application migration/owner role (`app`, configured as `DB_USER`) only has
`CREATE` on `public` via membership in the predefined role `pg_database_owner` —
that is, **only because it owns the database**.

Once the database exists and is owned by `app`, running `migration:run` before
`db:seed` cannot work on a fresh cluster. `database/seed.ts` provisions the
database contents (roles, then migrations, then seed data) in that order.

`database/seed.ts` runs these steps in exactly this order, and the order is
load-bearing: `database/bootstrap/001_roles.sql` **as a superuser** → the
migrations, as the owner role → the authenticator's `LOGIN` password → the
superuser-only grants that `0001` cannot apply itself → the seed data, connected
as `pgrst_authenticator` and scoped by `SET LOCAL ROLE app_admin`.

Roles come first because `0001_rls_foundation.sql` opens with a preflight that
raises `missing role(s) […] — run database/bootstrap/001_roles.sql as a
superuser first`, and because the seed's `assertUsersTableExists` needs
`public.users`, which only `0002_refresh_tokens.sql` creates. `migration:run` on
a cluster with no roles therefore dies on the preflight before any schema
exists. It went unnoticed because a machine that was provisioned once already
had the roles, so the same command sequence appeared to work on the next clone.

- **New machine, fresh cluster:** `createdb -O app app_dev`, then `npm run db:seed`.
  The database must exist and must be owned by the migration role (`-O app`),
  or subsequent migrations die with `permission denied for schema public`. Then
  `db:seed` bootstraps the roles, applies the migrations, and seeds the data.
- **If you prefer explicit steps:** `createdb -O app app_dev`, then
  `database/bootstrap/001_roles.sql` as a superuser against `app_dev`, then
  `npm run migration:run`, then `npm run db:seed`. The last three are
  idempotent, and it is the seed that adds the permissions, the group tree
  and the admin user.
- **An existing install:** `npm run migration:run` on its own is correct — it
  applies only the files not already recorded in the `migrations` table.

Role creation is deliberately not a migration (§B1), so there is no command that
does step 1 and nothing else. That is a decision, not an oversight.

### The verification gate

**`npm run verify` is the most important command in the repository.** It runs
typecheck, lint, tests, and a smoke check against a live database. A change is not
complete until `verify` passes.

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

**Mocks are the most common way an agent fakes progress**, and creating
`MockAuthService` to unblock a compile, then reporting the task complete, is the
single most frequent failure mode in this codebase's history.

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
- **Never bypass a real integration to "save time."** If Postgres is
  unavailable, the test fails or is skipped explicitly. It is never replaced
  with an in-memory fake.
- **Never declare a task complete while a mock is in the tree.** Report it as
  blocked instead. When reviewing a diff, treat any new mock as a blocking
  finding.

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

### 2.7 Work inside the repository, and do not leave it

**The shell's working directory persists between commands and nothing reports on
it, so it is the one piece of state that goes wrong quietly.** Start every
command from a known directory — `cd "$(git rev-parse --show-toplevel)" && ...`
— and the working directory stops being something you have to think about.

Leaving the repository is allowed when there is a reason (reading a harness's
own state, clearing a package cache, configuring an application outside the
tree); **drifting** — leaving and never coming back — is not. Never `cd ..` out
of the repository as a matter of habit.

Reach other places without moving: `git rev-parse --show-toplevel`,
`git -C <dir>`, `npm --prefix <dir>`. Scratch files go in **`.tmp/` at the
repository root**, which is gitignored — and a file a dispatched agent must read
goes in the project, not in `.tmp/`, because a relative path to a scratch area
resolves to nothing and the agent will do the work from a brief it could not
find. The handoff folder follows the workspace: a project with an equivalent on
the target puts briefs in that project's `.tmp/deleg/`; work belonging to no
project on the target uses the target's general handoff folder, and the agent's
reference to it must still be inside the tree it is working in.

A command that reaches outside the repository will be refused; that refusal is
a report that the working directory has drifted, not an obstacle to route
around. Re-anchor and continue.

**Make the working directory a precondition, not a discovery:** run `pwd` first
on any command that creates artifacts — installs, builds, writes a file, or
dispatches an agent. It is a precondition assertion, and it is what stops a
`node_modules`, a `dist/`, or a build output from landing in the wrong tree.
It is also the catch-all for the commands you did not think to anchor.

**The full rule is [`AGENTS.md` §2.7](../../AGENTS.md) and is stated there once**,
so there is one mechanism for it rather than two that can drift.

### 2.8 Delegating work: decide here, build there

A delegation is a **transfer of execution, not of judgement**. What you decide
stays with you; what you have decided is passed on.

**A brief asserts the DECISIONS and asks about the CODE.** The data model, the
security posture, the chosen behaviour and the boundary that must not move are
asserted — an agent cannot re-derive them and must not re-open them. The code
is described as a question: "find where the disable predicate actually lives",
not "it is in `users.service.ts`". **Every correction an agent has made to a
brief was a fact the brief asserted from memory instead of reading.** State the
scope negatively too — "this is the telemetry unit; the CAPTCHA unit is done and
must not be touched" — because a brief that does not say what it is NOT invites
the agent into the adjacent unit. And never assert the state of a tree you are
not standing in: a remote machine's checkout diverges while a dispatch is in
flight.

**Routing: name the kind of work, then decide the tier — before dispatching.**
Every dispatch is exactly one of three kinds: **Planning pipeline** (the
approach is not decided: plan, then implement, then validate independently),
**Build** (the approach is decided and written down; the deliverable is a
change), or **Investigation** (the question is *why*; the deliverable is a
read-only diagnosis, and the coordinator states the inquiry and the evidence
rather than leaving the agent to diagnose a bare symptom). Decide from the brief
alone, in that order, stopping at the first yes; resolve the model from
`model-catalog.json`; and **record the decision before dispatching, because a
routing decision made after seeing the result is not a routing decision.**

**A dispatch that has to decide is a dispatch with a loose brief** — and a
loose brief is the cause far more often than the model is.

**When a dispatch comes back unsatisfactory, the first move is not a bigger
model:** was the brief ambiguous (tighten it), was the task actually a kind
that should have been recognised as a planning pipeline or an investigation (do
it here), and only then consider a stronger tier.

**The full rule is [`AGENTS.md` §2.8](../../AGENTS.md) and is stated there once**,
so there is one mechanism for it rather than two that can drift.

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
`prefer-composition` and `prefer-takeuntil`, and its teardown rule reads
`context.parserServices`, which ESLint 9 removed while `angular-eslint@22` requires
ESLint ^9||^10 — enabling it aborts the entire lint run.
`@angular-eslint/no-implicit-take-until-destroyed` is the substitute. The plugin
may stay installed, but **no rule is enabled from it.**

Do not add a rule and then leave existing violations in place — fix them or
scope the rule to new code deliberately. `backend/test/unit/eslint-baseline.spec.ts`
asserts every rule in this list is actually active, and fails if one cannot be.

### Scoped structural rules, and why they are not in the list above

The baseline above is **cross-project** — every rule in it must be active in both
`backend/` and `frontend/`, which is exactly what
`test/unit/eslint-baseline.spec.ts` can check by reading two config files. A rule
that only makes sense in one project has no business in that list, and putting it
there would create a claim no test verifies.

Two live in `backend/eslint.config.js` as `no-restricted-syntax` selectors, each
proven able to fail and each a red `npm run lint` on the offending line:

- **`AbortController` is owned by `BreakerGate` and nowhere else.** A controller
  that is constructed and never passed to its consumer is not a timeout, it is a
  comment: it produces the complete appearance of a recoverable abort and none of
  the behaviour, it survives review because the surrounding code is correct, and
  no test stays green against it. A stoppable service takes the `AbortSignal` off
  the dispatch lease the gate hands it, which makes the defect unrepresentable
  rather than merely untested.
- **`Date.now()` is banned in `src/breaker/breaker-state.ts` only — "the clock is
  a value, never a call".** Every entry point into the breaker state machine takes
  `nowMs: number`, which is what lets the suite drive the machine from a fake
  clock and what makes the cold-start assertions deterministic. A `Date.now()`
  default in that file silently reinstates the host clock at exactly the decision
  the cold-start correction is about — whether a dispatch arriving 300 ms after
  boot is admitted. Everywhere else in `src/` calling the clock is correct: the
  meter and the gate take a real reading at the top of a tick, and the sweeper's
  `tick(nowMs = Date.now())` is the boundary that converts a real clock into the
  value the state machine then consumes. **The rule is scoped to the file where
  the invariant lives, because that is the only scope in which it is not noise.**

Two warnings about writing one of these. **A later flat-config object REPLACES
`no-restricted-syntax` for the files it matches**, so a narrower block that lists
only its own selector silently drops every earlier one from those files — the
`breaker-state.ts` block therefore lists both, from one imported constant so there
is a single copy of each rule and each message. And **a scoped rule that has never
fired proves nothing**: before landing one, add the violation, watch the lint go
red, and revert.

### Two conventions that stay structurally enforced, and why a lint rule is the wrong tool for either

Asked whether these should become `no-restricted-syntax` rules, and the answer is
**no for both** — recorded here so "nothing was done" is not mistaken for "nobody
looked".

- **No `set_config('request.jwt.claims', …)` outside the PostgREST boundary.**
  This is the single most important invariant in the schema (§B2 F1) and it is
  enforced by `test/unit/claims-write-surface.spec.ts`, which walks `src/` **and**
  `database/`, strips comments, and reports the offending file by path. A lint rule
  can only match an AST node shape, and the shapes that matter here are *inside
  strings*: `client.query('SELECT set_config($1, $2, true)', ['request.jwt.claims',
  '{}'])`, a `$$`-quoted `EXECUTE` in a migration, and a setting name built by
  concatenation. A `no-restricted-syntax` selector over `CallExpression` catches the
  bare call and misses the three that an attacker would actually write, which makes
  it a **second, narrower mechanism** for the same convention (§2.4) rather than a
  stronger one. The scanner also runs in `npm test` (step 4), inside `verify`.
- **The purge queue is written through `authz`, never a bare `UPDATE`.**
  `test/unit/purge/purge-claim.spec.ts` already asserts it from three directions:
  the four application SQL constants are one statement each and each calls an
  `authz` seam, no constant begins with `UPDATE privacy_purge_queue`, and
  `0016` carries the `REVOKE UPDATE … FROM app_admin` plus the retained write
  policy. The danger is a *string* changing, so the enforcement has to read the
  string; a selector cannot.

The general form: **a lint rule is the right tool when the violation is a node, and
the wrong tool when the violation is a payload.** Both of these are payloads.

---

# BACKEND RULES

Location: `backend/`. NestJS 12, Fastify adapter, PostgREST + `pg` (no ORM).

## B1. Database

- **PostgreSQL 18 or later.** Not SQLite. A locally-installed Postgres server is the
  baseline — it requires no container runtime and no external account. The floor is
  **18**, not a preference: every key defaults to `uuidv7()`, which is core from 18.
- **No ORM.** TypeORM, Sequelize and Prisma are not dependencies. There is no
  `entityManager`, no `createQueryBuilder`, no raw-query escape hatch from
  application code. That absence is load-bearing: the previous implementation
  evaded its own security layer through `entityManager.query()`.
- **PostgREST serves base tables.** It is the API layer. Do not add a Nest
  controller for anything expressible as CRUD over a table.
- **No views.** No `CREATE VIEW` in any migration (ADR-0022). A superuser-created
  view **bypasses all RLS silently**, and writes through views are unreliable (no
  primary key).
- **One naming convention, end to end.** Columns, the wire, and generated types
  are all `snake_case`. No client key transform, ever — it rewrites keys inside
  `jsonb` and breaks passthrough payloads. Never quote a camelCase identifier:
  Postgres folds `userId` to `userid`, and the mismatch only surfaces when
  something else references it.
- Derived field → `GENERATED ALWAYS AS (...) STORED` or a `STABLE` function via
  `/rpc/fn_name`.
- **Migrations are the only schema authority.** Plain SQL, one directory, one
  migrations table name. Never edit columns without a migration. Every migration
  needs a working `down()`.
- **Role creation is not a migration.** `CREATE ROLE` needs `CREATEROLE`, and roles are
  cluster-scoped while migrations are database-scoped, so roles — and the
  escalation-boundary `GRANT`, which needs `ADMIN OPTION` and therefore *cannot* run
  in a migration — live in `database/bootstrap/001_roles.sql`, run once **as a
  superuser**. **The one statement that is the security boundary is necessarily a
  superuser statement.** Do not move it to make a file self-contained.
- Store arrays and objects as `jsonb` (or a real Postgres array type). JSON blobs
  must be queryable.
- Timestamps are `timestamptz`. Booleans are `boolean`. UUIDs are `uuid`.
- **Every key is UUIDv7: `DEFAULT uuidv7()`, never `gen_random_uuid()`.** A v4
  scatters index insertions across the whole btree; a v7 sorts by minting time and
  lands at the right-hand edge. Take the **column default** — do not mint a key in
  the application, in the seed, or in a migration, because a supplied value silently
  bypasses the default and the catalog gate will not see it. Two consequences an
  agent will otherwise get wrong:
  - **One id cannot be left to a default.** The `refresh_tokens.jti` claim lives
    inside the access token, which the refresh row is keyed on, so it must exist
    before the row does. `src/auth/uuidv7.ts` mints it, matching the default's
    layout — a v4 there would make the column half v4.
  - **No backfill.** A v4 and a v7 are both valid UUIDs and nothing reads the
    version nibble, so existing rows are left alone and age out. Rewriting keys
    would mean updating every referencing row and rebuilding `authz.org_closure`, for
    an index-locality gain. `test/rls/uuid-keys.spec.ts` gates this from
    `pg_attrdef`, with no table names hardcoded — a new table with a v4 default fails
    it, which a test listing the old nine would not.
- Index anything you filter or sort on, including `jsonb` paths (GIN).

## B2. Authorization — two axes, two mechanisms, two key materials

**`groups` = scope (RLS). `roles` = capability (OLS). Nothing else.** Both are read
in the database and both resolve from the token's `sub`, but **neither is computed
from the other** and **no table puts them on one row**. ADR-0023; `docs/security.md`.

| Axis | Question | Mechanism | Key material |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | `user_groups` membership ⨝ `org_closure` — **never a claim** |
| **Capability** | Which *objects*? tables, verbs, columns, pages, endpoints | object-level security: `GRANT` + `has_permission()` | `user_roles` → `roles` → `role_permissions` → `permissions` |

**Two namespaces, and collapsing them fails silently.** **DB role** =
`app_anon` / `app_member` / `app_admin` — impersonation and grants, nothing else.
**Role** = a row in `roles`, where capability lives. Never create a DB role named
after a capability, and **never store a PostgreSQL role name in `roles`**: that
leaves the table referenced by nothing, so nothing can answer *"what can this role
do?"*. The `roles` → `role_permissions` foreign key is the fix (ADR-0023).

- **Every user has at least one role and at least one group.** So there is no
  `permission_rules` table, no combiner and no "nobody" case: the axes answer
  different questions and never compete.
- **No per-user grant, no deny, no precedence rules.** No `user_permissions`, no
  `is_granted`. Every member of a role holds identical capabilities.
- **Never split one operation's requirements across two PERMISSIVE policies.** They
  are **OR**-ed, so a scope policy covering `DELETE` admits it alone:

  ```sql
  -- WRONG: OR-ed, so scope_only admits every in-scoped DELETE on its own.
  CREATE POLICY scope_only ON t FOR ALL     USING (<scope>);
  CREATE POLICY cap_delete ON t FOR DELETE USING (<capability>);
  ```

  Measured: a member holding **zero** capabilities ran `DELETE` and `INSERT`, no error
  and no warning. **One policy per table** for scope, **grants, not a competing
  `USING`**, for capability. *(Withdrawn invariant, the escalation, both SQL shapes and
  the `AS RESTRICTIVE` alternative: ADR-0023, top.)*
- **Name tests after the attack:** *"a member with no `user.delete` permission cannot
  delete a row in its own group"* — the case both wrong shapes fail and neither
  per-half test ever ran.

### Scope — Postgres RLS only

**Row-level security is enforced by Postgres policies. Never in application code.**

- **F1 — scope is keyed on a caller-writable setting. Not a bug today, and the
  sharpest edge in the design.** `request.jwt.claims` is a **custom GUC, and any role
  may `SET` it.** Verified: a member set it directly and read another tenant's rows.
  Nothing in the schema stops this.
  - **The mitigation is architectural, not structural.** No grant, policy or
    constraint can restrict a custom GUC; the only control is that **no
    request-reachable SQL path can `SET` it** — an absence, not a defence.
  - **Any `pg` client, RPC, or `db-pre-request` hook that can reach that `SET` is a
    **P0**. The revocation work in `rebase.md` is *precisely* such a path being
    planned. Assert the absence before it lands, and prefer a design the
    authenticator cannot be talked into.
  - **`has_permission(who, …)` is the same class of hazard** — `who` arrives in the
    RPC body **verbatim**, nothing supplies it from the verified token. It is
    advisory for a self-check (CRUD capability is table grants); treat any path that
    makes it authoritative as P0 too. §Capability.
  - **Do not "fix" this by caching scope in another custom GUC** — built and
    **rejected as a vulnerability, not a trade**: a member read 50 rows, called
    `set_config('app.scope', …)` on its own GUC, and read **500**.

- **A table's owner bypasses its RLS policies**, and **nothing errors** when it does.
  - **Two distinct roles, always.** A migration/owner role that never receives
    requests, and a request-serving role that owns nothing.
  - **`ENABLE ROW LEVEL SECURITY` on every table a serving role can reach, and
    `FORCE` on every one of them — except `groups` and `user_groups`.**
    - **`FORCE` does not bind a superuser or `BYPASSRLS` role.** Every role that can
      reach a protected table must be `NOSUPERUSER NOBYPASSRLS`, asserted in a test.
    - **`FORCE` on `groups` is silent total closure loss. Do not add it.** The refresh
      runs `REFRESH MATERIALIZED VIEW` as the **view owner**, and RLS applies to the
      owner under `FORCE`, so it reads the tree through a policy `actor()` cannot
      satisfy and writes an **empty** closure: every tenant's scope becomes zero rows,
      with no error anywhere. Measured **0 rows** — not the half-tree a smaller
      fixture loses. `user_groups` is not FORCEd for the neighbouring reason: the
      owner writes those rows. Both are asserted in the suite. *Trade and
      measurements: ADR-0023 §`FORCE`.*
  - **That includes the migration role for `DML` on the FORCEd tables.** Seed
    **through the boundary**: connect as `pgrst_authenticator`, `SET LOCAL ROLE
    app_admin`, one transaction. **Never disable `row_security` to seed.** Claims
    alone cannot buy write access, because the admin branch discriminates on
    `current_user`.
  - Omitting `WITH CHECK` is safe — Postgres reuses `USING` for inserts, so one
    expression governs both visibility and insertability.
  - A test asserts the policy applies as the migration role, not only the request role.
- Write `CREATE POLICY` in a migration. RLS sits below the application, so no
  forgotten guard, endpoint, or future runtime can bypass it.
- **One policy per table, and it must be `total`** — every `OR` branch is evaluated,
  so a cast in any branch can take the whole query down. Never inline
  `current_setting(…, true)::json->>'sub'` as a bare expression: it **raises** on an
  empty string rather than denying, `OR` does not short-circuit past a raising
  operand, and a malformed value cast to `uuid` takes the query down including the
  admin branch. Read identity with the three-argument, `nullif`-guarded form **in a
  function that catches the cast**. The two-argument form is *not* the safe one: it
  gives `HTTP 500` where the guarded form denies.
- **The policy subquery must be uncorrelated.** That is what buys once-per-statement
  evaluation, and it is why scope is denormalised into the closure view, not walked.

This is the shipped scope shape, abbreviated — the full DDL, every measurement and
the reasoning are in `backend/database/migrations/0001_rls_foundation.sql` and
ADR-0023. **Scope comes from `user_groups`, not from the token: there is no
`site_id` claim.**

```sql
-- Authorization internals live in `authz`, outside `db-schemas = "public"`:
-- `openapi-mode = "ignore-privileges"` advertises every relation in db-schemas
-- regardless of grants, so "restricted" is not a state PostgREST can represent.
CREATE SCHEMA authz;  -- USAGE to app_anon, app_member, app_admin; nothing to PUBLIC

-- The cast applies to the extracted text: parenthesise. `->>'sub'::uuid` casts the
-- LITERAL 'sub' instead, because `::` binds tighter than `->>`. And it is CAUGHT:
-- a malformed `sub` returns NULL (a denial), it does not raise a 500.
CREATE FUNCTION authz.actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE raw text;
BEGIN
  raw := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub');
  IF raw IS NULL OR raw = '' THEN RETURN NULL; END IF;
  RETURN raw::uuid;
EXCEPTION WHEN others THEN RETURN NULL;   -- never raise on caller input
END $$;

-- authz.org_closure: UNION (not UNION ALL), NO accumulator column in the recursive
-- row, and the trailing SELECT -- without it the statement is a syntax error.
-- UNIQUE (ancestor, descendant) is required for REFRESH ... CONCURRENTLY.

CREATE POLICY row_scope ON projects USING (
    current_user = 'app_admin'                    -- never a token field
    OR group_id IN (                             -- UNCORRELATED: this is what buys
        SELECT c.descendant FROM public.user_groups ug   -- loops = 1
        JOIN authz.org_closure c ON c.ancestor = ug.group_id
        WHERE ug.user_id = authz.actor()
    )
);
```

> **SHIPPED — `0001_rls_foundation.sql` implements the shape above and
> `backend/test/rls/rls.spec.ts` proves it with 68 tests, run by `verify`.** The
> superseded `sites` / `site_id`-claim / per-row-walk shape is **gone from the
> tree**; `grep -rnE 'CREATE[[:space:]]+(TEMP(ORARY)?[[:space:]]+)?TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?sites\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+[^[:space:]]*(site_tree_ids|claim_site_id|request_claims)\b|CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?VIEW' backend/database/`
> returns nothing — it asserts on the **executable construct**, not on the bare
> word, because the SUPERSEDED NOTE quotes `sites`, `claim_site_id()` and
> `site_tree_ids()` in order to explain the withdrawal, so a substring gate returns
> lines and reads as a failure. **A green `verify` is therefore evidence for this
> section.** If a claim here contradicts the shipped file, the file wins and the
> claim is a bug in this document. One rule is **deliberately not enforced yet**:
> the **grant-subset trigger** (§Capability).

- **Key the admin branch on `current_user`, never on the `role` claim.**
  `request_claims()->>'role' = 'admin'` is a **dead branch** — the claim is
  caller-supplied, `current_user` is not, and a member forging `"role":"app_admin"`
  into their own validly-signed token gets zero rows. *(In a policy `current_user` is
  right; inside a `SECURITY DEFINER` function it is wrong. See §Capability.)*
- **The scoping subquery is hoisted once per statement — a `hashed SubPlan`, not an
  `InitPlan`.** Measured `loops = 1` at 305 and at 3305 rows; a correlated variant
  gives `loops = 305`. **Uncorrelatedness buys it, not the node name** — `x IN
  (SELECT …)` yields the hashed form, `InitPlan` is for uncorrelated *scalar*
  subqueries, and an `EXISTS`-shaped variant is simplified back into a hashed
  SubPlan. **Assert on `loops`, not on the SQL's apparent shape.** Nor is a `STABLE`
  helper hoisted — `STABLE` means *"same answer within this statement"*, **not**
  *"called once"*; the withdrawn walk ran 400,001 times over 400,000 rows.
  ADR-0023 §The hierarchy.
- **Multiple groups `UNION` — `IN`/`ANY`, never `AND`.** A membership change takes
  effect on the **next request with the same token**. No membership rows, or
  absent/empty/`{}` claims → **zero rows**, no error.
- **`parent_id REFERENCES groups(id)` does not enforce acyclicity** — a
  self-referencing FK admits `A → B → A`.
- **A policy is evaluated for EVERY role that reaches the table, including
  `app_anon`.** Grant `EXECUTE` on the **policy's** helpers to `app_anon` too. A
  policy that *errors* instead of denying is a DoS surface and an oracle. The test
  is "does a policy call it" — not "is it a helper": `has_permission` is granted to
  `app_member`/`app_admin` only, because no policy calls it.
- **`SET LOCAL app.user_id` is not an alternative.** A policy reads the setting it
  names; `app.user_id` is invisible to a policy built on `request.jwt.claims`.
- **`org_closure` is a matview: no RLS, no policy, and it must be kept out of
  `db-schemas` — not granted to nobody.** "Granted to nobody" is **unimplementable**:
  a policy expression's subquery runs with the **querying** role's privileges, so
  without a `SELECT` grant *no scoped read can be evaluated at all* — measured as
  `permission denied for materialized view` on every insert, select and update. The
  shipped answer is the **`authz` schema** — outside `db-schemas`, so PostgREST
  cannot address it and `ignore-privileges` cannot advertise it — **plus**
  `GRANT SELECT … TO app_anon, app_member, app_admin` (`app_anon` included, or an
  unauthenticated read fails with `42501` instead of zero rows). Assert both halves:
  the grant state *and* its absence from the served spec. ADR-0023 §The closure matview.
- **Refresh it with `REFRESH MATERIALIZED VIEW CONCURRENTLY` from a statement-level
  trigger on `groups`.**
  - **`CONCURRENTLY` is chosen for the lock it avoids, not for a measured constant.**
    A plain `REFRESH` holds an **`AccessExclusiveLock`** for the whole rebuild and
    blocks every tenant read behind it. The previously published timing table
    (13.5 / 6.7 / 7,606 ms) **does not reproduce** — on the shipped 12-row closure the
    audit measured plain `REFRESH` at 36.5 ms and `CONCURRENTLY` at 27.5 ms. **Quote
    the lock, not the milliseconds.**
  - **It needs a `UNIQUE` index, and it *can* run inside a transaction block that has
    already written** — verified on 15.19 from a row-level trigger. Only two
    restrictions bite: a read-only transaction, and a missing unique index.
    Statement-level is right because **N group changes cost one rebuild instead of N**
    — not because row-level is illegal.
  - Because the refresh runs *inside* the writing transaction there is **no staleness
    window**. **The blue/green matview swap is withdrawn** — unnecessary *and*
    impossible (`DROP MATERIALIZED VIEW` is rejected because policies depend on it).
- **Cycle safety: the closure query uses `UNION` and carries NO accumulator column.**
  `UNION` terminates on a cycle *only* without one; add `depth` and every pass is a new
  row, so `UNION` degenerates to `UNION ALL`. On an *acyclic* tree the two are
  indistinguishable — invisible until broken. Defence in depth, in order: a write-time
  trigger rejects the cycle; `UNION` bounds it if the trigger is bypassed;
  **`temp_file_limit` must be set on the refreshing session** or a non-terminating
  closure exhausts the filesystem. A tolerated cycle is fail-closed on the query and
  fail-**open** on the data — each member inherits the whole cycle's scope.
  - **M9 — multi-row cycle attempts are refused for a reason nothing documents, and
    it is fragile.** The trigger is `BEFORE … FOR EACH ROW`, and its `SELECT` sees
    rows written earlier in the same command because the **command counter** advances
    between rows. That is the *only* thing stopping a bulk group load from building a
    cyclic closure; change it to `FOR EACH STATEMENT` or a `CONSTRAINT` trigger and
    **one multi-row statement can build a cyclic tree.** Anything that bulk-loads
    `groups` needs a test that loads it in one statement. (A backward chain — parents
    written earlier — is admitted, and correctly so: it is acyclic when each row is
    checked.) ADR-0023 §Cycle safety.
- **Referential-integrity checks bypass RLS and fail OPEN.** FK, unique and primary key
  checks are not policy-governed. A plain FK is an **existence oracle** (`23503` vs
  success reveals any group id, including out-of-scope ones); an FK to an unreadable
  table is a **content oracle**; `UNIQUE` + `ON CONFLICT DO NOTHING` gives the same
  oracle with **no error at all**; and `ON DELETE CASCADE` **crosses RLS**.
  - **The rule — a design constraint, not a mechanical transform:** *A group-scoped
    table may only carry foreign keys that stay within the group-scoped set. Any FK
    leaving that set must terminate at a table members cannot write to.*
  - **Declare every table in one of FOUR categories**, and the primary key follows.
    A table that fits none of them is not an exception — it is a **fifth category
    that has not been named yet**, and naming it is the work:

    | Category | Tables | Primary key | FK discipline |
    |---|---|---|---|
    | **Group-scoped** | `projects`, `customers` | `PRIMARY KEY (group_id, id)` | carries `group_id`, and **every** FK carries `group_id` |
    | **The hierarchy** | `groups` | simple `PRIMARY KEY (id)` | not scoped by `group_id` — it *is* the group; self-FK is admin-only-reachable |
    | **Unscoped** | `users`, `actions`, `permissions`, `roles`, `role_permissions`, `user_roles`, `user_groups`, `refresh_tokens`, `login_attempts` | simple primary keys | global reference data |
    | **DERIVED** | `email_messages` | simple `PRIMARY KEY (id)` | **has no `group_id` at all** — scope is another table's membership, so an FK to the referenced USER is expected and permitted only at a table members cannot write to |
    | **ADDRESSED** | `admin_notifications` | simple `PRIMARY KEY (id)` | **the only FK is `user_id`, naming the READER not the payload**; the source row's own key is held in `source_ref` as `text` with **no FK at all** |

  - **ADDRESSED — the fifth category, and it is `admin_notifications`.** A notification
    is a *rendering* of a row in some other table, so it has no `group_id` (like
    DERIVED) and its scope is not a membership at all but **who it is for**: an
    `audience` of `all` (with `user_id` naming one person, or NULL for a broadcast) or
    `administrators`. The policy is one expression with both branches in it.
    - **Do not add a `group_id` to make it look like the group-scoped tables.** There is
      no group dimension in "is this alert for you", and a group a user belongs to is
      not the same set as the users an administrator may see.
    - **Do not add an FK to the source table.** Referential-integrity checks bypass RLS
      and fail OPEN, so an FK to a source the reader may not see is an existence oracle
      (`23503` against success). `source_ref` is the source's own key held as `text`,
      which also lets a source whose key is not a UUID be materialised with no schema
      change here.
    - **The source's payload goes in `data jsonb`, never as columns.** A generic table
      with an IP-shaped set of columns is one source's table with extra steps.
    - **Its identity is `UNIQUE NULLS NOT DISTINCT (source, source_ref, user_id)`.** A
      default `UNIQUE` treats a NULL `user_id` as distinct from every other NULL, so
      every system-wide notification becomes insertable again on every pass — and the
      `ON CONFLICT DO NOTHING` that stops a dismissal being resurrected silently stops
      matching at all.

  - **DERIVED — what the category means, because it is the one an agent will get
    wrong by pattern-matching the other three.** A derived row's scope is resolved
    through **another table's membership**: `email_messages` has no `group_id`, and
    an actor sees the mail history of exactly those users whose groups they can see.
    - **Do not add a `group_id` to make it look like the other tables.** A single
      `group_id` cannot express the two cases that force the category: a user in
      **several** groups (one column means duplicating the row per group, so "which
      groups is this message in?" becomes ambiguous), and a self-service reset that
      names **no group at all** (inventing one puts the row in a scope nobody chose).
      Both are why it is derived. ADR-0025.
    - **The policy cannot read the membership table directly.** A policy's subquery
      runs with the **querying** role's privileges, and `user_groups` carries its own
      self-scoping policy, so an inline `EXISTS` over it sees only the caller's own
      rows and silently degrades to "the recipient is me". Route it through a
      `SECURITY DEFINER` helper (`authz.visible_user_ids()`) that reads with the
      owner's privileges — the same reason `has_permission()` is `SECURITY DEFINER`.
    - **Both axes go in ONE predicate**, capability AND-ed with scope, never two
      PERMISSIVE policies (they OR). Assert the **function-call count**, not just the
      plan: `loops = 1` for the subplan is necessary and **not sufficient**, because a
      `STABLE` function sitting *beside* the hoisted subquery is still called once per
      candidate row. Measured on this table: `loops = 1` with **1** call inside the
      subquery, against **3,300** calls at 3,300 rows beside it.

- **`groups`'s own policy goes through `authz.visible_group_ids()`, a `SECURITY
  DEFINER` helper — a decision SEPARATE from not FORCEing the table. Do not merge
  them.** `REFRESH … CONCURRENTLY` is refused *"because it is being used by active
  queries in this session"*, and the `groups` policy's own inline join holds an active
  query on the closure for the whole writing statement — inlining it fails the refresh
  on **every** insert, update and delete; whereas not `FORCE`ing is because the
  refresh evaluates the view as the owner. Neither implies the other; assert both halves
  separately, because either alone passes. The helper takes **no argument** and calls
  `actor()` itself — a `who` parameter would let any caller enumerate another user's
  group ids. **This is the weakest link in the pattern:** an owner reads the group tree
  unrestricted, so keep tenant payload out of `groups` and record the trade in a
  comment.
- **The hierarchy walk is self-inclusive.** It anchors on the `root` row itself, so a
  member scoped to a group sees its own row plus its descendants, and a member scoped
  to an unrelated group sees **its own single row and none of the subtree**. Anyone
  documenting "unrelated → 0" is describing a bug.
- **`loops = 1` is necessary and NOT sufficient — a `STABLE` helper placed BESIDE a
  hoisted subquery is still called once per candidate row.** This is the single most
  expensive mistake available in a policy, and it is invisible in the plan's shape: the
  subplan reads as a perfect `hashed SubPlan` with `loops = 1` while the function beside
  it runs per row. `STABLE` means *"the same answer within this statement"*, **not**
  *"called once"*. Put the helper **inside** the uncorrelated subquery and the planner
  hoists it to a `One-Time Filter`; leave it beside the subquery and it is per-row.
  Measured on `email_messages` at 3,300 rows: **1** call inside, **3,300** beside
  (7.6 ms against 1.3 s), against 4.2 s for a correlated variant. **Assert the
  function-call count from `pg_stat_user_functions`, not the plan alone** — and note
  that a function that is never called has **no row** there, so read a missing row as
  zero. ADR-0025.
- **`EXECUTE` is granted to `PUBLIC` on new functions by default.** `REVOKE EXECUTE …
  FROM PUBLIC` on every function, or any `SECURITY DEFINER` helper is anonymously
  reachable. **A revoke is not a policy** — revoking from `PUBLIC` while granting to
  nobody is strictly worse than doing nothing, because it turns every scoped request
  into a `42501`. Revoke and grant, always together.
- **Rejected designs, all built and executed** (ADR-0023 §The hierarchy decision,
  `rebase.md` §6.6.2): **`ltree`**, whose `UNIQUE` on `path` makes re-parenting onto an
  occupied path fail outright; and a closure table with **incremental repair**, whose
  repair silently disagreed with the tree in 5 places and produced one root with the
  *same count* on both sides and different membership. The wholesale refresh is the
  design — the rejection was of repair, not of closure. **What survives:** any
  incremental update of a denormalised scope must be proved to agree with the source,
  and **comparing counts does not prove it — compare membership.**
- **Default deny.** `REVOKE ALL ... FROM PUBLIC` before any grant. Tables intended to be
  globally readable are listed explicitly.
- **The claims setting only reaches the database if PostgREST is configured to produce
  it, and the one setting that decides it will `PANIC` a server rather than fall
  back.** Only the **JSPath** `".role"` works. A policy suite can be perfect and every
  request still fail, because nothing reaches the policy. See B5.
- **A non-uuid or empty `sub` is a clean denial, not a `500`.** `authz.actor()` catches
  the cast and returns `NULL`; the suite asserts both shapes yield zero rows and that a
  garbage `sub` does not break an admin. (It used to yield `HTTP 500` — ADR-0023
  §Corrections to the record.)
- `db-pre-request` is the hook for **revocation**, and is **not** a throttle (see B6).
  An unreadable revocation table makes revocation **silently return `200` with data**,
  so the table must be `GRANT`ed to the authenticator.
- **No views.** A superuser-created view bypasses every RLS policy on its base table,
  silently. Never create one (ADR-0022).

### Operation — Postgres grants, not app guards

Object-level security over CRUD belongs to grants, so PostgREST cannot offer an
operation the grants withhold even by accident:

```sql
REVOKE ALL ON projects FROM PUBLIC;                    -- default deny FIRST
GRANT SELECT, INSERT                ON projects TO app_member;  -- no UPDATE/DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_admin;

REVOKE SELECT ON projects FROM app_member;             -- table level, FIRST
GRANT  SELECT (id, group_id, name) TO app_member;       -- `secret` unreadable
```

- **A column privilege can only narrow a table grant that has already been taken
  away — it cannot subtract from one.** `REVOKE SELECT (col)` on top of a standing
  table-level `SELECT` is accepted, exits 0, and changes nothing. The `REVOKE ALL` →
  verb grants → **table-level** `REVOKE SELECT` → column list order is the one that
  works; assert both orders so they cannot both be "right".
- A column-restricted role **cannot use `select=*`**, so requests against that table
  must name columns explicitly.
- Prefer keeping sensitive columns out of the readable set from the outset.
- **A test asserts `SELECT` is denied** — not merely omitted from a response.
- **Membership (`user_groups`) is readable and self-scoped — a forced trade, so state
  it rather than let the grant read as free.** The scope policy reads `user_groups`
  with the **querying** role's privileges, so *no* serving role can be denied `SELECT`
  on it: with the grant absent, every scoped read fails with `permission denied for
  table user_groups`. The two obvious fixes are both wrong — `app_member` needs a
  `SELECT` grant, and a `SECURITY DEFINER` wrapper turns the hashed `SubPlan`
  (`loops = 1`) back into a per-candidate-row `STABLE` call. So `app_member` reads
  **its own membership rows and nothing else** (the policy says `user_id = actor()`),
  and **`app_admin` reads the complete `user_groups` table** — every user, in every
  group. That is the price of the superset on this one table, and it is accepted
  rather than hidden. Writes: **`app_admin` holds `INSERT`/`DELETE` on `user_groups`**
  — that is the administration of the scope axis, and it is what makes adding and
  removing a member possible at all (`0031_admin_membership_write.sql`). **No other
  serving role holds any write verb on it**, `app_member` included: a member who can
  write their own membership row widens their own scope in one statement, and the
  scope policy honours it because it reads the table the caller just wrote. That
  omission is the control that fails **open** if forgotten, and it is asserted from
  the live catalog in `test/unit/authorization/admin-write-path.spec.ts`.

### Capability — object-level security over a permission table

**Capability is `resource` + `action` over a TABLE, resolved from the caller's role
rows.** It governs *objects* — tables, verbs, columns, pages, endpoints. It is never
keyed on a database role name and never keyed on a group.

```sql
-- actions(name) · permissions(id, resource, action_id) UNIQUE (resource, action_id)
-- roles(id, name, parent_id, is_system_role) · role_permissions(role_id→roles.id FK)
-- user_roles(user_id, role_id)
--
-- The actor is passed IN. Never current_user; never a role name.
CREATE FUNCTION has_permission(who uuid, resource text, action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    JOIN actions a     ON a.name = p.action_id
    WHERE p.resource = $2 AND a.name = $3
      AND rp.role_id IN (                       -- inherits UP the roles
        WITH RECURSIVE up (id) AS (            -- the ancestor set is SEEDED here
          SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = $1
          UNION                                 -- UNION: not UNION ALL
          SELECT r.parent_id FROM roles r JOIN up ON up.id = r.id
          WHERE r.parent_id IS NOT NULL)
        SELECT id FROM up)
  )
$$;
```

- **`$1`/`$2`/`$3`, not the parameter names.** In a SQL function an unqualified name
  that also names a column in scope resolves to the **column**, so the natural
  `p.resource = resource` parses as `p.resource = p.resource` — always true. Measured:
  `project/read` answered true for a member whose role held only `customer/read`.
- **Seed the ancestor set in the CTE. Do NOT join `role_permissions` to the caller's
  own roles and filter.** That caps inheritance at the caller's own roles, because the
  join has already discarded every ancestor's rows — the filter is a no-op and
  resolution is silently **one level deep**. Measured: a manager two levels below a
  role holding `project/read` was denied it.
- **`UNION`, not `UNION ALL`, and no accumulator column** — same reason as the closure:
  on a cyclic role graph the `UNION ALL` form is **non-terminating**. Verified:
  `has_permission` hung. `assert_role_acyclic()` stops one arriving.
- **Precomputing the ancestor set into a second closure view** is the same argument as
  `org_closure` (a `STABLE` function in a qual is once per candidate row — 400,001
  calls over 400,000 rows). **Not done, and not yet justified** at a role count in the
  tens. **Measure before adding it.**
- **Identity inside a `SECURITY DEFINER` function is the actor argument, never
  `current_user`** — which rebinds to the **function owner**. A body reading it
  answers identically for everyone, which **denies everyone** with an ordinary
  zero-row result, so the whole capability axis is absent, silently. Measured on the
  previous resolver: it returned `false` for `app_admin` *while holding* the row.
  **Assert the positive case** — a caller that **holds** a permission **passes**;
  denial tests cannot see this defect, and every one of them passed against it.
  ADR-0023 §Capability.
- **`SECURITY INVOKER` is not the alternative** — it needs `SELECT` on
  `role_permissions` and `permissions` for every serving role, publishing the **entire
  permission matrix**, and it arms the policy-recursion trap on `roles` itself. Keep
  `DEFINER`; fix the identity.
- **`who` arrives in the RPC body verbatim** — see F1 in §Scope. Nothing supplies it
  from the verified token, so this resolver is **advisory for a caller checking
  itself** and must never be made the enforcement point for CRUD, which is table
  grants. That makes it a **disclosure oracle**: a sweep of `(who, resource, action)`
  recovers any user's whole capability set. Measured — **63 unauthenticated probes
  recovered the administrator's complete permission set.** Hence `GRANT EXECUTE … TO
  app_member, app_admin`, **not** `app_anon`, despite the general "`app_anon` needs
  every policy helper" rule above, which does not apply because **no policy calls
  it**. An authenticated member can still read somebody else's capabilities: a
  deliberate trade, since capability is data and a self-only wrapper cannot express
  *"may this user do X"*.
- **`FOR INSERT WITH CHECK` and `FOR DELETE USING` discriminate by operation**, so an
  `INSERT` requirement is not satisfied by the `DELETE` one.
- **A new permission is one inserted row, no migration.** A new *tier* that is not a
  superset is a new database role — a bootstrap change plus an `ADMIN OPTION` grant.
  Say so before designing one.
- **Give a NEW capability its own row — never reuse an existing one.** `email:read` is
  not `user:read` and not `user:create`: a role holding `user:create` must read **zero**
  email rows, asserted inside its own group. Reusing a permission makes the grant
  invisible, because widening it for an unrelated reason silently widens email access
  and nobody reading that diff would know. A dedicated row is its own line in
  `role_permissions`, so revoking it touches nothing else. **A permission row and its
  grants are written by BOTH the migration and `database/seed.ts`**: the migration owns
  the schema, the seed owns the grant (roles are seeded, never migrated — §B1), and
  both must be `ON CONFLICT DO NOTHING` so a fresh provision and a re-migrated one
  agree. Assert both from the live catalog.
- **A credential-bearing payload is suppressed by CODE that THROWS, never by a
  convention and never by silently dropping the value.** `password_reset` and
  `email_verification` bodies carry a bearer token; `contentClassFor` in
  `src/email/email-content-class.ts` refuses one and is called **before** the
  transaction opens, so the refusal costs no round trip and is never partially applied.
  Silently nulling the column leaves the caller believing a body was stored, and the
  failure surfaces as an empty column with nothing to say a body was refused — §2.1.
  **Store no rendered body by default**, and prove the refusal red/green, because a
  suppression rule that cannot fail is not a rule.
- **`app_admin` is a superset, not a bypass:** all **rows** (RLS), all **tables**
  (grants), all **pages** (the resolver), all **endpoints** (the boundary `GRANT`).
  Four mechanisms, four tests. No flag turns enforcement off.
- **The grant-subset rule is NOT met — the invariant is two-sided and only one side
  is enforced.** A `BEFORE INSERT OR UPDATE` trigger on `role_permissions` **and**
  `user_roles` is supposed to verify the actor's effective permission set is a
  **superset** of what is being conferred, raising `42501` otherwise. **Nothing
  implements it**: the migration grants `app_admin` full `INSERT` on both tables and
  records no gap, so today *any* account manager confers *any* capability. Two
  further defects to fix while landing it: the sketch is **vacuous for a caller who
  already holds the permission conferred** (if the grantor holds `roles.admin`, then
  conferring `roles.admin` confers everything the grantor has), so it needs a
  separation-of-duty rule pinned to a non-grantable row; and it reads the grantor
  from the claims GUC, which is **caller-writable** (F1). `rebase.md` **W08b**;
  sketch: ADR-0023 §Least privilege.
- **`is_system_role` / `is_system_group` are the administrative floor, and they are
  ENFORCED** by a `BEFORE` row trigger on both tables: a floor row may not be
  `UPDATE`d or `DELETE`d except from a superuser session, and `INSERT` is uncovered so
  the floor stays creatable.
  - **`SECURITY INVOKER`, and it must stay that way** — the function is a question
    about the caller, so a `DEFINER` body would answer about the **owner** and every
    check would pass, i.e. a floor that never fires. It reads no table.
  - **The superuser path is `current_setting('is_superuser')`, NOT `current_user`**,
    because `is_superuser` derives from `SESSION_USER` and survives `SET ROLE` — which
    is what keeps the provisioning path (`pgrst_authenticator` `SET ROLE app_admin`)
    distinguishable from a request.
  - **A trigger, not a grant**: the floor is **per-ROW** and grants are **per-TABLE**,
    so withholding `DELETE` would strip the capability from every ordinary row to
    protect one, and would break "superset, not a bypass".
  - **`TRUNCATE` does not fire a row trigger.** It is closed by the grants — no serving
    role holds `TRUNCATE` on either table — and that is asserted per role rather than
    left in a comment, because a future table-level `TRUNCATE` grant is the change
    that would reopen this.
- Do not build query-builder proxies, `Proxy` wrappers, or CLS-based scope
  propagation. The previous implementation of this was ~2,400 lines that
  silently enforced nothing.
- **Never cache an authorization answer** — not in a GUC the caller can set, and not
  in a second database. `has_permission()` reads the live rows.
- **Every policy has a test — permitted returns rows, denied returns none, per
  access path — and assertions are on bodies and row counts, never on the status
  code alone.** No grant at all is `401`, not `200 []`; a correct denial, a full
  `USING (true)` leak and a partial leak were **all HTTP 200**, so a status-only
  test passes on a real leak. An LLM writing `USING (true)` is otherwise invisible.
  B8.

## B3. API contract — the spec is generated from the live schema

- `openapi.json` is generated by PostgREST from the database and committed, with
  `openapi-mode = "ignore-privileges"` so the served spec does not vary by role.
- **The committed spec is gated against the live catalog.**
  `backend/test/smoke/openapi-contract.smoke-spec.ts` runs inside `verify` and
  compares the committed file to the tables and columns the `db-schemas` really
  have: a missing table, a missing column, an extra table or an extra column is a
  red run. It was added because a 610-byte placeholder with **no paths** once
  survived thirteen migrations and nothing failed — the frontend's generated types
  were derived from it, so the committed contract was empty while the database was
  fully modelled. It reads `pg_class` (not `information_schema`, which omits
  materialised views) and asserts `authz` stays out of `db-schemas` and out of the
  spec. Column **names and existence** are what it checks; a changed type,
  description, verb or `$ref` is not, and `schema.ts` staleness against
  `openapi.json` is likewise not.
  - **It compares the CATALOG, not the served document, and that is the design.**
    The served document is Swagger 2.0, so a diff against it needs a conversion step
    plus a normaliser for two fields that are not properties of the schema:
    `servers[0].url` (PostgREST derives it from the BOUND `server-host`/`server-port`
    — measured `host: 127.0.0.1:3001`, `schemes: ["http"]`, `basePath: "/"` → the
    converter's `servers: [{"url": "http://127.0.0.1:3001"}]`) and `info.version`
    (the TOOL's version — measured `"16.4"` beside `info.title` `"standard public
    schema"`, both PostgREST defaults, not the project's own values). Comparing the
    catalog instead means **there is no environment-specific field in the comparison
    at all**, so the gate can never need a hand-tuned ignore list to go green — which
    is how a gate gets disabled. It is not weaker: the committed file is
    POST-conversion, so a table or column the conversion dropped fails here too.
    Measured on this tree: the committed file and a live PostgREST 16.4 document agree
    exactly on all 24 paths, 21 schemas and every column, with the 21 `body.<table>`
    Swagger parameters having become `components/requestBodies.<table>` — so the
    conversion is faithful and the gate is green against it.
- The frontend client is generated from it. **Never hand-write a URL, a response
  interface, or an HTTP call.** If the spec doesn't produce it, fix the schema.
- Regenerate after any schema or route change — `npm run generate:client`. A change
  that alters the wire format without regenerating the client is incomplete.
- `@ApiProperty()` and explicit DTO classes apply **only** to the thin Nest app's
  own routes. There is no decorator-based contract for the CRUD surface.
- A column rename is a **breaking change**: migration and client regeneration in the
  same change. `verify` rejects the mismatch at compile time.
- Validation on the thin app's routes is global and strict:
  `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Pagination is a shared helper. Never hand-roll `{ items, total, page }`.

## B4. Frontend client generation

- The Angular types are **generated** by `openapi-typescript` from `openapi.json`,
  which PostgREST emits from the live schema. Both are committed, and generated
  types are never hand-edited — `verify` fails if they are.
- **Not Orval.** Its `namingConvention` covers file names and enum keys, not schema
  property keys; converting snake_case properties needs a custom mutator.
  `openapi-typescript` emits the spec verbatim with zero runtime dependencies.
- Never hand-write an API URL, a response interface, or an HTTP call in the
  frontend. If the spec doesn't produce it, fix the schema.
- **No runtime key transform.** Naming is resolved at build time; a runtime transform
  would rewrite keys inside `jsonb` and corrupt passthrough payloads.
- Regenerate after any schema or route change — `npm run generate:client`. A change
  that alters the wire format without regenerating the client is incomplete.
- A column rename is a **breaking change**: migration and regeneration in the same
  change. `verify` rejects the mismatch at compile time.

## B5. Authentication

- **PostgREST verifies the JWT** from the shared secret and performs role
  impersonation via the `role` claim.
- **`jwt-role-claim-key` must be a JSPath: `.role`, not `role`.** The bare claim name
  makes PostgREST 16.4 **PANIC on boot** rather than fall back. The leading dot is
  the entire fix; `$.role` **also** panics on 16.4 — do not "modernise" the value.
- **PostgREST gives environment variables precedence over its config file.** A
  `PGRST_JWT_SECRET` inherited from `backend/.env` silently overrides
  `postgrest.conf`, and every request then fails `PGRST301 "None of the keys was able
  to decode the JWT"` while the config file looks correct. Strip inherited `PGRST_*`
  keys when spawning PostgREST rather than overriding them: `spawn` stringifies env
  values, so `undefined` arrives as the literal `"undefined"`.
- **The thin app registers `JwtAuthGuard` via `APP_GUARD`. Default deny.** Public
  routes opt out with `@Public()`. Per-controller `@UseGuards` is not an
  authorization model — a new controller that forgets the decorator is fully public.
- Both runtimes read the **same** secret. If `PGRST_JWT_SECRET` and `JWT_SECRET`
  diverge, fail loudly at boot rather than issuing tokens nothing accepts.
- **The `role` claim selects the database role — and it is an escalation vector.**
  PostgREST issues `SET ROLE` to whatever the token names, so a validly-signed token
  naming a **table-owning** role gets full read and a working `DELETE`.
  - **Validating the claim at mint is necessary but nowhere near sufficient.** The
    mitigation must hold even if another code path ever issues a token.
  - **The control is the grant, and nothing else:**
    `GRANT app_anon, app_member, app_admin TO authenticator;` — with that alone a
    token claiming an owner role gets `403`.
  - **The GRANT needs `ADMIN OPTION`, so it cannot run in a migration.** The one
    statement that *is* the security boundary is necessarily a superuser statement,
    and it lives in `database/bootstrap/001_roles.sql`. Assert it there by reading
    `pg_auth_members` and raising — otherwise its absence surfaces far away as an
    unrelated-looking `permission denied to set role` from inside a fixture.
  - **The `role` claim is a DB role name, not a capability.** Tokens carry
    `app_member` / `app_admin`; capability is resolved from `user_roles`, so a
    policy or test keyed on the claim's value produces a branch that can never
    match the caller's permissions.
  - **`REVOKE SET ON PARAMETER role` is inert on PostgreSQL 15.** Never rely on it.
  - **Never use `REVOKE <owner> FROM <authenticator>` as the boundary** — it is a
    per-role denylist, bypassed by any role not yet revoked.
  - Every serving role is `NOSUPERUSER NOBYPASSRLS NOINHERIT`.
  - **The authenticator must be `LOGIN`** — the one role PostgREST connects *as*. The
    other four stay `NOLOGIN`; PostgREST reaches them with `SET ROLE`.
  - **The issuer must always set `exp`** — a token with no `exp` is accepted.
  - A test asserts a token naming each non-granted role is refused, then checks the
    row count.
  - **Assert the row count through an UNFILTERED read.** A filtered count cannot
    distinguish "nothing was deleted" from "I can see nothing", which makes every
    denial assertion vacuous — under `FORCE`, a claimless owner read returns **0 rows**,
    so an owner-connection count helper silently reads zero forever.
- **No default JWT secret.** Assert `JWT_SECRET` is present and sufficiently long at
  bootstrap; throw if not.
- Access tokens short-lived (~15–30 min). Permissions are read from the database on
  each token refresh, **not baked into the token**, so revocation takes effect
  promptly.
- Refresh tokens are persisted in the database, rotated on every use, and genuinely
  revocable. In-memory session state is forbidden — it breaks on restart and on more
  than one instance.
- Password hashing: bcrypt or argon2, cost ≥ 12, configurable.
- Logout must actually invalidate the refresh token.

## B6. Security baseline

Every app forked from this needs these. They must actually work.

- **Rate limiting is registered globally** and tightened per-route on `login`,
  `register`, and `forgot-password`. Use `@Throttle` / the exported `ThrottleSkip`,
  not a hand-rolled metadata key.
- **PostgREST does not rate-limit, and `db-pre-request` cannot either** — it runs in
  a read-only transaction, so a write there fails `25006` and a working request
  returns `405`. Use a reverse proxy.
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
- **Every RLS policy has a test**: permitted case returns rows, denied case returns
  none, and the denied case is proven for each access path.
- **Name a test after the attack it prevents, not after what it calls.** "a
  validly-signed token naming the table-owning role is refused, and the row survives"
  tells a reader in six months which claim is load-bearing; "rls works" tells them
  nothing. `rls.spec.ts` is a fine *filename* — the `it()` titles are what a human
  reads when a step goes red.
- **Assert on bodies and row counts, never on status codes alone.** With a
  table-level `SELECT` grant in place, a column meant to be hidden comes back at
  **HTTP 200 with its value intact**, and a status-only assertion passes on the leak.
- **Prove a security test can fail.** Remove the control and confirm the matching test
  goes red — a suite that passes whether or not the protection exists is the exact
  failure this file exists to prevent. `npm run test:rls` is a **gating step of
  `verify`** (step 7 of 8); the tamper matrix that proved it is `docs/rebase.md`
  §6.6.1, and **it must be re-run whenever a control moves.** Every other step of
  `verify` stays green with all RLS disabled.
  - **A tampered run can leave the cluster worse than it found it.** Role membership
    is cluster-scoped and the bootstrap only ever `GRANT`s, so restoring the SQL file
    does **not** undo a widened boundary `GRANT`. Undo it with
    `REVOKE <role> FROM pgrst_authenticator` as a superuser and re-read
    `pg_auth_members`. Check the cluster, not the diff.
- **Never start a test server on a port something else may already hold.** The
  readiness probe succeeds against the *other* server, and the suite then quietly
  tests a database it did not create. Refuse to start if the port answers, and report
  the conflict. Same reasoning for `DROP DATABASE`: terminate existing backends
  first, or the drop fails naming a connection the operator cannot see.
- No test targets a non-existent API. If a spec and an implementation disagree, the
  spec is wrong or the implementation is unfinished — resolve it, do not leave a
  false green.

---

# FRONTEND RULES

Location: `frontend/`. Angular 22, standalone components, zoneless, SSR.

## F1. Components

- **Always `standalone: true`.** Do not create or use NgModules. The flag is
  redundant on Angular 19+ — write it anyway so the intent is explicit and
  version-independent.
- Imports are per-component in the `imports` array.
- `templateUrl` for anything over ~15 lines. Inline templates only for trivial
  markup. Never both, never neither.
- One component per file. File name matches the class name.
- No `host:` metadata object — use host directives or `@HostBinding`.

## F2. Change detection

- **OnPush on every component.** It is the Angular 22 default, so you should never
  write the strategy at all. Never write `ChangeDetectionStrategy.Eager` —
  Angular's former `Default`, renamed so its cost is obvious.
- **Zero manual change detection.** No `ChangeDetectorRef.detectChanges()`, no
  `markForCheck()`, no `NgZone` injection. They exist only to compensate for mutable
  state the framework cannot see; if you need one, the state is wrong.
- The application is **zoneless**. `NgZone.onStable` and `NgZone.onMicrotaskEmpty`
  never emit and `NgZone.isStable` is always `true`; anything depending on them is
  broken.
- If a view fails to update, the cause is a mutated object identity or a plain field
  where a signal is required — fix that, don't force a detection pass.

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
- **No method calls in template bindings** — they re-evaluate every change detection
  pass. Use a pure, memoized pipe instead:
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
- **Extract repeated markup into a component. Do not copy a block.** If you find
  yourself pasting a 50-line table into a new page, the answer is a child component.
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
