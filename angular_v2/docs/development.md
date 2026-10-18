# Development

Setup and verification for `angular_v2/`. Assumes a locally-installed
PostgreSQL instance — no container runtime.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `^22.22.3 \|\| ^24.15.0 \|\| >=26` | Angular 22's floor, and the floor `verify` fails on. `frontend/.npmrc` sets `engine-strict=true`, so a forker hits this at install rather than at build. The backend declares `>=22.18.0` — above Nest 12's own ≥ 20.19 — because `npm run dev` imports the local SMTP sink directly and needs Node's native TypeScript stripping. **Verify the version from a login shell** — see [Troubleshooting](#troubleshooting) |
| TypeScript | 6.0.x | pinned by Angular 22. See the codegen note below |
| PostgreSQL | **18 or later** | **Required, not a preference**: every key defaults to `uuidv7()`, which is a core function from 18. `0006_uuidv7.sql` refuses to run on an older server with a message naming the version. Verified on 18.6. Install from the PGDG apt repository — Debian's own `postgresql` package is still on 15 |

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
cp .env.test.example .env.test  # same coordinates; suites never read .env
createdb -O app app_dev       # database must be owned by the app role (see below)
npm run db:seed               # roles, then migrations, then permissions + admin user
cd ../frontend && npm install
npm run generate:client       # reads ../openapi.json
```

**`database/seed.ts` does not create the database.** It connects to `DB_NAME`
(`app_dev`) via `psql -d app_dev` and fails immediately if it does not exist:
`FATAL: database app_dev does not exist`.

Furthermore, **creating the database as the `postgres` superuser is also
wrong**: every migration will then fail with `permission denied for schema public`.
PostgreSQL 15 and later removed `CREATE` on schema `public` from `PUBLIC`. The
application migration/owner role (`app`, configured as `DB_USER`) only has
`CREATE` on `public` via membership in the predefined role `pg_database_owner` —
that is, **only because it owns the database**. The working command on a fresh
cluster is `createdb -O app app_dev`.

Once the database exists and is owned by `app`, running `migration:run` before
`db:seed` is still wrong on a fresh cluster. `database/seed.ts` runs, in this order:

1. `database/bootstrap/001_roles.sql`, through `sudo -u postgres psql` — a
   superuser session, because `CREATE ROLE` needs `CREATEROLE`;
2. `scripts/migrate.ts`, as the owner role — the same script `npm run
   migration:run` runs;
3. the authenticator's `LOGIN` password, again through a superuser session;
4. the superuser-only grants on `users`, `user_roles` and `user_groups` that the
   migrations cannot apply, after asserting `public.users` exists;
5. the seed data, connected as `pgrst_authenticator` and scoped by
   `SET LOCAL ROLE app_admin`.

Roles come first because `0001_rls_foundation.sql` opens with a preflight that
raises `missing role(s) [app_admin, app_anon, app_member, pgrst_authenticator] —
run database/bootstrap/001_roles.sql as a superuser first`, so
`npm run migration:run` against a cluster with no roles dies there before any
schema exists. It survived this long because a machine provisioned once already
had the roles: the same two commands worked the second time.

Prefer to see the steps? Create the database owned by `app` (`createdb -O app <DB_NAME>`),
run `database/bootstrap/001_roles.sql` as a superuser
(`sudo -u postgres psql -d <DB_NAME> -v ON_ERROR_STOP=1 -f
database/bootstrap/001_roles.sql`), then `npm run migration:run`, then `npm run
db:seed`. The second and third are idempotent, and the seed is what adds the
permissions, the group tree and the admin user.

`npm run migration:run` **on its own** is correct only for a database whose
roles already exist — a re-migration of an existing install. It applies just the
files missing from the `migrations` table.

One command once the above is done — from the repo root, or from `backend/`:

```bash
npm run dev
```

`npm run dev` boots the whole stack: PostgREST, the thin app, and the Angular SSR
server — by default `http://127.0.0.1:3001`, `http://127.0.0.1:3000` and
`http://127.0.0.1:4000`, but the banner prints whatever was actually configured.
It runs the frontend build once if
`frontend/dist/frontend/server/server.mjs` is missing, waits for each process
to answer its port, prints a readiness banner, and on Ctrl+C (or if any child
dies) shuts the rest down — no orphans. A PostgREST boot failure surfaces here,
not in a silently dead API. To iterate on SSR alone, `cd frontend &&
npm run dev`; to run everything against production config, build both projects
(`npm run build` in `backend/` and `frontend/`) and then `npm run prod`.

**The ports are configuration, and they are resolved once, before anything is
spawned.** `PORT` (thin app) and `SSR_PORT` (SSR server) come from the env file
above; the PostgREST port comes from `server-port` in `postgrest.conf`.
`backend/scripts/stack-ports.ts` resolves the three, refuses anything unusable
naming the keys, and hands the SSR child its own `SSR_PORT` — so the SSR server
no longer reads the thin app's `PORT`, which is how one key used to move two
listeners into one `EADDRINUSE`. Move the ports by editing those two files; see
[`deployment-guide.md` §Ports](./deployment-guide.md#ports).

`npm run prod` requires `backend/.env.production` (copy
`backend/.env.production.example` and fill in real secrets) and existing build
output. `npm run start:prod` in `backend/` boots only the thin app in
production mode and **fails loudly, naming `backend/.env.production`**, when it
is absent — there is no development fallback.

---

## Environment

Only `*.example` files are committed. Real `.env*` files are never tracked
(`.gitignore` allows `!.env.example` and `!.env.*.example`, blocks
everything else).

Which file loads depends on `NODE_ENV` (lowercased, default `development`),
via `backend/src/config/load-env-file.ts` — one loader for the app, the
suites, and the orchestrators:

| Mode | File loaded | If absent |
|---|---|---|
| `development` | `backend/.env`, else `backend/.env.development` | Nothing — a zero-config checkout still boots, or `loadEnvironment` names every missing key |
| `test` | `backend/.env.test` — the development file is never read from a test | Nothing — the same `loadEnvironment` key check fails loudly |
| `production` | `backend/.env.production` | **Throws, naming the file** — no development fallback |

Unknown `NODE_ENV` values throw, naming the value. A variable already present
in the real environment wins, as with Node's own `--env-file`.

```ini
# Required — the app refuses to boot without this
JWT_SECRET=<>=32 chars, asserted at bootstrap>

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=app
DB_PASSWORD=app
DB_NAME=app_dev

# Optional. Two separate keys for two separate listeners, so moving one never
# moves the other (the SSR server used to read this one too).
PORT=3000
SSR_PORT=4000

# Required. The login password of `pgrst_authenticator` — the role BOTH
# the thin app's login path and PostgREST connect as
AUTHENTICATOR_PASSWORD=<pgrst role's LOGIN password>

# Required by PostgREST / the login path. There is NO PGRST_DB_URI: `npm run
# dev` composes it from DB_HOST/DB_PORT/DB_NAME and AUTHENTICATOR_PASSWORD,
# always as `pgrst_authenticator`. Naming any other role in it is either a dead
# data layer (`permission denied to set role "app_anon"` — the owner is a member
# of none of the three serving roles) or a silent RLS bypass (the owner is exempt
# from every policy and nothing errors when it is).
PGRST_JWT_SECRET=<same value as JWT_SECRET>

# Required in every mode. The application's public origin: every email
# template carries an absolute link, so there is no default — and no
# localhost one either. https in production.
APP_BASE_URL=http://localhost:4000

# Transactional email. The transport follows NODE_ENV and no key selects it:
# development logs the rendered message to the terminal, test serialises it
# and sends nothing, production talks SMTP. The five keys below are required
# in production with no defaults, and are not read at all in the other modes.
# EMAIL_HOST=
# EMAIL_PORT=587
# EMAIL_USER=
# EMAIL_PASSWORD=
# EMAIL_FROM=
# EMAIL_SECURE=false
# APP_NAME=
```

With no SMTP credentials, a development checkout still completes a
verification or a reset: the message — link included — is printed by the Nest
`Logger`. That is the `stream` transport, and it is unreachable in production
because the transport is derived from the mode rather than from a key. See
[`adr.md`](./adr.md) ADR-0024 and, for a real deployment,
[`deployment-guide.md`](./deployment-guide.md) §Transactional email in
production.

Note the names. The previous codebase documented `DB_DATABASE` while reading
`DB_NAME`, and set `DATABASE_SYNCHRONIZE` while reading `DB_SYNCHRONIZE` — the
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

### `AUTHENTICATOR_PASSWORD` must agree between `.env` and `.env.test`

`ALTER ROLE pgrst_authenticator … PASSWORD` is **cluster-scoped**: one statement
rewrites the login password for every database on the cluster, `app_dev`
included. Both the seed and the RLS proof's teardown therefore write the
**configured** value rather than a literal, and both read it through the same
loader the application uses — so which file that value comes from depends entirely
on the `NODE_ENV` the run was launched with.

`npm run verify` runs in test mode, so it leaves the cluster holding the password
from **`backend/.env.test`**. `npm run dev` reads **`backend/.env`**. If the two
files disagree, the development stack cannot mint a token: `POST /auth/login`
answers **HTTP 500** with `password authentication failed for user
"pgrst_authenticator"` in the NestJS log, and PostgREST fails identically because
both connect as that role. The symptom is opaque precisely because nothing about
it names a `.env` — the stack reads `.env` happily and the database simply
rejects the password it is given.

Keep the two values identical. If they have diverged, re-sync under the
development environment rather than editing the role by hand:

```bash
cd backend && npm run db:seed
```

`test/smoke/database.smoke-spec.ts` is the gate for this, and it is the last step
of `verify` **because** a suite that only ever ran in isolation could not see the
damage a preceding step did to the shared cluster. It asserts the property from
the outside — a real login with the configured password — since a SCRAM verifier
cannot be read back, and its failure message names the divergence and the
`db:seed` fix. That message is the diagnostic; this section explains why it fires.

### Other scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Boot the full dev stack: PostgREST + thin app + SSR |
| `npm run prod` | Boot the full stack with production config (needs `backend/.env.production` and build output) |
| `npm run start:prod` | Thin app only, `NODE_ENV=production` — fails loudly without `backend/.env.production` |
| `npm run lint` | ESLint, both projects |
| `npm test` | Unit tests (`NODE_ENV=test`) |
| `npm run test:e2e` | Integration tests against a throwaway schema |
| `npm run test:rls` | Row-level security proof — real Postgres, real PostgREST |
| `npm run smoke` | Database smoke check against a live instance |
| `npm run generate:client` | Regenerate the Angular client from `openapi.json` |
| `npm run db:seed` | Provision database contents — bootstrap the roles, apply pending migrations, seed permissions/group tree/admin user (requires database created first via `createdb -O app app_dev`) |
| `npm run migration:run` | Apply pending migrations to a database whose roles already exist (a re-migration) |
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

- a running PostgreSQL, reachable with the credentials in `backend/.env.test`;
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
> 8 — and not as current figures. It was **re-measured in W33 (2026-10-07)**; the
> current figures are in `rebase.md` §6.6.1, and the old `of 33` numbers below are
> the superseded suite's.
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
| *(nothing — baseline)* | `verify passed`, **73** tests green (68 `rls.spec.ts` + 5 `seed.spec.ts`) — W33 re-measure, 2026-10-07 |
| `ALTER TABLE … ENABLE ROW LEVEL SECURITY` → `DISABLE` | `verify failed at step 7/8`, **19 of 73** |
| the column-hide `REVOKE SELECT ON … FROM app_member` line deleted | `verify failed at step 7/8`, **3 of 73** |
| the boundary `GRANT` widened to name the table-owning role | bootstrap assertion fires first (73 skipped); with it neutralized, **3 of 73** |
| `ALTER TABLE groups FORCE ROW LEVEL SECURITY` | `verify failed at step 7/8`, **17 of 73** — data failure mode: **empty closure** (0 rows) |
| closure query rewritten with `UNION ALL` | **green, 0 of 73** — invisible on the acyclic fixture; bounded probe: temp-file overflow |

> Superseded figures (`12 / 2 / 3 of 33`) were taken against the claim-keyed,
> per-row-walk migration. The current matrix is `rebase.md` §6.6.1 (**W33**,
> 2026-10-07); a proof carried across a schema change is a stale result wearing a
> current one's clothes.

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
| **`POST /auth/login` → HTTP 500**, `password authentication failed for user "pgrst_authenticator"`, after a green `verify` | **`AUTHENTICATOR_PASSWORD` diverged between `.env` and `.env.test`.** `ALTER ROLE … PASSWORD` is cluster-scoped, so the test-mode run left the cluster on `.env.test`'s value while `npm run dev` authenticates with `.env`'s. Re-sync with `cd backend && npm run db:seed`. See §`AUTHENTICATOR_PASSWORD` must agree. |
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