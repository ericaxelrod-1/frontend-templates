# Development

Setup and verification for `angular_v2/`. Assumes a locally-installed
PostgreSQL instance — no container runtime.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `^22.22.3 \|\| ^24.15.0 \|\| >=26` | Angular 22's floor, and the floor `verify` fails on. `frontend/.npmrc` sets `engine-strict=true`, so a forker hits this at install rather than at build. Nest 12 also requires ≥ 20.19 — the 21.x line is unsupported. **Verify the version from a login shell** — see [Troubleshooting](#troubleshooting) |
| TypeScript | 6.0.x | pinned by Angular 22. See the codegen note below |
| PostgreSQL | **15 or later** | verified on 15.19; 16/17 also fine. `security_invoker` views need 15+, though this template creates none |

```bash
node --version
psql -h localhost -U postgres -c 'select version();'
```

> **Check `node --version` before anything else, and run it from a login shell.**
> On a machine where Node is managed by **nvm**, nvm is sourced from `.bashrc`,
> which a **non-login** shell does not read. Such a shell resolves to whatever
> older Node is on `PATH` — so the reported version is below the floor, and
> `npm run verify` fails at the frontend step with a confusing **Angular CLI
> version error** rather than a clear "unsupported Node" message. The failure
> looks like an Angular problem and is an environment one; `bash -lc 'node
> --version'` is the honest check.

### Known constraint: `openapi-typescript` and TypeScript 6

`openapi-typescript@7.13.0` declares a peer dependency on `typescript@^5.x`,
while Angular 22 pins TypeScript 6.0. It runs correctly under an npm `overrides`
entry, which is what the backend uses today. Treat this as temporary: when
`openapi-typescript` declares TS 6 support, remove the override (W15).

## Setup

```bash
git clone <repo> && cd angular_v2
cd backend && npm install
cp .env.example .env          # then edit — see below
npm run migration:run
npm run db:seed               # creates roles, permissions, and an admin user
cd ../frontend && npm install
npm run generate:client       # reads ../openapi.json
```

One command once the above is done:

```bash
npm run dev
```

Serves SSR on `:4000`. The seeded admin credentials are printed by `db:seed`.

---

## Environment

Only `.env.example` is committed. Real `.env` files are never tracked.

```ini
# Required — the app refuses to boot without this
JWT_SECRET=<>=32 chars, asserted at bootstrap>

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=app_dev

# Optional
PORT=3000
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
THROTTLE_TTL=60
THROTTLE_LIMIT=10
```

Note the names. The current codebase documents `DB_DATABASE` while reading
`DB_NAME`, and sets `DATABASE_SYNCHRONIZE` while reading `DB_SYNCHRONIZE` — the
developer intent was silently ignored. `angular_v2/` documents one canonical set.

**There is no default `JWT_SECRET`.** Bootstrap throws if it is missing or too
short. A missing config value must stop the process, not produce a working app
signed with a committed string.

---

## The verification gate

```bash
npm run verify
```

Runs, in order: typecheck → lint → unit tests → integration tests → smoke check
against a live database.

**A change is not complete until `verify` passes.**

- Never report work as done on the basis of "it looks right."
- Never weaken a lint rule or delete a test to make `verify` pass. Fix the code.
- If a database is unreachable, `verify` **fails**. It never skips silently.

### Other scripts

| Command | Purpose |
|---|---|
| `npm run lint` | ESLint, both projects |
| `npm test` | Unit tests |
| `npm run test:e2e` | Integration tests against a throwaway schema |
| `npm run test:rls` | Row-level security proof — real Postgres, real PostgREST |
| `npm run generate:client` | Regenerate the Angular client from `openapi.json` |
| `npm run migration:run` | Apply migrations |
| `npm run migration:revert` | Revert the last migration |

Run `generate:client` after **any** DTO or route change. A change that alters the
wire format without regenerating the client is incomplete.

---

## Running tests

Tests run against a real PostgreSQL instance — never mocks of the database. Mocks
hide schema and policy bugs, which is why the previous security suite had 1,700
lines of tests that could not fail.

```bash
# Unit
npm test

# Integration, with a throwaway schema per suite
npm run test:e2e

# Row-level security proof
npm run test:rls

# Single concern
npm test -- rls
```

Never point tests at a developer's working data. Each integration suite creates and
drops its own schema.

### The row-level security proof

`npm run test:rls` is a **gating step of `verify`**, and it needs more than the
other suites do:

- a running PostgreSQL, reachable with the credentials in `backend/.env`;
- `sudo -u postgres psql`, because role bootstrap needs `CREATEROLE`;
- the `postgrest` binary on `PATH` at `/usr/local/bin/postgrest`.

If any of those is missing the suite **fails**. It never skips: a security suite
that passes without exercising its subject is a false green, which is the exact
failure mode this suite exists to prevent.

It rebuilds its own `rls_proof` database from nothing on every run, applies the
role bootstrap and the migration, seeds a **three-level `groups` tree** and a `sub`
token per principal, starts a PostgREST on port **3005** and tears it down
afterwards. It refuses to run if something else already answers on that port, and it
never touches the other PostgREST instance on 3002.

> ### ⚠ The tamper figures below are from the superseded suite
>
> The migration **has** been rewritten to the closure-join design (**W26, done**) and
> so has this suite (**W27, done**) — **68 tests**, green, run by `verify` step 7 of 8.
> `actions`, `permissions`, `roles`, `role_permissions`, `user_roles`, `groups`,
> `user_groups`, `authz.org_closure` and `has_permission()` are all in the tree; the
> superseded `sites` / `site_id`-claim shape is gone. So a green `test:rls` **is**
> evidence for the shipped design now, which it was not when this text was written.
>
> **Three clauses of that design are declared and not enforced**, and this section
> must not imply otherwise: the **grant-subset trigger** (`rebase.md` W08b),
> **`is_system_role`** as the administrative floor (W34), and the **identity source**
> — `request.jwt.claims` is a **caller-writable GUC**, verified exploitable by a
> member, whose only control is the absence of a request-reachable `SET` (W37).
>
> The tamper table was measured against the **old** file and the **old** suite, so
> read it as a **method** — remove a control, confirm the gate goes red at step 7 of
> 8 — and not as current figures. **Re-measuring it is W33**; the `of 33` numbers
> below are the superseded suite's.
> rather than as current numbers. Both the migration rewrite and the suite rewrite
> are tracked as work items; `rebase.md` §6.0.1, W06/W07 and W26/W27 have the
> detail.

The test names are the documentation. Each one names the attack it prevents —
"a validly-signed token naming the table-owning role is refused, and the row
survives" — because that is what a reader six months from now needs to know.
Assertions are on bodies and row counts, never on status codes alone: with a
table-level grant in place a leaked column comes back at HTTP 200 with its value
intact, and a status-only test passes on the leak.

**The gate is verified, not asserted.** Each of these was executed by removing one
control from the shipped SQL, running the full gate, and restoring the file:

| Control removed | Result |
|---|---|
| *(nothing — baseline)* | `verify passed`, **33** RLS tests green — **SUPERSEDED FIGURE, see W33** |
| `ALTER TABLE … ENABLE ROW LEVEL SECURITY` → `DISABLE` | `verify failed at step 7/8`, **12 of 33** — superseded |
| the `REVOKE SELECT ON … FROM app_member/app_admin` lines | `verify failed at step 7/8`, **2 of 33** — superseded |
| the boundary `GRANT` widened to reach the table owner | `verify failed at step 7/8`, **3 of 33** — superseded |

> **STALE — these numbers are from the superseded suite and must be re-measured.**
> They were taken against the claim-keyed, per-row-walk migration. The suite has been
> rewritten against the closure-join design and now runs **68** tests; the tamper rows
> above have not been re-run against it, and a proof carried across a schema change
> is a stale result wearing a current one's clothes. **Re-run the whole matrix before
> citing any figure in it** (`rebase.md` §6.6.1, **W27**).

The other steps cannot see any of this: typecheck, lint and both unit suites stay
green with every policy in the database disabled. Note also that `verify` stops at
the first failing step, so a tampered run ends at step 7 and never reaches step 8.
`rebase.md` §6.6.1 has the detail, including one tamper that did **not** turn the
gate red and why.

Seeding inside the proof suite connects as `pgrst_authenticator` and
`SET ROLE app_admin` — through the escalation boundary, not around it. A claim
alone can no longer admit a write, because the admin branch discriminates on
`current_user`.

---

## Why there is no CI

This repository is a template. It is never deployed and never runs in production,
so it has no continuous integration pipeline of its own.

`npm run verify` is the gate, and it is inherited by every fork — which is the
point. It must be self-contained and runnable with no external service. A fork may
add CI on top; the template does not need any.

---

## Adding a feature

1. **Backend** — decide which runtime owns it. Pure CRUD over a table →
   PostgREST, so write a migration and nothing else. Needs an algorithm, a secret,
   a socket, or a schedule → the thin Nest app, service then thin controller.
   Either way: migration if the schema changes, and an RLS policy if it touches
   rows.
2. **Regenerate** the OpenAPI spec and the Angular client.
3. **Frontend** — feature folder, standalone component, `OnPush`, signal state,
   service for HTTP, `| async` or `toSignal`.
4. **Tests** — service unit test, plus integration if auth or RLS is involved.
5. **Run `npm run verify`.** Fix what it reports. Do not silence it.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Boot fails on missing `JWT_SECRET` | Working as designed. Set it in `.env`. |
| **`verify` fails at a frontend step with an Angular CLI version error, not a Node error** | **An unsupported Node, reported confusingly.** The frontend requires `^22.22.3 \|\| ^24.15.0 \|\| >=26` and `frontend/.npmrc` sets `engine-strict=true`. **Run `verify` from a login shell** — `bash -lc 'npm run verify'` — so nvm is sourced by `.bashrc`. A **non-login** shell does not read `.bashrc`, resolves to an older Node below the floor, and the failure surfaces as an Angular CLI version mismatch rather than "unsupported Node". Check with `bash -lc 'node --version'` before debugging anything else. |
| `verify` fails at the smoke step | Postgres unreachable or migrations not applied. |
| Prerender throws `ReferenceError: localStorage` | A browser global on a server-executed path. Guard it or remove it. |
| Frontend types out of sync | Run `npm run generate:client`. |
| RLS test returns zero rows unexpectedly | Check identity and the policy's `USING` clause. Identity is the token's `sub` read through the claims setting — **not** `SET LOCAL app.user_id`, which no policy here reads, and not a `site_id` claim. Scope is `user_groups` membership joined to `org_closure`, so zero rows usually means no membership rows rather than a missing identity setting. |
| **PostgREST panics on boot:** `failed to parse role-claim-key value (role) … unexpected "r" / expecting "."` | `jwt-role-claim-key` must be a **JSPath**. Use `".role"`. The bare `"role"` does not fall back — it aborts startup. `$.role` panics too on 16.4, so do not "modernise" it. |
| `PGRST301 "None of the keys was able to decode the JWT"` while `postgrest.conf` looks correct | **Environment beats config.** An inherited `PGRST_JWT_SECRET` from `backend/.env` silently overrides the file. Strip inherited `PGRST_*` keys when spawning PostgREST — `spawn` stringifies `undefined` into the literal text `"undefined"`. |
| `403 permission denied for function request_claims` on every scoped request | `EXECUTE` was revoked from `PUBLIC` and granted to nobody. **A revoke is not a policy** — revoke *and* grant to `app_anon`, `app_member`, `app_admin`. Scoping is 100% non-functional until you do. |
| `permission denied for function site_tree_ids` on an *unauthenticated* read | `EXECUTE` was not granted to `app_anon`. A policy is evaluated for every role that reaches the table, including the anonymous one; the denial must arrive as zero rows, not as a `42501`. **This named the superseded design.** The walk is gone; the closure join reads a matview, and the equivalent symptom now names `authz.actor()` or `authz.org_closure` — both of which are granted to `app_anon` for the same reason |
| `stack depth limit exceeded` on any query as a non-superuser role | The hierarchy function reads the table its own policy protects. It must be `SECURITY DEFINER` **and** that table must not be `FORCE`d — one decision, not two. |
| `must have admin option on role "app_anon"` | The escalation-boundary `GRANT` cannot run as the migration role. Run `database/bootstrap/001_roles.sql` **as a superuser** — the one statement that *is* the boundary is necessarily a superuser statement. |
| `new row violates row-level security policy` when seeding | `FORCE` binds the owner for `DML`. Seed through the boundary: connect as `pgrst_authenticator`, `SET ROLE app_admin`. **Never** `SET row_security = off` — it reopens the owner bypass. |
| An internal column comes back at HTTP 200 | Column grants only *narrow* a table grant that is already gone. `REVOKE ALL`, re-grant the verbs, then `REVOKE SELECT` at table level, and only then the column list. |
| `port 3005 is already serving` and the suite would have tested the wrong database | Something else holds the proof port. The suite refuses to start; kill the other process rather than removing the guard. |