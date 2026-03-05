import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';


export default registerAs('database', () => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const dbTypeFromEnv = process.env.DB_TYPE?.toLowerCase();

  // Common settings
  const commonEntities = [
    path.join(__dirname, '../modules/**/entities/*.entity{.ts,.js}'),
  ];
  const commonMigrations = [path.join(__dirname, '../migrations/*{.ts,.js}')];

  const sqliteConfig: TypeOrmModuleOptions = {
    type: 'sqlite',
    database: process.env.DATABASE_FILE || 'db.sqlite',
    entities: commonEntities,
    synchronize: false,
    logging:
      nodeEnv === 'development' || nodeEnv === 'test'
        ? ['query', 'error', 'schema']
        : ['error'],
    autoLoadEntities: true,
    extra: { foreign_keys: true },
    namingStrategy: new SnakeNamingStrategy(),
    migrationsRun: false,

    migrations: [], // CLI uses data-source.ts for migrations array
  };

  const postgresConfig: TypeOrmModuleOptions = {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'permissions_db',
    schema: process.env.DB_SCHEMA || 'public',
    entities: commonEntities,
    synchronize: false,
    logging:
      nodeEnv === 'development' ? ['query', 'error', 'schema'] : ['error'],
    autoLoadEntities: true,
    namingStrategy: new SnakeNamingStrategy(),
    migrationsRun: false, // Typically false for app runtime, true for migration tool if needed

    migrations: commonMigrations,
    migrationsTableName: 'migrations_history',
  };

  // Comment out Snowflake configuration to prevent type errors and ensure SQLite/Postgres default
  /*
  const snowflakeConfig: TypeOrmModuleOptions = {
    type: 'sqlite', // Temporarily changed to sqlite to avoid error, review if Snowflake is truly needed
    account: process.env.SNOWFLAKE_ACCOUNT || 'your_account_locator', 
    username: process.env.SNOWFLAKE_USERNAME || 'your_user',
    password: process.env.SNOWFLAKE_PASSWORD, 
    database: process.env.SNOWFLAKE_DATABASE || 'YOUR_DB',
    schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC',
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'COMPUTE_WH',
    role: process.env.SNOWFLAKE_ROLE, 
    entities: commonEntities,
    synchronize: false,
    logging: nodeEnv === 'development' ? ['query', 'error', 'schema'] : ['error'],
    autoLoadEntities: true,
    migrationsRun: false,
    migrations: commonMigrations,
    migrationsTableName: 'migrations_history',
  };
  */

  let chosenConfig: TypeOrmModuleOptions;

  // Determine config based on DB_TYPE, then NODE_ENV for default SQLite/Postgres
  // if (dbTypeFromEnv === 'snowflake') {
  //   console.log('[DB Config] Using Snowflake configuration (if type is corrected).');
  //   chosenConfig = snowflakeConfig;
  // } else
  if (dbTypeFromEnv === 'postgres') {
    console.log('[DB Config] Using PostgreSQL configuration via DB_TYPE.');
    chosenConfig = postgresConfig;
  } else if (dbTypeFromEnv === 'sqlite') {
    console.log('[DB Config] Using SQLite configuration via DB_TYPE.');
    chosenConfig = sqliteConfig;
  } else {
    // Default to SQLite for development/test, Postgres for production if DB_TYPE is not set
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      console.log(
        `[DB Config] NODE_ENV is ${nodeEnv}. Defaulting to SQLite configuration.`,
      );
      chosenConfig = sqliteConfig;
    } else {
      // Handles 'production' or any other NODE_ENV value
      console.log(
        `[DB Config] NODE_ENV is ${nodeEnv}. Defaulting to PostgreSQL configuration.`,
      );
      chosenConfig = postgresConfig;
    }
  }

  // The logging is now defined within each specific config object (sqliteConfig, postgresConfig)

  console.log(
    `[DB Config] Final config type: ${chosenConfig.type}, DB: ${typeof chosenConfig.database === 'string' ? chosenConfig.database : 'complex_object'}`,
  );
  return chosenConfig;
});
