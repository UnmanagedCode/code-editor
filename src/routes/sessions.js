import { listSessions } from '../cc/sessions.js';
import { route } from '../http/route.js';

export function mountSessionRoutes(api) {
  api.get('/sessions', route(async (_req, res) => res.json(await listSessions())));
}
