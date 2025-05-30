import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';

/**
 * Configuration for the SQLite cache database used for permission caching.
 * This database is separate from the main application database and is used purely for
 * performance optimization of permission checks.
 */
export const CacheDatabaseConfig: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: path.join(process.cwd(), 'cache', 'permissions.sqlite'),
  entities: [
    path.join(
      __dirname,
      '../modules/permissions/cache-entities/*.entity{.ts,.js}',
    ),
  ],
  synchronize: true, // Safe for cache database
  logging: false,
};
