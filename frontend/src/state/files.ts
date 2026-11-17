import { useCallback, useRef, useState } from 'react';
import type { EditorHost } from '@/editor/EditorHost';
import { ApiError } from '@/lib/api';
import { endpoints, type FileResult, type Target } from '@/lib/endpoints';
import { isDirty, type Tab, type TabsAction } from './tabs';

type TabsApi = {
  tabs: Tab[];
  dispatch: (a: TabsAction) => void;
  add: (tab: Tab) => void;
};

const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : String(e)));
const conflictHash = (e: ApiError): string | null => {
  const h = (e.body as { currentHash?: unknown } | undefined)?.currentHash;
  return typeof h === 'string' ? h : null;
};

/**
 * Opening, saving and resolving files: the editor's load / conditional-save / conflict flow. Every save sends the hash the
 * buffer was loaded with, so a change made on disk meanwhile is a conflict, never an overwrite.
 */
export function useFileActions({ target, host, tabs, onOpened }: { target: Target; host: EditorHost; tabs: TabsApi; onOpened: (path: string) => void }) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const opening = useRef(new Set<string>());

  const markBusy = (path: string, on: boolean) => setBusy((s) => { const n = new Set(s); if (on) n.add(path); else n.delete(path); return n; });
  const find = (path: string) => tabsRef.current.tabs.find((t) => t.path === path);

  const tabFrom = (path: string, f: FileResult, reveal: number | null): Tab => {
    const model = f.kind === 'text' ? host.createModel(path, f.content ?? '') : null;
    return {
      path, kind: f.kind, model, hash: f.hash ?? null, savedVersionId: model?.getAlternativeVersionId() ?? 0,
      readOnly: f.readOnly, truncated: f.truncated, size: f.size, limitBytes: f.limitBytes, conflict: null, diff: null, reveal,
    };
  };

  /** Opens `path` in a tab (activating it when already open), optionally revealing a 1-based line. */
  const openFile = useCallback(async (path: string, line: number | null = null) => {
    setError(null);
    const existing = find(path);
    if (existing) { tabsRef.current.dispatch({ type: 'open', tab: { ...existing, reveal: line } }); onOpened(path); return; }
    if (opening.current.has(path)) return;
    opening.current.add(path);
    try {
      const f = await endpoints.read(target, path);
      if (find(path)) return;
      tabsRef.current.add(tabFrom(path, f, line));
      onOpened(path);
    } catch (e) {
      setError(asApiError(e));
    } finally {
      opening.current.delete(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree, host, onOpened]);

  /** Saves with `expectedHash`; resolves true when written. A conflict marks the tab; anything else is reported. */
  const writeTab = async (tab: Tab, expectedHash: string | null): Promise<boolean> => {
    if (!tab.model) return false;
    const versionId = tab.model.getAlternativeVersionId();
    const content = tab.model.getValue();
    markBusy(tab.path, true);
    try {
      const r = await endpoints.write(target, tab.path, content, expectedHash);
      tabsRef.current.dispatch({ type: 'saved', path: tab.path, hash: r.hash, versionId, size: r.size });
      return true;
    } catch (e) {
      const err = asApiError(e);
      if (err.code === 'SAVE_CONFLICT') tabsRef.current.dispatch({ type: 'conflict', path: tab.path, currentHash: conflictHash(err) });
      else setError(err);
      return false;
    } finally {
      markBusy(tab.path, false);
    }
  };

  const save = useCallback(async (path: string): Promise<boolean> => {
    const tab = find(path);
    if (!tab || !tab.model || tab.readOnly) return false;
    if (!isDirty(tab) && !tab.conflict) return true;
    return writeTab(tab, tab.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  /** Saves every dirty tab; true when all were written (a conflict leaves its tab marked and returns false). */
  const saveAll = useCallback(async (): Promise<boolean> => {
    let ok = true;
    for (const t of tabsRef.current.tabs) if (isDirty(t) && !(await save(t.path))) ok = false;
    return ok;
  }, [save]);

  /** Reads the disk version afresh and shows it against the live buffer. */
  const viewDiff = useCallback(async (path: string) => {
    markBusy(path, true);
    try {
      let disk;
      try {
        const f = await endpoints.read(target, path);
        if (f.kind !== 'text' || f.truncated) throw new ApiError(0, 'The file on disk is now binary or too large to compare.');
        disk = { text: f.content ?? '', hash: f.hash ?? null, deleted: false };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NOT_FOUND') disk = { text: '', hash: null, deleted: true };
        else throw e;
      }
      tabsRef.current.dispatch({ type: 'diff', path, diff: disk });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      markBusy(path, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  /** Overwrites the disk version the user was shown (or the 409's current hash): a further change on disk conflicts again. */
  const overwrite = useCallback(async (path: string) => {
    const tab = find(path);
    if (!tab?.conflict) return;
    await writeTab(tab, tab.diff ? tab.diff.hash : tab.conflict.currentHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  /** Replaces the buffer with the disk version and marks it clean. */
  const reload = useCallback(async (path: string) => {
    const tab = find(path);
    if (!tab?.model) return;
    markBusy(path, true);
    try {
      const f = await endpoints.read(target, path);
      if (f.kind !== 'text') throw new ApiError(0, 'The file on disk is now binary.');
      tab.model.setValue(f.content ?? '');
      tabsRef.current.dispatch({ type: 'reloaded', path, hash: f.hash ?? null, versionId: tab.model.getAlternativeVersionId(), size: f.size, readOnly: f.readOnly, truncated: f.truncated });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      markBusy(path, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  return { error, clearError: () => setError(null), report: (e: unknown) => setError(asApiError(e)), busy, openFile, save, saveAll, viewDiff, overwrite, reload };
}
