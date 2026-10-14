import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  downScriptPath,
  MigrationFileError,
  readDownScript,
  reversingStatements,
  splitSqlStatements,
} from '../../scripts/down-script.js';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * A down script is the sibling `.down.sql`, and it is checked before it runs.
 *
 * ## The defect this exists to prevent
 *
 * `scripts/migrate.ts` used to recover the down script by splitting the UP file on
 * `-- DOWN`. Every shipped migration follows the sibling-file convention, so that
 * split returned the pointer comment and nothing else. Measured against the files
 * as they stood:
 *
 * | Migration | What the old parser executed                             |
 * |-----------|-------------------------------------------------------------|
 * | 0001–0004 | comments only — no-op                                     |
 * | 0005      | two `DELETE`s; no policy, function or table dropped         |
 * | 0006      | threw `has no DOWN section` — it carries no marker at all   |
 *
 * Either way the runner then executed `DELETE FROM migrations WHERE name = …` and
 * exited 0. The ledger claimed the migration had been reverted while the schema
 * still carried it, and the next `migration:run` re-applied a migration that was
 * already there. Silent, and shaped like success — `AGENTS.md` §2.3.
 *
 * ## What is asserted
 *
 * 1. Every shipped migration has a sibling down script with at least one statement
 *    that reverses something. `readDownScript` throws otherwise.
 * 2. No up file carries an inline `-- DOWN` body, because a second copy of one
 *    down script is the drift this is meant to remove — and `0005_email_messages.sql`
 *    had exactly that: a two-`DELETE` partial duplicate of a sibling that also
 *    drops the policies, the functions and the table.
 *
 * ## Why the checks can fail
 *
 * Every gate below is exercised against a throwaway directory holding the exact
 * shape it is supposed to reject — a missing sibling, a comments-only file, an
 * empty file, a `NOTIFY`-only file, an up file with a divergent inline body. Those
 * are the red cases, so the green case on the real migrations is not a tautology.
 */

const MIGRATIONS_DIR = join(BACKEND_ROOT, 'database', 'migrations');

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function upMigrationNames(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4,}_.*\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();
}

/** The executable statements in an up file's own `-- DOWN` section, if it has one. */
function inlineDownStatements(upSql: string): readonly string[] {
  const marker = /^--[ \t]*DOWN[ \t]*$/m.exec(upSql);
  if (marker === null) {
    return [];
  }
  return splitSqlStatements(upSql.slice(marker.index + marker[0].length));
}

function fixture(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'down-script-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
  return dir;
}

describe('every shipped migration has a down script the runner can execute', () => {
  const names = upMigrationNames();

  it('finds the migrations to check, so an empty directory is not a pass', () => {
    // Properties of the list, NOT the list itself. An earlier version of this
    // assertion hardcoded every shipped filename, which meant adding a migration
    // required editing the test — so the fifth and sixth landed as red here before
    // anything checked their down scripts, and the failure was reported as a
    // broken test rather than a missing one. A gate that must be hand-edited on
    // every addition gets skipped, and a skipped gate is not a gate.
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/^\d{4,}_[a-z0-9_]+\.sql$/);
    }
    // Numbers are contiguous and unique: `0010_x.sql` beside `0012_y.sql` means a
    // migration was renamed away, and the ledger ordering is then not the file order.
    const numbers = names.map((name) => Number.parseInt(name.slice(0, 4), 10));
    const first = numbers[0] ?? 0;
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(numbers.map((_, index) => first + index));
  });

  it('still carries the migrations whose down scripts were each written by hand', () => {
    // A floor, not a duplicate. These eight are shipped history and a down script
    // that stops existing is a silent rollback regression, not a new file.
    const baseline = [
      '0001_rls_foundation.sql',
      '0002_refresh_tokens.sql',
      '0003_login_attempt_ip_keys.sql',
      '0004_grant_subset.sql',
      '0005_email_messages.sql',
      '0006_uuidv7.sql',
      '0007_resource_ceilings.sql',
      '0008_user_identity.sql',
    ];
    for (const name of baseline) {
      expect(names).toContain(name);
    }
  });

  it('resolves each down script to the sibling file, not a section of the up file', () => {
    for (const name of names) {
      expect(downScriptPath(MIGRATIONS_DIR, name)).toBe(
        join(MIGRATIONS_DIR, name.replace(/\.sql$/, '.down.sql')),
      );
    }
  });

  it('gives each down script at least one executable statement that reverses something', async () => {
    const checked: string[] = [];
    for (const name of names) {
      const down = await readDownScript(MIGRATIONS_DIR, name);
      expect(down.statements.length, `${down.path} has no executable statement`).toBeGreaterThan(0);
      expect(
        reversingStatements(down.statements).length,
        `${down.path} executes only NOTIFY — it reverts nothing`,
      ).toBeGreaterThan(0);
      expect(down.sql.trim(), `${down.path} is empty`).not.toBe('');
      checked.push(name);
    }
    expect(checked).toEqual([...names]);
  });

  it('reads the down SQL the runner executes, not a truncated parse of the up file', async () => {
    // The precise old failure: `sql.split('-- DOWN\n')[1]` on this file is the
    // pointer comment, so the runner would have executed a comment and called it
    // a revert.
    const down = await readDownScript(MIGRATIONS_DIR, '0001_rls_foundation.sql');
    expect(down.statements.some((statement) => statement.startsWith('DROP POLICY'))).toBe(true);
    expect(down.statements.some((statement) => statement.startsWith('DROP TABLE'))).toBe(true);
  });
});

describe('no up file carries a second copy of its own down script', () => {
  it('leaves every `-- DOWN` section a pointer with no executable statement of its own', () => {
    const offenders: string[] = [];
    for (const name of upMigrationNames()) {
      const statements = inlineDownStatements(readText(join(MIGRATIONS_DIR, name)));
      if (statements.length > 0) {
        offenders.push(`${name} -> ${statements.map((s) => s.split('\n')[0]).join(' | ')}`);
      }
    }
    expect(
      offenders,
      'an inline -- DOWN body is a second copy of the sibling .down.sql and can diverge from it',
    ).toEqual([]);
  });

  it('points at the sibling file that exists, so the pointer is not a dangling reference', () => {
    for (const name of upMigrationNames()) {
      const up = readText(join(MIGRATIONS_DIR, name));
      const marker = /^--[ \t]*DOWN[ \t]*$/m.exec(up);
      if (marker === null) {
        continue;
      }
      const section = up.slice(marker.index);
      const sibling = name.replace(/\.sql$/, '.down.sql');
      expect(section, `${name} has a -- DOWN section naming no file`).toContain(sibling);
      expect(() => readText(downScriptPath(MIGRATIONS_DIR, name))).not.toThrow();
    }
  });

  it('does not leave `0005_email_messages.sql` with the partial duplicate it carried', async () => {
    // The two-`DELETE` body it used to hold is a strict subset of the sibling: it
    // removed the capability rows and left the table, its policies and its
    // functions behind while reporting a successful revert.
    const up = readText(join(MIGRATIONS_DIR, '0005_email_messages.sql'));
    expect(inlineDownStatements(up)).toEqual([]);
    const down = await readDownScript(MIGRATIONS_DIR, '0005_email_messages.sql');
    for (const expected of ['DROP POLICY', 'DROP FUNCTION', 'DROP TABLE']) {
      expect(
        down.statements.some((statement) => statement.startsWith(expected)),
        `the authority for 0005 no longer drops anything with ${expected}`,
      ).toBe(true);
    }
  });
});

describe('the down-script checks reject the shapes that let a no-op through', () => {
  it('refuses a migration with no sibling down script, and names both paths', async () => {
    const dir = fixture({ '0001_thing.sql': 'CREATE TABLE thing (id int);' });
    const failure = await readDownScript(dir, '0001_thing.sql').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationFileError);
    expect((failure as Error).message).toContain('0001_thing.down.sql');
    expect((failure as Error).message).toContain('0001_thing.sql');
  });

  it('refuses a comments-only down script, because a comment is not a revert', async () => {
    const dir = fixture({
      '0002_thing.sql': 'CREATE TABLE thing (id int);',
      '0002_thing.down.sql':
        '-- DOWN\n-- =============================================================================\n-- See database/migrations/0002_thing.down.sql. Kept separate.\n',
    });
    const failure = await readDownScript(dir, '0002_thing.sql').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationFileError);
    expect((failure as Error).message).toContain('no executable statement');
  });

  it('refuses an empty down script', async () => {
    const dir = fixture({
      '0003_thing.sql': 'CREATE TABLE thing (id int);',
      '0003_thing.down.sql': '\n\n   \n',
    });
    const failure = await readDownScript(dir, '0003_thing.sql').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationFileError);
    expect((failure as Error).message).toContain('no executable statement');
  });

  it('refuses a down script whose only statement is NOTIFY, which reverts nothing', async () => {
    const dir = fixture({
      '0004_thing.sql': 'CREATE TABLE thing (id int);',
      '0004_thing.down.sql': "NOTIFY pgrst, 'reload schema';\n",
    });
    const failure = await readDownScript(dir, '0004_thing.sql').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationFileError);
    expect((failure as Error).message).toContain('reverses nothing');
    expect((failure as Error).message).toContain('notify');
  });

  it('refuses an up migration file name that is already a down script', () => {
    const failure = (() => {
      try {
        downScriptPath(MIGRATIONS_DIR, '0001_thing.down.sql');
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(MigrationFileError);
  });

  it('rejects the divergent inline -- DOWN body the gate above exists to catch', () => {
    // The real 0005 shape: an up file whose inline section holds a partial copy of
    // its own down script. If this gate ever stops failing, so does the one above.
    const dir = fixture({
      '0005_thing.sql':
        "CREATE TABLE thing (id int);\n\n-- DOWN\n-- =============================================================================\n" +
        '-- See database/migrations/0005_thing.down.sql.\n\n' +
        "DELETE FROM public.permissions WHERE resource = 'thing';\n",
      '0005_thing.down.sql': 'DROP TABLE IF EXISTS public.thing;\n',
    });
    const up = readText(join(dir, '0005_thing.sql'));
    expect(inlineDownStatements(up)).not.toEqual([]);
    expect(inlineDownStatements(up)).toHaveLength(1);
  });

  it('accepts the shape the sibling convention actually uses', async () => {
    const dir = fixture({
      '0006_thing.sql': 'CREATE TABLE thing (id int);\n',
      '0006_thing.down.sql': 'DROP TABLE IF EXISTS public.thing;\n',
    });
    const down = await readDownScript(dir, '0006_thing.sql');
    expect(down.statements).toEqual(['DROP TABLE IF EXISTS public.thing']);
  });
});

describe('splitting a script is not splitting on every semicolon', () => {
  it('keeps a `DO $$ … $$` body as one statement, so an inner semicolon is not a statement boundary', () => {
    // `0002_refresh_tokens.down.sql` drops a table from inside a DO block; a naive
    // `split(';')` would report the body fragments as statements and read a block
    // that drops nothing as one that does.
    const statements = splitSqlStatements(
      'DO $$\nDECLARE owner_name text;\nBEGIN\n  SELECT 1 INTO owner_name;\n  DROP TABLE public.thing;\nEND\n$$;\n',
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('DROP TABLE public.thing');
  });

  it('does not treat a `--` inside a string or a dollar-quoted body as a comment', () => {
    const statements = splitSqlStatements(
      "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS $body$ SELECT '-- not a comment' $body$;\n" +
        "INSERT INTO t VALUES ('a -- b');\n",
    );
    expect(statements).toHaveLength(2);
    expect(statements[1]).toBe("INSERT INTO t VALUES ('a -- b')");
  });

  it('strips nested block comments, which Postgres nests', () => {
    const statements = splitSqlStatements(
      '/* outer /* inner */ still outer */ DROP TABLE public.thing;\n',
    );
    expect(statements).toEqual(['DROP TABLE public.thing']);
  });

  it('does not mistake a `$1` placeholder for a dollar-quote opener', () => {
    const statements = splitSqlStatements('DELETE FROM t WHERE id = $1 AND name = $2;\n');
    expect(statements).toEqual(['DELETE FROM t WHERE id = $1 AND name = $2']);
  });

  it('reports zero statements for a script that is only prose', () => {
    expect(splitSqlStatements('-- DOWN\n-- See the sibling file.\n/* and a block note */\n')).toEqual(
      [],
    );
  });

  it('counts only the statements that reverse something as reversing', () => {
    expect(
      reversingStatements(["NOTIFY pgrst, 'reload schema'", 'DROP TABLE IF EXISTS t', 'notify x']),
    ).toEqual(['DROP TABLE IF EXISTS t']);
  });
});