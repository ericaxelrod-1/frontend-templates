# GEMINI.md

This project uses **`@AGENTS.md`** — a single shared rule file for every agent
(Kilo, Cursor, Gemini, Copilot, Claude Code).

Read it in full before making any change. It is the authoritative guide and
contains all project rules: backend (NestJS/Postgres/RLS/OpenAPI), frontend
(Angular 18 standalone/signals/OnPush), enforcement requirements, and the
`npm run verify` gate.

**Do not duplicate rules into this file.** If a rule needs to change, change it
in `AGENTS.md` only. A second copy is a second thing to forget to update, and
rule drift is the failure mode this file exists to prevent.

## Gemini-specific notes

- The project root for commands is `angular/backend/` or `angular/frontend/`.
  There is no root `package.json`.
- The backend uses the **Fastify** adapter. Do not import from `express`; use
  `FastifyRequest`/`FastifyReply` and inject `DOCUMENT` rather than touching
  `document`.
- Prefer `npm run <script>` over raw `npx`. The package scripts carry the
  required `ts-node`/`tsconfig-paths` flags.
- When asked to "verify" or "check my work", run `npm run verify` and report the
  actual output. Never infer success from having read the code.
- This repo is a **template to be forked**, not a running application. Judge a
  change by whether a new developer gets a correct starting point, not by
  whether it serves production traffic.