import * as path from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';

// Load .env variables if present
config();

console.log('[PathCheck] Script starting...');

const dbPathFromEnv = process.env.DATABASE_FILE;
const defaultDbPath = path.resolve(__dirname, '..', '..', 'db.sqlite'); // Always use canonical db path
const resolvedDbPath = path.resolve(dbPathFromEnv || defaultDbPath);

console.log(`[PathCheck] process.env.DATABASE_FILE: ${dbPathFromEnv}`);
console.log(`[PathCheck] Default DB Path used (relative to CWD): ${defaultDbPath}`);
console.log(`[PathCheck] Current working directory (via __dirname): ${__dirname}`);
console.log(`[PathCheck] Resolved absolute DB Path: ${resolvedDbPath}`);

if (fs.existsSync(resolvedDbPath)) {
  console.log(`[PathCheck] SUCCESS: Database file FOUND at resolved path: ${resolvedDbPath}`);
} else {
  console.error(`[PathCheck] ERROR: Database file NOT FOUND at resolved path: ${resolvedDbPath}`);
}

console.log('[PathCheck] Script finished.'); 