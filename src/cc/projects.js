import { Refusal } from '../refusals.js';
import { ccFetch, parseJson } from './fetch.js';

/** The roots the picker offers: every cc project with its worktrees, from `GET /api/projects`. */
export async function listRoots() {
  const { res, text } = await ccFetch('/api/projects', {}, { timeoutMs: 15_000, retry: true });
  const rows = parseJson(text);
  if (res.status !== 200 || !Array.isArray(rows)) throw new Refusal('CONDUCTOR_UNAVAILABLE', `code-conductor GET /api/projects: HTTP ${res.status}`);
  const projects = rows.map((p) => ({
    name: String(p.name),
    system: typeof p.system === 'string' ? p.system : 'local',
    workspace: typeof p.workspace === 'string' && p.workspace ? p.workspace : null,
    remoteId: typeof p.remoteId === 'string' ? p.remoteId : null,
    unreachable: typeof p.systemUnreachable === 'string' ? p.systemUnreachable : null,
    degraded: typeof p.degraded === 'string' ? p.degraded : (p.path ? null : 'no path'),
    worktrees: (Array.isArray(p.worktrees) ? p.worktrees : []).map((w) => ({ name: String(w.worktreeName), branch: typeof w.branch === 'string' ? w.branch : null })),
  }));
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { projects };
}
