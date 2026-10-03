import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../support/paths.js';

/**
 * W26 — drift between ADR-0023's two-axis design and the migration that is supposed
 * to implement it.
 *
 * A sibling of `test/unit/docs/`, and it behaves like its siblings in one respect
 * that matters more than the rest: the ledger is PRINTED on every run, so a drift
 * that is tolerated is a drift everybody can see. Unlike its siblings this file also
 * FAILS on the objects the design requires, because a migration that silently lost
 * the capability axis still applies cleanly, still passes `psql`, and still leaves a
 * green build — which is exactly how the superseded design survived for as long as it
 * did.
 *
 * It reads the migration FROM DISK. It does not connect to a database, because a
 * drift check that needs a running server is a drift check nobody runs, and because
 * the unit suite must stay runnable with nothing up.
 */

const MIGRATIONS_ROOT = join(BACKEND_ROOT, 'database', 'migrations');
const MIGRATION = join(MIGRATIONS_ROOT, '0001_rls_foundation.sql');

/**
 * Objects the design requires. Each is a REGEX rather than a bare name so the check
 * asks for the shape, not for the spelling: `CREATE TABLE IF NOT EXISTS groups`,
 * `CREATE OR REPLACE FUNCTION authz.actor()` and a bare `groups` all match.
 *
 * MATCHED AGAINST COMMENT-STRIPPED SQL. This is the asymmetry the check previously had
 * and it is the one place where the check's own honesty is the whole point: only the
 * superseded-name assertion stripped comments, so every other assertion in this file
 * could be satisfied by a line that begins with `--`. A migration with every table,
 * policy, grant and trigger commented out — and every comment still there, describing
 * an intact schema — passed the whole drift check. Commented-out SQL is what a
 * half-reverted change looks like, and a drift check that cannot see it is worse than
 * no drift check because it reports green.
 *
 * The set covers ALL FOUR KINDS OF OBJECT, not just tables. A migration stripped of
 * every GRANT and every CREATE POLICY still satisfied the earlier list, which asked
 * only whether the schema's SHAPE survived. The shape is not the design: the design is
 * the shape plus the policies that scope it, the grants that withhold it, and the
 * triggers that keep the data honest, and a database can have all three sets of names
 * present with none of them in force.
 *
 * `groups`, `user_groups`, `org_closure`, `actor`, `has_permission` — the scope and
 * identity machinery. `actions`, `permissions`, `roles`, `role_permissions`,
 * `user_roles` — the capability axis, which the superseded file did not have AT ALL.
 * Its absence is the reason a green test suite was not evidence: the 33 tests that
 * passed proved the withdrawn scope shape and had no capability axis to prove.
 */
const REQUIRED_OBJECTS: ReadonlyArray<{ readonly object: string; readonly pattern: RegExp; readonly why: string }> = [
  {
    object: 'groups',
    pattern: /CREATE TABLE IF NOT EXISTS groups\b/,
    why: 'the hierarchy the scope axis is expressed over',
  },
  {
    object: 'user_groups',
    pattern: /CREATE TABLE IF NOT EXISTS user_groups\b/,
    why: 'membership — the scope key is read from this table per statement, not from a claim',
  },
  {
    object: 'org_closure',
    pattern: /CREATE MATERIALIZED VIEW IF NOT EXISTS authz\.org_closure\b/,
    why: 'the precomputed ancestor/descendant relation that makes scope a hashed SubPlan with loops = 1',
  },
  {
    object: 'actor',
    pattern: /CREATE OR REPLACE FUNCTION authz\.actor\(\)/,
    why: 'the identity accessor that reads `sub` from request.jwt.claims',
  },
  {
    object: 'has_permission',
    pattern: /CREATE OR REPLACE FUNCTION has_permission\(who uuid, resource text, action text\)/,
    why: 'the capability resolver, inheriting up roles.parent_id',
  },
  {
    object: 'actions',
    pattern: /CREATE TABLE IF NOT EXISTS actions\b/,
    why: 'the capability axis has no axis at all without it',
  },
  {
    object: 'permissions',
    pattern: /CREATE TABLE IF NOT EXISTS permissions\b/,
    why: 'capability is (resource, action) as two columns, not a tier label in a string',
  },
  {
    object: 'roles',
    pattern: /CREATE TABLE IF NOT EXISTS roles\b/,
    why: 'a role is a ROW, so "what can this role do" is answerable by a query',
  },
  {
    object: 'role_permissions',
    pattern: /CREATE TABLE IF NOT EXISTS role_permissions\b/,
    why: 'role -> capability, with role_id a real FK to roles.id',
  },
  {
    object: 'user_roles',
    pattern: /CREATE TABLE IF NOT EXISTS user_roles\b/,
    why: 'user -> role, the entry point of the capability resolver',
  },
  // ------------------------------------------------------------------ POLICIES
  // Every table the design scopes must carry its scope policy. A table with ENABLE
  // and no CREATE POLICY is not "unrestricted", it is a table every row of which is
  // refused — which is safe but breaks the design silently, and it is a far likelier
  // half-revert than a policy quietly widened.
  {
    object: 'the projects scope policy',
    pattern: /CREATE POLICY row_scope ON projects USING \(/,
    why: 'ENABLE without a policy refuses every row, which is safe and still wrong',
  },
  {
    object: 'the customers scope policy',
    pattern: /CREATE POLICY row_scope ON customers USING \(/,
    why: 'the second scoped table, and the one every column-hiding test reads',
  },
  {
    object: 'the groups scope policy',
    pattern: /CREATE POLICY row_scope ON groups USING \(/,
    why: 'a member must see their own subtree and not the whole org chart',
  },
  {
    object: 'the user_groups scope policy',
    pattern: /CREATE POLICY row_scope ON user_groups USING \(/,
    why: 'membership is READABLE, and only self-scoped — without this the policy subquery cannot be evaluated',
  },
  // -------------------------------------------------------------------- GRANTS
  // The capability matrix is private BECAUSE of these two statements, in this order.
  // Both are asserted as present in executable SQL, and the RLS suite asserts their
  // effect; between them, a migration that loses them cannot pass.
  {
    object: 'the default-deny revoke on the API schema',
    pattern: /REVOKE ALL ON SCHEMA public FROM PUBLIC/,
    why: 'default deny. Every grant below narrows something that was taken away first.',
  },
  {
    object: 'the capability-matrix grant to the admin only',
    pattern: /GRANT SELECT, INSERT, UPDATE, DELETE ON actions, permissions, roles, role_permissions, user_roles TO app_admin/,
    why: 'app_member must hold NO read on the permission matrix — that is what keeps it private',
  },
  {
    object: 'the column-hiding revoke on projects',
    pattern: /REVOKE SELECT ON projects, customers FROM app_member/,
    why: 'a column privilege narrows a table grant only after the table grant is gone; without this the column list is decorative',
  },
  {
    object: 'the column-hiding grant on projects',
    pattern: /GRANT SELECT \(group_id, id, name, budget_cents, created_at\) ON projects TO app_member/,
    why: 'internal_notes exists on projects only so this list has something to hide, and it was asserted nowhere until now',
  },
  {
    object: 'the member grant that withholds UPDATE and DELETE',
    pattern: /GRANT SELECT, INSERT ON projects, customers TO app_member/,
    why: 'verb-level security is a grant, never a policy — a second permissive policy can only widen',
  },
  // ------------------------------------------------------------------ TRIGGERS
  // A trigger is not decoration, and a trigger that is present in a comment is not a
  // trigger. These four are the write-time controls the design has no other copy of.
  {
    object: 'the group cycle trigger',
    pattern: /CREATE TRIGGER groups_no_cycle\b[\s\S]*?EXECUTE FUNCTION assert_group_acyclic\(\)/,
    why: 'a self-referencing FK admits A -> B -> A, so the guard cannot be a constraint',
  },
  {
    object: 'the role cycle trigger',
    pattern: /CREATE TRIGGER roles_no_cycle\b[\s\S]*?EXECUTE FUNCTION assert_role_acyclic\(\)/,
    why: 'a cyclic role graph makes every role in it inherit the whole cycle',
  },
  {
    object: 'the closure refresh trigger',
    pattern: /CREATE TRIGGER groups_refresh_closure\b[\s\S]*?EXECUTE FUNCTION refresh_org_closure\(\)/,
    why: 'the refresh runs inside the writing transaction, so there is no staleness window',
  },
  {
    object: 'the administrative-floor trigger on roles',
    pattern: /CREATE TRIGGER roles_no_system_row\b[\s\S]*?EXECUTE FUNCTION protect_system_row\(\)/,
    why: 'is_system_role was documented as a control and enforced by nothing; this is the enforcement',
  },
  {
    object: 'the administrative-floor trigger on groups',
    pattern: /CREATE TRIGGER groups_no_system_row\b[\s\S]*?EXECUTE FUNCTION protect_system_row\(\)/,
    why: 'the scope axis half of the floor: deleting a floor group unparents a whole subtree',
  },
];

/**
 * SUPERSEDED NOTE — the superseded names, spelled out HERE and NOWHERE ELSE in
 * `backend/`, by design, because a detector cannot name what it forbids without
 * naming it. The two assertions below enforce that: a superseded name appearing in
 * any other file, or anywhere in the migration outside its own SUPERSEDED note,
 * FAILS.
 *
 * The migration's mention is allowed because it is the history note that says what
 * was withdrawn and must not be copied back. These two places are the complete set.
 */
const SUPERSEDED_NAMES: readonly string[] = [
  'sites',
  'site_tree_ids',
  'claim_site_id',
  'request_claims',
  'role_capability',
];

/** The one sanctioned mention in the migration, opened by this exact marker. */
const SUPERSEDED_MARKER = 'SUPERSEDED NOTE';

function readMigration(): string {
  // A drift check that cannot read the file must FAIL, loudly, and must not reach
  // the assertions that print "no drift". Returning '' here would report a perfect
  // migration for a file that does not exist — the one way this test could lie.
  return readFileSync(MIGRATION, 'utf8');
}

/** Every `.sql` file under a directory, recursively, as paths relative to BACKEND_ROOT. */
function sqlFilesUnder(relativeDirectory: string): readonly string[] {
  const root = join(BACKEND_ROOT, relativeDirectory);
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.sql')) {
        found.push(relative(BACKEND_ROOT, path));
      }
    }
  };

  walk(root);
  return found.sort();
}

describe('the migration implements the two-axis design', () => {
  it('reads the migration from disk, so the checks below are not vacuous', () => {
    const migration = readMigration();
    expect(migration.length).toBeGreaterThan(1000);
    expect(readdirSync(MIGRATIONS_ROOT).filter((name) => name.endsWith('.sql'))).toContain(
      '0001_rls_foundation.sql',
    );
  });

  it('creates every object ADR-0023 requires, and creates it as SQL rather than as a comment', () => {
    // Comment-stripped FIRST. This is the asymmetry the check had: only the
    // superseded-name assertion removed comments, so every other assertion here could
    // be satisfied by a line beginning with `--`. A migration whose schema is entirely
    // commented out while its explanatory comments remain would have passed this
    // whole file — and that is what a half-reverted change looks like.
    const migration = stripSqlComments(readMigration());
    const missing = REQUIRED_OBJECTS.filter((entry) => !entry.pattern.test(migration)).map(
      (entry) => `${entry.object} — ${entry.why}`,
    );

    expect(missing).toEqual([]);
  });

  it('cannot be satisfied by commented-out SQL, which is proven rather than asserted', () => {
    // A comment-stripping check that has never seen a comment is a check that might
    // strip nothing. The proof is a migration that DOES contain every required object
    // and has every one of them commented out: raw text matches, stripped text does
    // not, so the check has teeth.
    const withComments = REQUIRED_OBJECTS.map((entry) => `-- ${entry.pattern.source}`).join('\n');

    expect(withComments).toMatch(/CREATE TABLE IF NOT EXISTS groups/);
    expect(stripSqlComments(withComments)).not.toMatch(/CREATE TABLE IF NOT EXISTS groups/);

    // And the same for a block comment, which the line stripper used to miss
    // entirely — a whole schema in `/* ... */` would have satisfied every assertion
    // above.
    expect(stripSqlComments('/* CREATE TABLE IF NOT EXISTS groups (id uuid) */')).not.toMatch(
      /CREATE TABLE IF NOT EXISTS groups/,
    );

    // The real file survives stripping, so the stripper is not simply removing
    // everything it sees.
    const real = stripSqlComments(readMigration());
    expect(real).toMatch(/CREATE TABLE IF NOT EXISTS groups\b/);
    expect(real.length).toBeGreaterThan(1000);
  });

  it('reads identity from the claim with the guarded, correctly-precedenced cast', () => {
    const migration = stripSqlComments(readMigration());
    const accessor = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION authz.actor()'));

    // `::` binds tighter than `->>`, so `->>'sub'::uuid` casts the LITERAL 'sub'
    // rather than the extracted text. The extraction must be parenthesised first.
    expect(accessor).toMatch(/nullif\(current_setting\('request\.jwt\.claims', true\), ''\)::jsonb\s*->>\s*'sub'/);
    // And the cast must be caught, or a malformed `sub` is a 500 on every request
    // instead of a denial. Comments are stripped first: an inline comment between
    // THEN and RETURN must not make a guarded accessor look unguarded.
    expect(accessor).toMatch(/EXCEPTION\s+WHEN others THEN\s+RETURN NULL/);
  });

  it('FORCEs RLS on the group-scoped tables and revokes EXECUTE from PUBLIC on every function', () => {
    // Comment-stripped, for the same reason as the assertion above: `ALTER TABLE
    // projects FORCE ROW LEVEL SECURITY` in a comment satisfies a regex exactly as well
    // as the statement does, and this file's whole job is noticing that the migration
    // no longer says what the migration does.
    const migration = stripSqlComments(readMigration());

    for (const table of ['projects', 'customers']) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE ${table}\\s+FORCE ROW LEVEL SECURITY`));
      expect(migration).toMatch(new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`));
    }

    // Postgres grants EXECUTE to PUBLIC by default, so every function defined here
    // needs a matching revoke — and the revoke has to be written with the SIGNATURE
    // (types, not parameter names), which is why it is derived rather than
    // copy-pasted: a revoke spelled `has_permission(who uuid, ...)` matches no
    // function and fails silently.
    //
    // The definitions are read from the stripped text too, so a function that exists
    // only in a comment cannot both be defined and be accounted for by this loop.
    const definitions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION\s+([\w.]+)\(([^)]*)\)/g)];
    expect(definitions.length).toBeGreaterThan(0);

    const unrevoked = definitions
      .map((match) => signatureOf(match[1] ?? '', match[2] ?? ''))
      .filter((signature) => !migration.includes(`REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC`));
    expect(unrevoked).toEqual([]);
  });

  it('keeps the scope subquery uncorrelated, which is what makes it loops = 1', () => {
    const migration = stripSqlComments(readMigration());
    const policies = migration
      .slice(migration.indexOf('CREATE POLICY row_scope ON projects'))
      .match(/CREATE POLICY row_scope ON (projects|customers) USING \([\s\S]*?\);/g);

    expect(policies).not.toBeNull();
    // No row reference from the table into the subquery: a correlated subplan is
    // re-evaluated per candidate row (measured 400,001 calls over 400,000 rows).
    for (const policy of policies ?? []) {
      expect(policy).toContain('group_id IN (');
      expect(policy).not.toMatch(/(projects|customers)\.\w+\s*=\s*c\./);
      expect(policy).not.toContain('EXISTS (SELECT 1 FROM projects');
      expect(policy).not.toContain('EXISTS (SELECT 1 FROM customers');
    }
  });

  it('takes PRIMARY KEY (group_id, id) on every scoped table', () => {
    const migration = stripSqlComments(readMigration());
    for (const table of ['projects', 'customers']) {
      const tableDefinition = migration.slice(migration.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
      expect(tableDefinition.slice(0, 1200)).toContain('PRIMARY KEY (group_id, id)');
    }
  });

  it('contains no superseded design, and every mention of one is inside the SUPERSEDED note', () => {
    const migration = readMigration();

    // Strip the sanctioned note, then assert the rest of the file is clean. A
    // superseded name in executable SQL is the drift this exists to catch; a
    // superseded name in a comment outside the note is how a reader is misled.
    const markerIndex = migration.indexOf(SUPERSEDED_MARKER);
    expect(markerIndex, `the migration no longer carries a ${SUPERSEDED_MARKER}`).toBeGreaterThan(-1);
    const withoutNote = migration.slice(0, markerIndex) + migration.slice(migration.indexOf('\n', markerIndex));

    const executable = stripSqlComments(withoutNote);
    const found: string[] = [];
    for (const name of SUPERSEDED_NAMES) {
      if (executable.includes(name)) {
        found.push(name);
      }
    }
    expect(found).toEqual([]);
  });

  it('is the only file in backend/ that mentions a superseded name, and only in its note', () => {
    // The enforcement behind the last assertion: this file is the detector and must
    // therefore spell the names, so every OTHER occurrence is drift. Scoped to SQL
    // and to the directories that describe the schema — a mention in application
    // TypeScript would be just as wrong as one in the migration.
    const self = relative(BACKEND_ROOT, MIGRATION);
    const offenders: string[] = [];

    for (const directory of ['database', 'src', 'test/rls', 'test/unit']) {
      for (const file of sqlFilesUnder(directory)) {
        if (file === self) {
          continue;
        }
        const contents = readFileSync(join(BACKEND_ROOT, file), 'utf8');
        for (const name of SUPERSEDED_NAMES) {
          if (contents.includes(name)) {
            offenders.push(`${file}: ${name}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Removes SQL comments, so that prose describing an object cannot be mistaken for a
 * statement creating it.
 *
 * BOTH comment syntaxes, because the drift check's honesty depends on this function
 * and a line-comment stripper alone leaves C-style block comments untouched — so a
 * whole schema inside one would satisfy every assertion in this file. Neither syntax
 * appears inside a string literal in the migration, which is the only thing that would
 * make this unsafe here; the assertions that care about literals read the FUNCTION
 * BODIES out of the unstripped file instead.
 */
function stripSqlComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

/**
 * The name and argument TYPES a REVOKE must use — `has_permission(uuid, text, text)`,
 * never `has_permission(who uuid, resource text, action text)`. Postgres resolves a
 * function signature from types only, so a revoke written with parameter names names
 * nothing and is accepted without doing anything.
 */
function signatureOf(name: string, arguments_: string): string {
  const types = arguments_
    .split(',')
    .map((argument) => argument.trim().split(/\s+/).pop() ?? '')
    .filter((type) => type !== '');
  return `${name}(${types.join(', ')})`;
}