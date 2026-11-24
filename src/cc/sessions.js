import { Refusal } from '../refusals.js';
import { ccFetch, parseJson } from './fetch.js';

const DEAD = new Set(['exited', 'crashed']);

/**
 * The live cc sessions a comment can be sent to, from `GET /api/instances`. Only the fields the picker shows or matches
 * on pass through: a session row also carries its cwd, prompts and model, which the page has no use for.
 */
export async function listSessions() {
  const { res, text } = await ccFetch('/api/instances', {}, { timeoutMs: 15_000, retry: true });
  const rows = parseJson(text);
  if (res.status !== 200 || !Array.isArray(rows)) throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor GET /api/instances: HTTP ${res.status}`);
  const sessions = rows
    .filter((r) => typeof r?.sessionId === 'string' && r.sessionId && typeof r.project === 'string' && !DEAD.has(r.status))
    .map((r) => ({
      sessionId: r.sessionId,
      project: r.project,
      worktree: typeof r.worktree?.worktreeName === 'string' ? r.worktree.worktreeName : null,
      label: typeof r.displayLabel === 'string' ? r.displayLabel : r.sessionId,
      status: String(r.status),
      lastActive: typeof r.lastResponseAt === 'number' ? r.lastResponseAt : (typeof r.createdAt === 'number' ? r.createdAt : 0),
    }));
  return { sessions };
}
