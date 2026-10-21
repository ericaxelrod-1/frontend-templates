# Deployment Guide

How to run `angular_v2/` locally, test it, and put it behind a reverse proxy.
Written against the tree as it stands: **PostgreSQL 18+, PostgREST 16, a thin
NestJS 12 app, and an Angular 22 SSR frontend.** There is no ORM, no local mail
server, no separate API for CRUD, and no second state store.

Setup and troubleshooting live in [`development.md`](./development.md); this
document is what an operator needs once the stack already works locally.
Conventions the fork inherits are in [`AGENTS.md`](../AGENTS.md).

---

## What you are actually deploying

Three processes, and knowing which is which is most of the deployment work. The
ports are the defaults; §Ports below is how to move them.

| Process | Port | Role |
|---|---|---|
| **PostgREST** | `127.0.0.1:3001` | The API layer. Serves the base tables directly from PostgreSQL and enforces row-level security. Every CRUD request goes here, not through Nest. |
| **Thin Nest app** | `127.0.0.1:3000` | Only what PostgREST cannot do: JWT issuance, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, brute-force delay, authenticated privacy erasure API, and scheduled retention jobs under Postgres advisory locks. Default deny — every other route needs a token. |
| **Angular SSR server** | `127.0.0.1:4000` | Serves the app. Reads `SSR_PORT`, defaults to 4000. |

Both PostgREST and the thin app verify the **same** JWT secret, and the thin
app refuses to boot if `PGRST_JWT_SECRET` and `JWT_SECRET` differ.

## Ports

Ports are configuration, and all three are moved by editing two files.

| Port | Where it is configured | Default |
|---|---|---|
| PostgREST | `server-port` in [`postgrest.conf`](../postgrest.conf) | 3001 |
| Thin Nest app | `PORT` in the backend env file (`.env` / `.env.production`) | 3000 |
| Angular SSR server | `SSR_PORT` in the same env file | 4000 |

`npm run dev` and `npm run prod` resolve all three through
`backend/scripts/stack-ports.ts` before spawning anything, and **refuse to start
if any of them is unusable**, naming the keys — a value that is not a port, two
listeners on one port, or a `POSTGREST_URL` that does not name the port
`postgrest.conf` binds. That last one matters: the thin app calls PostgREST on
`POSTGREST_URL`, so moving PostgREST without moving that URL used to produce a
stack that reported itself ready and then failed every account-scoped request.

To move the whole stack, in `postgrest.conf` change `server-port`, and in the
env file change `POSTGREST_URL` to the same port, plus `PORT` and `SSR_PORT` as
wanted. Nothing else — the launchers pass the resolved origins to the SSR
server's proxy, so no rebuild is needed. `server-host` and the two loopback bind
addresses are **not** configuration and stay as they are; the reverse proxy in
front of the stack is what is reachable from elsewhere.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **≥ 22.18.0** for both projects. The frontend declares **`^22.22.3 \|\| ^24.15.0 \|\| >=26`** and sets `engine-strict=true`, so the frontend's floor is the stricter one | The backend's floor is raised above NestJS 12's own ≥ 20.19 because `npm run dev` imports the local SMTP sink (`backend/scripts/smtp-sink.ts`) directly and relies on Node's native TypeScript stripping, which is only stable from 22.18. An older Node fails at `npm ci` rather than at build. Check from a **login** shell — see [`development.md` §Troubleshooting](./development.md#troubleshooting) |
| npm | ships with Node | `frontend/package.json` pins `packageManager: npm@11.11.0` |
| PostgreSQL | **18 or later** | Local instance. **No Docker.** `uuidv7()` is a core function from 18 onward and `gen_random_uuid()` has been core for far longer, so **no extension is required** — installing `pgcrypto` for it is a false requirement that older drafts of this guide carried |
| `postgrest` binary | 16.x, on `PATH` | `dev.mjs` and `prod.mjs` spawn it as a bare command; `/usr/local/bin/postgrest` is the expected location. 16.4 is what the `jwt-role-claim-key` value is verified against |
| `sudo -u postgres psql` | passwordless | `db:seed`, the integration suites and the RLS proof all bootstrap roles as the `postgres` superuser |

```bash
node --version
psql -h localhost -U postgres -c 'select version();'
postgrest --version
sudo -u postgres psql -c '\du'     # must succeed without a password prompt
```

### Where the superuser credential comes from

Every superuser statement in this repository — the role bootstrap, the
`ALTER ROLE … PASSWORD` the integration suites restore, and the
`CREATE DATABASE` each throwaway proof database needs — runs `psql` as the
`postgres` role, and **where the credential comes from depends on how the
machine authenticates**. On Linux that is `sudo -u postgres psql`: the OS user
is `postgres`, the session is a Unix socket one, and it authenticates by
**PEER** — no password is involved and none is asked for, which is why `-h` is
deliberately absent from that spelling (naming a host forces a TCP session, and
a TCP session is not peer authentication, so it asks the cluster for a password
the `postgres` role may not have). A machine with no peer authentication —
Windows, which has neither a `postgres` OS account nor a Unix socket — has to
supply the credential itself: the session is a TCP one and the password comes
from **`PGPASSFILE`**, the file that variable names, in libpq's
`host:port:database:user:password` format
(`localhost:5432:*:postgres:<password>`), or from `PGPASSWORD`. The test
harness passes `-w` there, so a missing or unreadable passfile fails the run
at once with a message naming the variable, rather than prompting on stdin and
hanging the suite overnight.

---

## One-time setup

### 1. The migration/owner role and the database

Two objects the template deliberately does **not** create for you, because both
need a superuser and neither is part of the design — the password is a
deployment-specific secret:

```bash
# The owner role. NOSUPERUSER NOBYPASSRLS are load-bearing: FORCE ROW LEVEL
# SECURITY binds neither a superuser nor a BYPASSRLS role, so these attributes
# are the only thing between a serving role and every row.
sudo -u postgres psql -c "CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS"

# The database, owned by that role. The schema owner must be `app` (`OWNER app`):
# PostgreSQL 15 and later removed CREATE on schema public from PUBLIC. The app
# role only has CREATE on public via pg_database_owner (by owning the database);
# creating the database as postgres causes migrations to fail with
# "permission denied for schema public".
sudo -u postgres psql -c "CREATE DATABASE app_prod OWNER app"
```

There is **no npm script for either statement.** See *Not yet present*.

### 2. Dependencies and the client

```bash
cd backend && npm ci
cd ../frontend && npm ci
cd ../frontend && npm run generate:client    # reads ../openapi.json
```

`generate:client` is needed once per clone. Re-run it after any migration or
route change — see [`api-contract.md`](./api-contract.md).

### 3. Migrations and seed

Against the database created in step 1, on a cluster that has no roles yet,
**one command provisions its schema and roles**:

```bash
cd backend
npm run db:seed        # roles → migrations → data, in that order
```

Step by step, if you would rather see each step — the roles file needs a
superuser session, everything after it does not:

```bash
# As a superuser, against the database from step 1. Idempotent.
sudo -u postgres psql -d app_prod -v ON_ERROR_STOP=1 \
  -f database/bootstrap/001_roles.sql

# As the owner role. Idempotent; applies only what the `migrations` table lacks.
npm run migration:run

# Idempotent. This pass adds the permissions, the group tree and the admin user.
npm run db:seed
```

What each one does, and why the order matters:

- `migration:run` applies the plain-SQL migrations in
  `backend/database/migrations/` as the owner role, one transaction each. It
  applies exactly the files missing from the `migrations` table, so the count
  moves with the tree — read `ls backend/database/migrations/*.sql` rather than a
  number written here, because a number written here is exactly the kind of claim
  that goes stale silently. **`0001` refuses to run until the four serving roles
  exist** — it raises, naming them. Migrations cannot create roles:
  `CREATE ROLE` needs `CREATEROLE`, which is cluster-scoped, and the escalation
  boundary `GRANT` needs `ADMIN OPTION`, so the boundary is *necessarily* a
  superuser statement.
- `db:seed` is therefore the command that bootstraps roles first. It runs
  `database/bootstrap/001_roles.sql` through `sudo -u postgres psql`, then
  applies any pending migrations, then sets the authenticator's `LOGIN`
  password, then applies the superuser-only grants the migrations cannot, and
  finally seeds reference data and the admin user — all **through** the
  escalation boundary (`pgrst_authenticator` + `SET LOCAL ROLE app_admin`),
  never around it.

So `migration:run` → `db:seed` **cannot work on a fresh cluster**: the first
command dies on `0001`'s preflight with `missing role(s) [app_admin, app_anon,
app_member, pgrst_authenticator] — run database/bootstrap/001_roles.sql as a
superuser first`, and no schema is created. It looked correct because every
machine that ran it had the roles left by an earlier provision.

Run `migration:run` on its own only when the roles already exist — a
re-migration of an existing install. It applies exactly the files missing from
the `migrations` table, so it is safe to repeat and a no-op when there is
nothing new.

`migration:revert` reverses the last migration. Every migration carries a
working `-- DOWN` section; a missing one is an error, not a no-op.

### 4. Role and boundary model

Five roles, and the split between them is the security design, not bookkeeping:

| Role | Purpose |
|---|---|
| `app` | Migration/owner. Owns the schema, applies migrations, **never receives a request**. Not created by the bootstrap — it needs a `LOGIN` credential, so it is deployment-specific. |
| `app_anon` | `db-anon-role`. Unauthenticated callers. |
| `app_member` | An authenticated caller holding at least one role. |
| `app_admin` | The superset principal: more of everything, four mechanisms, never a bypass. |
| `pgrst_authenticator` | The **only** role PostgREST ever logs in as. Owns nothing, bypasses nothing. `LOGIN`, because a `NOLOGIN` authenticator makes PostgREST unable to serve. |

The single control that stops a validly-signed token from assuming a
table-owning role is one statement, and it lives in
`backend/database/bootstrap/001_roles.sql`:

```sql
GRANT app_anon, app_member, app_admin TO pgrst_authenticator;
```

The file asserts the grant afterwards by reading `pg_auth_members` and raising,
in both directions — that all three are reachable and that **nothing else** is.
A token naming any other role is refused by Postgres with `403`.

Row-level security is `ENABLE` + `FORCE` on every table a serving role can
reach, **except `groups` and `user_groups`**. `FORCE` on `groups` is not a
hardening step: the closure refresh runs as the view owner, reads the tree
through a policy `actor()` cannot satisfy, and writes an **empty** closure —
measured 0 rows, every tenant's scope becomes zero, no error anywhere. Both
omissions are asserted in the suite. Full detail in
[`security.md`](./security.md).

---

## Seeded credentials

One account, not a set of demo users:

| | |
|---|---|
| Username | `admin` |
| Email | `admin@example.com` |
| Password | the value of `SEED_ADMIN_PASSWORD` at seed time |
| Role | `admin` capability role; member of the `HQ` and `EU` groups |

The password is **not** printed unless it was actually applied. On a first seed
the seed prints `seed complete. admin / <password>`. On a re-run where the
stored hash already matches, it prints that the password is unchanged and names
the variable that rotates it — because `ON CONFLICT DO NOTHING` cannot rotate
anything, and a completion line that reported an unapplied password would be a
lie.

**Rotate before anyone else touches the box:**

```bash
cd backend && SEED_ADMIN_PASSWORD='<a real password>' npm run db:seed
```

The seed compares against the stored hash and only rewrites when the values
differ, so a same-password re-run is byte-identical.

The authenticator's password is set during seeding from `AUTHENTICATOR_PASSWORD`
— the same value the thin app authenticates with and that PostgREST is given in
`PGRST_DB_URI`. There is **no default**: the seed refuses to run rather than
substitute a literal, because `ALTER ROLE … PASSWORD` is cluster-scoped and a
literal would be written to every database on the cluster and outlive the run.

`SEED_AUTHENTICATOR_PASSWORD` overrides it and is **durable** — it is left in
place, because bootstrapping a cluster whose login password is not the one this
checkout uses is a legitimate reason to set one. In production set
`AUTHENTICATOR_PASSWORD` to the real value and leave `SEED_AUTHENTICATOR_PASSWORD`
unset; the two must agree, because the application and PostgREST both connect
with `AUTHENTICATOR_PASSWORD`.

**In development, that configured value has to be the same in `.env` and
`.env.test`.** The seed reads it from the file belonging to the current
`NODE_ENV`, and because the statement is cluster-scoped it does not matter which
one supplied it — the password is now the cluster's, for `app_dev` as much as for
the database being seeded. `verify` and every test suite run in test mode, so they
leave the cluster on `.env.test`'s value, and `npm run dev` authenticates with
`.env`'s. Diverge them and the development stack cannot mint a token; see §Step 8
exists because step 7 is cluster-scoped for the symptom and the repair.

---

## Running the stack in development

```bash
cd angular_v2
npm run dev
```

That one command boots all three processes, waits for each to answer its port,
prints a readiness banner, and on Ctrl+C — or if any child dies — takes the rest
down. No orphans, and a PostgREST boot failure surfaces here rather than as a
silently dead API. It composes PostgREST's database URI before spawning anything
and refuses to start if `DB_HOST`, `DB_PORT`, `DB_NAME`, `AUTHENTICATOR_PASSWORD`
or `PGRST_JWT_SECRET` is missing from `backend/.env`, and refuses to run under any
`NODE_ENV` other than `development`.

First run on a fresh clone: `frontend/dist/frontend/server/server.mjs` does not
exist, so `dev` runs `npm run build` in `frontend/` once and says so. To iterate
on the frontend alone, `cd frontend && npm run dev` (build + serve SSR). To run
the frontend on the dev server with no SSR, `cd frontend && npm start` (:4200).

Environment file resolution is one loader,
`backend/src/config/load-env-file.ts`, resolved next to `backend/` and never
against the cwd:

| `NODE_ENV` | File loaded | If absent |
|---|---|---|
| `development` (default) | `backend/.env`, else `backend/.env.development` | nothing loaded; `loadEnvironment` then names every missing key |
| `test` | `backend/.env.test` — **the development file is never read from a test** | same loud key check |
| `production` | `backend/.env.production` | **throws, naming the file** — no development fallback |

An unknown `NODE_ENV` throws naming the value. A variable already present in the
real environment wins, so `JWT_SECRET=… npm start` overrides the file without an
edit.

---

## Test mode and the verification gate

```bash
cd backend
npm test           # unit,            NODE_ENV=test
npm run test:e2e   # integration,     NODE_ENV=test, throwaway database per suite
npm run test:rls   # RLS proof,      NODE_ENV=test, real Postgres + real PostgREST
npm run smoke      # live database smoke check
```

Every one of these sets `NODE_ENV=test`, so it reads `backend/.env.test` and
never `backend/.env`. Each integration suite creates and drops its own database;
`test:rls` rebuilds `rls_proof` from nothing on every run. None of them can be
pointed at a developer's working data through the env file.

```bash
npm run verify     # from angular_v2/ or backend/
```

Eight steps, in order, stopping at the first failure:

```
[1/8] typecheck (backend)
[2/8] typecheck (frontend)
[3/8] lint (both projects)
[4/8] unit tests (backend)
[5/8] unit tests (frontend)
[6/8] integration tests
[7/8] row-level security proof
[8/8] database smoke check
```

**Step 7 is the one that matters for a deployment decision.** Every other step
stays green with all row-level security disabled in the database. It needs more
than the rest: a live PostgreSQL, `sudo -u postgres psql`, and the `postgrest`
binary on `PATH`. If any is missing it **fails** — it never skips, because a
security suite that passes without exercising its subject is a false green.

A green `verify` is therefore the deployment gate. Never weaken a lint rule or
delete a test to get one.

### Step 8 exists because step 7 is cluster-scoped

`ALTER ROLE pgrst_authenticator … PASSWORD` is **cluster-scoped**: it rewrites the
login password for every database on the cluster, not just the throwaway one the
proof rebuilt. The RLS proof sets its own password and restores it in `afterAll`,
and the seed writes the **configured** `AUTHENTICATOR_PASSWORD` — no literal,
because a literal would be written cluster-wide and outlive the run. Both restore
paths read the value through the same loader the application uses, so which file
supplied it depends on the `NODE_ENV` the run was launched under.

The operational consequence is that **`AUTHENTICATOR_PASSWORD` must be identical
in `backend/.env` and `backend/.env.test`**. `verify` runs in test mode, so a green
run leaves the cluster holding `.env.test`'s value; `npm run dev` reads `.env`. When
they disagree the development stack cannot mint a token — `POST /auth/login`
answers **HTTP 500** with `password authentication failed for user
"pgrst_authenticator"`, and PostgREST fails the same way because both connect as
that role. Nothing in the failure names a `.env`: the application reads its own
file without complaint and the database rejects the password it is handed.

Step 8 is the gate for exactly this, and it runs **last** so it reads the cluster
as the preceding steps left it. It proves the property from the outside — a real
login with the configured password, because a SCRAM verifier cannot be read back —
and its failure message names the divergence and the fix: re-run
`npm run db:seed` under the development environment, which re-syncs the cluster
from `.env`. Setting the two files to the same value is the durable fix; the
re-seed only repairs the cluster, it does not stop them drifting again.

In production there is no second file and so no such ambiguity: one
`AUTHENTICATOR_PASSWORD` in `backend/.env.production`, which both the seed and the
running stack read. The divergence is a development-only hazard, created by the
test mode the gate runs in.

---

## Production

### 1. Build both projects

```bash
cd backend && npm run build      # nest build  -> backend/dist/main.js
cd ../frontend && npm run build  # ng build   -> dist/frontend/{browser,server}
```

`ng build` defaults to the `production` configuration (budgets, output hashing,
no source maps). The SSR bundle lands at
`frontend/dist/frontend/server/server.mjs`; the browser bundle at
`frontend/dist/frontend/browser/`.

### 2. The production environment file

```bash
cd backend
cp .env.production.example .env.production
```

Then fill in **real** secrets. `PGRST_JWT_SECRET` must equal `JWT_SECRET`, or
the thin app throws at bootstrap. There is no development fallback: a missing
`backend/.env.production` aborts both `npm run prod` and `npm run start:prod`
with a message naming the file.

### 3. Boot

```bash
cd angular_v2
npm run prod
```

Same lifecycle discipline as `dev`: all three processes, per-process readiness
probes, a banner on success, and no orphans on exit. It additionally **refuses
to boot without build output** — both `backend/dist/main.js` and
`frontend/dist/frontend/server/server.mjs` must exist, and it says which one is
missing and which command produces it. It does not build for you.

`npm run prod` also forces `NODE_ENV=production` for the thin app, so the env
file is `backend/.env.production` and nothing else. To run only the thin app:

```bash
cd backend && npm run start:prod    # NODE_ENV=production node dist/main.js
```

PostgREST inherits **no** `PGRST_*` keys from your shell. The orchestrators
strip them and re-inject only the two from the env file, because an inherited
`PGRST_JWT_SECRET` silently overrides `postgrest.conf` and every request then
fails `PGRST301` while the config file looks correct.

---

## Serving the frontend

Three options. The honest framing first: **this template's content is
authenticated and row-scoped to the caller**, so it is not crawlable public
HTML, and the page a browser receives depends on who is holding the token. That
is what decides the default.

Note one detail of the current build, because both static options depend on it.
`app.routes.server.ts` marks `/login`, `/verify-email`, `/reset-password` and
`/verify-email-change` `RenderMode.Server` and everything else — `**` — 
`RenderMode.Client`, because the token lives in `localStorage` and a server
render of the authenticated area would answer a question it cannot. **No route is
`RenderMode.Prerender`**, so `ng build` writes **no `index.html`** — the browser
folder contains `index.csr.html` and no `prerendered-routes.json` at all. Option
**B** exists because of that file.

### A. Server-side rendering — the usual choice

```bash
cd frontend && npm run serve:ssr:frontend    # node dist/frontend/server/server.mjs
```

`SSR_PORT` selects the port, 4000 by default; `npm run prod` sets it in that
child's environment explicitly, from the same resolution the launcher uses for
its readiness probes. **Not** `PORT`: that key belongs to the thin app, and the
launcher strips it from this child's environment so one key cannot move two
listeners. The same server serves `dist/frontend/browser/` as static
assets, so you do not need Nginx to serve hashed bundles itself.

Pick this when the app is the product, which is the case here: every row a user
sees is filtered by their group membership inside the database, so the server
render and the API see the same scoped view, and the first paint is not a
loading spinner over an empty shell.

**Cost:** a resident Node process. See *Memory tuning*.

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # In SSR mode, the Node Express server (port 4000) serves HTML, static
    # assets from dist/frontend/browser, and proxies /api and /rest via api-proxy.ts.
    # The application itself sets the Content-Security-Policy header on HTML responses.
    # Do NOT duplicate the Content-Security-Policy header here (§2.4: one mechanism);
    # Nginx adds only transport headers meaningful at the TLS termination edge.
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

### B. Static hosting

Point a static server at `frontend/dist/frontend/browser`, with a fallback to
`index.html`. With no prerendered routes you must supply the CSR shell yourself —
the file on disk is `index.csr.html`:

```bash
cp frontend/dist/frontend/browser/index.csr.html \
   frontend/dist/frontend/browser/index.html
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /srv/angular_v2/frontend/dist/frontend/browser;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;   # Angular's client-side router
    }

    # The thin Nest app. /api is the prefix the bundle asks for; see
    # src/app/core/api/api-base-urls.ts. It is relative on purpose.
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # PostgREST. /rest, not /db — the prefix is in api-base-urls.ts and in
    # src/server/api-proxy.ts, and changing it in only one of the three is the
    # failure. It binds 127.0.0.1, so this proxy has to live on the same host.
    # PostgREST does no rate limiting of its own — do it here.
    location /rest/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        limit_req zone=api burst=20 nodelay;
    }

    # In static hosting, no Node SSR process runs, so Nginx is the server emitting
    # HTML and owns setting the Content-Security-Policy header.
    # The policy must permit 'unsafe-inline' for Angular component styles and Beasties
    # critical CSS, and 'unsafe-eval' for consent tag execution.
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

**The trade:** zero Node frontend footprint, but nothing is server-rendered. The
first paint is a shell, and there is no SSR of anything behind the token. Pick
it only if the frontend is genuinely a static shell in your fork.

### C. Prerendering

If a fork adds public routes that must be crawled — a marketing page, a public
status page — set those routes to `RenderMode.Prerender` in
`frontend/src/app/app.routes.server.ts`. `ng build` then writes a real
`index.html` per prerendered route, and you deploy it exactly as **B**, with no
per-route copy step.

**Not active today.** No entry in `app.routes.server.ts` is `RenderMode.Prerender`
— four are `Server`, the catch-all is `Client` — so this option produces nothing
until a forker changes it.

### Reverse proxy, whichever you pick

PostgREST listens on `127.0.0.1:3001` only, so the proxy must be on the same
host. All three processes are plain HTTP and expect a TLS terminator in front of
them.

**The two path prefixes are already decided, and they are the fork's only
freedom here:** `/api` for the thin app and `/rest` for PostgREST, both declared
in `frontend/src/app/core/api/api-base-urls.ts` and both mounted by
`frontend/src/server/api-proxy.ts` (SSR) and `frontend/proxy.conf.json`
(`ng serve`). **Keep them relative.** An absolute `http://localhost:3000` baked
into the bundle breaks every browser that is not the build machine, which is why
there is no frontend environment file to put one in — the three places that name
these prefixes name them as paths, and that is the whole mechanism.

### Host header validation and proxy headers (`NG_ALLOWED_HOSTS`, `NG_TRUST_PROXY_HEADERS`)

When you put the Angular SSR server behind a reverse proxy, visitor requests
arrive carrying the public hostname — `app.example.com`. By default, the server
refuses every such request with **HTTP 400 Bad Request** and an empty body:

```
ERROR: Bad Request ("https://app.example.com/").
URL with hostname "app.example.com" is not allowed.
```

Developers never see this locally because `frontend/angular.json` sets:

```json
"security": {
  "allowedHosts": ["localhost", "127.0.0.1"]
}
```

Local requests arrive at `localhost` or `127.0.0.1`, which are on that compiled
list. A public hostname is not.

#### Why the allowlist exists (SSRF and DNS rebinding)

The allowlist is not developer friction to be worked around: it is a core
Server-Side Request Forgery (SSRF) and DNS-rebinding protection built into
`@angular/ssr`. Because SSR executes on the server and renders markup or fetches
assets in response to incoming request headers, accepting arbitrary `Host` or
`X-Forwarded-Host` values lets an external attacker trick the server into
accessing internal loopback services or injecting malicious origins into rendered
content.

Do not "fix" this by deleting the security block from `angular.json` or trying to
disable host checks. The allowlist must stay; it simply needs to name the host the
application is reached on.

#### The two environment variables

Both variables come from `@angular/ssr` and are confirmed in
`node_modules/@angular/ssr`:

- `NG_ALLOWED_HOSTS` — comma-separated list of permitted hostnames. Read by
  `getAllowedHostsFromEnv()`.
- `NG_TRUST_PROXY_HEADERS` — comma-separated list of proxy headers to trust (such
  as `x-forwarded-proto,x-forwarded-host,x-forwarded-port`). Read by
  `getTrustProxyHeadersFromEnv()`.

In `frontend/src/server.ts`, the engine is instantiated with no options:

```typescript
const angularApp = new AngularNodeAppEngine();
```

With no options passed, `AngularNodeAppEngine` resolves `allowedHosts` as
`options?.allowedHosts ?? getAllowedHostsFromEnv()` and `trustProxyHeaders` as
`options?.trustProxyHeaders ?? getTrustProxyHeadersFromEnv()`. The environment
variables are read automatically at startup. **No code change is needed in
`server.ts`**, and you must not add one.

#### Why `NG_TRUST_PROXY_HEADERS` is needed

All three processes bind plain HTTP on loopback and expect a reverse proxy in
front of them to terminate TLS. Without `NG_TRUST_PROXY_HEADERS`, the Angular
server only sees the proxy's local HTTP connection and ignores
`X-Forwarded-Proto`. It cannot tell that the client arrived over HTTPS rather
than plain HTTP, which breaks anything in SSR that generates an absolute URL
(producing `http://` links instead of `https://`).

Setting `NG_TRUST_PROXY_HEADERS=x-forwarded-proto,x-forwarded-host,x-forwarded-port`
enables `@angular/ssr` to reconstruct the true incoming protocol and port.

#### Precedence: additive, and verified against the shipped source

`NG_ALLOWED_HOSTS` **adds to** the compiled `angular.json` list; it does not
replace it. From `@angular/ssr`'s `AngularAppEngine`:

```js
getAllowedHosts(options) {
  const allowedHosts = new Set([...(options?.allowedHosts ?? []), ...this.manifest.allowedHosts]);
  // ...
  return allowedHosts;
}
```

`options.allowedHosts` is what `NG_ALLOWED_HOSTS` populates, and
`this.manifest.allowedHosts` is `["localhost", "127.0.0.1"]` compiled from
`angular.json`. The result is a **union**, so with
`NG_ALLOWED_HOSTS=app.example.com` the effective allowlist is all three:

```
Set(3) { 'app.example.com', 'localhost', '127.0.0.1' }
```

This is worth stating because the replacement behaviour is real but belongs to
a different, **deprecated** engine: `CommonEngine` does
`new Set(getAllowedHostsFromEnv() ?? this.options?.allowedHosts ?? [])`, which
is a plain substitution. This template uses `AngularNodeAppEngine`, not
`CommonEngine`, so that path is not the one in play. Anyone who reads the
`CommonEngine` source and concludes the variable replaces the list is reading
code this application never executes.

Because the union holds, the production value needs to name only the production
hostname — listing loopback again is harmless but redundant:

```ini
NG_ALLOWED_HOSTS=app.example.com
NG_TRUST_PROXY_HEADERS=x-forwarded-proto,x-forwarded-host,x-forwarded-port
```

#### Where the variables must be written

This is genuinely counter-intuitive and must be stated plainly:

- The Angular SSR server has no `.env` loader of its own — Angular does not load
  an environment file.
- The stack launchers do: `backend/scripts/prod.mjs` (line 42) and
  `backend/scripts/dev.mjs` (line 70) each call `process.loadEnvFile(...)`, and
  then spawn the SSR server child with `ssrChildEnv(process.env, stackPorts)`
  (preserving `process.env`).
- Therefore, `NG_ALLOWED_HOSTS` and `NG_TRUST_PROXY_HEADERS` placed in
  **`backend/.env.production`** (loaded by `prod.mjs`) reach the SSR server.

This is a frontend concern living in the backend's environment file, and that is
why: it is the only environment file the SSR process inherits. Do not invent a
`frontend/.env` mechanism that does not exist.

#### Why Nginx `Host` rewriting does not solve it

By default, Nginx forwards the visitor's original `Host` header
(`proxy_set_header Host $host;`), so the SSR server sees `app.example.com` and
refuses with 400.

The tempting workaround — rewriting `Host` to loopback before proxying:

```nginx
# DO NOT DO THIS
proxy_set_header Host 127.0.0.1;
```

silently breaks every absolute URL the application generates. The password-reset
and email-verification links are the concrete examples: an email would be sent
containing a link like `http://127.0.0.1:4000/reset-password?token=...`, which
cannot work off-box.

The app must be told its real hostname via `NG_ALLOWED_HOSTS`, not tricked into
believing it is loopback.

---

## Memory tuning (`--max-old-space-size`)

V8 lets the heap climb well past what a small container has before it collects
aggressively, so on a constrained host cap it rather than waiting for a
`JavaScript heap out of memory` in production.

```bash
# Angular SSR server — 512 MB
node --max-old-space-size=512 dist/frontend/server/server.mjs

# Thin Nest app — 256 MB
NODE_ENV=production node --max-old-space-size=256 dist/main.js
```

Those are the exact entry points the npm scripts use, so the flag goes in front
of the same paths. Alternatively set `NODE_OPTIONS=--max-old-space-size=…` in
the unit that supervises the process, which covers both without changing any
command. Postgres gets its own tuning; it is a separate process.

Measure under your real load before choosing a ceiling — the right number for
this app is set by the routes you add, not by the template.

---

## Environment configuration

The full key set, and where the values come from:

| Key | Required | Meaning |
|---|---|---|
| `JWT_SECRET` | **yes** | Access/refresh token signing. Minimum **32 characters**; bootstrap throws if shorter. **No default, ever.** |
| `PGRST_JWT_SECRET` | **yes** | Must equal `JWT_SECRET`. Read by the PostgREST process, not the thin app. |
| — | — | **There is no `PGRST_DB_URI`.** PostgREST's connection is composed by `scripts/dev.mjs` / `scripts/prod.mjs` from `DB_HOST`, `DB_PORT`, `DB_NAME` and `AUTHENTICATOR_PASSWORD`, always as `pgrst_authenticator`. A committed file must not carry a credential, and two copies of one password drift apart; the earlier hand-written key pointed at the owner role, which owns every table — exempt from its own RLS, silently — and cannot `SET ROLE` at all, so every request failed with `42501 permission denied to set role "app_anon"` while `GET /` still answered 200. |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | **yes** | The thin app's and the migration runner's connection, as the owner role. No defaults: a guess writes into whatever database answers. `DB_HOST`, `DB_PORT` and `DB_NAME` are also half of PostgREST's composed URI; `DB_USER`/`DB_PASSWORD` are deliberately **not**. |
| `AUTHENTICATOR_PASSWORD` | **yes** | `pgrst_authenticator`'s `LOGIN` password — used by the login path **and** by PostgREST, which is why it is the single source for both. Must match what was set out of band. |
| `PORT` | no (3000) | Thin app listen port. **This key is the thin app's only** — the SSR server reads `SSR_PORT`. |
| `SSR_PORT` | no (4000) | Angular SSR server listen port. `npm run dev` / `npm run prod` set it in that child's environment from their own resolution. |
| — | — | **The PostgREST port is not an env key.** It is `server-port` in `postgrest.conf`, and the launchers refuse to start when it disagrees with `POSTGREST_URL`. |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | no (900) | Access token lifetime. |
| `JWT_REFRESH_TOKEN_TTL_SECONDS` | no (2592000) | Refresh token lifetime, 30 days. |
| `SECURITY_IP_ALLOWLIST` | no (empty) | Comma-separated addresses, normalised before comparison. |
| `SECURITY_FAILURE_WINDOW_SECONDS` | no (600) | Brute-force counter window. |
| `SECURITY_DELAY_SCHEDULE_SECONDS` | no (`0,1,4,16`) | Progressive delay per counted failure. |
| `SECURITY_DELAY_CAP_SECONDS` | no (30) | Ceiling on any scheduled entry. |
| `SECURITY_BLOCK_THRESHOLD` | no (5) | Failures before a refusal, before any credential check. |
| `SECURITY_CAPTCHA_THRESHOLD` | no (3) | Failures against ONE ACCOUNT before the next sign-in must carry a challenge. Zero is refused at boot: a threshold of zero would challenge every sign-in. |
| `SECURITY_CAPTCHA_TTL_SECONDS` | no (300) | How long a challenge stays redeemable. Zero is refused at boot. |
| `APP_BASE_URL` | **yes, in every mode** | The application's public origin. Every email template carries an absolute link, so there is no default to fall back to. Must be `https:` in production. |
| `NG_ALLOWED_HOSTS` | **yes, in production** | Comma-separated allowed hostnames for Angular SSR (e.g. `localhost,127.0.0.1,app.example.com`). Configured in `backend/.env.production` (SSR inherits it via `prod.mjs`). **Adds to** the `angular.json` allowlist rather than replacing it — see below. |
| `NG_TRUST_PROXY_HEADERS` | **yes, behind a reverse proxy** | Comma-separated proxy headers Angular SSR trusts (`x-forwarded-proto,x-forwarded-host,x-forwarded-port`). Configured in `backend/.env.production`. Allows SSR to detect HTTPS behind TLS termination. |
| `CSP_ALLOWED_ORIGINS` | no (empty) | Comma- or space-separated allowed origins added to `script-src`, `connect-src`, `img-src`, and `frame-src` for third-party consent tags (e.g. `https://www.googletagmanager.com https://*.google-analytics.com`). Inherited by SSR via launcher child env. |
| `CONTENT_SECURITY_POLICY` | no (assembled) | Complete verbatim override for the Content-Security-Policy header. Directive-specific additions also supported: `CSP_SCRIPT_SRC`, `CSP_CONNECT_SRC`, `CSP_STYLE_SRC`, `CSP_FONT_SRC`, `CSP_IMG_SRC`, `CSP_FRAME_SRC`. |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_USER` `EMAIL_PASSWORD` `EMAIL_FROM` | **yes, in production** | The SMTP submission endpoint. Required with no defaults and **not read at all** outside production, so no mode needs a credential it cannot use. |
| `EMAIL_SECURE` | no (from the port) | Implicit TLS. Defaults to `true` on port 465, `false` otherwise (STARTTLS on 587). |
| `APP_NAME` | no (the `APP_BASE_URL` hostname) | The product name used in message subjects. |

A missing required key stops the process with **one** error naming **every**
absent key, so a misconfigured deployment is one edit rather than one variable
per restart. Templates to copy:

- `backend/.env.example` and `backend/.env.development.example` → `.env`
- `backend/.env.test.example` → `.env.test`
- `backend/.env.production.example` → `.env.production`

Only `*.example` files are committed. `.env*` files are git-ignored, and no
database file ever belongs in the repository.

---

## Pre-deployment checklist

- [ ] `npm run verify` passes end to end, **including step 7/8, the RLS proof.**
      Every other step stays green with row-level security disabled, so a green
      run without step 7 is not evidence of anything.
- [ ] `backend/.env.production` exists and is filled with **real** secrets —
      a fresh random `JWT_SECRET` of at least 32 characters, the production
      database coordinates, and no value copied from `backend/.env`.
- [ ] `PGRST_JWT_SECRET` equals `JWT_SECRET` in the same file.
- [ ] The seeded admin password has been rotated:
      `SEED_ADMIN_PASSWORD='…' npm run db:seed` against the production database.
- [ ] `pgrst_authenticator`'s `LOGIN` password has been set **out of band** and
      matches `AUTHENTICATOR_PASSWORD` in `backend/.env.production`. The seed
      writes that value and has no literal fallback, so the two cannot drift;
      confirm it rather than assume it:
      `PGPASSWORD='<AUTHENTICATOR_PASSWORD>' psql -h <DB_HOST> -U pgrst_authenticator -d <DB_NAME> -tAc 'select 1'`.
- [ ] `postgrest.conf` still reads `jwt-role-claim-key = ".role"`. It must be
      the JSPath `.role`; the bare `role` makes PostgREST 16.4 **panic on boot**,
      and `$.role` panics too. Do not "modernise" it.
- [ ] The escalation boundary holds on the production cluster:
      `SELECT rolname FROM pg_auth_members JOIN pg_roles …` confirms
      `pgrst_authenticator` reaches exactly `app_admin, app_anon, app_member`
      and nothing else. `backend/database/bootstrap/001_roles.sql` asserts this
      itself on every run — read the output rather than assuming it ran.
- [ ] Every file in `backend/database/migrations/` is applied: the `migrations`
      table names each one. Read the directory and compare — do not check a count
      written here, because a stale count is a green tick on an unfinished
      migration.
- [ ] `openapi.json` and the generated frontend types are current for the schema
      you deployed (`cd frontend && npm run generate:client`).
- [ ] The reverse proxy sits in front of all three processes, terminates TLS,
      and rate-limits the PostgREST path — PostgREST does not rate-limit itself.
- [ ] Memory ceilings set for the SSR server and the thin app if the host is
      constrained.
- [ ] Email: the `EMAIL_*` keys below are set to **real** provider credentials
      and the SMTP endpoint answers `EHLO` from this host. A production boot
      with any of them missing throws at bootstrap naming the key.
- [ ] SPF, DKIM and DMARC published on the sending domain and verified with
      `dig` — see §Transactional email in production.
- [ ] `NG_ALLOWED_HOSTS` and `NG_TRUST_PROXY_HEADERS` configured in
      `backend/.env.production` naming `localhost,127.0.0.1` alongside the
      production hostname, so Angular SSR accepts public traffic and detects TLS
      from the reverse proxy.

---

## Not yet present

Named here rather than written into the steps above as if they existed. Each one
names its reason, because an absence without a reason reads as an oversight
rather than as a decision.

**This list is machine-checked, and it fails when it stops being true.**
`backend/test/unit/docs/deployment-gaps.spec.ts` re-derives each absence from the
tree. It reads this document for exactly one thing — *which entries exist*, via a
`<!-- gap:… -->` marker on each bullet below — and never to decide whether an
absence holds, because a guard that compared the document against itself would be
a tautology. Building one of these turns `verify` red, and the fix is to delete
the bullet rather than to relax the check. So does adding a bullet with no marker
or no matching check: a new gap cannot be documented without deciding how it is
watched. And so does removing a bullet without removing its check, because a check
with nothing left to assert is not a control.

Every top-level `- ` bullet in this section is therefore an entry, and each must
carry a marker. The checks differ in kind and the test says which, per entry.
*File-absence* entries — "no CI", "no container config" — are near-exhaustive,
because the thing is a file with a conventional name. *Behaviour-absence* entries
— "no geo resolver" — are keyword gates over source files that exist, so each one
prints its blind spot in the suite's log. Read that line before trusting one.

- **No script creates the owner role or the database.** Step 1 above is two
  `psql` commands run as a superuser, because `CREATE ROLE` needs `CREATEROLE`,
  which is cluster-scoped, and the escalation boundary needs `ADMIN OPTION` — so
  neither statement *can* be a migration or a seeded step. There is no
  `npm run db:create`. <!-- gap:db-create -->

- **No geo-IP resolution, and therefore no geo-blocking.** `users.geo_source` /
  `geo_accuracy_km` / `geo_updated_at` and `ip_reputation.geo_location` are
  columns; `shared/geo-place.ts` renders them. **Nothing derives a place from an
  address**, so `geo_source` records where a value came from rather than a lookup
  this application performed, and `ip_reputation.geo_location` stays `NULL`: the
  telemetry producer does not name the column at all, so it cannot fill it.

  **WHY A COUNTRY CANNOT BE DERIVED HERE.** A country needs a DATA SOURCE, and
  this template has none of the three:

  - a **local GeoIP database** (`GeoLite2-City.mmdb` and its relatives) is a large
    binary blob that cannot be committed to a template repository, needs a
    download step, a licence and an update cadence — and no reader library is a
    dependency here either, so there is nothing that could open one;
  - a **hosted geo-IP API** is a third-party credential, which §0 forbids ("no
    third-party API keys"), and no `.env*` file in this repository carries one;
  - a **reverse proxy that already knows the country** is not in this tree either
    (see the `container` entry below), and a country header read without a
    trusted proxy in front of it is a control the caller disables by sending the
    header.

  **So there is no geo-blocking key, and there must not be one.** §B6: "a
  configuration key that nothing reads is a lie in the configuration file." A key
  consumed by a stub would be worse than no key at all, because §B6 also says an
  `isAllowlisted`-style flag "must be consumed by a real decision, or the check
  is deleted" — and a stub decision is not a decision.

  **THE INTEGRATION POINT, for a fork that has a source.** The decision belongs at
  the edge, in the reverse proxy, which already sees the connection: a proxy that
  can resolve a country can refuse the request there, before this process spends
  anything on it. If the decision is to live in the application instead, the place
  to add it is `src/security/` beside the producer that owns `ip_reputation`, and
  it must be a real decision on a real value — a resolver that fills
  `geo_location` and a check that reads it, or neither.
  <!-- gap:geo-resolver -->

- **No strict CSP.** The SSR application sets a `Content-Security-Policy`
  header (`frontend/src/server.ts`), but it permits inline scripts and styles
  (`'unsafe-inline'`) and dynamic script evaluation (`'unsafe-eval'`). A strict
  policy that forbids inline scripts cannot satisfy the consent tag injector,
  which executes vendor snippets verbatim from `consent_tags.snippet`, or
  Angular's critical CSS inlining (`@angular/ssr` Beasties). The tag mechanism
  and a strict CSP are in fundamental tension: a policy strict enough to prevent
  XSS breaks arbitrary third-party tag injection. The policy is configurable via
  `CSP_ALLOWED_ORIGINS` and directive-specific keys.
  [`security.md`](./security.md) §Transport headers. <!-- gap:strict-csp -->

- **No cookie is set or read, and no tracker is loaded.** The consent control
  shipped — a universal widget on public pages, a settings surface inside the
  app — and a decision is stored, in the browser for an anonymous visitor and in
  `consent_records` for a signed-in one. What is still absent is anything the
  consent would have to *gate*: this tree sets no cookie, reads no cookie, and
  loads no tracker. The session lives in `localStorage`, which GDPR does not
  classify as a cookie and which the session document treats as a weaker store on
  purpose.

  So the widget has nothing to switch on until a fork adds a tag, and **the
  obligation attaches at that moment**: the first tracker or non-essential cookie
  a fork introduces is the thing GDPR and UK GDPR consent applies to, and the tag
  machinery — `consent_tags`, `consent_page_groups`, and the generic injector that
  runs a vendor's snippet verbatim — is what gates it. The substantive privacy
  work in v2 is elsewhere and is real: erasure, retention windows, the purge
  queue, tombstones and the statutory compliance record. See
  [`security.md`](./security.md).
  <!-- gap:cookies -->

- **No container, systemd, or process-supervisor configuration**, and no
  orchestrator that survives a reboot. `npm run prod` is a foreground process;
  putting it under a supervisor is the fork's work. No `Dockerfile`, no
  `compose.yml`, no `*.service`, no `Procfile`, no `fly.toml`, no `k8s/` — and
  that is deliberate rather than merely unfinished: a deployment recipe nobody
  reviews in this repository is a deployment recipe that describes an
  architecture this repository no longer has.
  <!-- gap:container -->

- **No `swagger2openapi` regeneration script.** PostgREST 16 serves Swagger 2.0
  and `openapi-typescript` targets OpenAPI 3, so the conversion is a required
  step. It is documented in [`README.md`](../README.md) and performed by hand;
  `openapi.json` is committed, and `backend/test/smoke/openapi-contract.smoke-spec.ts`
  gates that committed file against the live catalog, so a spec that drifts is a
  red run even though nothing regenerates it.
  <!-- gap:openapi-regen -->

- **No CI.** The template has no pipeline by design; `npm run verify` is the gate
  a fork inherits. See [`development.md` §Why there is no CI](./development.md#why-there-is-no-ci).
  <!-- gap:ci -->
---

## Transactional email in production

`backend/src/email/` sends the two transactional messages the product needs:
address verification and password reset. The architecture and the reasoning are
in [`adr.md`](./adr.md) ADR-0024; this section is the operator's half.

### The transport is not configurable

There is deliberately **no** `EMAIL_TRANSPORT`, `EMAIL_PROVIDER` or
`EMAIL_ENABLED` key. The transport follows `NODE_ENV`, which
`npm run prod` and `npm run start:prod` set to `production`:

| mode | transport | what it does |
|---|---|---|
| `development` | `streamTransport` | writes the rendered message to the Nest `Logger`. Nothing leaves the machine. |
| `test` | `jsonTransport` | serialises and returns the message; nothing is sent. |
| `production` | `smtpTransport` | talks to your provider. |

So there is no way to configure the thing that would keep mail from being sent,
and no way to point a production process at a local sink. If you want to see
what a message looks like in development, run it in development.

### Required keys

All five are **required in production with no defaults**, and bootstrap throws
`EnvironmentError` naming every one that is missing before the process serves
anything. They are not read at all in development or test, so there is no
credential to invent for a transport that cannot use one.

```ini
# backend/.env.production

# Required in EVERY mode — the application's public origin. Every template
# carries an absolute link, so there is no default to fall back to. Must be
# https in production.
APP_BASE_URL=https://app.example.com

# Required in production only. Submission endpoint, not an inbox address.
EMAIL_HOST=smtp.eu-west-1.amazonaws.com     # SES; smtp.sendgrid.net; smtp.mailgun.org
EMAIL_PORT=587                              # 465 for implicit TLS
EMAIL_USER=AKIA...                          # SES: the SMTP username, not the API key
EMAIL_PASSWORD=...                          # SES: the SMTP password, not the API key
EMAIL_FROM=Acme <no-reply@app.example.com>  # must match a verified identity

# Optional. Defaults to true on port 465 (implicit TLS) and false elsewhere,
# which means STARTTLS on 587. Set it explicitly when your provider is unusual.
EMAIL_SECURE=false

# Optional. Defaults to the hostname of APP_BASE_URL, so no mode invents a product
# name. Set it to what users actually call the thing.
APP_NAME=Acme
```

`APP_BASE_URL` is required in development too. There is no localhost default —
the previous tree's `http://localhost:4200` is exactly the value that survives
into a real deployment and mails every user a link to the developer's own
machine. It must be `https:` in production: a verification or reset token
delivered over plain HTTP is readable by every hop between you and the user.

Outside production, `EMAIL_FROM` defaults to `no-reply@<hostname of APP_BASE_URL>`,
so a development message still has a sender and no mode invents a domain.

### Choosing a provider

The application speaks SMTP and knows nothing about any vendor's API. So the
only thing you are choosing is *an SMTP endpoint and a credential*, and any of
these works without a code change:

| Provider | `EMAIL_HOST` | Notes |
|---|---|---|
| Amazon SES | `smtp.<region>.amazonaws.com` | Cheapest at volume. `EMAIL_USER` is the **SMTP** username / `EMAIL_PASSWORD` the **SMTP** password from "Generate SMTP credentials" — *not* the API key. SES is also sandboxed by default: a new account can only send **to verified addresses**, so production verification and reset mail silently never arrives until the account leaves the sandbox. |
| SendGrid | `smtp.sendgrid.net` | API key as the password, `apikey` as the user. Free tier is 100/day. |
| Mailgun | `smtp.mailgun.org` (EU: `smtp.eu.mailgun.org`) | "SMTP password", not the account API key. |
| Postmark | `smtp.postmarkapp.com` | Strong per-message metadata; a good fit for transactional-only sending. |
| A self-hosted relay | your host | Fine if you already run one. You then own the reputation, the queue and the retry policy. |

What every one of them requires before a single message is accepted is the same
thing: **you must own the sending domain and prove it.** That is the next
section.

### Deliverability checklist

**SPF, DKIM and DMARC are DNS `TXT` records.** Not application settings, not
anything the application can assert or verify at runtime — they are published by
whoever controls the domain's DNS zone. The application can only be configured
to send *from* a domain that already has them. A deployment that skips this does
not error; its mail is quietly junked or spam-foldered, which is why it is a
checklist item rather than a feature.

**SPF** — which hosts may send as this domain. **Publish exactly one SPF record**
(an SPF record with two `include:` mechanisms is a permanent error), and keep it
under 10 DNS lookups.

```dns
app.example.com.  TXT  "v=spf1 include:amazonses.com ~all"
```

`~all` is "soft fail": mark as spam rather than reject. Use `-all` only once
every legitimate sender is listed. Mailgun uses
`include:mailgun.org`, SendGrid `include:sendgrid.net`.

**DKIM** — a cryptographic signature the receiving server verifies, and the only
one of the three that survives forwarding. **Every provider publishes its own
selector**, so do not invent one:

```dns
ses1._domainkey.app.example.com.  TXT  "k=rsa;p=MIGfMA0GCSq…"
ses2._domainkey.app.example.com.  TXT  "k=rsa;p=MIIBIjANBg…"
```

Ask the provider for the exact record — SES shows it under "Verify a domain",
SendGrid under "Sender Authentication", Mailgun under "Sending → Domains".

**DMARC** — tells receivers what to do when SPF and DKIM both fail, and is what
makes the other two enforceable. Start at `p=none` with a report address, watch
for a few days, then move to `quarantine` and finally `reject`.

```dns
_dmarc.app.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@reports.example.com; fo=1"
```

`rua=` is aggregate XML reports; `ruf=` is per-message forensics.

**Verify from the deployment host, not from a laptop.** DNS is cached, so check
after the TTL expires, and check from wherever the mail will actually be sent:

```bash
dig +short TXT app.example.com               | grep 'v=spf1'
dig +short TXT ses1._domainkey.app.example.com
dig +short TXT _dmarc.app.example.com         | grep 'v=DMARC1'
```

Three answers, three records, no error text. Then send a real message and read
the provider's own verdict:

- **SES** — the message id appears under *Sending &gt; reputation*; reputation
  below 95% starts getting deliveries delayed or refused. Check the identity is
  verified: `aws ses get-identity-verification-attributes --identities app.example.com`.
- **SendGrid / Mailgun / Postmark** — their dashboards show SPF and DKIM alignment
  per message, and a *failing* alignment is the usual reason a message lands in
  spam while your own inbox test "worked".
- **Any provider** — send to a seed address on a domain you do not control
  (never to your own `app.example.com`, which passes SPF trivially) and read the
  full `Authentication-Results:` header. You want
  `spf=pass`, `dkim=pass`, `dmarc=pass`.

Also: the `From:` address's domain must be one you have verified, and it should
match the domain the user typed. `From: no-reply@app.example.com` with
`APP_BASE_URL=https://app.example.com` is the shape you want.

### Why a mail-catch sink is not a production transport

Mailpit, MailHog, Mailcatcher and friends bind a local port, accept everything,
and write it to a database or a web UI. They are the right answer for
development and for the `jsonTransport` assertions in this repository's own test
suite. They are **not** a production transport, for reasons that are about
delivery and not about features:

- **Nothing leaves the process.** A verification or password-reset link that
  exists only inside a container's memory was never delivered to anybody, and
  the user is told it was.
- **There is no reputation to speak of, so nothing is deliverable.** Receiving
  servers judge a domain by who has sent from it. A sink has no sending history,
  so when you later point `EMAIL_HOST` at a real relay, the new IP is judged as
  a stranger.
- **It gives you a false green.** The application reports success — correctly,
  from its own point of view — so a sink configured in production looks like a
  working system right up to the point a real user clicks a link that was never
  delivered. `EmailService` throws on a transport failure precisely so that this
  state cannot present as success; a sink removes the failure, not the problem.

The one thing a sink is genuinely for here is confirming in development that the
two templates render. That needs no sink at all: the development transport
prints the exact MIME to your terminal, `NODE_ENV=test` serialises it for the
suite, and `npm run verify` builds the project and renders both templates from
`dist/` so a build that stopped shipping them fails the gate.
