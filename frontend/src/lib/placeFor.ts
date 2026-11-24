import type { RootProject } from './endpoints';
import { relPathError } from './paths';

/** Where an absolute path lives: a project (worktree null = its main checkout) and the file relative to that root. */
export type Place = { project: string; worktree: string | null; file: string };
/** cc's active session, as `ccBridge.session` reports it. */
export type SessionPlace = { project: string; worktree: string | null } | null | undefined;

/**
 * The root containing `abs`: the project or worktree whose path is the longest proper prefix of `abs` at a `/` boundary,
 * so a worktree nested under its project's tree wins over the project. Roots with identical paths (projects on different
 * Systems) tie: the one that is cc's active session's place wins, else there is no answer. Null too when no root contains
 * `abs` or the remainder is not a path the backend accepts.
 */
export function placeForPath(abs: string, projects: RootProject[], session: SessionPlace): Place | null {
  const roots = projects.flatMap((p) => [
    { path: p.path, project: p.name, worktree: null as string | null },
    ...p.worktrees.map((w) => ({ path: w.path, project: p.name, worktree: w.name as string | null })),
  ]);
  const containing = roots
    .flatMap((r) => (r.path ? [{ ...r, root: r.path.endsWith('/') ? r.path.slice(0, -1) : r.path }] : []))
    .filter((r) => abs.startsWith(`${r.root}/`));
  if (containing.length === 0) return null;
  const longest = Math.max(...containing.map((r) => r.root.length));
  const best = containing.filter((r) => r.root.length === longest);
  const chosen = best.length === 1 ? best[0]
    : best.find((r) => session && r.project === session.project && r.worktree === (session.worktree ?? null));
  if (!chosen) return null;
  const file = abs.slice(longest + 1);
  return relPathError(file) ? null : { project: chosen.project, worktree: chosen.worktree, file };
}
