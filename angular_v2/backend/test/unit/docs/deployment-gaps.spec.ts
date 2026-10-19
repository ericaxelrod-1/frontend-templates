import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, relativeToRepository } from '../../support/paths.js';

/**
 * `docs/deployment-guide.md` §`Not yet present` is a list of ABSENCES, and an
 * absence that is no longer true is worse than no entry at all: it is asserted
 * in the same confident voice as the parts of the guide that are true, and a
 * deployment document is the artifact a reader — and an agent — trusts most.
 *
 * That is not hypothetical. This section previously claimed `app.routes.ts` was
 * empty when it carried fifteen routes, that no route sent an email when four
 * did, and that the frontend had no HTTP layer when it had a base-URL module,
 * three services and two proxy configurations. Hand-correcting that list fixes it
 * until the next unit lands and then it is wrong again — the rot is structural,
 * not clerical, which is how this template's inherited v1 guide ended up
 * describing SQLite, MailDev and a `4200` dev server long after the architecture
 * moved. So the list is MACHINE-CHECKED, and this file is the mechanism.
 *
 * ## What it checks
 *
 * Each entry names the tree state that makes it true, and this file re-derives
 * that state. **It never reads the prose to decide whether an absence holds** —
 * a guard that compared the document against itself would be a tautology. The
 * document is read for exactly one thing: *which entries exist*, via a
 * `<!-- gap:… -->` marker on each bullet. The substance comes from the tree.
 *
 * That marker buys the direction that matters most. Two sets must agree exactly:
 *
 *   - a bullet with no marker, or with no entry in `GAPS` below, fails — so a
 *     new gap cannot be documented without deciding how it is checked;
 *   - an entry in `GAPS` with no bullet fails — so deleting a bullet requires
 *     deleting its check, which is a deliberate edit rather than a silent one.
 *
 * And building the thing fails: add a CAPTCHA issuer, a `.github/` directory or
 * a `db:create` script and the matching entry goes red, because the absence it
 * documents has stopped being true. The fix is to delete the bullet, never to
 * relax the check.
 *
 * ## File-absence versus behaviour-absence — not the same kind of assertion
 *
 * `kind` on every entry says which, and `cannot` says what the check is blind
 * to. Both are printed, because an assertion that cannot fail is worse than no
 * assertion:
 *
 *   - **file-absence** ("no CI", "no container config") — the thing is a file
 *     with a conventional name, so the check is near-exhaustive and its limit is
 *     a name outside the pattern.
 *   - **behaviour-absence** ("no CAPTCHA issuer", "no telemetry producer") — the
 *     thing is code INSIDE files that exist, so the check is a keyword gate over
 *     source text. It is a heuristic, and each entry states its blind spot. A
 *     producer reaching a table through a generated identifier, or a CAPTCHA
 *     provider that never says "captcha", passes. These entries are worth having
 *     and worth distrusting in exactly the proportion stated.
 *
 * Every check also carries a `probe`: the same scanner run over a synthetic tree
 * in which the thing IS built. The suite below asserts every probe is non-empty,
 * because a scanner that matches nothing is indistinguishable from a clean tree
 * — the same argument `stack-ports.spec.ts` makes for its port literal scanner.
 */

type Kind = 'file-absence' | 'behaviour-absence' | 'script-absence';

type Gap = {
  readonly id: string;
  readonly kind: Kind;
  /** Restated so a red run says which claim broke. */
  readonly claim: string;
  /** What this check is blind to. Printed with the ledger. */
  readonly cannot: string;
  /** Problems with the tree as it stands. Empty means the absence still holds. */
  readonly problems: () => readonly string[];
  /** Problems with a synthetic tree in which the thing IS built. Never empty. */
  readonly probe: () => readonly string[];
};

type Source = { readonly path: string; readonly text: string };

// ---------------------------------------------------------------------------
// Reading the tree.
// ---------------------------------------------------------------------------

/**
 * Vendored and generated code is not read. `schema.ts` is emitted by
 * `openapi-typescript` from `openapi.json` and carries an entry for every table
 * in the database, so a grep for "does the source mention `captcha`" would
 * answer yes about the STORAGE and go red on a build artifact rather than on a
 * producer. Specs are excluded for the same reason more softly: a test may
 * legitimately name a thing that production code does not.
 */
const NOT_SOURCE =
  /(^|[/\\])(node_modules|dist|coverage)([/\\]|$)|\.(?:spec|stories)\.ts$|[/\\]app[/\\]api[/\\]schema\.ts$/;

/** Application code, which is what a behaviour claim is about. */
const CODE_ROOTS = ['backend/src', 'backend/scripts', 'frontend/src'] as const;

/** The migrations and the seed, for claims about the SCHEMA. */
const SQL_ROOTS = ['backend/database'] as const;

function walk(directory: string, into: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (NOT_SOURCE.test(full)) {
      continue;
    }
    if (entry.isDirectory()) {
      walk(full, into);
    } else if (entry.isFile()) {
      into.push(full);
    }
  }
  return into;
}

/**
 * Comments are stripped before a behaviour claim is tested, because these files
 * discuss their own absences at length — `0022` says "nothing in `backend/src/`
 * issues a challenge" — and prose about a gap must not read as the gap filling
 * in. The cost is that a `//` inside a string literal goes too, which is
 * harmless for every pattern below.
 */
function stripComments(text: string, path: string): string {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return /\.(?:ts|mjs|js|sql)$/.test(path)
    ? withoutBlocks.replace(/^[^\S\n]*(?:--|\/\/).*$/gm, '')
    : withoutBlocks;
}

function sourcesUnder(roots: readonly string[]): Source[] {
  return roots
    .flatMap((root) => walk(join(REPOSITORY_ROOT, root)))
    // `relative()` returns OS-NATIVE separators, so on Windows every path arrived as
    // `frontend\\src\\...` and `path.startsWith('frontend/src/')` matched NOTHING. The
    // frontend half of the `consent-ui` check was therefore vacuous on the machine
    // this suite actually runs on, and an absence it should have caught went
    // unnoticed for exactly as long as it took to be untrue. Normalised to `/`
    // here, at the one place paths enter the corpus, so every comparison below is
    // platform-independent.
    .map((file) => ({
      path: relativeToRepository(file).split('\\').join('/'),
      text: stripComments(readFileSync(file, 'utf8'), file),
    }));
}

/**
 * `carveOut` removes one exact token before the pattern is applied. It exists
 * for a COLUMN NAME that legitimately appears in application code — the three
 * `captcha_required_count` hits are a selected field, not a challenge — and it
 * is a whole-token replacement rather than a widened pattern, so nothing
 * adjacent to it can hide.
 */
function hits(sources: readonly Source[], pattern: RegExp, carveOut?: string): string[] {
  return sources
    .filter((source) => {
      const text = carveOut === undefined ? source.text : source.text.split(carveOut).join(' ');
      return pattern.test(text);
    })
    .map((source) => source.path)
    .sort();
}

const CODE = sourcesUnder(CODE_ROOTS);
const SQL = sourcesUnder(SQL_ROOTS);

/**
 * TypeScript and the launcher scripts, for claims about CODE rather than about
 * markup. A template that renders a column named `captcha_required_count` is a
 * page, not an implementation, and `app.routes.ts` naming `/verify-email` is a
 * route table, not a challenge.
 */
const LOGIC = CODE.filter((source) => /\.(?:ts|mjs|js)$/.test(source.path));

/** `postgrest.conf` and `angular.json`: configuration, not application code. */
const CONFIG = ['postgrest.conf', 'frontend/angular.json'].map((path) => ({
  path,
  text: stripComments(readFileSync(join(REPOSITORY_ROOT, path), 'utf8'), path),
}));

/**
 * The environment files, read rather than listed so a new mode is covered — the
 * idiom `erasure-environment.spec.ts` uses. A geo-blocking key cannot be added
 * without one of these carrying it, which is what makes the check meaningful;
 * the examples are committed, so it is not vacuous on a machine without a `.env`.
 */
const ENVIRONMENTS = readdirSync(join(REPOSITORY_ROOT, 'backend'))
  .filter((name) => name === '.env' || name.startsWith('.env.'))
  .sort()
  .map((name) => ({ path: `backend/${name}`, text: readFileSync(join(REPOSITORY_ROOT, 'backend', name), 'utf8') }));

type Manifest = { readonly where: string; readonly scripts: Record<string, string> };

/**
 * The three committed manifests, read rather than listed so a new project is
 * covered. Narrowed through `unknown` because `JSON.parse` returns `any`, which
 * `recommendedTypeChecked` refuses to let reach a typed binding.
 */
function manifests(): readonly Manifest[] {
  return ['.', 'backend', 'frontend'].map((project) => {
    const label = project === '.' ? 'package.json' : `${project}/package.json`;
    const manifest: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, project, 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null || !('scripts' in manifest)) {
      throw new TypeError(`${label} has no scripts object`);
    }
    const declared: unknown = manifest.scripts;
    if (typeof declared !== 'object' || declared === null) {
      throw new TypeError(`${label} scripts is not an object`);
    }
    const scripts: Record<string, string> = {};
    for (const [name, command] of Object.entries(declared)) {
      if (typeof command === 'string') {
        scripts[name] = command;
      }
    }
    return { where: label, scripts };
  });
}

function scriptLines(manifestsToRead: readonly Manifest[]): string[] {
  return manifestsToRead
    .flatMap((manifest) =>
      Object.entries(manifest.scripts).map(([name, command]) => `${manifest.where} script '${name}': ${command}`),
    )
    .sort();
}

function scriptHits(pattern: RegExp, manifestsToRead: readonly Manifest[] = manifests()): string[] {
  return scriptLines(manifestsToRead).filter((line) => pattern.test(line));
}

/** One level of the repository root, `backend/`, `frontend/` and `docs/`. */
const SCANNED_DIRECTORIES = ['', 'backend', 'frontend', 'docs'] as const;

function listings(): string[] {
  return SCANNED_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(REPOSITORY_ROOT, directory)).map((name) =>
      directory === '' ? name : `${directory}/${name}`,
    ),
  );
}

/**
 * File and directory NAME checks; nothing here descends. One level is a
 * deliberate bound — walking `node_modules` takes minutes — so every entry using
 * this says so as its limit rather than letting a reader assume coverage.
 */
function namedLike(pattern: RegExp, names: readonly string[] = listings()): string[] {
  return names.filter((name) => pattern.test(name)).sort();
}

const DEPLOYMENT_MANIFEST =
  /^(?:[Dd]ockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|Procfile|fly\.toml|render\.ya?ml|vercel\.json|netlify\.toml|Vagrantfile|[\w.-]+\.(?:service|socket|timer)|k8s|kubernetes|helm|charts|ansible)$/;

const PIPELINE_DEFINITION =
  /^\.github$|^gitlab-ci\.ya?ml$|^\.circleci$|^azure-pipelines\.ya?ml$|^\.travis\.ya?ml$|^Jenkinsfile$|^\.drone\.ya?ml$|^buildkite\.ya?ml$|^bitbucket-pipelines\.ya?ml$|^appveyor\.ya?ml$|^\.woodpecker\.ya?ml$|^cloudbuild\.ya?ml$/;

/**
 * The second half of the `ci` entry, which is not a file name at all: `ci` is an
 * npm lifecycle name, so a manifest that declares one shadows `npm ci`. Whatever
 * the pipeline file is called, this catches it.
 */
function ciScriptProblems(manifestsToRead: readonly Manifest[] = manifests()): string[] {
  return manifestsToRead.filter((manifest) => 'ci' in manifest.scripts).map((manifest) => `${manifest.where} declares a 'ci' script`);
}

// ---------------------------------------------------------------------------
// The document, read for its ENTRY LIST and nothing else.
// ---------------------------------------------------------------------------

const GUIDE = readFileSync(join(REPOSITORY_ROOT, 'docs', 'deployment-guide.md'), 'utf8');

const HEADING = '## Not yet present';
const MARKER = /<!--\s*gap:([a-z0-9-]+)\s*-->/;

function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start === -1) {
    throw new Error(`${heading} is not in docs/deployment-guide.md; this guard has nothing to check`);
  }
  const rest = markdown.slice(start + 1);
  const end = rest.indexOf('\n## ', heading.length);
  return end === -1 ? rest : rest.slice(0, end);
}

type Bullet = { readonly text: string; readonly id: string | undefined };

/** Top-level bullets only: a line beginning `- ` at column zero. */
function bulletsOf(section: string): Bullet[] {
  const bullets: { text: string; id: string | undefined }[] = [];
  for (const line of section.split('\n')) {
    const id = MARKER.exec(line)?.[1];
    if (line.startsWith('- ')) {
      bullets.push({ text: line.slice(2), id });
    } else if (bullets.length > 0) {
      const last = bullets[bullets.length - 1];
      bullets[bullets.length - 1] = { text: last?.text ?? '', id: last?.id ?? id };
    }
  }
  return bullets;
}

const bullets = bulletsOf(sectionOf(GUIDE, HEADING));
const documentedIds = bullets.flatMap((bullet) => (bullet.id === undefined ? [] : [bullet.id]));

// ---------------------------------------------------------------------------
// The ledger. One entry per `<!-- gap:… -->` marker, in the same order.
// ---------------------------------------------------------------------------

const TELEMETRY_TABLES = /\b(?:security_alerts|ip_reputation|security_detected_patterns|pattern_login_attempts)\b/;

/**
 * Writing a telemetry table takes one of two shapes, and both are named here
 * because they fail in different ways. The backend reaches Postgres through SQL,
 * so a producer says `INSERT INTO` / `UPDATE` / `DELETE FROM` against the table.
 * The browser reaches it through PostgREST, where a read and a write are the
 * same URL and only the HTTP verb distinguishes them — which is why the frontend
 * half is a check on the verb in any file that names a table, not on the URL.
 */
const TELEMETRY_SQL_WRITE =
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:ONLY\s+)?(?:public\.)?(?:security_alerts|ip_reputation|security_detected_patterns|pattern_login_attempts)\b/i;

// The optional generic argument matters: the frontend calls
// `this.http.post<string | { id?: string }>(...)`, and a pattern that required `(`
// straight after the verb did not match it — so a real write to a consent relation
// through the generated client was invisible to the check meant to catch it.
const NON_GET_VERB = /\bhttp\.(?:post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(/;

/**
 * Two clauses, because a producer has two shapes: SQL against a named table, and
 * a non-GET `HttpClient` verb in a file that names one — through PostgREST a read
 * and a write are the same URL and only the verb separates them.
 */
function telemetryWriters(corpus: readonly Source[]): string[] {
  return corpus
    .filter(
      (source) =>
        TELEMETRY_TABLES.test(source.text) && (TELEMETRY_SQL_WRITE.test(source.text) || NON_GET_VERB.test(source.text)),
    )
    .map((source) => `${source.path} writes to a security-telemetry table`)
    .sort();
}

/** Vendor and product names, not the word "geoip". */
const GEO_PROVIDER = /maxmind|geolite2|ipinfo|ipstack|ip-?api\b|ip2location|ipgeolocation/i;

const TRACKER =
  /googletagmanager|google-analytics|\bgtag\(|connect\.facebook\.net|\bfbq\(|\bhotjar\b|\bmatomo\b|\bpiwik\b|plausible\.io|clarity\.ms|\bmixpanel\b/i;

const PROVISION = /\bdb:(?:create|database)\b|\bcreatedb\b|CREATE\s+(?:ROLE|DATABASE)\b/i;

const GEO_BLOCKING_KEY = /\b(?:GEO_BLOCK|GEOIP|ALLOWED_COUNTR|COUNTRY_ALLOWLIST)/i;

const POLICY_HEADER = /content-security-policy|contentSecurityPolicy|\bhelmet\b/i;

const COOKIE_USE = /document\.cookie|\bSet-Cookie\b|cookie-consent|cookie_consent\b/i;



const GAPS: readonly Gap[] = [
  {
    id: 'db-create',
    kind: 'script-absence',
    claim: 'no npm script provisions the owner role or the database',
    cannot:
      'Reads the three committed manifests, so it sees every script the repository declares. It cannot see a script declared anywhere else, and it cannot see an operator running `createdb` by hand — which is exactly the case the guide walks through.',
    problems: () => scriptHits(PROVISION).map((line) => `${line} provisions the role or the database`),
    probe: () =>
      scriptHits(PROVISION, [{ where: 'backend/package.json', scripts: { 'db:create': 'createdb -O app app_dev' } }]),
  },
  {
    id: 'captcha-logic',
    kind: 'behaviour-absence',
    claim: 'the `captcha` table is storage; nothing issues or verifies a challenge',
    cannot:
      'Two halves, and they are not equally strong. The schema half is exhaustive — it reads the migrations, so dropping the table is caught. The behavioural half is a keyword gate over TypeScript and the launcher scripts: it removes the exact token `captcha_required_count` and then requires zero occurrences of `captcha`. A challenge implemented without ever using that word passes, as does one implemented in a file outside the four roots read here.',
    problems: () => [
      ...hits(LOGIC, /captcha/i, 'captcha_required_count').map(
        (path) => `${path} mentions captcha, so an issuer or a verifier may exist`,
      ),
      ...(SQL.some((source) => /CREATE TABLE[^;]*\bcaptcha\b/i.test(source.text))
        ? []
        : ["no migration creates a `captcha` table, so this entry's \"storage exists\" half is no longer true"]),
    ],
    probe: () =>
      hits(
        [
          {
            path: 'backend/src/auth/captcha.service.ts',
            text: "client.query('SELECT challenge, solution_hash FROM public.captcha WHERE token_hash = $1', [hash]);",
          },
        ],
        /captcha/i,
      ),
  },
  {
    id: 'geo-resolver',
    kind: 'behaviour-absence',
    claim: 'nothing derives a place from an address, and nothing can block by country',
    cannot:
      'Two keyword gates: a list of geolocation VENDOR names over application code, and a list of geo-blocking CONFIG KEYS over the environment files. A resolver pointed at a vendor not on the first list passes, and so does a blocklist read from anywhere but an env file. The vendor list names products rather than the bare word "geoip", because `users.geo_source` uses `geoip` as a provenance LABEL and a check that flagged it would be reporting the column this tree does read.',
    problems: () => [
      ...hits(CODE, GEO_PROVIDER).map((path) => `${path} names a geolocation provider`),
      ...hits(ENVIRONMENTS, GEO_BLOCKING_KEY).map((path) => `${path} configures geo-blocking`),
    ],
    probe: () =>
      hits(
        [{ path: 'backend/src/config/environment.ts', text: 'const reader = new MaxMind.GeoLite2.Reader();' }],
        GEO_PROVIDER,
      ),
  },
  {
    id: 'telemetry-producers',
    kind: 'behaviour-absence',
    claim: 'no application code writes the four security-telemetry tables',
    cannot:
      'The tightest check in this file, and it is two clauses because a producer has two shapes: SQL `INSERT INTO` / `UPDATE` / `DELETE FROM` / `TRUNCATE` against a named table in application code or a launcher script, and a non-GET `HttpClient` verb in any frontend file that names one — because through PostgREST a read and a write are the same URL and only the verb separates them. It does not read `database/seed.ts`, which writes `is_mock = true` fixtures on purpose, and it cannot see a table name assembled by concatenation.',
    problems: () => telemetryWriters(CODE),
    probe: () =>
      telemetryWriters([
        {
          path: 'backend/src/security/alert-writer.ts',
          text: 'client.query(`INSERT INTO security_alerts (alert_type) VALUES ($1)`, [type]);',
        },
        {
          path: 'frontend/src/app/features/security/alert-service.ts',
          text: "this.http.post(`${POSTGREST_BASE_URL}/security_alerts`, row);",
        },
      ]),
  },
  {
    id: 'csp',
    kind: 'behaviour-absence',
    claim: 'nothing in either project sets a Content-Security-Policy',
    cannot:
      'Application source, `postgrest.conf`, `angular.json` and both manifests, for the header name, the Angular config key and `helmet`. It is blind to the place a policy is normally set — the reverse proxy in front of the stack — because that is outside the repository, and a deployment that sets it there is not contradicted by this entry.',
    problems: () =>
      hits([...CODE, ...CONFIG], POLICY_HEADER).map((path) => `${path} configures a content security policy`),
    probe: () =>
      hits(
        [{ path: 'backend/src/app.module.ts', text: 'app.register(helmet({ contentSecurityPolicy: { directives: {} } }));' }],
        POLICY_HEADER,
      ),
  },
  {
    id: 'cookies',
    kind: 'behaviour-absence',
    claim: 'no cookie is set or read, and no tracker is loaded',
    cannot:
      'A cookie-API grep over application code and the migrations, plus a fixed list of tracker vendors over application code. A tracker injected by a first-party script under a name not on that list would pass. The consent DECISION half of this entry left when the consent control shipped — a decision is now stored, in the browser for an anonymous visitor and in `consent_records` for a signed-in one — so the entry narrowed to the cookie and tracker halves, which are still true: this tree sets no cookie, reads no cookie, and loads no tracker. The session lives in `localStorage`, which GDPR does not classify as a cookie.',
    problems: () => [
      ...hits([...CODE, ...SQL], COOKIE_USE).map((path) => `${path} reads or writes a cookie`),
      ...hits(CODE, TRACKER).map((path) => `${path} loads a tracker that consent would have to gate`),
    ],
    probe: () =>
      hits(
        [{ path: 'frontend/src/index.html', text: '<script src="https://www.googletagmanager.com/gtag/js"></script>' }],
        TRACKER,
      ),
  },
  {
    id: 'container',
    kind: 'file-absence',
    claim: 'no container, systemd, or process-supervisor configuration',
    cannot:
      'File and directory NAMES at the repository root and one level into `backend/`, `frontend/` and `docs/`. Nothing descends, so a manifest three levels down is invisible, and a manifest named outside the pattern is invisible.',
    problems: () => namedLike(DEPLOYMENT_MANIFEST).map((name) => `${name} is a deployment manifest`),
    probe: () => namedLike(DEPLOYMENT_MANIFEST, ['Dockerfile.prod', 'frontend/nginx.conf']),
  },
  {
    id: 'ci',
    kind: 'file-absence',
    claim: 'no continuous-integration pipeline',
    cannot:
      'One-level NAME scan for the pipeline files this repository could plausibly gain, plus the `ci` script half. A pipeline that lives in a file named outside the pattern, or on a service this list does not name, is not caught.',
    problems: () => [
      ...namedLike(PIPELINE_DEFINITION).map((name) => `${name} is a pipeline definition`),
      ...ciScriptProblems(),
    ],
    probe: () => [
      ...namedLike(PIPELINE_DEFINITION, ['.github', 'backend/package.json']),
      ...ciScriptProblems([{ where: 'backend/package.json', scripts: { ci: 'npm run verify' } }]),
    ],
  },
  {
    id: 'openapi-regen',
    kind: 'script-absence',
    claim: 'the PostgREST Swagger 2.0 → OpenAPI 3 conversion is documented, not automated',
    cannot:
      'Reads the three manifests for `swagger2openapi` and asserts `openapi.json` is still committed at the repository root — the other half of the entry. It cannot see a conversion performed by hand into a different filename.',
    problems: () => [
      ...scriptHits(/swagger2openapi/i).map((line) => `${line} regenerates the committed spec`),
      ...(existsSync(join(REPOSITORY_ROOT, 'openapi.json')) ? [] : ['openapi.json is no longer committed at the repository root']),
    ],
    probe: () =>
      scriptHits(/swagger2openapi/i, [
        { where: 'backend/package.json', scripts: { 'generate:openapi': 'swagger2openapi openapi.json' } },
      ]),
  },
];

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

describe('the `Not yet present` section is a machine-checked ledger, not prose', () => {
  it('finds the section and its bullets, so the checks below are not vacuous', () => {
    expect(bullets.length).toBeGreaterThan(0);
    expect(documentedIds.length).toBeGreaterThan(0);
  });

  it('marks every bullet with a `gap:` marker, so a gap cannot be documented without a check', () => {
    const unmarked = bullets
      .filter((bullet) => bullet.id === undefined)
      .map((bullet) => `${bullet.text.slice(0, 72)}… (no <!-- gap:… --> marker)`);

    expect(unmarked).toEqual([]);
  });

  it('has exactly one check per marker, and one marker per check', () => {
    // The direction that is easy to skip: a check whose bullet has been deleted
    // is a check that has stopped asserting anything, and it would sit in this
    // file reading as a live control. ORDER is not asserted — a guide may
    // reorder its bullets — so the two lists are sorted; a duplicate, an orphan
    // and a missing check each fail the comparison.
    const checked = GAPS.map((gap) => gap.id).sort();

    expect(checked.filter((id) => !documentedIds.includes(id))).toEqual([]);
    expect([...documentedIds].sort()).toEqual(checked);
  });

  it('gives every entry a claim and a stated limit', () => {
    // `kind` needs no assertion: it is a required union, so the compiler has
    // already refused an entry without one. What nothing else enforces is the
    // sentence saying what the check cannot see, and an entry whose `cannot` is
    // blank is exactly the entry a reader trusts too far.
    const undescribed = GAPS.filter((gap) => gap.claim.trim() === '' || gap.cannot.trim() === '').map(
      (gap) => gap.id,
    );

    expect(undescribed).toEqual([]);
  });
});

describe('each absence the guide documents still holds', () => {
  it.each(GAPS)('$id — $claim', (gap) => {
    expect(gap.problems(), `${gap.id}: ${gap.claim}`).toEqual([]);
  });
});

describe('no check in this file can pass without its subject existing', () => {
  it.each(GAPS)('$id finds its subject in a synthetic tree', (gap) => {
    expect(gap.probe(), `the probe for ${gap.id} is vacuous — the check cannot fail`).not.toEqual([]);
  });

  it('the marker pattern is not vacuous either', () => {
    expect(MARKER.exec('<!-- gap:ci -->')?.[1]).toBe('ci');
    expect(MARKER.exec('<!--gap:db-create-->')?.[1]).toBe('db-create');
    expect(MARKER.exec('- an entry with no marker')).toBeNull();
  });
});

describe('the outstanding gaps are reported on every run', () => {
  it('prints the ledger, so what the template does not have is visible in the log', () => {
    const report = GAPS.map(
      (gap) => `  - ${gap.id} [${gap.kind}] ${gap.claim}\n      blind to: ${gap.cannot}`,
    ).join('\n');

    console.warn(
      `docs/deployment-guide.md §Not yet present documents ${String(GAPS.length)} absence(s):\n${report}`,
    );

    expect(report).toContain('blind to:');
  });
});