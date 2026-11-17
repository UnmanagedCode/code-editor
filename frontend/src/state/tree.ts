import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { endpoints, type Entry, type Target } from '@/lib/endpoints';
import { isUnder, retarget } from '@/lib/paths';

export type DirState =
  | { status: 'loading'; entries: Entry[]; truncated: boolean }
  | { status: 'loaded'; entries: Entry[]; truncated: boolean }
  | { status: 'error'; entries: Entry[]; truncated: boolean; error: ApiError };

const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : String(e)));

/**
 * The lazily loaded tree: a directory's children are fetched only when it is first expanded (the root on mount).
 * `reload` re-lists the given directories that are loaded; `reloadAll` every expanded one.
 */
export function useTree(target: Target) {
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const targetRef = useRef(target);
  targetRef.current = target;
  const generation = useRef(0);

  const load = useCallback(async (path: string) => {
    const gen = generation.current;
    setDirs((d) => ({ ...d, [path]: { status: 'loading', entries: d[path]?.entries ?? [], truncated: d[path]?.truncated ?? false } }));
    try {
      const r = await endpoints.list(targetRef.current, path);
      if (gen !== generation.current) return;
      setDirs((d) => ({ ...d, [path]: { status: 'loaded', entries: r.entries, truncated: r.truncated } }));
    } catch (e) {
      if (gen !== generation.current) return;
      setDirs((d) => ({ ...d, [path]: { status: 'error', entries: d[path]?.entries ?? [], truncated: false, error: asApiError(e) } }));
    }
  }, []);

  useEffect(() => {
    generation.current++;
    setDirs({});
    setExpanded(new Set(['']));
    void load('');
  }, [target.project, target.worktree, load]);

  const toggle = useCallback((path: string) => {
    const open = expandedRef.current.has(path);
    setExpanded((s) => { const n = new Set(s); if (open) n.delete(path); else n.add(path); return n; });
    if (!open && dirsRef.current[path]?.status !== 'loaded') void load(path);
  }, [load]);

  /** Expands every ancestor of `path` (so a file opened by quick-open or search is visible), loading what is not yet loaded. */
  const reveal = useCallback((path: string) => {
    const parts = path.split('/').slice(0, -1);
    const chain = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    setExpanded((s) => new Set([...s, ...chain]));
    for (const d of chain) if (dirsRef.current[d]?.status !== 'loaded') void load(d);
  }, [load]);

  const reload = useCallback((paths: string[]) => {
    for (const p of new Set(paths)) if (p === '' || expandedRef.current.has(p) || dirsRef.current[p]) void load(p);
  }, [load]);

  const reloadAll = useCallback(() => { for (const p of expandedRef.current) void load(p); }, [load]);

  /** Forgets a deleted directory's cached listings and expansion. */
  const forget = useCallback((path: string) => {
    setDirs((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !isUnder(k, path))));
    setExpanded((s) => new Set([...s].filter((k) => !isUnder(k, path))));
  }, []);

  /** Moves a renamed directory's cached listings and expansion to its new path. */
  const moved = useCallback((from: string, to: string) => {
    setDirs((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [isUnder(k, from) ? retarget(k, from, to) : k, v])));
    setExpanded((s) => new Set([...s].map((k) => (isUnder(k, from) ? retarget(k, from, to) : k))));
  }, []);

  return { dirs, expanded, toggle, reveal, reload, reloadAll, forget, moved };
}
