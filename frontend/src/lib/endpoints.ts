import { api } from './api';

export type Target = { project: string; worktree: string | null };

export type RootProject = {
  name: string;
  system: string;
  remoteId: string | null;
  unreachable: string | null;
  degraded: string | null;
  worktrees: { name: string; branch: string | null }[];
};
export type RootsResult = { projects: RootProject[] };

export type EntryKind = 'file' | 'dir' | 'symlink' | 'other';
export type LinkTarget = 'file' | 'dir' | 'other' | 'outside' | 'git' | 'broken';
export type Entry = { name: string; kind: EntryKind; target?: LinkTarget; ignored: boolean; unsupported?: boolean };
export type ListResult = { path: string; entries: Entry[]; truncated: boolean };

export type FileResult = {
  path: string;
  size: number;
  kind: 'text' | 'binary';
  content?: string;
  hash?: string;
  truncated: boolean;
  readOnly: boolean;
  limitBytes: number;
};

export type SearchMatch = { line: number; text: string };
export type SearchResult = { engine: 'rg' | 'git'; files: { path: string; matches: SearchMatch[] }[]; total: number; truncated: boolean; limit: number };
export type FilesResult = { engine: 'rg' | 'git'; files: string[]; truncated: boolean; limit: number };

const targetParams = (t: Target, extra: Record<string, string>) => {
  const p = new URLSearchParams({ project: t.project, ...(t.worktree ? { worktree: t.worktree } : {}), ...extra });
  return p.toString();
};
const body = (method: string, payload: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const withTarget = (t: Target, rest: Record<string, unknown>) => ({ project: t.project, ...(t.worktree ? { worktree: t.worktree } : {}), ...rest });

/** Every backend call, relative URLs only. An object so tests can spy on its members. */
export const endpoints = {
  roots: (signal?: AbortSignal) => api<RootsResult>('api/roots', { signal }),
  list: (t: Target, path: string, signal?: AbortSignal) => api<ListResult>(`api/list?${targetParams(t, { path })}`, { signal }),
  read: (t: Target, path: string, signal?: AbortSignal) => api<FileResult>(`api/file?${targetParams(t, { path })}`, { signal }),
  write: (t: Target, path: string, content: string, expectedHash: string | null) =>
    api<{ hash: string; size: number }>('api/file', body('PUT', withTarget(t, { path, content, expectedHash }))),
  create: (t: Target, path: string, type: 'file' | 'dir') => api<{ path: string }>('api/entries', body('POST', withTarget(t, { path, type }))),
  rename: (t: Target, from: string, to: string) => api<{ from: string; to: string }>('api/rename', body('POST', withTarget(t, { from, to }))),
  remove: (t: Target, path: string) => api<{ path: string }>('api/delete', body('POST', withTarget(t, { path }))),
  search: (t: Target, q: string, opts: { regex: boolean; matchCase: boolean }, signal?: AbortSignal) =>
    api<SearchResult>(`api/search?${targetParams(t, { q, regex: opts.regex ? '1' : '0', case: opts.matchCase ? '1' : '0' })}`, { signal }),
  files: (t: Target, signal?: AbortSignal) => api<FilesResult>(`api/files?${targetParams(t, {})}`, { signal }),
};
