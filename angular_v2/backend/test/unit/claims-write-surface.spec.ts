import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_ROOT } from '../support/paths.js';

const SRC_ROOT = join(BACKEND_ROOT, 'src');
const DATABASE_ROOT = join(BACKEND_ROOT, 'database');

function tsFilesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.ts')) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort();
}

function sqlFilesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.endsWith('.sql')) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort();
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--');
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join('\n');
}

export function claimsWriteSurfaceFindings(source: string): string[] {
  const findings: string[] = [];
  if (/set_config\s*\(/i.test(source) && /request\.jwt\.claims|request\.jwt/.test(source)) {
    findings.push('set_config() reaches the claims GUC (the SET and the request.jwt.claims key co-occur)');
  }
  if (/set_config\s*\(\s*(?!['"`])/i.test(source)) {
    findings.push('set_config() names its setting through a variable or parameter instead of a literal');
  }
  if (/\bSET\b[^'"\n;]{0,20}['"]?\s*(\+|\$\{)/i.test(source)) {
    findings.push('SET builds its setting name by string concatenation or interpolation');
  }
  if (/\bSET\b[^;\n]{0,80}?request\.jwt\.claims|request\.jwt\.claims[^;\n]{0,80}?\bSET\b/i.test(source)) {
    findings.push('a SET statement names request.jwt.claims');
  }
  return findings;
}

type FunctionBody = {
  readonly name: string;
  readonly textParameters: ReadonlyArray<{ readonly name: string; readonly positional: string }>;
  readonly statements: readonly string[];
};

function parseFunctionBodies(sql: string): readonly FunctionBody[] {
  const functions: FunctionBody[] = [];
  const headerPattern = /CREATE (?:OR REPLACE )?FUNCTION\s+([\w.$]+)\s*\(([^)]*)\)/g;
  const headers = [...sql.matchAll(headerPattern)];

  for (const header of headers) {
    const name = header[1] ?? '';
    if (name.startsWith('authz.')) {
      continue;
    }
    const argumentsText = header[2] ?? '';
    const rest = sql.slice((header.index ?? 0) + header[0].length);
    const bodyMatch = /AS\s+\$\$([\s\S]*?)\$\$/.exec(rest);
    if (bodyMatch === null) {
      continue;
    }
    const textParameters: { readonly name: string; readonly positional: string }[] = [];
    argumentsText.split(',').forEach((argument, index) => {
      const trimmed = argument.trim();
      const named = /^(\w+)\s+(text|varchar|character varying)\b/i.exec(trimmed);
      const anonymous = /^(text|varchar|character varying)\b/i.exec(trimmed);
      if (named !== null && named[1] !== undefined) {
        textParameters.push({ name: named[1], positional: `$${index + 1}` });
      } else if (anonymous !== null) {
        textParameters.push({ name: '', positional: `$${index + 1}` });
      }
    });
    if (textParameters.length === 0) {
      continue;
    }
    functions.push({ name, textParameters, statements: (bodyMatch[1] ?? '').split(';') });
  }
  return functions;
}

function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rpcSettingsSurfaceFindings(sql: string): string[] {
  const findings: string[] = [];
  for (const fn of parseFunctionBodies(sql)) {
    for (const statement of fn.statements) {
      for (const parameter of fn.textParameters) {
        const referenced =
          (parameter.name !== '' && new RegExp(`\\b${escapeRegex(parameter.name)}\\b`).test(statement)) ||
          statement.includes(parameter.positional);
        if (!referenced) {
          continue;
        }
        const parameterPattern = parameter.name !== '' ? `${escapeRegex(parameter.name)}|${escapeRegex(parameter.positional)}` : escapeRegex(parameter.positional);
        if (new RegExp(`set_config\\s*\\(\\s*(?:${parameterPattern})\\b`, 'i').test(statement)) {
          findings.push(`${fn.name}: a text parameter is the set_config() target`);
        } else if (/\bEXECUTE\b/i.test(statement)) {
          findings.push(`${fn.name}: a text parameter flows into EXECUTE (SQL string from the caller)`);
        } else if (/quote_ident\s*\(/i.test(statement)) {
          findings.push(`${fn.name}: a text parameter is used to build an identifier`);
        } else if (/format\s*\(/i.test(statement) && /'[^']*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|TRUNCATE|SET|%I)[^']*'/i.test(statement)) {
          findings.push(`${fn.name}: a text parameter is used to build a SQL string via format()`);
        } else if (new RegExp(`\\bSET\\b[^;\\n]{0,40}?(?:${parameterPattern})`, 'i').test(statement)) {
          findings.push(`${fn.name}: a text parameter is a SET target`);
        }
      }
    }
  }
  return findings;
}

export function permissionOracleFindings(sql: string, srcSources: readonly string[]): string[] {
  const findings: string[] = [];
  for (const statement of sql.split(';')) {
    if (/GRANT\s[^;]*EXECUTE/i.test(statement) && /has_permission/i.test(statement) && /app_anon/i.test(statement)) {
      findings.push('has_permission is executable by app_anon');
    }
  }
  for (const source of srcSources) {
    if (/has_permission/i.test(source)) {
      findings.push('request-handling code references has_permission');
    }
  }
  return findings;
}

describe('W37 — the request.jwt.claims write surface stays absent', () => {
  it("a member can set request.jwt.claims verbatim and read another tenant's rows, so no request-handling pg client may reach that SET", () => {
    const findings = tsFilesUnder(SRC_ROOT).flatMap((file) =>
      claimsWriteSurfaceFindings(stripComments(readFileSync(file, 'utf8'))).map(
        (finding) => `${relative(BACKEND_ROOT, file)}: ${finding}`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it('no RPC over the public schema may take a setting name or a SQL fragment from the caller, because a POST to /rpc fills it verbatim', () => {
    const findings = sqlFilesUnder(DATABASE_ROOT).flatMap((file) =>
      rpcSettingsSurfaceFindings(stripComments(readFileSync(file, 'utf8'))).map(
        (finding) => `${relative(BACKEND_ROOT, file)}: ${finding}`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it('has_permission is never the CRUD enforcement point: it is neither granted to app_anon nor called from request-handling code, because its who= argument makes it a disclosure oracle', () => {
    const sql = sqlFilesUnder(DATABASE_ROOT)
      .map((file) => stripComments(readFileSync(file, 'utf8')))
      .join('\n');
    const srcSources = tsFilesUnder(SRC_ROOT).map((file) => stripComments(readFileSync(file, 'utf8')));
    expect(permissionOracleFindings(sql, srcSources)).toEqual([]);
  });

  it('the scanners fail on the vulnerable shapes, so the empty results above are not vacuous', () => {
    expect(
      claimsWriteSurfaceFindings("await pool.query('SELECT set_config($1, $2, true)', ['request.jwt.claims', '{}']);"),
    ).not.toEqual([]);
    expect(
      claimsWriteSurfaceFindings("await pool.query(`SET ${settingName} = on`);"),
    ).not.toEqual([]);
    expect(
      claimsWriteSurfaceFindings("await pool.query('SELECT set_config($1, $2, true)', ['statement_timeout', '0']);"),
    ).not.toEqual([]);
    expect(
      rpcSettingsSurfaceFindings(
        "CREATE FUNCTION public.evil(setting_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\nBEGIN\n  PERFORM set_config(setting_name, 'on', true);\nEND $$;",
      ),
    ).not.toEqual([]);
    expect(
      rpcSettingsSurfaceFindings(
        "CREATE FUNCTION public.evil(sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$\nBEGIN\n  EXECUTE sql;\nEND $$;",
      ),
    ).not.toEqual([]);
    expect(
      permissionOracleFindings('GRANT EXECUTE ON FUNCTION has_permission(uuid, text, text) TO app_anon;', []),
    ).not.toEqual([]);
    expect(permissionOracleFindings('const ok = await has_permission(who, resource, action);', ['const ok = await has_permission(who, resource, action);'])).not.toEqual([]);
    const benign = rpcSettingsSurfaceFindings(
      'CREATE OR REPLACE FUNCTION has_permission(who uuid, resource text, action text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM permissions p WHERE p.resource = $2 AND p.action_id = $3) $$;',
    );
    expect(benign).toEqual([]);
  });
});
