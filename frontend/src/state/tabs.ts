import { useCallback, useReducer, useRef, useState } from 'react';
import type { EditorHost, EditorModel } from '@/editor/EditorHost';
import { isUnder, retarget } from '@/lib/paths';

/** The disk version shown by "View diff": its text, the hash Overwrite must then send, and whether the file is gone. */
export type DiskView = { text: string; hash: string | null; deleted: boolean };

export type Tab = {
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
  | { type: 'saved'; path: string; hash: string; versionId: number; size: number }
  | { type: 'conflict'; path: string; currentHash: string | null }
  | { type: 'diff'; path: string; diff: DiskView | null }
  | { type: 'reloaded'; path: string; hash: string | null; versionId: number; size: number; readOnly: boolean; truncated: boolean }
  | { type: 'revealed'; path: string }
  | { type: 'renamed'; from: string; to: string }
  | { type: 'removed'; path: string };

const patch = (s: TabsState, path: string, change: Partial<Tab>): TabsState => ({
  ...s,
  tabs: s.tabs.map((t) => (t.path === path ? { ...t, ...change } : t)),
});

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
      if (s.tabs.some((t) => t.path === a.tab.path)) return { ...patch(s, a.tab.path, a.tab.reveal === null ? {} : { reveal: a.tab.reveal }), active: a.tab.path };
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
      return patch(s, a.path, { hash: a.hash, savedVersionId: a.versionId, size: a.size, conflict: null, diff: null });
    case 'conflict':
      return patch(s, a.path, { conflict: { currentHash: a.currentHash } });
    case 'diff':
      return patch(s, a.path, { diff: a.diff });
    case 'reloaded':
      return patch(s, a.path, { hash: a.hash, savedVersionId: a.versionId, size: a.size, readOnly: a.readOnly, truncated: a.truncated, conflict: null, diff: null });
    case 'revealed':
      return patch(s, a.path, { reveal: null });
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
  const [state, dispatch] = useReducer(tabsReducer, EMPTY_TABS);
  const [, setTick] = useState(0);
  const ref = useRef(state);
  ref.current = state;

  const add = useCallback((tab: Tab) => {
    tab.model?.onDidChangeContent(() => setTick((n) => n + 1));
    dispatch({ type: 'open', tab });
  }, []);

  /** Closes the tab at `path` (or every tab beneath it) and disposes the buffers. */
  const drop = useCallback((path: string, { subtree = false } = {}) => {
    const doomed = ref.current.tabs.filter((t) => (subtree ? isUnder(t.path, path) : t.path === path));
    dispatch({ type: subtree ? 'removed' : 'close', path });
    for (const t of doomed) t.model?.dispose();
  }, []);

  const rename = useCallback((from: string, to: string) => {
    for (const t of ref.current.tabs) if (isUnder(t.path, from)) t.model?.setLanguage(host.languageFor(retarget(t.path, from, to)));
    dispatch({ type: 'renamed', from, to });
  }, [host]);

  const active = state.tabs.find((t) => t.path === state.active) ?? null;
  return { state, tabs: state.tabs, active, dispatch, add, drop, rename };
}
