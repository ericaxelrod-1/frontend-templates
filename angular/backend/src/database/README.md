# Database Setup

This directory contains the database configuration, migrations, and seed scripts for the application.

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

To switch to PostgreSQL:

1. Update the `dataSourceOptions` in `data-source.ts` to use PostgreSQL
2. Run migrations to create the schema in PostgreSQL
3. Update environment variables accordingly 