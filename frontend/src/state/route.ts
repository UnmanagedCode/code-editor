import { useCallback, useEffect, useRef, useState } from 'react';
import type { LineRange } from '@/lib/ccLink';
import { MAX_LINK_LINE } from '@/lib/limits';

/** The UI route, kept in the query string (never the hash: cc's history contract reserves it, and a query survives reload). */
export type Route = { project: string | null; worktree: string | null; file: string | null };
/**
 * A request cc put in the query: untrusted text, resolved against api/roots before it changes the route.
 * - `place`: a ⋮ menu item's `ccProject`/`ccWorktree`.
 * - `path`: a deep link's `ccPath` (an absolute path on the project's System) with an optional `ccLine`/`ccEndLine` range;
 *   `invalid` when the path is not a clean absolute file path.
 */
export type CcRequest =
  | { kind: 'place'; project: string; worktree: string | null }
  | { kind: 'path'; path: string; range: LineRange | null; invalid: boolean };

export const EMPTY_ROUTE: Route = { project: null, worktree: null, file: null };

/** Every query key cc may add; each is removed from the URL once read. */
export const CC_KEYS = ['ccProject', 'ccWorktree', 'ccPath', 'ccLine', 'ccEndLine'] as const;

const nonEmpty = (v: string | null): string | null => (v ? v : null);
const DIGITS = /^[0-9]+$/;

/** A clean absolute POSIX file path: `/`-led, no NUL, no empty, `.` or `..` segment (so no trailing `/`). */
export function isCleanAbsPath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('\0')) return false;
  return path.slice(1).split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** `ccLine`/`ccEndLine` as a range: an invalid or missing line is no range; an end not past the line is a single line. */
export function parseLineRange(line: string | null, endLine: string | null): LineRange | null {
  if (line === null || !DIGITS.test(line)) return null;
  const start = Number(line);
  if (start < 1 || start > MAX_LINK_LINE) return null;
  if (endLine === null || !DIGITS.test(endLine)) return { start, end: null };
  const end = Math.min(Number(endLine), MAX_LINK_LINE);
  return { start, end: end > start ? end : null };
}

/** The route and any cc request in `search`. `consume` is true when any cc key is present (they are then stripped). `ccPath` wins over `ccProject`. */
export function parseSearch(search: string): { route: Route; cc: CcRequest | null; consume: boolean } {
  const p = new URLSearchParams(search);
  const consume = CC_KEYS.some((k) => p.has(k));
  let cc: CcRequest | null = null;
  if (p.has('ccPath')) {
    const path = p.get('ccPath') ?? '';
    cc = { kind: 'path', path, range: parseLineRange(p.get('ccLine'), p.get('ccEndLine')), invalid: !isCleanAbsPath(path) };
  } else {
    const ccProject = nonEmpty(p.get('ccProject'));
    if (ccProject) cc = { kind: 'place', project: ccProject, worktree: nonEmpty(p.get('ccWorktree')) };
  }
  const route: Route = consume
    ? { ...EMPTY_ROUTE }
    : { project: nonEmpty(p.get('project')), worktree: nonEmpty(p.get('worktree')), file: nonEmpty(p.get('file')) };
  if (!route.project) { route.worktree = null; route.file = null; }
  return { route, cc, consume };
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
 * The route from the URL, re-read on `popstate`. `cc` is a pending cc request: the cc keys are consumed (removed from the
 * URL) when read, and the App turns a resolved request into the route. A request arriving on `popstate` (cc's `navigate`
 * into an open page) leaves the current route in place, written back over the cc keys, so the open root stays open while
 * the request is resolved.
 */
export function useRoute() {
  const initial = parseSearch(window.location.search);
  const [route, setRouteState] = useState<Route>(initial.route);
  const [cc, setCc] = useState<CcRequest | null>(initial.cc);
  const current = useRef(route);

  const write = useCallback((next: Route) => {
    const url = `${window.location.pathname}${buildSearch(next)}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);
  const commit = useCallback((next: Route) => { current.current = next; setRouteState(next); write(next); }, [write]);

  useEffect(() => {
    if (initial.consume) write(EMPTY_ROUTE);
    const onPop = () => {
      const parsed = parseSearch(window.location.search);
      if (parsed.consume) write(current.current);
      else { current.current = parsed.route; setRouteState(parsed.route); }
      setCc(parsed.cc);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRoute = useCallback((next: Route) => commit(next), [commit]);
  /** Updates only the open file (the active tab), leaving the root. */
  const setFile = useCallback((file: string | null) => commit({ ...current.current, file }), [commit]);
  const clearCc = useCallback(() => setCc(null), []);

  return { route, setRoute, setFile, cc, clearCc };
}
