import { queryFlag, queryString, targetOf } from '../http/params.js';
import { clientAbort, route } from '../http/route.js';
import { listFiles, search } from '../fs/search.js';
import { Refusal } from '../refusals.js';

export function mountSearchRoutes(api, limits) {
  const ctx = { limits };

  api.get('/search', route(async (req, res) => {
    const target = targetOf(req.query);
    const q = queryString(req.query, 'q', { required: true });
    if (q === '') throw new Refusal('INVALID_ARGUMENT', 'q must not be empty');
    if (q.length > limits.MAX_QUERY_LENGTH) throw new Refusal('INVALID_ARGUMENT', `q is longer than ${limits.MAX_QUERY_LENGTH} characters`);
    if (q.includes('\0')) throw new Refusal('INVALID_ARGUMENT', 'q contains NUL');
    const regex = queryFlag(req.query, 'regex');
    const matchCase = queryFlag(req.query, 'case');
    res.json(await search(target, { q, regex, matchCase }, { ...ctx, signal: clientAbort(req, res) }));
  }));

  api.get('/files', route(async (req, res) => {
    res.json(await listFiles(targetOf(req.query), { ...ctx, signal: clientAbort(req, res) }));
  }));
}
