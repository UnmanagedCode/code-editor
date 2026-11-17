import { listRoots } from '../cc/projects.js';
import { route } from '../http/route.js';

export function mountRootRoutes(api) {
  api.get('/roots', route(async (_req, res) => res.json(await listRoots())));
}
