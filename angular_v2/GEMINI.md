# GEMINI.md

This project uses **`@AGENTS.md`** — the single shared rule file for every agent
(Kilo, Cursor, Gemini, Copilot, Claude Code).

Read it in full before making any change. It is the authoritative guide: PostgREST
and Postgres RLS, the thin Nest app, Angular 22 (standalone, signals, OnPush,
zoneless), the enforced ESLint baseline, and the `npm run verify` gate.

**Do not duplicate rules into this file.** If a rule needs to change, change it
in `AGENTS.md` only. A second copy is a second thing to forget to update, and
rule drift is the failure mode this file exists to prevent.

## Project layout

```
backend/     NestJS 12 thin app + pg.  No ORM.
frontend/    Angular 22, standalone, SSR, signals
docs/        rebase.md (the build plan), adr.md (23 decisions), and the rest
```

- **There is no root `package.json`.** Commands run from `backend/` or `frontend/`.
- `../angular/` is the **old** implementation, kept for reference only. Do not
  modify it, and do not follow its conventions.
- **`npm run verify` at `backend/` is the gate** — typecheck, lint, unit,
  integration, **row-level security proof**, database smoke. It fails loudly when
  Postgres is unreachable. The RLS proof is step 7 of 8 and is the only step that
  can see a policy regression; everything before it stays green with every policy
  dropped.

## Things that will bite you

- **PostgREST is the API layer.** Do not add a Nest controller for anything
  expressible as CRUD over a table. There is no ORM — no TypeORM, Sequelize or
  Prisma — so application code cannot issue SQL at all.
- **RLS is bypassed for the table owner.** Migrations run as an owner role that
  never serves requests; request roles own nothing. Every protected data table has
  `FORCE ROW LEVEL SECURITY` — **except the site-tree table, which must NOT be
  `FORCE`d.** Its hierarchy helper is `SECURITY DEFINER` and reads that table, so
  `FORCE` puts the owner inside the function back under the policy that called it:
  every query dies with `stack depth limit exceeded`. Adding `FORCE` there
  re-introduces a total outage that passes a code review. See `AGENTS.md` B2.
- **There are two role vocabularies.** `app_anon` / `app_member` / `app_admin` are
  database roles. `ic` / `site_manager` / `admin` are capability roles. An `ic`
  and a `site_manager` are both `app_member`. Never create a database role named
  after a capability.
- **One naming convention: `snake_case`** in columns, on the wire, and in
  generated types. No views, no runtime key transform.
- **Tests run against real Postgres.** A test that passes when the database is
  unreachable is a broken test, not a passing one.
- **Docker is not used.** A local PostgreSQL instance, no container runtime.
- This is a **template to be forked**, not a running application. Judge a change
  by whether a new developer gets a correct starting point.