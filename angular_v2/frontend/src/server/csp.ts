import type { RequestHandler } from 'express';

/**
 * Parses space- or comma-delimited origin lists from an environment variable.
 */
export function parseOriginList(raw: string | undefined): readonly string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Assembles the Content-Security-Policy header value.
 *
 * ## The Tension Between Strict CSP and Consent Tags
 *
 * A strict CSP disallows 'unsafe-inline' and 'unsafe-eval'. However:
 * 1. Angular inlines component styles and Beasties inlines critical CSS into `<style>` tags.
 * 2. Beasties inlines a bootstrap script into `index.html` to toggle `link[data-beasties-media]`.
 * 3. The consent tag mechanism (`consent_tags.snippet` & `SnippetInjector`) executes
 *    third-party vendor snippets verbatim from the database, requiring dynamic inline scripts
 *    and `eval()` (`globalEval`).
 *
 * Therefore, `script-src` and `style-src` require `'unsafe-inline'`, and `script-src`
 * requires `'unsafe-eval'`.
 *
 * Operators can allow external vendor origins by setting `CSP_ALLOWED_ORIGINS`
 * (applied to script-src, connect-src, img-src, and frame-src) or specific directives
 * like `CSP_SCRIPT_SRC` and `CSP_CONNECT_SRC`. An explicit `CONTENT_SECURITY_POLICY`
 * environment variable overrides the assembled header completely.
 */
export function buildContentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const explicitPolicy = env['CONTENT_SECURITY_POLICY']?.trim();
  if (explicitPolicy) {
    return explicitPolicy;
  }

  const genericOrigins = parseOriginList(env['CSP_ALLOWED_ORIGINS']);
  const scriptOrigins = parseOriginList(env['CSP_SCRIPT_SRC']);
  const styleOrigins = parseOriginList(env['CSP_STYLE_SRC']);
  const connectOrigins = parseOriginList(env['CSP_CONNECT_SRC']);
  const imgOrigins = parseOriginList(env['CSP_IMG_SRC']);
  const fontOrigins = parseOriginList(env['CSP_FONT_SRC']);
  const frameOrigins = parseOriginList(env['CSP_FRAME_SRC']);

  const dedupe = (items: readonly string[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  };

  const scriptSources = dedupe(["'self'", "'unsafe-inline'", "'unsafe-eval'", ...genericOrigins, ...scriptOrigins]);
  const styleSources = dedupe(["'self'", "'unsafe-inline'", ...styleOrigins]);
  const connectSources = dedupe(["'self'", ...genericOrigins, ...connectOrigins]);
  const imgSources = dedupe(["'self'", 'data:', ...genericOrigins, ...imgOrigins]);
  const fontSources = dedupe(["'self'", ...fontOrigins]);
  const frameSources = dedupe(["'self'", ...genericOrigins, ...frameOrigins]);

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    `img-src ${imgSources.join(' ')}`,
    `font-src ${fontSources.join(' ')}`,
    `connect-src ${connectSources.join(' ')}`,
    `frame-src ${frameSources.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return directives.join('; ');
}

/**
 * Express middleware that adds the Content-Security-Policy header to responses.
 */
export function createCspMiddleware(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const policy = buildContentSecurityPolicy(env);
  return (_req, res, next): void => {
    res.setHeader('Content-Security-Policy', policy);
    next();
  };
}
