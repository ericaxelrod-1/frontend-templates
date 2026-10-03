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
- **Role creation is not a migration.** `CREATE ROLE` needs `CREATEROLE` and roles
  are cluster-scoped while migrations are database-scoped, so roles live in
  `database/bootstrap/001_roles.sql`, run once **as a superuser**. The
  escalation-boundary `GRANT` lives there for the same reason: `GRANT <role> TO
  <role>` needs `ADMIN OPTION`, so it *cannot* run in a migration — verified:
  `must have admin option on role "app_anon"`. **The one statement that is the
  security boundary is necessarily a superuser statement.** Do not move it into a
  migration to make the file self-contained.
- Every migration needs a working `down()`.
- Store arrays and objects as `jsonb` (or a real Postgres array type). JSON blobs
  must be queryable.
- Timestamps are `timestamptz`. Booleans are `boolean`. UUIDs are `uuid`.
- Columns are `snake_case`. Never quote a camelCase identifier: Postgres folds
  `userId` to `userid`, and the mismatch only surfaces when something else
  references it.
- Index anything you filter or sort on, including `jsonb` paths (GIN).

## B2. Authorization — three axes, three mechanisms, composing per operation

**Scope and capability are orthogonal.** A role-based check can be satisfied by a
valid role no matter which group the caller is standing in, so it can never express
"your group's rows." Forcing one mechanism to carry both is why the previous
permissions module could not do row-level security at all (ADR-0023).

**Orthogonal inputs, one composed expression.** The axes are separate *sources of
truth*; they are not separate *expressions*. Every policy that needs both carries
both, in one statement, per operation. Two corrections below, both from executed
testing: the older rule — "never in the same expression" — shipped a privilege
escalation, and the axis table's Scope and Feature cells were both wrong. Full
evidence and measurements in **ADR-0023**.

| Axis | Question | Mechanism | Keyed on |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | a **membership table**, not a claim |
| **Operation** | Which *verbs*? | table + column `GRANT` | DB `role` claim |
| **Feature / capability** | Which *features*? | per-operation RLS policies | `role_capability` table |

> **CORRECTED.** The Scope and Feature rows were both wrong. Scope was documented as
> keyed on a `site_id` **JWT claim**; it is keyed on **membership in a table**, so a
> revoked membership bites on the next request rather than at token expiry. Feature
> was documented as thin-app guards on a capability role; capability is a row in
> `role_capability`, checked in the database. Full evidence in ADR-0023.

**The two role vocabularies are different things.**

| Vocabulary | Values | Used by |
|---|---|---|
| DB role (scope tier) | `app_anon`, `app_member`, `app_admin` | PostgREST impersonation, RLS, grants |
| Capability role (a **label**, not a DB role) | `ic`, `site_manager`, `admin` | thin-app guards, feature checks |

> **CORRECTED.** The second row previously read "Used by: thin-app guards". It now
> also reads them, but capability is **enforced in the database** — a capability is
> a row in `role_capability`, checked by `has_capability()` from a per-operation
> RLS policy composed with the scope policy. `ic` / `site_manager` / `admin` remain
> the vocabulary the thin app's guards *speak*, and remain **not** database
> roles. See §Capability.

- **An `ic` and a `site_manager` are the *same* DB role — `app_member`.** They
  reach the same features and are scoped to their own site by the *identical*
  policy. Their only difference is capability.
- **Never create DB roles named after capabilities** (`ic`, `site_manager`).
  Capability lives in a **table**, not in roles — see §Capability below. Modelling
  a capability as a role is not merely inelegant, it is arithmetically dead: five
  capabilities need **31** additional roles (§Capability).
- **Never both mechanisms on one operation.** If an operation is a table verb,
  the database grants it. If it is application logic, a thin-app guard checks it.
  Applying both means two places to update and two ways to disagree. This is a
  statement about *mechanisms for one operation*, and it is unaffected by the
  correction below — scope and capability compose because both are **RLS**, one
  mechanism.
- **CORRECTED — the separation rule was WRONG and it shipped a security bug.**
  This section used to say, as a greppable invariant: *"you must be unable to
  write one query or guard that filters by site **and** by feature."* **That rule
  caused a silent privilege escalation** and is withdrawn. Enforcement was correct;
  the shape the rule forced was wrong. Full narrative, both SQL shapes and the
  measurement: ADR-0023 §the withdrawal at the top.

  ```sql
  -- WRONG: two PERMISSIVE policies on one operation are OR-ed, so scope_only
  -- admits every in-scope DELETE on its own and cap_delete can only widen.
  CREATE POLICY scope_only ON t FOR ALL          USING (<scope>);
  CREATE POLICY cap_delete ON t FOR DELETE USING (<capability>);

  -- RIGHT: one composed policy per operation.
  CREATE POLICY user_delete ON users FOR DELETE USING (
      has_capability('user.delete') AND unit_id = ANY (unit_tree_ids(claim_unit_id()))
  );

  -- Also right: permissive scope + RESTRICTIVE capability (ANDs with the
  -- permissive set). Use this when the scope half is shared by many tables.
  CREATE POLICY cap_delete ON t AS RESTRICTIVE FOR DELETE
      USING (has_capability('user.delete'));
  ```

  Verified: a member holding **zero** capabilities ran the two-permissive shape and
  `DELETE`d **1 row** and `INSERT`ed **1 row**, **no error and no warning**. The
  gate was not weak — it was absent, and every half passed its own test. A `FOR ALL`
  policy's `USING` also governs `WITH CHECK`, which is why `INSERT` fails the same
  way.

  - **What survives of the old rule, and is still greppable:** no capability is
    *derived from* scope and none from the DB role. `has_capability()` reads the
    `role` GUC and a capability table; `actor()` reads identity from the token.
    Neither is computed from the other, and a policy never infers "you are an IC"
    from "you are scoped to a group".
  - **What is gone:** the claim that the two can never meet in one expression.
    They must meet. Keeping them apart is what removed the gate.
  - Name tests after the attack: *"a member with no `user.delete` capability
    cannot delete a row in its own group"* — the case both wrong shapes fail and
    neither per-half test ever ran.

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
    is `INSERT`, so the owner is rejected by the policy (`new row violates
    row-level security policy` — verified). **Seed through the boundary:** connect
    as `pgrst_authenticator` and `SET LOCAL ROLE app_admin` in one transaction.
    **Never disable `row_security` to seed** — that reopens the bypass.
    - **CORRECTED after the W07 proof.** This used to say "seed from a role that
      sets `request.jwt.claims` to a value the policy admits." **That route stopped
      working** when the admin branch was fixed to key on `current_user` rather
      than on a claim — claims alone can only ever *narrow* scope now. A correction
      to a policy can silently invalidate a procedure documented elsewhere; check
      the policy before trusting any seeding instruction.
  - Omitting `WITH CHECK` is safe: Postgres falls back to the `USING` expression
    for inserts, so one expression governs both visibility and insertability.
  - A test asserts the policy applies when run as the migration role, not only as
    the request role.
- Write `CREATE POLICY` in a migration. RLS sits below the application, so no
  forgotten guard, new endpoint, or future runtime can bypass it.
- One policy per table, and it must be **total** — every `OR` branch is
  evaluated, so a cast in any branch can take the whole query down. Never write
  a bare `current_setting(...,true)::json`; it **raises** on an empty string
  rather than denying. Use a defensive accessor, and **never cast a caller-supplied
  value to `uuid` inside a policy** — a malformed claim raises
  `invalid input syntax for type uuid` and takes the whole query down with it.
  `USING` alone **does** govern `INSERT` when no `WITH CHECK` is written (`polqual`
  is reused) — confirmed by denial, not only by reading `pg_policy`:

```sql
CREATE FUNCTION request_claims() RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- The uuid cast is guarded. A malformed site_id yields NULL, which flows into
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

> **SUPERSEDED — the shape above is what `0001_rls_foundation.sql` still ships, and
> it is not the design.** It keys scope on a `site_id` **token claim** and walks the
> hierarchy **per row**. Both are replaced: scope is read from a **membership
> table** joined to a refreshed **closure matview**, whose subquery is hoisted
> (`loops = 1`). A token claim cannot express membership that changes mid-session.
> Proven design, evidence and the migration-status note: **ADR-0023 §Row scope**.

- **Key the admin branch on `current_user`, never on the `role` claim.** The
  claim is caller-supplied and signed by whoever holds the secret; `current_user`
  is set by Postgres from the `SET ROLE` the escalation boundary already
  constrained. Reading the admin tier out of the token re-opens the very hole
  this policy exists to close. Verified in the shipped policy: a member who forged
  `"role":"admin"` into their own validly-signed token got **zero rows**, because
  no branch reads that field.
  - **In a policy, `current_user` is right. Inside a `SECURITY DEFINER` function it
    is wrong** — it rebinds to the function owner. See §Capability.
- **The DB role vocabulary is `app_anon` / `app_member` / `app_admin`.** A
  capability role (`ic`, `site_manager`, `admin`) is a *different* vocabulary and
  is not a database role. Writing `request_claims()->>'role' = 'admin'` produces
  a **dead branch** that never matches, because no token ever carries the bare
  string `admin`. Verified over HTTP: a valid `app_admin` token got `200 []` and
  saw nothing at all.
- **A malformed `site_id` must not break an admin either.** It is tempting to
  reason that `TRUE OR NULL` is `TRUE` and "the failing cast never completes" —
  that reasoning is **wrong**. `OR` does not short-circuit past an expression
  that raises; both operands are evaluated and the error wins. Verified: an
  admin token with `"site_id":"garbage"` returned
  `invalid input syntax for type uuid`. Only the guarded accessor above makes the
  policy total for every input, admin included.
- Absent, empty, or `{}` claims → both branches false → **zero rows**, no error.
- **A policy is evaluated for EVERY role that reaches the table, including
  `app_anon`.** So `EXECUTE` on the policy's helper functions must be granted to
  `app_anon` too — verified, omitting it made unauthenticated reads fail with
  `permission denied for function site_tree_ids` instead of returning zero rows.
  A policy that errors is a denial-of-service surface and an oracle.
- **`SET LOCAL app.user_id` is not an alternative.** A policy reads the setting it
  names; `app.user_id` is invisible to a policy built on `request.jwt.claims`.
- **Hierarchy functions must return a scalar array, not `SETOF`.** Postgres rejects
  set-returning functions in policy expressions. Use `RETURNS uuid[]` with
  `array_agg`, or read the closure view directly.
- **A `STABLE` function in a policy qual is evaluated once per candidate row.**
  Measured: **400,001 calls over 400,000 rows**. `STABLE` means *"same answer within
  this statement"*, **not** "called once" — so a `STABLE` helper whose argument
  includes a column cannot be hoisted. The two claims that explained it away
  (`VOLATILE` caused it; `PARALLEL SAFE` cost ~170×) are both withdrawn and both
  measured false. **Full record: ADR-0023 §The hierarchy.** Keep this bullet; it is
  the reason the scope was later denormalised into a closure view.
- **Scope is a closure materialized view, refreshed — not a walk.** The scoping
  subquery is uncorrelated, so the planner hoists it: **`loops = 1` at 305 rows and
  at 3305 rows**, where a deliberately correlated variant gives `loops = 305`. It
  appears as a **`hashed SubPlan`** — `x IN (SELECT …)` yields the hashed form;
  `InitPlan` is for uncorrelated *scalar* subqueries. Uncorrelatedness is what buys
  once-per-statement; the node name does not.
  - **Scope comes from a membership table (`user_groups`), not a token claim**, so a
    membership change takes effect on the **next request with the same token**.
    Multiple groups union — `IN`/`ANY`, never `AND`.
- **The closure matview is granted to NOBODY.** A matview has no RLS and no policy,
  PostgREST auto-publishes it as a first-class resource, and under
  `openapi-mode = "ignore-privileges"` it appears in the served spec regardless of
  grants. **A single `GRANT SELECT` served the entire org tree to an anonymous
  caller.** Assert the grant state in a test — the spec will not tell you.
- **Refresh it with `REFRESH MATERIALIZED VIEW CONCURRENTLY` from a statement-level
  trigger on the hierarchy table.** `CONCURRENTLY` needs a `UNIQUE` index on the
  view. Reads continue at **6.7 ms** during a concurrent refresh (13.5 ms
  baseline); a plain refresh blocked tenant reads for **7,606 ms** and a
  trigger-held lock for **8,466 ms**. Because the refresh runs inside the writing
  transaction there is **no staleness window**.
  - **REVERSED: the blue/green matview swap is withdrawn — unnecessary *and*
    impossible.** There is no window to close, and `DROP MATERIALIZED VIEW` on the
    closure is rejected because seven RLS policies depend on it.
- **Cycle safety: the closure query uses `UNION` and carries NO accumulator
  column.** `UNION` terminates on a cycle *only* when the recursive row has no
  accumulator — add a `depth` column and every pass is a new row, so `UNION`
  degrades to `UNION ALL`. Measured on a cyclic graph: `UNION ALL` + `depth` is
  **non-terminating** and exceeds `temp_file_limit` in **91 ms**; `UNION` with no
  accumulator returns **384 rows in 12.7 ms**. On an *acyclic* tree both return
  **361 rows** — the property is invisible until the data is broken.
  - **`parent_id REFERENCES groups(id)` does not enforce acyclicity.**
  - Defence in depth, in order: a write-time trigger rejects the cycle; `UNION`
    bounds it if the trigger is bypassed; **`temp_file_limit` must be set on the
    refreshing session** or a non-terminating closure exhausts the filesystem.
  - A tolerated cycle is fail-closed on the query and fail-**open** on the data:
    each cycle member inherits the whole cycle's scope.
- **Referential-integrity checks bypass RLS and fail OPEN.** FK, unique and primary
  key checks are not policy-governed. Measured: a plain FK is an **existence
  oracle** (success vs `23503` reveals any group id, including out-of-scope ones);
  an FK to an unreadable table is a **content oracle** (a token value in an
  unreadable table was confirmed); `UNIQUE` + `ON CONFLICT DO NOTHING` gives the
  same oracle with **no error at all** — the most dangerous form; and
  `ON DELETE CASCADE` **crosses RLS** (a member deleted a group they held and
  destroyed a row in a group they could never see).
  - **The rule — a design constraint, not a mechanical transform:** *A group-scoped
    table may only carry foreign keys that stay within the group-scoped set. Any FK
    leaving that set must terminate at a table members cannot write to.*
  - **Declare every table in one of three categories**, and the primary key follows:

    | Category | Tables | Primary key | FK discipline |
    |---|---|---|---|
    | **Group-scoped** | `projects`, `customers` | `PRIMARY KEY (group_id, id)` | carries `group_id`, and **every** FK carries `group_id` |
    | **The hierarchy** | `groups` | simple `PRIMARY KEY (id)` | not scoped by `group_id` — it *is* the group; self-FK is admin-only-reachable |
    | **Unscoped** | `users`, `roles`, `role_permissions`, `user_groups` | simple primary keys | global reference data |

- **A hierarchy function that walks the tree its own policy protects must be
  `SECURITY DEFINER`, and the tree table must NOT be `FORCE`d.** These are one
  decision, not two. With `SECURITY INVOKER` the walk reads a table whose policy
  calls the walk, and every request as a non-superuser role dies with
  `stack depth limit exceeded` — verified, after ~100 frames, with no policy error
  and no partial result. `FORCE` on that table does not fix it — it makes it
  worse, because then the owner inside the function is itself subject to the
  policy. Only DEFINER plus leaving that table un-`FORCE`d terminates.
  `SECURITY DEFINER` is safe here **only** because the function reads no
  caller-supplied table and returns no caller-supplied data; it is not a general
  licence to make helpers privileged.
  **This is the weakest link in the pattern:** an owner can read the tree table
  unrestricted. Keep tenant payload out of it, and record the trade in a comment
  where the next maintainer will hit it.
- **The hierarchy walk is self-inclusive.** It anchors on the `root` row itself, so
  a member scoped to a group sees its own row plus its descendants, and a member
  scoped to an unrelated group sees **its own single row and none of the subtree**.
  Verified counts over the five-row proof fixture: root→3, mid→2, unrelated→**1**,
  unknown→0, admin→all 5. Anyone documenting "unrelated→0" is describing a bug.
- **`EXECUTE` is granted to `PUBLIC` on new functions by default.** `REVOKE
  EXECUTE … FROM PUBLIC` on every function, or any `SECURITY DEFINER` helper is
  anonymously reachable. Verified: 7 of 9 test functions had `NULL proacl`.
  **A revoke is not a policy** — revoking from `PUBLIC` while granting to nobody
  is strictly worse than doing nothing, because it turns every scoped request into
  a 42501. Revoke and grant, always together.
- **Hierarchy is a function, not a policy.** Scope derives from position in a tree
  via one recursive helper — `LANGUAGE sql STABLE`. Adding a level is a data
  change, not a code change.
- **Rejected designs, all built and executed.** Full evidence in ADR-0023 and
  `docs/rebase.md` §6.6.2.
  - **REJECTED AS A VULNERABILITY: a per-session scope cache.** A member read 50
    rows, then called `set_config('app.scope', …)` on **its own** custom GUC and
    read **500**. Custom GUCs have no privilege control and `SET LOCAL` gives no
    protection — the caller is the one setting it. **Never cache authorization
    scope in a GUC the caller can set.**
  - **REJECTED: `ltree`.** Its `UNIQUE` constraint on `path` makes the obvious
    repair fail outright — re-parenting onto an occupied path raises
    `duplicate key value violates unique constraint "org_ltree_path_key"`.
    Verified.
  - **CORRECTED: a closure table was rejected here and is now the design.** The
    original rejection was of **incremental repair**, which silently disagreed with
    the tree in 5 places across 9 roots with no error raised — and root 1 had the
    *same count* (241) on both sides with different membership, so count-based
    checks pass. A closure refreshed **wholesale** has no repair step to get
    wrong. **What survives:** any incremental update of a denormalised scope must be
    proved to agree with the source, and comparing *counts* does not prove it —
    compare membership.
- **Default deny.** `REVOKE ALL ... FROM PUBLIC` before any grant. Tables intended
  to be globally readable are listed explicitly.
- **The claims setting only reaches the database if PostgREST is configured to
  produce it, and the one setting that decides it will `PANIC` a server rather
  than fall back.** `jwt-role-claim-key = "role"` (bare) aborts PostgREST 16.4 on
  boot: `failed to parse role-claim-key value (role) … unexpected "r" / expecting
  "."`. Only the **JSPath** `".role"` works; `$.role` panics on 16.4 too. A policy
  suite can be perfect and every request still fails, because nothing reaches the
  policy. See B5 and `docs/development.md` troubleshooting.
- PostgREST exposes JWT claims as a transaction-scoped setting. Read them with the
  **three-argument** `current_setting`, `nullif`-guarded, inside a function that
  catches the cast — never inline as `current_setting(…, true)::json->>'sub'`, which
  raises on `''`. See the guarded accessor above.
  - **CORRECTED — an earlier version of this file said the two-argument
    `current_setting` was the safe form. That is inverted for this case.** Measured:
    two-argument **raises** (`HTTP 500`); three-argument with `nullif` and a guarded
    cast gives a **clean denial**. Keep the three-argument form.
  - **One residual, recorded because it is fail-closed but wrong:** a non-uuid or
    empty `sub` yields **`HTTP 500`**, not `403`. Nothing is disclosed and nothing
    is admitted, but an operator reading logs chases an internal error instead of an
    authorization decision. Catch the cast in the accessor and return `NULL`.
- The thin Nest app has no SQL path at all (no ORM), so it passes no identity to
  a policy: PostgREST does that from the verified token. `SET LOCAL app.user_id`
  appears nowhere and would be ignored if it did.
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

### Capability — per-operation RLS policies over a capability table

**Decided: capability is enforced in the database, by per-operation RLS policies,
with capability living in a TABLE — not in roles.** This replaced the previous
answer in this section ("feature guards in the thin app", keyed on a capability
role), because the thin-app answer could not be composed with scope, and composing
them is mandatory (§Scope).

> **CORRECTED after execution.** The shape below is right and the function body was
> **dead**. `has_capability()` read `current_user` inside a `SECURITY DEFINER`
> function, so it compared the capability table against the *owner's* role and
> returned `false` for everyone — including `app_admin` **while holding the
> capability row**. The capability axis was silently absent, and it was absent in
> the shape that *denies*, which is why nothing looked wrong. Full evidence:
> ADR-0023 §Capability.

```sql
CREATE TABLE role_capability (
  db_role    text NOT NULL,
  capability text NOT NULL,
  PRIMARY KEY (db_role, capability)
);

-- current_setting('role', true), NEVER current_user -- see the correction below.
CREATE FUNCTION has_capability(cap text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM role_capability rc
                 WHERE rc.db_role = current_setting('role', true)
                   AND rc.capability = cap)
$$;
```

- **CORRECTED — the documented body was dead, and it took the whole capability axis
  with it.** It read `WHERE rc.db_role = current_user` inside a **`SECURITY
  DEFINER`** function. `SECURITY DEFINER` rebinds `current_user` to the **function
  owner**, so the predicate compared the capability table against the owner's role
  name and never against the serving role. **Measured: `has_capability()` returned
  `false` for `app_admin` *while holding* the capability row.** Every component was
  individually correct and the capability axis was silently absent.
  - **Why that shape is the worst one available:** it denies **everyone**, including
    the roles that should have it, and it denies them with an ordinary zero-row
    result. No error, no warning — a capability system that refuses every caller
    looks exactly like a capability system that works.
  - **The correct source is `current_setting('role', true)`**, the GUC Postgres
    tracks for the `SET ROLE` that PostgREST's impersonation performs.
  - Measured inside a `SECURITY DEFINER` function: `current_user` = `app`,
    `current_role` = `app`, `session_user` = `pgrst_authenticator`,
    `role` = `app_admin`. Three of the four look plausible; only one is right.
  - **Inside a `SECURITY DEFINER` function, identity comes from the `role` GUC,
    never `current_user`.** In a *policy* — which is not inside a function —
    `current_user` is still correct for the admin branch.
  - **`SECURITY INVOKER` is not the alternative.** Under `INVOKER` every serving role
    needs `SELECT` on `role_capability`, which publishes the **entire capability
    matrix** — exactly what capability exists to keep private. Keep `DEFINER`; fix
    the GUC.
  - **The test that would have caught it is the positive one.** Denials already had
    tests; the defect is invisible to them. Assert that a role **holding** a
    capability **passes**.

- **Confirmed expressible: `FOR INSERT WITH CHECK` and `FOR DELETE USING`
  discriminate by operation.** Postgres evaluates a different policy per verb,
  so the capability requirement for `INSERT` cannot be satisfied by the one for
  `DELETE`. Verified against the four policies on the `users` fixture: `SELECT`,
  `UPDATE` (with `USING` *and* `WITH CHECK`), `INSERT` (`WITH CHECK` only) and
  `DELETE` (`USING` only) each carried their own scope expression, and
  `INSERT`/`DELETE` carried the capability term as well.
- **Grants-as-capability is a dead end — enumerated, not asserted.** A policy can
  only test `current_user`, so a capability modelled as a role needs one role per
  distinct capability set. With the **five** capabilities in the executed fixture
  (`financial.read`, `user.create`, `user.deactivate`, `user.delete`,
  `user.read`) that is 2⁵ = **32** distinct sets; the empty set is already served
  by the base role, so **31 additional database roles**, each needing a policy per
  table, plus `GRANT role TO authenticator` entries that are cluster-scoped and
  need `ADMIN OPTION` — a superuser statement per role.
- **Role inheritance cannot help. It only ever adds, never subtracts.** Verified:
  grant a privilege to the parent role and the child inherits it; then
  `REVOKE` that privilege **from the child** and it is still `t` — inheritance
  puts it straight back. There is no way to express "this role has that
  capability *except* this one". And every serving role here is `NOINHERIT`
  (verified: `app_anon`, `app_member`, `app_admin`, `app_auditor`, `cap_auth`,
  `cap_owner` all `rolinherit = f`), which makes membership **inert** for
  privilege resolution in the first place.
- **A new capability inside an existing tier is one inserted row, no migration.**
  Verified: `INSERT INTO role_capability VALUES ('app_auditor',
  'financial.export')` and the tier has it, with no DDL and no policy change. The
  operation policies reference capabilities **by name**, so a new name is not a
  code change either.
- **A new tier that is not a superset of an existing one is a new database role** —
  and therefore a bootstrap change, an `ADMIN OPTION` grant, and a decision about
  what that role may reach. Say so before designing one.
- Do not build query-builder proxies, `Proxy` wrappers, or CLS-based scope
  propagation. The previous implementation of this was ~2,400 lines that
  silently enforced nothing.
- **Every policy has a test**: permitted case returns rows, denied case returns
  none, and the denied case is proven for each access path. An LLM writing
  `USING (true)` is otherwise invisible.
  - **Add the cross-axis test, which is the one that actually catches the bug
    above:** a member with **no** capability must be denied, *in its own scope*.
    Per-half tests pass against both the correct and the broken shape.

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
- **`jwt-role-claim-key` must be a JSPath: `.role`, not `role`.** The bare claim
  name makes PostgREST 16.4 **PANIC on boot** rather than fall back — verified,
  `failed to parse role-claim-key value (role) ... unexpected "r" / expecting "."`.
  The leading dot is the entire fix. `$.role` is a later JSONPath spelling and
  **also** panics on 16.4 — do not "modernise" the value.
- **PostgREST gives environment variables precedence over its config file.** A
  `PGRST_JWT_SECRET` inherited from `backend/.env` silently overrides the value
  in `postgrest.conf`, and a server started that way verifies tokens with the
  wrong secret. Every request then fails `PGRST301 "None of the keys was able to
  decode the JWT"` while the config file looks correct. Verified — and it cost
  more time to find than any SQL bug here, because nothing in the file is wrong.
  When spawning PostgREST, strip inherited `PGRST_*` keys rather than overriding
  them: `spawn` stringifies env values, so `undefined` reaches PostgREST as the
  literal text `"undefined"`.
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
    token claiming an owner role gets `403` with
    `permission denied to set role "app"` (verified).
  - **The GRANT needs `ADMIN OPTION`, so it cannot be run by a migration role.**
    Verified: applying it as the owner fails with
    `must have admin option on role "app_anon"`. The one statement that *is* the
    boundary is therefore a superuser statement, and it belongs in the role
    bootstrap rather than the migration. Assert it there by reading
    `pg_auth_members` and raising — otherwise its absence surfaces far away as an
    unrelated-looking `permission denied to set role` from deep inside a fixture.
  - **The `role` claim is a DB role name, not a capability.** Tokens carry
    `app_member` / `app_admin`, never `ic` / `site_manager` / `admin`. Writing a
    policy or a test against the bare capability name produces a branch that can
    never match.
  - **`REVOKE SET ON PARAMETER role` is inert on PostgreSQL 15.** Never rely on it.
  - **Never use `REVOKE <owner> FROM <authenticator>` as the boundary.** It is a
    per-role denylist, bypassed by any role not yet revoked.
  - Every serving role is `NOSUPERUSER NOBYPASSRLS NOINHERIT`.
  - **The authenticator must be `LOGIN`.** It is the one role PostgREST
    connects *as*, and a `NOLOGIN` role cannot be connected to — verified, and
    the failure is "the server cannot serve at all", not a subtle one. The other
    four stay `NOLOGIN`, because nothing ever connects as them; PostgREST reaches
    them with `SET ROLE`.
  - **The issuer must always set `exp`** — a token with no `exp` is accepted.
  - A test asserts a token naming each non-granted role is refused, and checks the
    row count afterwards.
  - **Assert the row count through an UNFILTERED read.** A count taken through a
    filtered path cannot distinguish "nothing was deleted" from "I can see
    nothing", which makes every denial assertion in the suite vacuous. Concretely:
    under `FORCE`, a claimless owner read returns **0 rows**, not the true count —
    verified — so an owner-connection count helper silently reads zero forever.
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
- **Every RLS policy has a test**: permitted case returns rows, denied case returns
  none, and the denied case is proven for each access path.
- **Name a test after the attack it prevents, not after what it calls.**
  "a validly-signed token naming the table-owning role is refused, and the row
  survives" tells a reader in six months which claim is load-bearing; "rls works"
  tells them nothing. `rls.spec.ts` is a fine *filename* — the `it()` titles are
  what a human reads when a step goes red.
- **Assert on bodies and row counts, never on status codes alone.** The specific
  way this bites: with a table-level `SELECT` grant in place, a column that was
  meant to be hidden comes back at **HTTP 200 with its value intact**, and a
  status-only assertion passes on the leak. Verified.
- **Prove a security test can fail.** Remove the control and confirm the matching
  test goes red — a suite whose tests all pass whether or not the protection
  exists is the exact failure this file exists to prevent. `npm run test:rls` is a
  **gating step of `verify`** (step 7 of 8), and the claim is verified rather than
  asserted: each of these was executed by removing one control from the shipped
  SQL, running the whole gate, and restoring the file —

  | Control removed | Result |
  |---|---|
  | *(nothing — baseline)* | `verify passed`, 33 RLS tests green |
  | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` → `DISABLE` | red at step 7/8, **12 of 33** |
  | the `REVOKE SELECT ON … FROM app_member/app_admin` lines | red at step 7/8, **2 of 33** |
  | the boundary `GRANT` widened to reach the table-owning role | red at step 7/8, **3 of 33** |

  The other steps cannot see any of it: typecheck, lint and both unit suites stay
  green with every policy in the database disabled. `verify` stops at the first
  failing step, so a tampered run ends at 7 and never reaches 8. Re-run this
  table whenever a control moves — a gate whose load-bearing status was proved
  once, three defects ago, is a claim again (`rebase.md` §6.6.1).
  - **A tampered run can leave the cluster worse than it found it.** Role
    membership is cluster-scoped and the bootstrap only ever `GRANT`s, so
    restoring the SQL file does **not** undo a widened boundary `GRANT` — the next
    run is red with a clean tree, and the live escalation is back. Undo it with
    `REVOKE <role> FROM pgrst_authenticator` as a superuser and re-read
    `pg_auth_members`. Check the cluster, not the diff.
- **Never start a test server on a port something else may already hold.** The
  readiness probe succeeds against the *other* server, and the suite then quietly
  tests a database it did not create. Refuse to start if the port answers, and
  report the conflict. Same reasoning for `DROP DATABASE`: terminate existing
  backends first, or the drop fails naming a connection the operator cannot see.
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
