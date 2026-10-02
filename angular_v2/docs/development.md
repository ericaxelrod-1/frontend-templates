# Development

Setup and verification for `angular_v2/`. Assumes a locally-installed
PostgreSQL instance — no container runtime.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `^22.22.3 \|\| ^24.15.0 \|\| >=26` | Angular 22's floor. `frontend/.npmrc` sets `engine-strict=true`, so a forker hits this at install rather than at build. Nest 12 also requires ≥ 20.19 — the 21.x line is unsupported |
| TypeScript | 6.0.x | pinned by Angular 22. See the codegen note below |
| PostgreSQL | **15 or later** | verified on 15.19; 16/17 also fine. `security_invoker` views need 15+, though this template creates none |

```bash
node --version
psql -h localhost -U postgres -c 'select version();'
```

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

# Single concern
npm test -- rls
```

Never point tests at a developer's working data. Each integration suite creates and
drops its own schema.

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
| `verify` fails at the smoke step | Postgres unreachable or migrations not applied. |
| Prerender throws `ReferenceError: localStorage` | A browser global on a server-executed path. Guard it or remove it. |
| Frontend types out of sync | Run `npm run generate:client`. |
| RLS test returns zero rows unexpectedly | Check the `SET LOCAL` identity is set and the policy's `USING` clause. |