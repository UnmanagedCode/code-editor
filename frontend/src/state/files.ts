import { useCallback, useRef, useState } from 'react';
import type { EditorHost } from '@/editor/EditorHost';
import { ApiError } from '@/lib/api';
import type { LineRange } from '@/lib/ccLink';
import { endpoints, type FileResult, type Target } from '@/lib/endpoints';
import { isUnder } from '@/lib/paths';
import { isDirty, newTabId, type Tab, type TabsAction } from './tabs';

type TabsApi = {
  getTabs: () => Tab[];
  dispatch: (a: TabsAction) => void;
  add: (tab: Tab) => void;
};

const BOM = '﻿';
/** Splits a leading byte order mark off decoded text: Monaco drops it from the buffer, so the tab remembers it. */
const splitBom = (text: string) => (text.startsWith(BOM) ? { bom: true, text: text.slice(1) } : { bom: false, text });

const asApiError = (e: unknown) => (e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : String(e)));
const conflictHash = (e: ApiError): string | null => {
  const h = (e.body as { currentHash?: unknown } | undefined)?.currentHash;
  return typeof h === 'string' ? h : null;
};

/**
 * Opening, saving and resolving files: the editor's load / conditional-save / conflict flow. Every save sends the hash the
 * buffer was loaded with, so a change made on disk meanwhile is a conflict, never an overwrite. Saves of one tab are
 * serialised, and a response is applied to its tab by id, so a rename or another save in flight cannot misdirect it.
 */
export function useFileActions({ target, host, tabs, onOpened }: { target: Target; host: EditorHost; tabs: TabsApi; onOpened: (path: string) => void }) {
  const [error, setError] = useState<ApiError | null>(null);
  /** Ids of the tabs with a request in flight. */
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /** Paths being read, with the range to reveal once open: a second open of a file still loading updates it. */
  const opening = useRef(new Map<string, LineRange | null>());
  const queues = useRef(new Map<number, Promise<unknown>>());

  const markBusy = (id: number, on: boolean) => setBusy((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const byPath = (path: string) => tabsRef.current.getTabs().find((t) => t.path === path);
  const byId = (id: number) => tabsRef.current.getTabs().find((t) => t.id === id);

  const tabFrom = (path: string, f: FileResult, reveal: LineRange | null): Tab => {
    const { bom, text } = splitBom(f.content ?? '');
    const model = f.kind === 'text' ? host.createModel(path, text) : null;
    return {
      id: newTabId(), path, kind: f.kind, model, hash: f.hash ?? null, savedVersionId: model?.getAlternativeVersionId() ?? 0,
      readOnly: f.readOnly, truncated: f.truncated, size: f.size, bom: f.kind === 'text' && bom, limitBytes: f.limitBytes, conflict: null, diff: null, reveal,
    };
  };

  /** Runs `job` after every earlier job of the same tab. */
  const enqueue = <T,>(id: number, job: () => Promise<T>): Promise<T> => {
    const prior = queues.current.get(id) ?? Promise.resolve();
    const next = prior.then(job, job);
    queues.current.set(id, next);
    void next.finally(() => { if (queues.current.get(id) === next) queues.current.delete(id); }).catch(() => {});
    return next;
  };

  /** Opens `path` in a tab (activating it when already open), optionally revealing a range of 1-based lines. */
  const openFile = useCallback(async (path: string, range: LineRange | null = null) => {
    setError(null);
    const existing = byPath(path);
    if (existing) { tabsRef.current.dispatch({ type: 'open', tab: { ...existing, reveal: range } }); onOpened(path); return; }
    if (opening.current.has(path)) { if (range) opening.current.set(path, range); return; }
    opening.current.set(path, range);
    try {
      const f = await endpoints.read(target, path);
      if (byPath(path)) return;
      tabsRef.current.add(tabFrom(path, f, opening.current.get(path) ?? null));
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
    const { id, path } = tab;
    const versionId = tab.model.getAlternativeVersionId();
    const content = (tab.bom ? BOM : '') + tab.model.getValue();
    markBusy(id, true);
    try {
      const r = await endpoints.write(target, path, content, expectedHash);
      tabsRef.current.dispatch({ type: 'saved', id, hash: r.hash, versionId, size: r.size });
      return true;
    } catch (e) {
      const err = asApiError(e);
      if (err.code === 'SAVE_CONFLICT') {
        // A conflict answered for a hash the tab has moved past is stale news (the tab was saved meanwhile): ignore it.
        const now = byId(id);
        if (now && now.hash === expectedHash) tabsRef.current.dispatch({ type: 'conflict', id, currentHash: conflictHash(err) });
      } else {
        setError(err);
      }
      return false;
    } finally {
      markBusy(id, false);
    }
  };

  const save = useCallback((path: string): Promise<boolean> => {
    const first = byPath(path);
    if (!first) return Promise.resolve(false);
    return enqueue(first.id, async () => {
      const tab = byId(first.id); // read when the job runs: an earlier save may have moved its hash and version
      if (!tab || !tab.model || tab.readOnly) return false;
      if (!isDirty(tab) && !tab.conflict) return true;
      return writeTab(tab, tab.hash);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  /** Saves every dirty tab; true when all were written (a conflict leaves its tab marked and returns false). */
  const saveAll = useCallback(async (): Promise<boolean> => {
    let ok = true;
    for (const t of tabsRef.current.getTabs()) if (isDirty(t) && !(await save(t.path))) ok = false;
    return ok;
  }, [save]);

  /** Resolves when every queued or in-flight save of a tab at or under `path` has finished (a rename or delete must not overtake it). */
  const settle = useCallback(async (path: string) => {
    const pending = tabsRef.current.getTabs().filter((t) => isUnder(t.path, path)).map((t) => queues.current.get(t.id)).filter((p): p is Promise<unknown> => p !== undefined);
    await Promise.allSettled(pending);
  }, []);

  /** Reads the disk version afresh and shows it against the live buffer. */
  const viewDiff = useCallback(async (path: string) => {
    const tab = byPath(path);
    if (!tab) return;
    markBusy(tab.id, true);
    try {
      let disk;
      try {
        const f = await endpoints.read(target, path);
        if (f.kind !== 'text' || f.truncated) throw new ApiError(0, 'The file on disk is now binary or too large to compare.');
        disk = { text: splitBom(f.content ?? '').text, hash: f.hash ?? null, deleted: false };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NOT_FOUND') disk = { text: '', hash: null, deleted: true };
        else throw e;
      }
      tabsRef.current.dispatch({ type: 'diff', id: tab.id, diff: disk });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      markBusy(tab.id, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  /** Overwrites the disk version the user was shown (or the 409's current hash): a further change on disk conflicts again. */
  const overwrite = useCallback((path: string) => {
    const first = byPath(path);
    if (!first) return Promise.resolve();
    return enqueue(first.id, async () => {
      const tab = byId(first.id);
      if (!tab?.conflict) return;
      await writeTab(tab, tab.diff ? tab.diff.hash : tab.conflict.currentHash);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  /** Replaces the buffer with the disk version and marks it clean. */
  const reload = useCallback(async (path: string) => {
    const tab = byPath(path);
    if (!tab?.model) return;
    markBusy(tab.id, true);
    try {
      const f = await endpoints.read(target, path);
      if (f.kind !== 'text') throw new ApiError(0, 'The file on disk is now binary.');
      const { bom, text } = splitBom(f.content ?? '');
      tab.model.setValue(text);
      tabsRef.current.dispatch({ type: 'reloaded', id: tab.id, hash: f.hash ?? null, versionId: tab.model.getAlternativeVersionId(), size: f.size, readOnly: f.readOnly, truncated: f.truncated, bom });
    } catch (e) {
      setError(asApiError(e));
    } finally {
      markBusy(tab.id, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.project, target.worktree]);

  return { error, clearError: () => setError(null), report: (e: unknown) => setError(asApiError(e)), busy, openFile, save, saveAll, settle, viewDiff, overwrite, reload };
}
