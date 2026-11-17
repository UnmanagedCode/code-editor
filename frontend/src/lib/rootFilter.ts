import type { RootProject } from '@/lib/endpoints';

export const NO_WORKSPACE = 'No workspace';

export type RootGroup = { workspace: string | null; projects: { project: RootProject; worktreeHit: boolean }[] };

/** Whether a project matches the filter, and whether only through one of its worktrees (so the row opens expanded). */
export function matchRoot(p: RootProject, filter: string): { hit: boolean; worktreeHit: boolean } {
  const q = filter.trim().toLowerCase();
  if (!q) return { hit: true, worktreeHit: false };
  if (p.name.toLowerCase().includes(q) || (p.workspace ?? '').toLowerCase().includes(q)) return { hit: true, worktreeHit: false };
  // A project that is unreachable or degraded lists no worktrees, so they cannot match.
  if (p.unreachable === null && p.degraded === null && p.worktrees.some((w) => w.name.toLowerCase().includes(q) || (w.branch ?? '').toLowerCase().includes(q))) return { hit: true, worktreeHit: true };
  return { hit: false, worktreeHit: false };
}

/** Matching projects grouped by workspace: groups alphabetical with "no workspace" last, projects alphabetical within. */
export function groupRoots(projects: RootProject[], filter: string): RootGroup[] {
  const by = new Map<string | null, RootGroup>();
  for (const project of projects) {
    const m = matchRoot(project, filter);
    if (!m.hit) continue;
    const ws = project.workspace || null;
    let g = by.get(ws);
    if (!g) { g = { workspace: ws, projects: [] }; by.set(ws, g); }
    g.projects.push({ project, worktreeHit: m.worktreeHit });
  }
  const groups = [...by.values()];
  for (const g of groups) g.projects.sort((a, b) => a.project.name.localeCompare(b.project.name));
  groups.sort((a, b) => (a.workspace === null ? 1 : b.workspace === null ? -1 : a.workspace.localeCompare(b.workspace)));
  return groups;
}

export const groupLabel = (g: RootGroup) => g.workspace ?? NO_WORKSPACE;
/** A key that keeps a workspace literally named "No workspace" apart from the no-workspace group. */
export const groupKey = (g: RootGroup) => (g.workspace === null ? 'none' : `ws:${g.workspace}`);
