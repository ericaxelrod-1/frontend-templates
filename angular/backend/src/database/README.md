# Database Setup

This directory contains the database configuration, migrations, and seed scripts for the application.

## Which database this tree targets: **SQLite**

This is not aspirational and not a leftover. Everything that actually opens a
connection resolves to SQLite, and the migrations are written in SQLite dialect.
The evidence, so that nobody has to re-derive it from intent:

| Fact | Where |
|---|---|
| `type: 'sqlite'` — and every `typeorm`/`migration:*` npm script passes **this** file as `-d` | `data-source.ts:42`, `package.json` |
| The app config **defaults to SQLite** in every environment unless `DB_TYPE=postgres` is set explicitly | `src/config/database.config.ts:79-91` |
| `DB_TYPE=sqlite` is what both shipped env files set | `.env.test:6`, `test/.env.rls-test:6` |
| `.env.development` points at a file, not a host | `.env.development` (`DATABASE_FILE=...db.sqlite`) |
| `sqlite3` is a runtime dependency; **`pg` is not installed at all** | `package.json`, `node_modules/` |
| The applied-migration table is SQLite's `migrations` (51 applied vs 52 files) | `db.sqlite` |
| A migration named `FixSQLiteCompositePrimaryKeys` has been applied to the live file | `migrations/` |

`INSERT OR IGNORE`, `INSERT OR REPLACE` and `?` placeholders in
`1658012345678-CreatePermissionEntities.ts`, `1658012445678-SeedInitialPermissions.ts`,
`1684156801000-add-action-permissions.ts`, `1690000000001-SeedPermissionsData.ts`,
`1777327198306-AddPrivacyAndHealthPermissions.ts`,
`20250516094311-AddSystemManagePermission.ts` and `schema-sync.ts` are therefore
**correct as written**. Postgres rejects all three, and rewriting seven applied
migrations to portable syntax would not make this application target Postgres —
it would only make it fail to run on the database it actually uses.

### Divergence from `AGENTS.md` §B1 — recorded, not resolved

The repository `AGENTS.md` §B1 states **"PostgreSQL. Not SQLite."** That clause
does not describe this tree. It describes `angular_v2/backend/`, which is a
different application: PostgREST + `pg`, no ORM, and its own `AGENTS.md` saying
PostgreSQL 18 and listing TypeORM as not-a-dependency.

Nothing in `angular/backend/` implements §B1's other claims either — there is no
`SET LOCAL app.user_id`, no `CREATE POLICY`, and RLS is an application-level
subsystem in `packages/nestjs-typeorm-rls` rather than Postgres policies. The
divergence is whole-section, not one sentence.

**Left in place deliberately.** §B1 is the repository's single source of truth
and rewriting it to bless SQLite would contradict the tree it is also read
against (`angular_v2/`), and this legacy tree is on its way out. Correcting one
half of a document that two applications are measured against is a decision for
whoever owns that document, not a side effect of a permissions fix.

What is *not* left implicit: the `postgresConfig` branch in
`src/config/database.config.ts:31-49` is **dead code that cannot work**. Setting
`DB_TYPE=postgres` selects it, and `pg` is not installed, so the app dies at
bootstrap with a driver-not-found error rather than falling back. Read that
branch as unimplemented, not as a supported option.

## Structure

- `data-source.ts`: Configuration for TypeORM data source
- `migrations/`: Contains database migration files
- `seeds/`: Contains database seed files
- `seed.ts`: Main seed script that runs all seed files

## Migrations

Migrations are used to manage database schema changes over time. They allow us to version control our database schema and make it easy to update the database when deploying changes.

### Commands

```bash
# Generate a new migration (provide a name for the migration)
npm run migration:generate -- src/database/migrations/MigrationName

# Create an empty migration file (for manual editing)
npm run migration:create -- src/database/migrations/MigrationName

# Run pending migrations
npm run migration:run

# Revert the last applied migration
npm run migration:revert
```

### Development Workflow

1. Make changes to entity files
2. Generate a migration
3. Review and test the migration
4. Commit the migration to version control
5. When deploying, run the migrations

## Database Seeding

Seeding is used to populate the database with initial data for development and testing.

### Commands

```bash
# Run all seed scripts
npm run db:seed
```

### Seed Files

- `initial.seed.ts`: Creates default roles
- `users.seed.ts`: Creates default users
- `groups.seed.ts`: Creates default groups and user-group relationships

### Adding New Seed Files

1. Create a new file in the `seeds/` directory
2. Export a function that takes a `DataSource` parameter
3. Import the function in `seed.ts` and add it to the seeding pipeline

## Environment Variables

The database configuration can be customized using environment variables:

- `DATABASE_FILE`: SQLite database file path (default: `db.sqlite`)
- `DATABASE_SYNCHRONIZE`: Whether to synchronize the database schema automatically (default: `false`)
- `MIGRATIONS_RUN`: Whether to run migrations on application start (default: `true`)

## Migration Path to PostgreSQL

This application is initially configured to use SQLite for ease of setup, but it provides a migration path to PostgreSQL for production environments.

**This path is aspirational, not implemented.** See "Which database this tree
targets" above: `pg` is not a dependency, the Postgres branch of
`database.config.ts` cannot connect, and the migration set is SQLite-dialect
throughout. Switching requires installing the driver *and* rewriting the
migrations, not just flipping a type.

To switch to PostgreSQL:

1. Add `pg` as a dependency and correct the `postgresConfig` block in
   `src/config/database.config.ts` (it currently reads `DB_NAME`, while
   `.env.example` supplies `DB_DATABASE` — a mismatch that silently falls back to
   `permissions_db`)
2. Port every migration off `INSERT OR IGNORE`, `INSERT OR REPLACE` and `?`
   placeholders
3. Update the `dataSourceOptions` in `data-source.ts` to use PostgreSQL
4. Run migrations to create the schema in PostgreSQL
5. Update environment variables accordingly

## The committed `db.sqlite`

`db.sqlite` is **tracked in git** (3.7 MB). `AGENTS.md` §2.5 says never to
commit a database file because it carries real emails, password hashes and
login history. This tree commits it anyway, and `.gitignore` lists only
`.env.gmail`.

What it actually contains, measured rather than assumed: 9 users (all
`@example.com`, so no real address), 9 populated **bcrypt hashes** (`$2b$10$`),
and 5 `login_attempts` rows carrying `ip_address`, `user_agent` and
`email_attempted` (all `::1` / `admin@example.com`). So §2.5's concern is half
real — the login/IP history and the password hashes are there; the identities
are placeholders.

**Migration state — note this is narrower than "N migrations behind".** The
`migrations` table's `id` is an autoincrement rowid, so its highest value (55)
is not a migration count. The real comparison is 51 applied against 52 files on
disk, and the four differences are not four gaps:

- `AddActionPermissions1684156801000`, `FixRolePermissions1684156802000` and
  `FixRoleSchema1684156805000` are applied under their **original class names**;
  the files were later renamed to kebab-case (`1684156801000-add-action-permissions.ts`
  and friends) with the same timestamps. Their effects are in the file. They are
  not pending work — they are a renaming that left TypeORM's recorded names
  behind, and a `migration:run` against this file would attempt to re-apply them.
- **`20250516094311-AddSystemManagePermission` is the one genuinely unapplied
  migration**, and it is the one that matters.

Consequences in the shipped artifact:

- `system:manage` **does not exist as a permission row** (only `system:admin` and
  `system:health` do).
- `POST /admin/system-health/clear-temp` therefore returns **403 for everyone**,
  including `Administrator`. `PermissionGuard` resolves `system:manage` to false
  for every user because `checkUserPermission` finds no such grant — and that
  controller's own spec proves the route *works* for a caller holding the
  permission, so this is the database being behind, not the guard.

This is also why `database.config.ts:26` sets `migrationsRun: false` with
`migrations: []` — the app runtime deliberately does not auto-migrate, and the
comment says migrations are the CLI's business via `data-source.ts` (whose
`migrationsRun: true` applies to the CLI path).

Not regenerated here: see the report. The trade is §2.5 (a committed DB carries
login history and password hashes) against a shipped artifact in which a route
its own controller guards is unreachable for every user, including the
administrator.

