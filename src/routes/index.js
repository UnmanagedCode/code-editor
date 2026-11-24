import { mountFileRoutes } from './files.js';
import { mountRootRoutes } from './roots.js';
import { mountSearchRoutes } from './search.js';
import { mountSessionRoutes } from './sessions.js';

export function mountRoutes(api, limits) {
  mountRootRoutes(api);
  mountFileRoutes(api, limits);
  mountSearchRoutes(api, limits);
  mountSessionRoutes(api);
}
