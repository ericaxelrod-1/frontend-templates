import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPOSITORY_ROOT = resolve(BACKEND_ROOT, '..');
export const FRONTEND_ROOT = join(REPOSITORY_ROOT, 'frontend');
export const DOCS_ROOT = join(REPOSITORY_ROOT, 'docs');

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function relativeToRepository(path: string): string {
  return relative(REPOSITORY_ROOT, path);
}
