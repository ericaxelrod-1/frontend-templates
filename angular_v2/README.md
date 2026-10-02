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
| **Enforcement in the database** | Row-level security via `CREATE POLICY`. A forgotten decorator cannot bypass it. |
| **A real gate** | `npm run verify` — typecheck, lint, test, smoke. It fails loudly. |
| **No mocks, no stubs** | A function is fully implemented or it does not exist. |

---

## Requirements

| | Version |
|---|---|
| Node.js | ≥ 22.12 |
| TypeScript | ≥ 5.9 |
| PostgreSQL | 16 or 17 — local instance, **no Docker** |

---

## Setup

```bash
# 1. install
cd backend && npm install
cd ../frontend && npm install

# 2. configure
cd ../backend && cp .env.example .env     # set JWT_SECRET — the app refuses to boot without it

# 3. database
npm run migration:run
npm run db:seed                            # prints the seeded admin credentials

# 4. client
cd ../frontend && npm run generate:client

# 5. run
npm run dev                                # SSR on http://localhost:4000
```

Full detail: [`docs/development.md`](docs/development.md).

---

## Verify

```bash
npm run verify
```

Typecheck → lint → unit tests → integration tests → smoke against a live database.
**A change is not complete until this passes.**

Never weaken a lint rule or delete a test to make it green. Fix the code.

---

## Layout

```
angular_v2/
├── AGENTS.md            rules — single source of truth for every agent
├── GEMINI.md            imports AGENTS.md
├── openapi.json         generated contract, committed
└── docs/
    ├── rebase.md        migration scope + full file inventory
    ├── adr.md           21 decision records
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