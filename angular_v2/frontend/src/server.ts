import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { DEFAULT_API_ORIGIN, DEFAULT_POSTGREST_ORIGIN, mountApiProxy } from './server/api-proxy';

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
  const port = Number.parseInt(process.env['PORT'] ?? '4000', 10);
  app.listen(port, '127.0.0.1', (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);