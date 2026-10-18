import type { Express, Request, Response } from 'express';

/**
 * Same-origin proxy for the two backends.
 *
 * ## Why the browser cannot call them directly
 *
 * Neither service sends CORS headers: `backend/src/main.ts` registers no CORS
 * policy, and `postgrest.conf` sets no `cors-allowed-origins`. A browser at
 * `http://localhost:4000` calling `http://127.0.0.1:3001` is therefore refused
 * before the request leaves the page — which would make the whole API layer
 * unusable from a browser, and would tempt the next person into "fixing" it by
 * opening CORS on the database-facing service.
 *
 * The SSR server is already in the request path (it serves the application), so
 * it forwards these two prefixes. The browser then only ever makes same-origin
 * requests, and the bearer token is never offered to another origin.
 *
 * ## Configuration
 *
 * `API_ORIGIN` and `POSTGREST_ORIGIN` name the two upstreams. The values below
 * are the fallback for running this server on its own; `backend/scripts/dev.mjs`
 * and `prod.mjs` set both from the stack they start, so the three ports of a
 * running stack are decided in one place and no rebuild is needed to move them.
 * The fallback is this repository's own development stack — `PORT=3000` and
 * `POSTGREST_URL=http://127.0.0.1:3001` in `backend/.env.development.example`
 * and `server-port = 3001` in `postgrest.conf` — which is why the two numbers
 * here are held to those files by `backend/test/unit/stack-ports.spec.ts`
 * instead of being left to drift. Neither value is a credential and neither is
 * security-critical configuration, which is why these are the only defaulted
 * values in the frontend; nothing secret is defaulted anywhere.
 */

/** Headers that describe the hop, not the payload. Forwarding them corrupts both. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Set by this server for the browser; the upstream's own value is wrong here.
  'content-encoding',
  'content-length',
]);

export const DEFAULT_API_ORIGIN = 'http://127.0.0.1:3000';
export const DEFAULT_POSTGREST_ORIGIN = 'http://127.0.0.1:3001';

/**
 * `duplex: 'half'` is how Node's `fetch` is told the body is a stream, and it is
 * absent from the DOM `RequestInit` this file otherwise compiles against.
 */
type StreamedInit = RequestInit & { duplex?: 'half' };

/**
 * Installs `mount -> origin` on the app. Returns nothing; it mutates `app`, which
 * is how every other Express middleware is composed.
 */
export function mountApiProxy(
  app: Express,
  mount: string,
  origin: string,
  name: string,
): void {
  const target = new URL(origin);
  // `request.url`, not `request.originalUrl`: Express rewrites `url` to drop the
  // mount path but leaves `originalUrl` intact, so forwarding `originalUrl` would
  // send `/api/auth/login` upstream as `/api/auth/login` and every proxied call
  // would 404. That is not reachable from a unit test of this file, and it is not
  // reachable by reading the code — it is what the browser found.
  //
  // No `next` parameter: every path through this handler answers the response,
  // so it is never a middleware that falls through to the next one.
  app.use(mount, async (request: Request, response: Response) => {
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(new URL(request.url, target), {
        method: request.method,
        headers: forwardableHeaders(request.headers),
        ...(hasBody(request.method) ? streamBody(request) : {}),
        redirect: 'manual',
      });
    } catch (cause) {
      // A dead upstream is reported, not swallowed: a `200` with an empty body
      // would render as a page that loaded and found nothing.
      response.status(502).json({
        message: `${name} at ${target.origin} could not be reached`,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    for (const [header, value] of upstream.headers) {
      if (!HOP_BY_HOP.has(header) && value !== undefined) {
        response.setHeader(header, value);
      }
    }
    response.status(upstream.status);
    response.send(Buffer.from(await upstream.arrayBuffer()));
  });
}

function hasBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

/**
 * Forwards the request as a stream rather than buffering it.
 *
 * An Express `Request` *is* a Node `Readable` and undici accepts one, but the
 * compiler cannot see that: `BodyInit` here is the DOM `ReadableStream`, while
 * `Readable.toWeb()` returns `node:stream/web`'s, and since TypeScript 5.7 the
 * two are mutually unassignable because of `ArrayBufferLike` vs `ArrayBuffer`
 * variance. Converting to a web stream therefore fails for reasons that have
 * nothing to do with this code, so the one cast sits here. Buffering instead
 * would typecheck cleanly and quietly make every request body memory-resident.
 */
function streamBody(request: Request): StreamedInit {
  return { body: request as unknown as BodyInit, duplex: 'half' };
}

function forwardableHeaders(incoming: Request['headers']): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'host') {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}