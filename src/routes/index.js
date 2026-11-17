import { mountFileRoutes } from './files.js';
import { mountRootRoutes } from './roots.js';
import { mountSearchRoutes } from './search.js';

export function mountRoutes(api, limits) {
  mountRootRoutes(api);
  mountFileRoutes(api, limits);
  mountSearchRoutes(api, limits);
}
