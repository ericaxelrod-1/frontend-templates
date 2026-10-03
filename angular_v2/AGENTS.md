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

Postgres is expected to be running locally, from `DB_HOST` / `DB_PORT` / `DB_USER` /
`DB_PASSWORD` / `DB_NAME` in `.env`. **Docker is not used and is not a supported
path.**

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
- Index anything you filter or sort on, including `jsonb` paths (GIN).

## B2. Authorization — three axes, three mechanisms, composing per operation

**Organising frame: `groups = RLS`, `roles = OLS`.** *Groups* decide **rows** (RLS,
below the application); *roles* decide **verbs** and capabilities (grants and
per-operation policies). Both are needed: a role-based check is satisfied by a valid
role no matter which group the caller stands in, so it can never express "your
group's rows."

**The axes are separate inputs, composed in one policy per operation** — separate
*sources of truth*, not separate *expressions*. Evidence: **ADR-0023**,
`docs/security.md` §Scope and capability.

| Axis | Question | Mechanism | Keyed on |
|---|---|---|---|
| **Scope** | Which *rows*? | `CREATE POLICY` (RLS) | `user_groups` **membership table** — never a claim |
| **Operation** | Which *verbs*? | table + column `GRANT` | DB `role` claim |
| **Feature / capability** | Which *features*? | per-operation RLS policies | `role_capability` **table** |

**Two role vocabularies, and collapsing them fails silently.** **DB role** =
`app_anon` / `app_member` / `app_admin` (impersonation, RLS, grants). **Capability** =
`ic` / `site_manager` / `admin` — a *label*, never a DB role, held as a row in
`role_capability`, and also the vocabulary the thin app's guards *speak*.

- **An `ic` and a `site_manager` are the *same* DB role — `app_member`.** Same
  features, same scope policy; capability is their only difference.
- **Never create DB roles named after capabilities.** Capability lives in a **table**.
- **Never both *mechanisms* on one operation.** A table verb belongs to the database;
  application logic to a thin-app guard. Scope and capability compose precisely
  because both are **RLS** — one mechanism.
- **Never split one operation's requirements across two PERMISSIVE policies.** They
  are **OR**-ed, so a scope policy covering `DELETE` admits it alone and a capability
  policy can only widen. Compose them in one policy, or mark the capability policy
  `AS RESTRICTIVE` (which ANDs with the permissive set).

  ```sql
  -- WRONG: OR-ed, so scope_only admits every in-scope DELETE on its own.
  CREATE POLICY scope_only ON t FOR ALL   USING (<scope>);
  CREATE POLICY cap_delete ON t FOR DELETE USING (<capability>);

  -- RIGHT: one composed policy per operation. A FOR ALL policy's USING also
  -- governs WITH CHECK, which is why the WRONG shape fails INSERT identically.
  CREATE POLICY user_delete ON users FOR DELETE USING (
      has_capability('user.delete') AND <scope>
  );

  -- Also right when the scope half is shared by many tables.
  CREATE POLICY cap_delete ON t AS RESTRICTIVE FOR DELETE
      USING (has_capability('user.delete'));
  ```

- **No capability is *derived from* scope or from the DB role** — that is the whole
  of the surviving separation rule. **The claim that the two can never meet in one
  expression is gone**: keeping them apart is what removed the gate. *(Withdrawn
  invariant, measured escalation, both SQL shapes: ADR-0023, top.)*
- **Name tests after the attack:** *"a member with no `user.delete` capability cannot
  delete a row in its own group"* — the case both wrong shapes fail and neither
  per-half test ever ran.

### Scope — Postgres RLS only

**Row-level security is enforced by Postgres policies. Never in application code.**

- **A table's owner bypasses its RLS policies**, and **nothing errors** when it does.
  - **Two distinct roles, always.** A migration/owner role that never receives
    requests, and a request-serving role that owns nothing.
  - **`ALTER TABLE … FORCE ROW LEVEL SECURITY`** on every protected table.
    - **`FORCE` does not bind a superuser or `BYPASSRLS` role.** Every role that can
      reach a protected table must be `NOSUPERUSER NOBYPASSRLS`, asserted in a test.
  - **That includes the migration role for `DML`.** Seed **through the boundary**:
    connect as `pgrst_authenticator`, `SET LOCAL ROLE app_admin`, one transaction.
    **Never disable `row_security` to seed.** Claims alone cannot buy write access,
    because the admin branch discriminates on `current_user`.
  - Omitting `WITH CHECK` is safe — Postgres reuses `USING` for inserts, so one
    expression governs both visibility and insertability.
  - A test asserts the policy applies as the migration role, not only the request role.
- Write `CREATE POLICY` in a migration. RLS sits below the application, so no
  forgotten guard, endpoint, or future runtime can bypass it.
- **One policy per table, and it must be `total`** — every `OR` branch is evaluated,
  so a cast in any branch can take the whole query down.
  - **Never a bare `current_setting(...,true)::json`** — it *raises* on an empty
    string rather than denying, and `OR` does not short-circuit past a raising operand.
  - **Never cast a caller-supplied value to `uuid` inside a policy** — a malformed
    claim raises `invalid input syntax for type uuid` and takes the query down, admin
    branch included.
  - **Read identity with the three-argument, `nullif`-guarded `current_setting`, in a
    function that catches the cast** — never inline as `current_setting(…, true)::json->>'sub'`.
    The two-argument form is *not* the safe one: `HTTP 500` where the guarded form denies.
- **The policy subquery must be uncorrelated.** That is what buys once-per-statement
  evaluation, and it is why scope is denormalised into the closure view, not walked.

This is the scope policy. **Scope comes from `user_groups`, not from the token —
there is no `site_id` claim:**

```sql
-- group hierarchy (admin-writable), membership (NOT member-writable), closure matview
CREATE TABLE groups (id uuid PRIMARY KEY, parent_id uuid REFERENCES groups(id), name text NOT NULL);
CREATE TABLE user_groups (user_id uuid NOT NULL, group_id uuid NOT NULL REFERENCES groups(id),
                          PRIMARY KEY (user_id, group_id));

-- The cast applies to the extracted text: parenthesise. `->>'sub'::uuid` casts the
-- LITERAL 'sub' instead, because `::` binds tighter than `->>`.
CREATE FUNCTION actor() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

-- Closure: UNION (not UNION ALL) and NO accumulator column in the recursive row.
-- The trailing SELECT is required -- without it the statement is a syntax error.
CREATE MATERIALIZED VIEW org_closure AS
WITH RECURSIVE t AS (
    SELECT id AS ancestor, id AS descendant FROM groups
  UNION
    SELECT t.ancestor, g.id FROM t JOIN groups g ON g.parent_id = t.descendant
)
SELECT ancestor, descendant FROM t;

-- UNIQUE index, required for REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX org_closure_uniq ON org_closure (ancestor, descendant);

CREATE POLICY row_scope ON projects USING (
    group_id IN (
        SELECT c.descendant FROM user_groups ug
        JOIN org_closure c ON c.ancestor = ug.group_id
        WHERE ug.user_id = actor()
    )
);

-- An admin branch ORs on current_user, which is set by Postgres from the SET ROLE
-- the escalation boundary already constrained -- never from a token field.
```

> **SUPERSEDED, and it must not be copied: the per-row recursive walk keyed on a
> `site_id` claim.** `0001_rsl_foundation.sql` still ships it. That design is
> **measured wrong** on both halves — a claim cannot express membership that
> changes mid-session, and a walk cannot be hoisted — and the migration rewrite
> must remove it. It is deliberately not reproduced here as an example;
> ADR-0023 §Row scope holds it, labelled, with the measurements that retired it.

- **Key the admin branch on `current_user`, never on the `role` claim.**
  `request_claims()->>'role' = 'admin'` is a **dead branch** that can never match —
  the claim is caller-supplied, `current_user` is not. *(In a policy `current_user`
  is right; inside a `SECURITY DEFINER` function it is wrong. See §Capability.)*
- **The scoping subquery is hoisted once per statement — a `hashed SubPlan`, not an
  `InitPlan`.** Measured `loops = 1` at 305 rows and at 3305 rows; a correlated
  variant gives `loops = 305`. **Uncorrelatedness buys it, not the node name** —
  `x IN (SELECT …)` yields the hashed form, `InitPlan` is for uncorrelated *scalar*
  subqueries, and an `EXISTS`-shaped variant is simplified back to a hashed SubPlan.
  **Assert on `loops`, not on the SQL's apparent shape.**
- **Never repeat the claim that a `STABLE` helper is hoisted into an `InitPlan`.**
  `STABLE` means *"same answer within this statement"*, **not** *"called once"*; the
  withdrawn walk was called 400,001 times over 400,000 rows. (ADR-0023 §The hierarchy.)
- **Multiple groups `UNION` — `IN`/`ANY`, never `AND`.** A membership change takes
  effect on the **next request with the same token**. No membership rows, or
  absent/empty/`{}` claims → **zero rows**, no error.
- **`parent_id REFERENCES groups(id)` does not enforce acyclicity** — a
  self-referencing FK admits `A → B → A`.
- **A policy is evaluated for EVERY role that reaches the table, including
  `app_anon`.** Grant `EXECUTE` on the policy's helpers to `app_anon` too. A policy
  that *errors* instead of denying is a DoS surface and an oracle.
- **`SET LOCAL app.user_id` is not an alternative.** A policy reads the setting it
  names; `app.user_id` is invisible to a policy built on `request.jwt.claims`.
- **Hierarchy functions must return a scalar array, not `SETOF`** — Postgres rejects
  set-returning functions in policy expressions. Use `RETURNS uuid[]` with
  `array_agg`, or read the closure view directly.
- **`org_closure` is a matview, granted to NOBODY.** No RLS, no policy, PostgREST
  **auto-publishes** it, and under `openapi-mode = "ignore-privileges"` it appears in
  the served spec **regardless of grants**. A single `GRANT SELECT` served the whole
  org tree to an anonymous caller. Assert the grant state in a test — the spec will
  not tell you.
- **Refresh it with `REFRESH MATERIALIZED VIEW CONCURRENTLY` from a statement-level
  trigger on `groups`.** `CONCURRENTLY` needs a `UNIQUE` index on the view and cannot
  run in a transaction block that has already written — hence statement-level, not
  row-level. Because the refresh runs *inside* the writing transaction there is **no
  staleness window**. **The blue/green matview swap is withdrawn** — unnecessary (no
  window to close) *and* impossible (`DROP MATERIALIZED VIEW` is rejected because
  seven RLS policies depend on it).
- **Cycle safety: the closure query uses `UNION` and carries NO accumulator column.**
  `UNION` terminates on a cycle *only* without one; add `depth` and every pass is a
  new row, so `UNION` degenerates to `UNION ALL`. On an *acyclic* tree the two are
  indistinguishable — invisible until broken.
  - Defence in depth, in order: a write-time trigger rejects the cycle; `UNION` bounds
    it if the trigger is bypassed; **`temp_file_limit` must be set on the refreshing
    session** or a non-terminating closure exhausts the filesystem.
  - A tolerated cycle is fail-closed on the query and fail-**open** on the data — each
    cycle member inherits the whole cycle's scope.
- **Referential-integrity checks bypass RLS and fail OPEN.** FK, unique and primary key
  checks are not policy-governed — the policy is not evaluated at all. A plain FK is an
  **existence oracle** (`23503` vs success reveals any group id, including out-of-scope
  ones); an FK to an unreadable table is a **content oracle**; `UNIQUE` +
  `ON CONFLICT DO NOTHING` gives the same oracle with **no error at all**; and
  `ON DELETE CASCADE` **crosses RLS**.
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
  `SECURITY DEFINER`, and the tree table must NOT be `FORCE`d — one decision, not
  two.** Under `INVOKER` the walk reads a table whose policy calls the walk and every
  non-superuser request dies with `stack depth limit exceeded`; `FORCE` on that table
  *causes* it. Assert both halves, because either alone passes. `SECURITY DEFINER` is
  safe here **only** because the function reads no caller-supplied table and returns
  no caller-supplied data. **This is the weakest link in the pattern** — an owner can
  read the tree table unrestricted, so keep tenant payload out of it and record the
  trade in a comment.
- **The hierarchy walk is self-inclusive.** It anchors on the `root` row itself, so a
  member scoped to a group sees its own row plus its descendants, and a member scoped
  to an unrelated group sees **its own single row and none of the subtree**. Anyone
  documenting "unrelated → 0" is describing a bug.
- **`EXECUTE` is granted to `PUBLIC` on new functions by default.** `REVOKE EXECUTE …
  FROM PUBLIC` on every function, or any `SECURITY DEFINER` helper is anonymously
  reachable. **A revoke is not a policy** — revoking from `PUBLIC` while granting to
  nobody is strictly worse than doing nothing, because it turns every scoped request
  into a `42501`. Revoke and grant, always together.
- **Never cache authorization scope in a GUC the caller can set.** Custom
  dot-prefixed GUCs have no privilege control and `SET LOCAL` gives no protection,
  because the caller is the one setting it. Rejected as a vulnerability, not a trade.
- **Rejected designs, all built and executed** (ADR-0023 §The hierarchy decision,
  `docs/rebase.md` §6.6.2):
  - **`ltree`** — its `UNIQUE` constraint on `path` makes the obvious repair fail
    outright on re-parenting onto an occupied path.
  - **A closure table with *incremental* repair** — the repair silently disagreed with
    the tree in 5 places with no error, and one root had the *same count* on both sides
    with different membership. The wholesale refresh is the design; the rejection was
    of repair, not of closure.
  - **What survives of that finding:** any incremental update of a denormalised scope
    must be proved to agree with the source, and **comparing counts does not prove it
    — compare membership.**
- **Default deny.** `REVOKE ALL ... FROM PUBLIC` before any grant. Tables intended to be
  globally readable are listed explicitly.
- **The claims setting only reaches the database if PostgREST is configured to produce
  it, and the one setting that decides it will `PANIC` a server rather than fall
  back.** Only the **JSPath** `".role"` works. A policy suite can be perfect and every
  request still fail, because nothing reaches the policy. See B5.
- **One residual, fail-closed but wrong:** a non-uuid or empty `sub` yields **`HTTP
  500`**, not `403`. Catch the cast in `actor()` and return `NULL`.
- The thin Nest app has no SQL path at all (no ORM), so it passes no identity to a
  policy: PostgREST does that from the verified token.
- `db-pre-request` is the hook for **revocation**, and is **not** a throttle (see B6).
  An unreadable revocation table makes revocation **silently return `200` with data**,
  so the table must be `GRANT`ed to the authenticator.
- **No views.** A superuser-created view bypasses every RLS policy on its base table,
  silently. Never create one (ADR-0022).
- **Every policy has a test**: permitted case returns rows, denied case returns none,
  and the denied case is proven for each access path. An LLM writing `USING (true)` is
  otherwise invisible.

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

### Capability — per-operation RLS policies over a capability table

**Capability is enforced in the database, by per-operation RLS policies, with
capability living in a TABLE — not in roles.** The earlier answer ("feature guards in
the thin app", keyed on a capability role) is withdrawn: a guard above the database
cannot be composed with the policy below it. Thin-app guards remain correct for what
RLS cannot express — a workflow action that is not a table verb.

```sql
CREATE TABLE role_capability (
  db_role    text NOT NULL,
  capability text NOT NULL,
  PRIMARY KEY (db_role, capability)
);

-- current_setting('role', true), NEVER current_user -- see the rule below.
CREATE FUNCTION has_capability(cap text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM role_capability rc
                 WHERE rc.db_role = current_setting('role', true)
                   AND rc.capability = cap)
$$;
```

- **Inside a `SECURITY DEFINER` function, identity comes from the `role` GUC, never
  `current_user`** — which rebinds to the **function owner**. A body reading
  `rc.db_role = current_user` returns `false` for everyone, which is the worst
  available shape: it denies **everyone** with an ordinary zero-row result, so the
  whole capability axis is absent, silently. In a *policy* — not inside a function —
  `current_user` is still correct for the admin branch.
- **`SECURITY INVOKER` is not the alternative.** It would need `SELECT` on
  `role_capability` for every serving role, publishing the **entire capability
  matrix**. Keep `DEFINER`; fix the GUC.
- **The test that catches this is the positive one.** Denials already had tests; the
  defect is invisible to them. Assert that a role **holding** a capability
  **passes**.
- **`FOR INSERT WITH CHECK` and `FOR DELETE USING` discriminate by operation**, so
  the `INSERT` capability requirement cannot be satisfied by the `DELETE` one.
- **Grants-as-capability is a dead end.** A capability modelled as a role needs one
  role per distinct capability set: five capabilities means **31 additional database
  roles**, each needing a policy per table plus a cluster-scoped `ADMIN OPTION` grant.
- **Role inheritance cannot help — it only ever adds, never subtracts.** `REVOKE` a
  privilege *from the child* and inheritance puts it straight back. Every serving role
  here is `NOINHERIT`, which makes membership inert anyway.
- **A new capability inside an existing tier is one inserted row, no migration** —
  and the policies name capabilities, so a new name is not a code change either.
- **A new tier that is not a superset of an existing one is a new database role** —
  and therefore a bootstrap change, an `ADMIN OPTION` grant, and a decision about what
  that role may reach. Say so before designing one.
- Do not build query-builder proxies, `Proxy` wrappers, or CLS-based scope
  propagation. The previous implementation of this was ~2,400 lines that
  silently enforced nothing.
- **Every policy has a test**: permitted case returns rows, denied case returns
  none, and the denied case is proven for each access path. An LLM writing
  `USING (true)` is otherwise invisible.
  - **Add the cross-axis test, which is the one that actually catches the bug
    above:** a member with **no** capability must be denied, *in its own scope*.
    Per-half tests pass against both the correct and the broken shape.
  - **Assert on bodies and row counts, never on status codes alone.** No grant at
    all is `401`, not `200 []`; a correct denial, a full `USING (true)` leak and a
    partial leak were **all HTTP 200**. A status-only test passes on a real leak.

## B3. API contract — the spec is generated from the live schema

- `openapi.json` is generated by PostgREST from the database and committed, with
  `openapi-mode = "ignore-privileges"` so the served spec does not vary by role.
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
    `app_member` / `app_admin`, never `ic` / `site_manager` / `admin`; a policy or
    test written against the bare capability name produces a branch that can never match.
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
