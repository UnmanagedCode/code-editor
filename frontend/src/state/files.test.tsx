import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { endpoints } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { makeFakeHost } from '@/test/fakeEditorHost';
import { useFileActions } from './files';
import { isDirty, useTabs } from './tabs';

const target = { project: 'app', worktree: null };

function setup() {
  const backend = installBackend({ files: { 'd/a.txt': 'alpha\n', 'b.txt': 'beta\n' } });
  const fake = makeFakeHost();
  const hook = renderHook(() => {
    const tabs = useTabs(fake.host);
    const files = useFileActions({ target, host: fake.host, tabs: { getTabs: tabs.getTabs, dispatch: tabs.dispatch, add: tabs.add }, onOpened: () => {} });
    return { tabs, files };
  });
  return { backend, fake, hook };
}

/** The next write applies on the server at once and answers when released (the response is what races a rename). */
function holdNextWrite() {
  const real = vi.mocked(endpoints.write).getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.mocked(endpoints.write).mockImplementationOnce(async (...args) => { const r = await real(...args); await gate; return r; });
  return release;
}

describe('a save that lands while its file is renamed', () => {
  it('still marks the (renamed) tab saved, with the new hash: the response is matched to the tab, not to the old path', async () => {
    const { backend, fake, hook } = setup();
    await act(() => hook.result.current.files.openFile('d/a.txt'));
    fake.modelFor('d/a.txt').type('new\n');
    const release = holdNextWrite();
    let saved!: Promise<boolean>;
    act(() => { saved = hook.result.current.files.save('d/a.txt'); });
    await vi.waitFor(() => expect(vi.mocked(endpoints.write)).toHaveBeenCalledTimes(1)); // the request has left
    await endpoints.rename(target, 'd', 'e');
    act(() => hook.result.current.tabs.rename('d', 'e'));
    await act(async () => { release(); await saved; });
    const tab = hook.result.current.tabs.tabs[0];
    expect(tab.path).toBe('e/a.txt');
    expect(isDirty(tab)).toBe(false);
    expect(tab.conflict).toBeNull();
    expect(tab.hash).toBe(backend.hashOf('e/a.txt'));
  });

  it('the next save after the rename uses the new hash and the new path, so it is not a false conflict', async () => {
    const { backend, fake, hook } = setup();
    await act(() => hook.result.current.files.openFile('d/a.txt'));
    fake.modelFor('d/a.txt').type('one\n');
    const release = holdNextWrite();
    let first!: Promise<boolean>;
    act(() => { first = hook.result.current.files.save('d/a.txt'); });
    await vi.waitFor(() => expect(vi.mocked(endpoints.write)).toHaveBeenCalledTimes(1)); // the request has left
    await endpoints.rename(target, 'd', 'e');
    act(() => hook.result.current.tabs.rename('d', 'e'));
    await act(async () => { release(); await first; });
    fake.modelFor('d/a.txt').type('two\n');
    let ok = false;
    await act(async () => { ok = await hook.result.current.files.save('e/a.txt'); });
    expect(ok).toBe(true);
    expect(backend.disk.get('e/a.txt')!.content).toBe('two\n');
    expect(hook.result.current.tabs.tabs[0].conflict).toBeNull();
  });

  it('a conflict answer is also applied to the renamed tab', async () => {
    const { backend, fake, hook } = setup();
    await act(() => hook.result.current.files.openFile('d/a.txt'));
    fake.modelFor('d/a.txt').type('mine\n');
    backend.diskEdit('d/a.txt', 'worker\n');
    const real = vi.mocked(endpoints.write).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.mocked(endpoints.write).mockImplementationOnce(async (...args) => { try { return await real(...args); } finally { await gate; } });
    let saved!: Promise<boolean>;
    act(() => { saved = hook.result.current.files.save('d/a.txt'); });
    await vi.waitFor(() => expect(vi.mocked(endpoints.write)).toHaveBeenCalledTimes(1)); // the request has left
    act(() => hook.result.current.tabs.rename('d', 'e'));
    await act(async () => { release(); await saved; });
    expect(hook.result.current.tabs.tabs[0].path).toBe('e/a.txt');
    expect(hook.result.current.tabs.tabs[0].conflict).not.toBeNull();
  });
});
