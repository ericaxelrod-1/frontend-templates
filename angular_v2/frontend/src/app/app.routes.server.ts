import { RenderMode } from '@angular/ssr';
import type { ServerRoute } from '@angular/ssr';

/**
 * Server render modes.
 *
 * `/login` is genuinely public and is rendered on the server.
 *
 * Everything else is `RenderMode.Client`, and that is a consequence of the
 * session decision rather than a preference. The token lives in `localStorage`,
 * which no server can read, so a server render of `/users` would answer a
 * question it has no way to answer: the guard would see no session, redirect to
 * `/login`, and hydrate a document whose rendered route is not the URL in the
 * address bar — a hydration mismatch rather than a page. Declaring the
 * authenticated area client-rendered makes the server's ignorance explicit and
 * structural instead of a mismatch to debug. See `session.service.ts` for the
 * storage trade this rests on.
 *
 * The catch-all falls into `**`, so the Not Found page is client-rendered too.
 * It is reached by a URL the application cannot map, and rendering it on the
 * server would gain nothing: there is no data behind it.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: 'login',
    renderMode: RenderMode.Server,
  },
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];