# angular_v2

**Angular 22 + PostgREST + PostgreSQL** — a boilerplate template meant to be
forked and built upon.

PostgREST is the API layer, sitting on PostgreSQL. A thin NestJS app beside it
handles what PostgREST cannot: JWT issuance, login, email, CAPTCHA, rate limiting
and scheduled jobs.

This is the rebuild of `../angular`. The old tree is left untouched as a reference
and rollback point. What changed and why is in
[`docs/rebase.md`](docs/rebase.md); the decisions are in
[`docs/adr.md`](docs/adr.md).

---

## What this is

A starting point for a web application: authentication, roles and permissions,
group membership, data scoping, email, and an Angular SSR frontend — with **zero
third-party accounts or API keys**. Every feature works on a fresh clone.

## What makes it different

| | |
|---|---|
| **No accounts to create** | Self-hosted everything. CAPTCHA, email and geo-IP are all local-first. |
| **Enforced, not documented** | Every convention in `AGENTS.md` has an ESLint rule. Rules before refactors. |
| **Generated contract** | DTOs → OpenAPI → typed Angular client. Drift is a compile error. |
| **Enforcement in the database** | Row-level security via `CREATE POLICY`, keyed on group membership. A forgotten decorator cannot bypass it. |
| **A real gate** | `npm run verify` — typecheck, lint, test, smoke. It fails loudly. |
| **No mocks, no stubs** | A function is fully implemented or it does not exist. |

---

## Row scoping and roles

**Groups determine which rows you can see. Roles determine which objects you can
reach.** The two axes are separate inputs, resolved separately, and never compete.
Both are enforced in the database — `CREATE POLICY` and `GRANT`, plus a permission
table — not by guards in application code. A new endpoint, a forgotten decorator,
or a second runtime cannot bypass any of it, because none of it lives in the
application.

```
groups ──► user_groups ──► org_closure ──► which group_ids the policy admits
roles  ──► role_permissions ──► permissions ──► which resource:action a role holds
                ▲
             user_roles
```

Scope is read from a **membership table**, not from a claim inside the token, so
a membership change takes effect on the **next request with the same token**
rather than at token expiry. The policy's subquery is **uncorrelated**, so it is
evaluated **once per statement, not once per candidate row** — measured `loops =
1` at 305 rows and at 3305 rows.

Capability is `resource` + `action` over a table, and `role_permissions.role_id`
is a real foreign key to `roles.id` — so *"what can this role do?"* is a query,
not an application-code convention. There are no per-user grants and no denies:
**every member of a role holds identical capabilities.** `app_admin` is a
**superset, not a bypass** — all rows, all tables, all pages, all endpoints, by
four mechanisms with four tests.

Full design and evidence: [`docs/adr.md`](docs/adr.md) ADR-0023, and
[`docs/architecture.md`](docs/architecture.md) §The data model.

### What is and is not built

**The scope axis and the capability axis above are implemented.**
`backend/database/migrations/0001_rls_foundation.sql` creates `groups`,
`user_groups`, `org_closure`, `actions`, `permissions`, `roles`, `role_permissions`
and `user_roles`, plus `actor()` and `has_permission()`. The superseded `sites` /
`site_id`-claim design is **gone** from the tree.
`npm run verify` gates on `backend/test/rls/rls.spec.ts`, whose **68 tests pass
against this design**, so here a green `verify` *is* evidence for the shape above —
unlike the previous state of this file.

**Two things in that design are declared but not enforced.** Read them before
relying on them:

- **The identity source is a caller-writable setting.** `request.jwt.claims` is a
  custom GUC and **any role may `SET` it** — verified: a member set it directly and
  read another tenant's rows. Nothing in the schema prevents this. The only control
  is that **no request-reachable SQL path can reach the `SET`**, and that is an
  absence rather than a defence. **Any `pg` client, RPC or `db-pre-request` hook
  that can set it is a P0** — and revocation via `db-pre-request` is planned work.
- **The grant-subset rule is not implemented.** *A caller cannot grant a capability
  it does not hold* is half-enforced: the scope half is free via `WITH CHECK`, the
  capability half has no trigger and no policy to fall back on. `app_admin` holds
  full `INSERT` on `role_permissions` and `user_roles` today. (`rebase.md` W08b.)

Three more trade-offs that are deliberate, not defects: `org_closure` lives in an
`authz` schema **outside** `db-schemas` and is **granted** to the serving roles
(it cannot be granted to nobody — a policy's subquery runs with the querying role's
privileges); **`app_admin` reads the complete `user_groups` table**; and
`has_permission` is executable by `app_member`/`app_admin` but **not** `app_anon`,
because its `who` argument makes it a disclosure oracle — measured, 63 unauthenticated
probes recovered an administrator's whole permission set.

Full record, with the measurements behind each of these: [`docs/adr.md`](docs/adr.md)
ADR-0023 §F1, §Least privilege, §The closure matview.

---

## Requirements

| | Version |
|---|---|
| Node.js | `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0` — the Angular 22 CLI refuses to start on anything older. `frontend/.npmrc` sets `engine-strict=true`, so `npm install` fails with that message rather than failing later |
| TypeScript | 6.0.x — pinned by both projects |
| PostgreSQL | **15 or later** — verified on 15.19; 16/17 also fine. Local instance, **no Docker** |

---

## Setup

```bash
# 1. install
cd backend && npm install
cd ../frontend && npm install

# 2. configure
cd ../backend && cp .env.example .env     # set JWT_SECRET — the app refuses to boot without it

# 3. client — regenerates the Angular types from the committed openapi.json
cd ../frontend && npm run generate:client
```

**Not available yet.** `npm run migration:run`, `npm run migration:revert`,
`npm run db:seed` and `npm run dev` are documented in
[`docs/development.md`](docs/development.md) and land in phase P1-N2, with the
migration runner, the seed and the four database roles. They are recorded as
outstanding in `backend/test/unit/docs/doc-claims.spec.ts`, so `verify` reports
them on every run rather than pretending they exist.

Full detail: [`docs/development.md`](docs/development.md).

---

## The contract

`openapi.json` at the root is the committed contract, and it is **generated from
the live database** — it cannot drift from the schema. The chain is:

```
tables ──▶ PostgREST ──▶ Swagger 2.0 ──▶ swagger2openapi ──▶ openapi.json ──▶ openapi-typescript ──▶ src/app/api/schema.ts
(PostgreSQL)              (live)          (GET /)           (committed)          (committed)
```

PostgREST 16 serves **Swagger 2.0**, not OpenAPI 3, so `swagger2openapi` is a
required step: `openapi-typescript` targets 3.x. The converted spec is
committed, so only the regenerator needs the tool.

The file committed today is a **placeholder with no paths** — the template has no
tables yet. It is replaced by the output of that chain once the baseline
migration lands. The frontend types are generated from whatever is committed:
`cd frontend && npm run generate:client`.

---

## Verify

```bash
cd backend && npm run verify
```

Typecheck → lint → unit tests → integration tests → smoke against a live
database. **A change is not complete until this passes.** It lints and
type-checks both projects, so `frontend/node_modules` must exist.

Never weaken a lint rule or delete a test to make it green. Fix the code.

---

## Layout

```
angular_v2/
├── AGENTS.md            rules — single source of truth for every agent
├── GEMINI.md            imports AGENTS.md
├── openapi.json         generated contract, committed
├── postgrest.conf       PostgREST configuration, committed, secret-free
├── backend/             thin NestJS app — JWT issuance and workflows
│   ├── src/             main.ts · app.module.ts · config/
│   ├── test/            unit · e2e · smoke
│   └── .env.example
├── frontend/            Angular 22 SSR, standalone, zoneless
│   └── src/app/         shell component + generated types
└── docs/
    ├── rebase.md        migration scope + full file inventory
    ├── adr.md           decision records, with their reversals kept
    ├── architecture.md  target structure
    ├── development.md   setup + verify + troubleshooting
    ├── security.md      threat model + control hierarchy
    ├── api-contract.md  the generated-contract pipeline
    ├── API_OBJECTIVES.md  API acceptance criteria, per objective
    └── testing.md       what must be tested, and what a test is
```

---

## Documentation

For a template, **the docs are the product** — a forker reads them before reading
code, and a wrong doc is worse than no doc. Every claim below is true.

| Doc | Read it when |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Understanding the structure and why it is that way |
| [`docs/development.md`](docs/development.md) | Setting up, or debugging the build |
| [`docs/security.md`](docs/security.md) | Adding anything auth-related |
| [`docs/api-contract.md`](docs/api-contract.md) | Changing any DTO or route |
| [`docs/testing.md`](docs/testing.md) | Writing tests, or deciding what needs one |
| [`docs/API_OBJECTIVES.md`](docs/API_OBJECTIVES.md) | Checking the API layer meets its acceptance criteria |
| [`docs/adr.md`](docs/adr.md) | Understanding why a decision was made |
| [`docs/rebase.md`](docs/rebase.md) | Working through the migration from `angular/` |
| [`AGENTS.md`](AGENTS.md) | Before writing any code |

---

## Contributing

Read [`AGENTS.md`](AGENTS.md) first — it is binding. It is short and it is
enforced by tooling, not by goodwill.

The three that matter most:

1. **No mock services, ever.** Not in application code, not in the DI container.
   A mock is a claim the work is done.
2. **Fail loudly.** No default config fallbacks, no `|| true`, no silent
   degradation.
3. **One mechanism per concern.** `grep` before adding a controller, component,
   guard or type. Duplicates are how this codebase accumulated its problems.