import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { DEFAULT_API_ORIGIN, DEFAULT_POSTGREST_ORIGIN, mountApiProxy } from './server/api-proxy';
import { createCspMiddleware } from './server/csp';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// BEFORE the static handler and the Angular handler, so `/api` and `/rest` are
// never looked for in `browser/` and never reach a route. See `api-proxy.ts` for
// why these two prefixes exist at all.
mountApiProxy(app, '/api', process.env['API_ORIGIN'] ?? DEFAULT_API_ORIGIN, 'the application API');
mountApiProxy(
  app,
  '/rest',
  process.env['POSTGREST_ORIGIN'] ?? DEFAULT_POSTGREST_ORIGIN,
  'the PostgREST API layer',
);

// Content-Security-Policy for all documents and assets served by the application.
// Installed AFTER mountApiProxy so upstream API responses (/api, /rest) are not
// injected with document security headers, but BEFORE static files and Angular SSR.
app.use(createCspMiddleware());

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  /**
   * `SSR_PORT`, and never `PORT`.
   *
   * `PORT` is the thin Nest app's key and it arrives in this process by
   * accident: `backend/scripts/dev.mjs` and `prod.mjs` load `backend/.env`, which
   * sets `PORT=3000`, and used to hand the whole environment to this server
   * unchanged — so both listeners inherited one key and competed for one port. The
   * launchers now strip `PORT` from this child's environment and set `SSR_PORT`,
   * so the two ports cannot move together (§2.4: one key, one concern).
   *
   * The value is validated rather than parsed-and-hoped, because
   * `Number.parseInt('abc')` is `NaN` and `app.listen(NaN)` binds a port the
   * kernel picks — the process reports "listening" on a number nobody configured
   * and the readiness probe in the launcher waits out its 120 seconds for a
   * listener that is not on the port either of them chose (§2.3).
   */
  const configuredPort = process.env['SSR_PORT'] ?? '4000';
  const port = Number.parseInt(configuredPort, 10);
  if (!/^\d+$/.test(configuredPort) || port < 1 || port > 65535) {
    throw new Error(
      `SSR_PORT must be an integer between 1 and 65535, received '${configuredPort}'. ` +
        'It is this server\'s own key: the thin app listens on PORT, and the two must be set separately.',
    );
  }
  app.listen(port, '127.0.0.1', (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);