import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { endpoints, type RootProject } from '@/lib/endpoints';

/** The projects and worktrees cc offers, loaded on mount and on `reload`. The last good list stays while a reload runs or fails. */
export function useRoots() {
  const [projects, setProjects] = useState<RootProject[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    endpoints.roots(controller.signal).then(
      (r) => { setProjects(r.projects); setError(null); setLoading(false); },
      (e) => { if (!controller.signal.aborted) { setError(e instanceof ApiError ? e : new ApiError(0, String(e))); setLoading(false); } },
    );
    return () => controller.abort();
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { projects, error, loading, reload };
}

/** The root a pending cc request names, when api/roots lists it (the worktree too, if one was named). */
export function resolveCcRequest(projects: RootProject[], cc: { project: string; worktree: string | null }): { project: string; worktree: string | null } | null {
  const p = projects.find((x) => x.name === cc.project);
  if (!p) return null;
  if (cc.worktree && !p.worktrees.some((w) => w.name === cc.worktree)) return null;
  return { project: p.name, worktree: cc.worktree };
}
