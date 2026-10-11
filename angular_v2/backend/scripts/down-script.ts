import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where a migration's down script lives, and whether it is worth running.
 *
 * ## The convention this enforces
 *
 * A down script is a SIBLING FILE: `0001_rls_foundation.sql` reverts through
 * `0001_rls_foundation.down.sql`. All six shipped migrations already use it, and
 * each up file's `-- DOWN` section says so and holds nothing else. There is one
 * down script per migration and it is the sibling — `AGENTS.md` §2.4 is why it
 * cannot be a second, inline copy inside the up file: two copies of one down
 * script drift, and the runner would execute whichever one it happened to parse.
 *
 * ## Why the runner used to corrupt the ledger
 *
 * It read the down script out of the UP file by splitting on `-- DOWN`, which
 * returns the pointer comment on every migration that follows the convention.
 * Commenting out is not reverting: the runner then deleted the row from
 * `migrations` and exited 0, so the next `migration:run` re-applied a migration
 * that had never been reversed — on top of a schema still carrying its tables,
 * policies and functions. Silent, and shaped exactly like success.
 *
 * So the checks below run BEFORE any statement reaches the database, and they
 * reject the two shapes that let a no-op through:
 *
 *   * nothing executable at all — an empty or comments-only file; and
 *   * nothing that reverses — a file whose only statements are `NOTIFY`, which
 *     is what a truncated or wrong down script degrades to.
 *
 * `AGENTS.md` §2.3: a migration that cannot be reverted says so and stops, rather
 * than reporting a success it did not achieve.
 */

export class MigrationFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationFileError';
  }
}

/** The sibling `.down.sql` path for an up migration's file name. */
export function downScriptPath(migrationDir: string, migrationName: string): string {
  if (!migrationName.endsWith('.sql') || migrationName.endsWith('.down.sql')) {
    throw new MigrationFileError(
      `${migrationName} is not an up migration file name; a down script is resolved from the up file's name`,
    );
  }
  return join(migrationDir, `${migrationName.slice(0, -'.sql'.length)}.down.sql`);
}

/**
 * Statements that change nothing by themselves. `NOTIFY pgrst, 'reload schema'`
 * is in every down script because the scripts are also applied by hand with
 * `psql -f`, and it is the one statement a down script can contain that is
 * neither the reversal nor a comment.
 */
const NON_REVERSING = new Set(['notify']);

function firstKeyword(statement: string): string {
  const match = /^[A-Za-z]+/.exec(statement);
  return match === null ? '' : match[0].toLowerCase();
}

/** A statement that reverses something, rather than only announcing itself. */
export function reversingStatements(statements: readonly string[]): readonly string[] {
  return statements.filter((statement) => !NON_REVERSING.has(firstKeyword(statement)));
}

/** A dollar-quote opener (`$$` or `$tag$`) at `start`, or null if there is none. */
function dollarTagAt(sql: string, start: number): string | null {
  const match = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(sql.slice(start));
  return match === null ? null : match[0];
}

/** A `'...'` or `"..."` run starting at `start`, honouring the doubled-quote escape. */
function quotedAt(sql: string, start: number, quote: string): string {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      return sql.slice(start, index + 1);
    }
    index += 1;
  }
  return sql.slice(start);
}

/**
 * The executable statements in a SQL script: comments removed, split on the
 * semicolons that end a statement.
 *
 * Not a `split(';')`. The shipped down scripts carry `DO $$ … $$` bodies with
 * semicolons and `--` inside them — `0002_refresh_tokens.down.sql` drops a table
 * from inside one — so a naive split reports fragments of a body as statements
 * and a body as several. Comments are stripped rather than kept, so a script that
 * is nothing but prose reports zero statements, which is the whole point of the
 * check in `readDownScript`.
 *
 * It understands line comments, nested block comments, single-quoted strings,
 * double-quoted identifiers and dollar-quoted bodies, because a `--` inside any of
 * those is not a comment. It is not a parser and does not need to be: it runs
 * over migration files this repository authors.
 */
export function splitSqlStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const lineEnd = sql.indexOf('\n', index);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      // Postgres block comments nest, so the depth is counted rather than
      // jumping to the next `*/`.
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          depth += 1;
          index += 2;
          continue;
        }
        if (sql.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      continue;
    }

    const character = sql[index];

    if (character === "'" || character === '"') {
      const quoted = quotedAt(sql, index, character);
      current += quoted;
      index += quoted.length;
      continue;
    }

    if (character === '$') {
      const tag = dollarTagAt(sql, index);
      if (tag !== null) {
        const close = sql.indexOf(tag, index + tag.length);
        const body = close === -1 ? sql.slice(index) : sql.slice(index, close + tag.length);
        current += body;
        index += body.length;
        continue;
      }
    }

    if (character === ';') {
      statements.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

export interface DownScript {
  /** The sibling file the down SQL was read from. */
  readonly path: string;
  /** The whole file, handed to the driver unmodified. */
  readonly sql: string;
  /** Its executable statements, comments excluded. Never empty. */
  readonly statements: readonly string[];
}

/**
 * Reads and checks the sibling down script.
 *
 * Throws before the caller touches the database when the file is missing, has no
 * executable statement, or has nothing that reverses — so a migration whose down
 * script is unusable keeps its `migrations` row and is still reported as applied.
 */
export async function readDownScript(
  migrationDir: string,
  migrationName: string,
): Promise<DownScript> {
  const path = downScriptPath(migrationDir, migrationName);

  let sql: string;
  try {
    sql = await readFile(path, 'utf8');
  } catch (cause) {
    throw new MigrationFileError(
      `migration ${migrationName} has no down script at ${path}. The convention is a sibling ` +
        `${migrationName.replace(/\.sql$/, '.down.sql')}; an up file carrying its down section ` +
        `inline is a second copy of one script (AGENTS.md §2.4), and reverting with no down ` +
        `script would delete the ledger row without reversing the schema.`,
      { cause },
    );
  }

  const statements = splitSqlStatements(sql);

  if (statements.length === 0) {
    throw new MigrationFileError(
      `down script ${path} contains no executable statement. Comments are not a down script: ` +
        `running it would delete the ${migrationName} ledger row while leaving the schema in place.`,
    );
  }

  if (reversingStatements(statements).length === 0) {
    throw new MigrationFileError(
      `down script ${path} reverses nothing — its only statements are ` +
        `${statements.map(firstKeyword).join(', ')}. Running it would delete the ${migrationName} ` +
        `ledger row while leaving the schema in place.`,
    );
  }

  return { path, sql, statements };
}