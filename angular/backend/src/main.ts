import 'reflect-metadata';
// Add immediate log at top of file to verify the file is being loaded
console.log('\n💡 main.ts file loaded - starting application bootstrap');

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggerService } from './logger/logger.service';
import {
  HttpExceptionFilter,
  AllExceptionsFilter,
} from './modules/common/security';
import { ConfigService } from '@nestjs/config';
import { EnhancedLogger } from './shared/utils/logger';
import * as path from 'path'; // Import path module
import * as fs from 'fs'; // Import fs module
import { dataSourceOptions } from './database/data-source'; // Import dataSourceOptions
import { SqliteConnectionOptions } from 'typeorm/driver/sqlite/SqliteConnectionOptions';

// Determine CWD (should be angular/backend when running npm start)
const CWD = process.cwd();

// Ensure logs directory exists in CWD (angular/backend/logs)
const logsDir = path.join(CWD, 'logs');
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`[Bootstrap] Created logs directory: ${logsDir}`);
  } catch (e) {
    console.error(
      `[Bootstrap] Failed to create logs directory (${logsDir}):`,
      e,
    );
  }
}

const BOOTSTRAP_LOG_FILE = path.join(logsDir, 'bootstrap-debug.log');
console.log(
  `[Bootstrap] Bootstrap details will be logged to: ${BOOTSTRAP_LOG_FILE}`,
);
// Clear previous log file for this session
try {
  fs.writeFileSync(BOOTSTRAP_LOG_FILE, '');
} catch (e) {
  console.error('Failed to clear bootstrap log', e);
} // Added error logging

function logBootstrap(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message); // Keep console logging for immediate feedback
  try {
    fs.appendFileSync(BOOTSTRAP_LOG_FILE, logMessage);
  } catch (e) {
    console.error(
      `[Bootstrap] Failed to write to bootstrap log file (${BOOTSTRAP_LOG_FILE}):`,
      e,
    ); // Added error logging
  }
}

// Log versions and dependencies
logBootstrap(
  `📦 NestJS Version: ${require('@nestjs/core/package.json').version}`,
);
logBootstrap(`🔄 Node.js Version: ${process.version}`);
logBootstrap(`🗄️ Trying to load AppModule...`);

async function bootstrap() {
  logBootstrap('🔄 Starting bootstrap...');
  logBootstrap(
    `[Bootstrap] Current __dirname (main.ts location): ${__dirname}`,
  );
  logBootstrap(
    `[Bootstrap] Current process.cwd() (should be angular/backend): ${process.cwd()}`,
  );

  try {
    logBootstrap(`[Bootstrap] DataSource Type: ${dataSourceOptions.type}`);

    if (dataSourceOptions.type === 'sqlite') {
      const sqliteOptions = dataSourceOptions as SqliteConnectionOptions;
      const dbPathFromEnv = process.env.DATABASE_FILE;
      const defaultDbPathInOptions =
        typeof sqliteOptions.database === 'string'
          ? sqliteOptions.database
          : 'db.sqlite';
      const dbPathToUse = dbPathFromEnv || defaultDbPathInOptions;
      const resolvedDbPath = path.resolve(CWD, dbPathToUse);

      logBootstrap(
        `[Bootstrap] process.env.DATABASE_FILE: ${dbPathFromEnv || 'Not set'}`,
      );
      logBootstrap(
        `[Bootstrap] Default DB Path from dataSourceOptions: ${defaultDbPathInOptions}`,
      );
      logBootstrap(
        `[Bootstrap] Effective DB Path for SQLite (resolved from CWD ${CWD}): ${dbPathToUse}`,
      );
      logBootstrap(
        `[Bootstrap] Resolved absolute DB Path for SQLite: ${resolvedDbPath}`,
      );

      if (!fs.existsSync(resolvedDbPath)) {
        logBootstrap(
          `[Bootstrap] ERROR: SQLite Database file NOT FOUND at resolved path: ${resolvedDbPath}`,
        );
      } else {
        logBootstrap(
          `[Bootstrap] SUCCESS: SQLite Database file FOUND at resolved path: ${resolvedDbPath}`,
        );
      }
    } else {
      logBootstrap(
        `[Bootstrap] Host: ${(dataSourceOptions as any).host || 'N/A'}`,
      );
      logBootstrap(
        `[Bootstrap] Port: ${(dataSourceOptions as any).port || 'N/A'}`,
      );
      logBootstrap(
        `[Bootstrap] Username: ${(dataSourceOptions as any).username ? 'Set' : 'Not Set'}`,
      );
      logBootstrap(
        `[Bootstrap] Database Name: ${dataSourceOptions.database || 'N/A'}`,
      );
      logBootstrap(
        `[Bootstrap] Schema: ${(dataSourceOptions as any).schema || 'N/A'}`,
      );
    }

    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      {
        logger: new LoggerService(),
        cors: true,
      },
    );

    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe());

    const port = process.env.PORT || 3000;
    await app.listen(port);
    logBootstrap(`🚀 Server is running on: http://localhost:${port}`);
  } catch (error) {
    logBootstrap(`❌ Bootstrap failed: ${error?.message || error}`);
    if (error?.stack) {
      logBootstrap(error.stack);
    }
    process.exit(1);
  }
}

logBootstrap('🔄 Starting application...');
bootstrap().catch((err) => {
  logBootstrap(`❌ Fatal error in bootstrap: ${err?.message || err}`);
  if (err?.stack) {
    logBootstrap(err.stack);
  }
  process.exit(1);
});
