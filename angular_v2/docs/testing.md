# Testing

What must be tested, what counts as a test, and how tests run. Rationale in
[`adr.md`](./adr.md) ADR-0008.

---

## The rule

> A test that cannot fail is not a test, and is worse than no test.

The previous repository had 1,761 lines across 14 `test-*.ts` files and **zero
`expect()` calls**. They printed `✅ BLOCKED (correct)` or
`❌ NOT BLOCKED (wrong!)` to a log file, caught every exception without
re-throwing, and always exited `0`. Jest's `testRegex` could not match them, ten
had no npm entry point, and `nest-cli.json` excluded them from compilation so they
were never type-checked either.

One of them explicitly created "a test module without database dependencies" and
mocked the service under test. It could not have detected a single production bug —
including the guard-ordering defect that disabled the entire feature it claimed to
verify.

---

## What must be tested

| Subject | Requirement |
|---|---|
| **Every RLS policy** | Permitted case returns rows. Denied case returns none. The denied case is proven for each access path. |
| **Auth flows** | Login, refresh rotation, logout invalidation, password reset |
| **Security controls** | The six in [`security.md`](./security.md) — each currently fails |
| **Every service** | Unit tests with real assertions |
| **Every component with logic** | Spec renders the template, so template errors surface |
| **Every DTO / contract** | Generated — the compiler checks shape |

### Never tested against mocks of the database

Tests run against a real PostgreSQL instance — a dedicated test database or a
throwaway schema per suite. Never against a developer's working data.

Mocks of the database hide schema and policy bugs, which is the entire class of
defect RLS is supposed to prevent. `AGENTS.md` §2.2 forbids an in-memory stand-in
for a real integration; if Postgres is unavailable the test **fails or is skipped
explicitly**, never silently replaced.

---

## Six security tests

These are the proof that the security module is wired rather than decorative. All
six fail against the old implementation:

1. **A wrong password creates a `login_attempt` row with `status: 'failed'`.**
   Catches the guard-ordering bug.
2. **Five failures from one IP make `isBlocked()` return `true`.**
3. **A blocked IP is rejected before credentials are validated.** Assert the
   rejection happens in the guard, not the handler.
4. **`::ffff:x.x.x.x` and `x.x.x.x` share a counter.** Catches the normalisation
   bypass.
5. **Four failures across four IPs for one email throttle that account.** Proves
   per-account counting is independent of IP.
6. **A blocked, allowlisted IP is neither blocked nor counted.**

Plus one per RLS policy, permitted and denied.

And four for the three-axis authorization model (ADR-0023):

1. **Scope** — an `app_member` token for site A returns only site A rows; a token
   for site B returns only site B rows.
2. **Operation** — `app_member` may `SELECT` and `INSERT` but `UPDATE` and
   `DELETE` are refused by grants, not by application code.
3. **Vocabulary** — no DB role is named after a capability role; no policy or grant
   mentions `ic` or `site_manager`.
4. **Separation** — no policy or guard filters by scope *and* capability together.

---

## Running

```bash
npm test                # unit
npm run test:e2e        # integration, throwaway schema per suite
npm test -- rls         # a single concern
npm run verify          # the gate: typecheck, lint, test, smoke
```

`verify` fails loudly when Postgres is unreachable. It never skips silently.

---

## Standards

- **Assert.** No assertion-free tests, no `expect.assertions`-free smoke checks, no
  tests that pass when the implementation is deleted.
- **No `any`** in specs, same as production code.
- **Test behaviour, not implementation.** A spec that fails when you rename a
  private field is testing the wrong thing.
- **No test targets a non-existent API.** If a spec and an implementation
  disagree, resolve it — do not leave a false green. A spec for a removed service
  is worse than no spec, because it reports coverage that does not exist.
- **Component specs render the template.** Otherwise template errors surface only
  in the browser.
- **Fixtures and mocks live only in `*.spec.ts`.** Never in application code.

---

## No mocks in application code

Reiteration because it is the most common way work gets falsely reported complete:

- A mock service must never exist in `src/` outside `*.spec.ts`.
- Never register a fake in the DI container.
- Never create a parallel fake of something that already exists.
- Never bypass a real integration to save time.
- **Never declare a task complete while a mock is in the tree.**

> A mock is not a placeholder for work — it is a claim that the work is done. If a
> real service cannot be written yet, the consuming code does not get written
> either. A truthful "this needs X" is a valid outcome; a mock plus a success
> message is a lie.