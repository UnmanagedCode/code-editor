import { vi, type MockInstance } from 'vitest';
import { ApiError } from '@/lib/api';
import { endpoints, type Entry, type RootProject, type Target } from '@/lib/endpoints';

export type BackendFile = { content: string } | { binary: true; size: number } | { content: string; truncated: true; size: number };

/** An in-memory project behind the `endpoints` object: list/read/write/create/rename/remove/search/files with real conditional-save semantics. */
export function installBackend(init: {
  files: Record<string, string | BackendFile>;
  projects?: RootProject[];
  ignored?: string[];
  links?: Record<string, Entry['target']>;
  limitBytes?: number;
}) {
  const disk = new Map<string, { key: string; content: string; version: number; binary?: number; truncatedSize?: number }>();
  const set = (path: string, f: string | BackendFile) => {
    if (typeof f === 'string') disk.set(path, { key: path, content: f, version: 1 });
    else if ('binary' in f) disk.set(path, { key: path, content: '', version: 1, binary: f.size });
    else disk.set(path, { key: path, content: f.content, version: 1, ...('truncated' in f ? { truncatedSize: f.size } : {}) });
  };
  for (const [p, f] of Object.entries(init.files)) set(p, f);
  const ignored = new Set(init.ignored ?? []);
  const links = init.links ?? {};
  // Like a content hash, it survives a rename: keyed by the path the file was created at.
  const hashOf = (path: string) => { const f = disk.get(path); return f ? `hash:${f.key}:${f.version}` : null; };
  const calls = { list: [] as string[], read: [] as string[], write: [] as { path: string; content: string; expectedHash: string | null }[], create: [] as string[], rename: [] as [string, string][], remove: [] as string[], search: [] as { q: string; regex: boolean; matchCase: boolean }[], files: 0 };
  const notFound = () => new ApiError(404, 'no such file or directory', 'NOT_FOUND');
  const limit = init.limitBytes ?? 2 * 1024 * 1024;

  const state = {
    disk, calls, hashOf,
    /** A change made behind the editor's back (a worker's edit). */
    diskEdit(path: string, content: string) { const f = disk.get(path)!; f.content = content; f.version++; },
    diskDelete(path: string) { disk.delete(path); },
    searchResult: null as null | Awaited<ReturnType<typeof endpoints.search>>,
    searchError: null as ApiError | null,
    listError: null as ApiError | null,
    rootsSpy: null as unknown as MockInstance<typeof endpoints.roots>,
  };

  const rootsSpy = vi.spyOn(endpoints, 'roots').mockImplementation(async () => ({ projects: init.projects ?? [] }));
  state.rootsSpy = rootsSpy;
  vi.spyOn(endpoints, 'list').mockImplementation(async (_t: Target, dir: string) => {
    calls.list.push(dir);
    if (state.listError) throw state.listError;
    const prefix = dir === '' ? '' : `${dir}/`;
    const names = new Map<string, Entry>();
    for (const p of [...disk.keys(), ...Object.keys(links)]) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const name = rest.split('/')[0];
      const isDir = rest.includes('/');
      const full = prefix + name;
      if (names.has(name)) continue;
      if (p in links && !isDir) names.set(name, { name, kind: 'symlink', target: links[p], ignored: ignored.has(full) });
      else names.set(name, { name, kind: isDir ? 'dir' : 'file', ignored: ignored.has(full) });
    }
    return { path: dir, entries: [...names.values()].sort((a, b) => (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) || a.name.localeCompare(b.name)), truncated: false };
  });
  vi.spyOn(endpoints, 'read').mockImplementation(async (_t: Target, path: string) => {
    calls.read.push(path);
    const f = disk.get(path);
    if (!f) throw notFound();
    if (f.binary !== undefined) return { path, size: f.binary, kind: 'binary', truncated: false, readOnly: true, limitBytes: limit };
    if (f.truncatedSize !== undefined) return { path, size: f.truncatedSize, kind: 'text', content: f.content, truncated: true, readOnly: true, limitBytes: limit };
    return { path, size: f.content.length, kind: 'text', content: f.content, hash: hashOf(path)!, truncated: false, readOnly: false, limitBytes: limit };
  });
  vi.spyOn(endpoints, 'write').mockImplementation(async (_t: Target, path: string, content: string, expectedHash: string | null) => {
    calls.write.push({ path, content, expectedHash });
    const current = hashOf(path);
    if (current !== expectedHash) throw new ApiError(409, 'the file changed on disk since it was opened', 'SAVE_CONFLICT', { currentHash: current, code: 'SAVE_CONFLICT' });
    const f = disk.get(path);
    if (f) { f.content = content; f.version++; } else disk.set(path, { key: path, content, version: 1 });
    return { hash: hashOf(path)!, size: content.length };
  });
  vi.spyOn(endpoints, 'create').mockImplementation(async (_t: Target, path: string, type: 'file' | 'dir') => {
    calls.create.push(path);
    if (disk.has(path) || [...disk.keys()].some((k) => k.startsWith(`${path}/`))) throw new ApiError(409, 'an entry with that name already exists', 'ALREADY_EXISTS');
    set(type === 'dir' ? `${path}/.keep` : path, '');
    return { path };
  });
  vi.spyOn(endpoints, 'rename').mockImplementation(async (_t: Target, from: string, to: string) => {
    calls.rename.push([from, to]);
    if ([...disk.keys()].some((k) => k === to || k.startsWith(`${to}/`))) throw new ApiError(409, 'an entry with that name already exists', 'ALREADY_EXISTS');
    for (const [k, v] of [...disk]) if (k === from || k.startsWith(`${from}/`)) { disk.delete(k); disk.set(to + k.slice(from.length), v); }
    return { from, to };
  });
  vi.spyOn(endpoints, 'remove').mockImplementation(async (_t: Target, path: string) => {
    calls.remove.push(path);
    for (const k of [...disk.keys()]) if (k === path || k.startsWith(`${path}/`)) disk.delete(k);
    return { path };
  });
  vi.spyOn(endpoints, 'search').mockImplementation(async (_t: Target, q: string, opts: { regex: boolean; matchCase: boolean }) => {
    calls.search.push({ q, ...opts });
    if (state.searchError) throw state.searchError;
    return state.searchResult ?? { engine: 'rg', files: [], total: 0, truncated: false, limit: 500 };
  });
  vi.spyOn(endpoints, 'files').mockImplementation(async () => {
    calls.files++;
    return { engine: 'rg', files: [...disk.keys()].filter((k) => !k.endsWith('/.keep')).sort(), truncated: false, limit: 20000 };
  });
  return state;
}
