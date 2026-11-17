import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { endpoints, type RootProject } from '@/lib/endpoints';

export type RootsState =
  | { status: 'loading' }
  | { status: 'ready'; projects: RootProject[] }
  | { status: 'error'; error: ApiError };

/** The projects and worktrees cc offers, loaded once and on `reload`. */
export function useRoots() {
  const [state, setState] = useState<RootsState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    endpoints.roots(controller.signal).then(
      (r) => setState({ status: 'ready', projects: r.projects }),
      (e) => { if (!controller.signal.aborted) setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError(0, String(e)) }); },
    );
    return () => controller.abort();
  }, [nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}

/** The root a pending cc request names, when api/roots lists it (the worktree too, if one was named). */
export function resolveCcRequest(projects: RootProject[], cc: { project: string; worktree: string | null }): { project: string; worktree: string | null } | null {
  const p = projects.find((x) => x.name === cc.project);
  if (!p) return null;
  if (cc.worktree && !p.worktrees.some((w) => w.name === cc.worktree)) return null;
  return { project: p.name, worktree: cc.worktree };
}
