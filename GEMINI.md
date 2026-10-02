# GEMINI.md

This project uses **`@angular_v2/AGENTS.md`** — a single shared rule file for every
agent (Kilo, Cursor, Gemini, Copilot, Claude Code).

Read it in full before making any change. It is the authoritative guide and
contains all project rules: backend (PostgREST/Postgres/RLS), the thin Nest app,
frontend (Angular 22, standalone/signals/OnPush/zoneless), enforcement
requirements, and the `npm run verify` gate.

> The repo root also contains `@AGENTS.md`, which describes the **older**
> `angular/` tree (Angular 18, NestJS API over TypeORM, SQLite). It is kept only
> as a historical reference. **Do not follow it for new work.** The plan is in
> `angular_v2/docs/rebase.md`.

**Do not duplicate rules into this file.** If a rule needs to change, change it
in `AGENTS.md` only. A second copy is a second thing to forget to update, and
rule drift is the failure mode this file exists to prevent.

## Gemini-specific notes

- Work inside `angular_v2/` — it holds the target tree. `angular/` is the old
  implementation, kept for reference only; do not modify it.
- There is no root `package.json`. Commands run from `angular_v2/backend/` or
  `angular_v2/frontend/`.
- The thin Nest app uses the **Fastify** adapter. Do not import from `express`;
  use `FastifyRequest`/`FastifyReply` and inject `DOCUMENT` rather than touching
  `document`.
- **PostgREST is the API layer.** Do not add a Nest controller for anything
  expressible as CRUD over a table. There is no ORM — no TypeORM, no Sequelize,
  no Prisma.
- Prefer `npm run <script>` over raw `npx`. The package scripts carry the
  required `ts-node`/`tsconfig-paths` flags.
- When asked to "verify" or "check my work", run `npm run verify` and report the
  actual output. Never infer success from having read the code.
- This repo is a **template to be forked**, not a running application. Judge a
  change by whether a new developer gets a correct starting point, not by
  whether it serves production traffic.
- There is **no Docker and no container runtime**. Postgres runs as a local
  instance.