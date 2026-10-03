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

And these for the three-axis authorization model (ADR-0023) — the first is the
one that was found **after** the docs claimed it was handled:

1. **Escalation.** A validly-signed token whose `role` claim names a table-owning
   role must be refused. Then assert the row count is unchanged. This is the
   highest-severity control in the project: untested, that token read every row
   and its `DELETE` removed one.
2. **Scope** — an `app_member` token for site A returns only site A rows; a token
   for site B returns only site B.
3. **Operation** — `app_member` may `SELECT` and `INSERT` but `UPDATE` and
   `DELETE` are refused by grants, not by application code.
4. **Vocabulary** — capability lives in a table, not in roles; no DB role is named
   after a capability; no policy or grant mentions `ic` or `site_manager`.
   - **Capability is not merely denied — it is granted.** Assert that a role
     **holding** `user.delete` **succeeds** at deleting a row in its own scope. This
     positive case is the one that catches the defect that actually occurred: a
     `SECURITY DEFINER` body reading `current_user` compares against the *function
     owner*, so `has_capability()` returned `false` for `app_admin` **while holding
     the capability row**. Every denial test on this page passed against it. A
     capability axis that denies everyone is indistinguishable from a working one.
   - **Identity inside the check comes from the `role` GUC.** Inside a
     `SECURITY DEFINER` function, `current_user`/`current_role` = `app` and
     `session_user` = `pgrst_authenticator`; only `current_setting('role', true)`
     tracks PostgREST's impersonation. `SECURITY INVOKER` is not the fix — it would
     require `SELECT` on `role_capability` for every serving role, publishing the
     whole capability matrix.
5. **Composition, not separation** — scope and capability appear **together**, in
   one policy per operation. The previous version of this line said "no policy or
   guard filters by scope *and* capability together". **That rule caused a silent
   privilege escalation** (`adr.md` ADR-0023), and these replace it:
   - **A member with no capability is denied, in its own scope** — must fail to
     `DELETE` and to `INSERT` rows belonging to *its own* unit. This is the only
     assertion that separates the correct shape from the broken one: when scope
     and capability sit in two permissive policies, every other test on this page
     still passes while the capability check has been OR-ed away entirely.
   - **No operation carries two permissive policies.** Assert against `pg_policy`
     that no `(relid, cmd)` pair has more than one `polpermissive` row. Where two
     policies are wanted, one must be `AS RESTRICTIVE`.
6. **Policy totality** — empty, absent and malformed claims all yield zero rows and
   no error; an admin token with a garbage `site_id` still sees everything.
7. **Not superuser** — every serving role is `NOSUPERUSER NOBYPASSRLS`, asserted
   against the catalogue. `FORCE ROW LEVEL SECURITY` does not bind either.
8. **No public function execution** — every function's `proacl` excludes `PUBLIC`.
9. **Hierarchy** — a member of a group sees that group and its descendants and
   **nothing above it**: member of `EU` sees `EU`, `UK`, `FR` and **not** `HQ` and
   **not** `US`; a member of `HQ` sees everything beneath. A member of two disjoint
   groups sees the **union** — `IN`/`ANY`, never `AND`. **The caller cannot widen
   its own scope**: `set_config('app.scope', …)` on a caller-writable GUC must not
   change what the policy returns. The per-session scope cache was rejected as a
   vulnerability precisely because it fails this test.
10. **Membership revocation** — remove a `user_groups` row and re-issue the **same**
    token. The next request must not see the old scope. Scope is a table read, so
    this is the whole of live-session scope revocation; there is no claim to wait
    out. (The claim-keyed design could not pass this.)
11. **The scoping subquery is evaluated once** — `EXPLAIN (ANALYZE)` reports
    **`loops = 1`** for the scoping SubPlan, at both a small and a large row count.
    Do **not** assert this from the policy text: an `EXISTS`-shaped correlated
    variant is simplified back into a hashed SubPlan. Only `loops` is evidence.
12. **The closure matview is granted to nobody** — assert against `pg_acl` that no
    role, `PUBLIC` included, holds `SELECT` on `org_closure`. A matview has no RLS,
    PostgREST publishes it automatically, and `openapi-mode = "ignore-privileges"`
    lists it in the spec regardless — so neither the spec nor a denial test can see
    a grant that should not be there. **One `GRANT SELECT` served the entire org
    tree to an anonymous caller.**
13. **Referential integrity does not leak** — for each FK on a group-scoped table,
    assert that a caller in group A cannot distinguish "group B exists" from
    "group B does not exist" by writing a row. `23503` is an existence oracle; a
    `UNIQUE` + `ON CONFLICT DO NOTHING` path is the same oracle **with no error at
    all**; `ON DELETE CASCADE` is a write across RLS. Also assert no group-scoped
    FK leaves the group-scoped set.

### Required, and not yet written: revocation while a session is live

**This is an explicit unknown, recorded here because nobody has tested it.**

> **The premise has changed — re-read this before writing the tests.** When this was
> written, hierarchy scope rode in a **signed JWT claim** verified once per
> transaction while capability resolved per statement from a table. The two
> therefore had *different revocation latency by construction*, and that seam was
> the worry. **The seam no longer exists:** scope is a **membership table read**,
> exactly like capability, so a membership change takes effect on the **next
> request with the same token**. Item 10 above is that test. A test written from the
> old text would be testing a superseded design.

- **What remains unknown:**
  1. A **capability** revoked mid-session → the next request is denied. Expected
     to work, because `has_capability()` reads the table live. **Unverified** — and
     note that "expected to work" was wrong once already: the same function
     returned `false` for *everyone*.
  2. Access token still valid, **refresh token** revoked → refresh refused, session
     cannot be extended.
  3. A user **removed from a group** whose descendants they were reaching → no rows
     from that subtree on the next request. Same mechanism as item 10; **unverified**.
  4. The claim references a **deleted** user → a denial, never an error.
- **Assertion discipline as everywhere else:** bodies and row counts, never the
  status code alone, and prove each test can go red. Note case 4: a non-uuid or
  empty `sub` currently yields **`HTTP 500`**, not `403` — fail-closed, but assert
  the current behaviour explicitly so a change to either is visible.
- Until these exist and are executed, treat live-session revocation as **not
  implemented**, and do not present the access token's TTL as if it bounds the
  exposure.

### Assert on the body, never the status

This is not a style preference. Verified: a correct denial, a full
`USING (true)` leak, and a **partial 3-of-5 leak** were **all HTTP 200**. A test
that asserts only the status code passes on a real data leak. Assert row count
and row content.

Conversely, an endpoint with **no grant at all returns `401`**, not `200 []` —
so "empty array" is not a universal denial signal either.

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