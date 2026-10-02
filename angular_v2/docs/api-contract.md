# API contract

How the backend and frontend stay aligned. Rationale in [`adr.md`](./adr.md)
ADR-0003 and ADR-0004; inventory in [`rebase.md`](./rebase.md).

---

## The problem this solves

`angular/` implements the API **twice** — once in Nest, once in Angular — by hand,
with no compiler link between them. The backend returned raw TypeORM entities
while the frontend hand-declared what it believed it received.

The foundation existed and was unused: `@nestjs/swagger` installed, decorators on
34 files, `SwaggerModule` imported in `main.ts:11` and never called. The
documentation advertised a contract that did not exist.

Measured drift in the old tree: ~126 hand-written HTTP calls, `Role` declared 4×
with `id` typed `number`, `string` and `number?`, 6 calls to non-existent
endpoints, one broken HTTP method, and a CSRF token sent in a body where the
backend read a header.

---

## The pipeline

```
tables  ──▶  PostgREST  ──▶  openapi.json  ──▶  openapi-typescript  ──▶  types
(PostgreSQL)   (live)          (committed)              (committed)        (committed)
```

One direction. The frontend never hand-writes a URL, a response interface, or an
HTTP call. **If the spec does not produce it, the schema is wrong.**

Generating from the live database rather than from hand-written decorators is
strictly stronger: the spec describes what actually exists. The old
decorator-based pipeline could not have caught the six 404s, because the
decorators and the routes were written independently.

**PostgREST serves base tables. There are no views** (ADR-0022) — because
superuser-created views bypass RLS entirely, and writes through views are
unreliable. **The schema and the API are the same artifact**, so adding a field is
genuinely one migration.

### Naming: one convention, no translation

`user_id` in Postgres → `user_id` on the wire → `user_id` in the generated type.

No view, no client transform, no per-model mapping. Two mechanisms were rejected
with evidence in ADR-0022:

| Rejected | Why |
|---|---|
| **Views** | Superuser-created views **bypass all RLS** silently. PostgREST: *"When created by a SUPERUSER role, all row-level security policies will be bypassed."* A real leak has occurred from this. Also: no primary key, so upsert and single-row PATCH/DELETE are unreliable |
| **Client key transform** | Rewrites keys *inside* `jsonb`, breaking passthrough payloads. Already tried and deleted in `angular/` after a 35-task refactor |
| **Quoted camelCase columns** | Every identifier needs quotes; an unquoted `userId` folds to `userid` and fails only when something else references it |

### The generator

**`openapi-typescript`**, not Orval. Orval's `namingConvention` covers **file
names** and **enum keys** — there is no option for schema property keys, so
converting snake_case properties needs a custom mutator. `openapi-typescript`
emits types exactly as the spec states, with **zero runtime dependencies**.

That is the point: naming is resolved at build time, so nothing can corrupt a
`jsonb` payload at runtime. (Orval does have a signal-first `httpResource` Angular
mode worth revisiting if the thin-app `HttpClient` layer ever proves insufficient.)

### Requirements

| Requirement | Rule |
|---|---|
| No `CREATE VIEW` in any migration | ADR-0022. A superuser-created view bypasses RLS |
| No quoted camelCase identifiers | Postgres folds them; the mismatch surfaces late |
| Internal columns revoked | Column-level `REVOKE`, not omission — and revoke table-level **first** |
| No runtime key transform, ever | Naming is a build-time concern |
| Generated types are never hand-edited | `verify` fails if they are |
| `@ApiProperty()` on thin-app DTOs | Only for the ~10 routes Nest still owns |
| Hand-written URLs and response interfaces | Forbidden |
| Component-level `HttpClient` | Architectural boundary violation; HTTP lives in services |
| `any[]` to break a circular import | Fix the import graph instead |
| A column rename is a breaking change | Migration **and** regeneration in the same change |

---

## Regeneration

```bash
npm run generate:client
```

Required after **any** schema or route change. A change that alters the wire
format without regenerating the client is an incomplete change.

Both `openapi.json` and the generated types are committed so the frontend builds
without either runtime running — which matters because a fork's first action is
`npm install && npm run build`, not starting three processes.

---

## What drift looks like afterwards

With generation in place, contract failures become **compile errors**:

| Change | Without generation | With generation |
|---|---|---|
| Rename a column | Runtime `undefined` downstream | Frontend fails to compile |
| Drop a column | 500, or a silently missing field | Frontend fails to compile |
| Change a column type | `NaN` or a rendering bug | Frontend fails to compile |
| Add a route to a resource | 404 | Frontend fails to compile |

That is the entire argument. Recurring human chore becomes a build step, and the
only kind of drift that actually gets fixed is the kind the compiler rejects.

The coupling between API shape and schema shape is the accepted cost. Because
`verify` rejects it at compile time, a rename cannot ship unnoticed — a weaker
guarantee than a view's decoupling, and a stronger one than a silent transform.