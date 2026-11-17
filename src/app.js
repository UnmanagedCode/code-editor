import express from 'express';
import http from 'node:http';
import { route, sendError } from './http/route.js';
import { requestGuard, requireJson, securityHeaders } from './http/security.js';
import { serveDist } from './http/static.js';
import * as defaultLimits from './limits.js';
import { Refusal } from './refusals.js';
import { mountRoutes } from './routes/index.js';

/** The app: headers → health → /api (guard, JSON gate, routes) → UI → 404 → errors. `limits` overrides defaults in tests. */
export function createApp({ distDir, limits = {} }) {
  const effective = { ...defaultLimits, ...limits };
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(requestGuard);
  api.use(requireJson);
  mountRoutes(api, effective);
  api.use(route(async () => { throw new Refusal('NOT_FOUND', 'no such API route'); }));
  app.use('/api', api);

  app.use(serveDist(distDir));
  // Terminal 404 and error handlers: Express's own pages would replace the CSP.
  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof Refusal) return sendError(res, err);
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    if (req.path.startsWith('/api/')) {
      const code = status === 413 ? 'TOO_LARGE' : status < 500 ? 'INVALID_ARGUMENT' : 'INTERNAL';
      return res.status(status).json({ error: http.STATUS_CODES[status] ?? 'Error', code });
    }
    res.status(status).type('text/plain').send(http.STATUS_CODES[status] ?? 'Error');
  });
  return app;
}
