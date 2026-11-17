import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { EditorHost, EditorModel } from '@/editor/EditorHost';
import { isUnder, retarget } from '@/lib/paths';

/** The disk version shown by "View diff": its text, the hash Overwrite must then send, and whether the file is gone. */
export type DiskView = { text: string; hash: string | null; deleted: boolean };

export type Tab = {
  /** Stable across renames: asynchronous answers (a save's response) are matched to a tab by id, never by the path it had when the request left. */
  id: number;
  path: string;
  kind: 'text' | 'binary';
  /** Null for a binary file. */
  model: EditorModel | null;
  /** The sha256 the editor loaded or last saved; null when there is none (binary, truncated). */
  hash: string | null;
  savedVersionId: number;
  readOnly: boolean;
  truncated: boolean;
  size: number;
  /** The file starts with a U+FEFF byte order mark, which Monaco strips from the buffer; it is written back on save. */
  bom: boolean;
  limitBytes: number;
  conflict: { currentHash: string | null } | null;
  diff: DiskView | null;
  /** A 1-based line to reveal once the editor mounts (from a search result). */
  reveal: number | null;
};

export type TabsState = { tabs: Tab[]; active: string | null };
export const EMPTY_TABS: TabsState = { tabs: [], active: null };

export type TabsAction =
  | { type: 'open'; tab: Tab }
  | { type: 'activate'; path: string }
  | { type: 'close'; path: string }
  | { type: 'saved'; id: number; hash: string; versionId: number; size: number }
  | { type: 'conflict'; id: number; currentHash: string | null }
  | { type: 'diff'; id: number; diff: DiskView | null }
  | { type: 'reloaded'; id: number; hash: string | null; versionId: number; size: number; readOnly: boolean; truncated: boolean; bom: boolean }
  | { type: 'revealed'; id: number }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'removed'; path: string };

const patch = (s: TabsState, match: { path: string } | { id: number }, change: Partial<Tab>): TabsState => ({
  ...s,
  tabs: s.tabs.map((t) => (('id' in match ? t.id === match.id : t.path === match.path) ? { ...t, ...change } : t)),
});

let nextTabId = 1;
/** A fresh tab id. */
export const newTabId = (): number => nextTabId++;

/** Where the active tab goes when `gone` closes: the tab that slid into its place, else the one before it. */
function nextActive(before: Tab[], after: Tab[], gone: Set<string>, active: string | null): string | null {
  if (active === null || !gone.has(active)) return active;
  const i = before.findIndex((t) => t.path === active);
  const rest = before.slice(i + 1).find((t) => !gone.has(t.path));
  const prev = before.slice(0, i).reverse().find((t) => !gone.has(t.path));
  return (rest ?? prev)?.path ?? (after[0]?.path ?? null);
}

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'open':
      if (s.tabs.some((t) => t.path === a.tab.path)) return { ...patch(s, { path: a.tab.path }, a.tab.reveal === null ? {} : { reveal: a.tab.reveal }), active: a.tab.path };
      return { tabs: [...s.tabs, a.tab], active: a.tab.path };
    case 'activate':
      return s.tabs.some((t) => t.path === a.path) ? { ...s, active: a.path } : s;
    case 'close':
    case 'removed': {
      const gone = new Set(s.tabs.filter((t) => (a.type === 'close' ? t.path === a.path : isUnder(t.path, a.path))).map((t) => t.path));
      if (gone.size === 0) return s;
      const tabs = s.tabs.filter((t) => !gone.has(t.path));
      return { tabs, active: nextActive(s.tabs, tabs, gone, s.active) };
    }
    case 'saved':
      return patch(s, { id: a.id }, { hash: a.hash, savedVersionId: a.versionId, size: a.size, conflict: null, diff: null });
    case 'conflict':
      return patch(s, { id: a.id }, { conflict: { currentHash: a.currentHash } });
    case 'diff':
      return patch(s, { id: a.id }, { diff: a.diff });
    case 'reloaded':
      return patch(s, { id: a.id }, { hash: a.hash, savedVersionId: a.versionId, size: a.size, readOnly: a.readOnly, truncated: a.truncated, bom: a.bom, conflict: null, diff: null });
    case 'revealed':
      return patch(s, { id: a.id }, { reveal: null });
    case 'renamed':
      return {
        tabs: s.tabs.map((t) => (isUnder(t.path, a.from) ? { ...t, path: retarget(t.path, a.from, a.to) } : t)),
        active: s.active === null ? null : retarget(s.active, a.from, a.to),
      };
  }
}

/** Unsaved changes: the buffer's version differs from the one at load/save (undoing back to the saved text is clean). */
export const isDirty = (t: Tab): boolean => t.model !== null && !t.readOnly && t.model.getAlternativeVersionId() !== t.savedVersionId;

/** Tabs state plus the side effects the pure reducer cannot do: model disposal, language on rename, dirty re-render ticks. */
export function useTabs(host: EditorHost) {
  const [state, rawDispatch] = useReducer(tabsReducer, EMPTY_TABS);
  const [, setTick] = useState(0);
  const ref = useRef(state);
  ref.current = state;
  // The ref is advanced at dispatch time too, so an asynchronous caller that dispatches and then reads sees its own change
  // before React has rendered it.
  const dispatch = useCallback((a: TabsAction) => { ref.current = tabsReducer(ref.current, a); rawDispatch(a); }, []);
  /** The latest tabs, including changes dispatched but not yet rendered. */
  const getTabs = useCallback(() => ref.current.tabs, []);

  // Unmounting (a root switch) disposes every buffer. StrictMode's simulated unmount remounts at once, so disposal is
  // deferred a microtask and skipped when the component is alive again by then.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queueMicrotask(() => { if (!alive.current) for (const t of ref.current.tabs) t.model?.dispose(); });
    };
  }, []);

  const add = useCallback((tab: Tab) => {
    tab.model?.onDidChangeContent(() => setTick((n) => n + 1));
    dispatch({ type: 'open', tab });
  }, [dispatch]);

  /** Closes the tab at `path` (or every tab beneath it) and disposes the buffers. */
  const drop = useCallback((path: string, { subtree = false } = {}) => {
    const doomed = ref.current.tabs.filter((t) => (subtree ? isUnder(t.path, path) : t.path === path));
    dispatch({ type: subtree ? 'removed' : 'close', path });
    for (const t of doomed) t.model?.dispose();
  }, [dispatch]);

  const rename = useCallback((from: string, to: string) => {
    for (const t of ref.current.tabs) if (isUnder(t.path, from)) t.model?.setLanguage(host.languageFor(retarget(t.path, from, to)));
    dispatch({ type: 'renamed', from, to });
  }, [host, dispatch]);

  const active = state.tabs.find((t) => t.path === state.active) ?? null;
  return { state, tabs: state.tabs, getTabs, active, dispatch, add, drop, rename };
}
