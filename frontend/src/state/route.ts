import { useCallback, useEffect, useState } from 'react';

/** The UI route, kept in the query string (never the hash: cc's history contract reserves it, and a query survives reload). */
export type Route = { project: string | null; worktree: string | null; file: string | null };
/** What a cc ⋮ menu item appended: untrusted text, validated against api/roots before it becomes a Route. */
export type CcRequest = { project: string; worktree: string | null };

export const EMPTY_ROUTE: Route = { project: null, worktree: null, file: null };

const nonEmpty = (v: string | null): string | null => (v ? v : null);

export function parseSearch(search: string): { route: Route; cc: CcRequest | null } {
  const p = new URLSearchParams(search);
  const ccProject = nonEmpty(p.get('ccProject'));
  const route: Route = ccProject
    ? { ...EMPTY_ROUTE }
    : { project: nonEmpty(p.get('project')), worktree: nonEmpty(p.get('worktree')), file: nonEmpty(p.get('file')) };
  if (!route.project) { route.worktree = null; route.file = null; }
  return { route, cc: ccProject ? { project: ccProject, worktree: nonEmpty(p.get('ccWorktree')) } : null };
}

export function buildSearch(route: Route): string {
  const p = new URLSearchParams();
  if (route.project) {
    p.set('project', route.project);
    if (route.worktree) p.set('worktree', route.worktree);
    if (route.file) p.set('file', route.file);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * The route from the URL, re-read on `popstate`. `cc` is a pending ccProject/ccWorktree request: the cc parameters are
 * consumed (removed from the URL) when read, and `resolveCc` turns a validated one into the route.
 */
export function useRoute() {
  const initial = parseSearch(window.location.search);
  const [route, setRouteState] = useState<Route>(initial.route);
  const [cc, setCc] = useState<CcRequest | null>(initial.cc);

  const write = useCallback((next: Route) => {
    const url = `${window.location.pathname}${buildSearch(next)}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);

  useEffect(() => {
    if (initial.cc) write(EMPTY_ROUTE); // consume the cc parameters
    const onPop = () => {
      const parsed = parseSearch(window.location.search);
      setRouteState(parsed.route);
      setCc(parsed.cc);
      if (parsed.cc) write(EMPTY_ROUTE);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRoute = useCallback((next: Route) => { setRouteState(next); write(next); }, [write]);
  /** Updates only the open file (the active tab), leaving the root. */
  const setFile = useCallback((file: string | null) => {
    setRouteState((r) => { const next = { ...r, file }; write(next); return next; });
  }, [write]);
  const clearCc = useCallback(() => setCc(null), []);

  return { route, setRoute, setFile, cc, clearCc };
}
