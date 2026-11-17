import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeFakeHost } from '@/test/fakeEditorHost';
import { EMPTY_TABS, isDirty, tabsReducer, useTabs, type Tab, type TabsState } from './tabs';

const tab = (path: string, extra: Partial<Tab> = {}): Tab => ({
  path, kind: 'text', model: null, hash: 'h', savedVersionId: 1, readOnly: false, truncated: false, size: 1, limitBytes: 100,
  conflict: null, diff: null, reveal: null, ...extra,
});
const open = (s: TabsState, ...paths: string[]) => paths.reduce((acc, p) => tabsReducer(acc, { type: 'open', tab: tab(p) }), s);

describe('tabsReducer', () => {
  it('opens a tab and activates it; opening an open path activates it without duplicating', () => {
    let s = open(EMPTY_TABS, 'a', 'b');
    expect(s.active).toBe('b');
    s = tabsReducer(s, { type: 'open', tab: tab('a') });
    expect(s.tabs.map((t) => t.path)).toEqual(['a', 'b']);
    expect(s.active).toBe('a');
  });

  it('re-opening with a line sets the line to reveal; without one it leaves it', () => {
    let s = open(EMPTY_TABS, 'a');
    s = tabsReducer(s, { type: 'open', tab: tab('a', { reveal: 7 }) });
    expect(s.tabs[0].reveal).toBe(7);
    s = tabsReducer(s, { type: 'revealed', path: 'a' });
    expect(s.tabs[0].reveal).toBeNull();
  });

  it('closing the active tab activates its right neighbour, else the left one; closing another keeps the active', () => {
    let s = open(EMPTY_TABS, 'a', 'b', 'c');
    s = tabsReducer(s, { type: 'activate', path: 'b' });
    s = tabsReducer(s, { type: 'close', path: 'b' });
    expect(s.active).toBe('c');
    s = tabsReducer(s, { type: 'close', path: 'c' });
    expect(s.active).toBe('a');
    s = open(s, 'z');
    s = tabsReducer(s, { type: 'close', path: 'a' });
    expect(s.active).toBe('z');
    s = tabsReducer(s, { type: 'close', path: 'z' });
    expect(s).toEqual(EMPTY_TABS);
  });

  it('renamed follows an exact file and a folder prefix, and the active path', () => {
    let s = open(EMPTY_TABS, 'src/a.ts', 'src/lib/b.ts', 'srcx/c.ts');
    s = tabsReducer(s, { type: 'activate', path: 'src/lib/b.ts' });
    s = tabsReducer(s, { type: 'renamed', from: 'src', to: 'source' });
    expect(s.tabs.map((t) => t.path)).toEqual(['source/a.ts', 'source/lib/b.ts', 'srcx/c.ts']);
    expect(s.active).toBe('source/lib/b.ts');
    s = tabsReducer(s, { type: 'renamed', from: 'source/a.ts', to: 'source/z.ts' });
    expect(s.tabs[0].path).toBe('source/z.ts');
  });

  it('removed drops the path and everything beneath it', () => {
    let s = open(EMPTY_TABS, 'src/a.ts', 'src/lib/b.ts', 'srcx/c.ts');
    s = tabsReducer(s, { type: 'removed', path: 'src' });
    expect(s.tabs.map((t) => t.path)).toEqual(['srcx/c.ts']);
    expect(s.active).toBe('srcx/c.ts');
  });

  it('conflict → saved clears the conflict and diff and records the new hash/version', () => {
    let s = open(EMPTY_TABS, 'a');
    s = tabsReducer(s, { type: 'conflict', path: 'a', currentHash: 'x' });
    s = tabsReducer(s, { type: 'diff', path: 'a', diff: { text: 't', hash: 'x', deleted: false } });
    expect(s.tabs[0].conflict).toEqual({ currentHash: 'x' });
    s = tabsReducer(s, { type: 'saved', path: 'a', hash: 'new', versionId: 9, size: 3 });
    expect(s.tabs[0]).toMatchObject({ hash: 'new', savedVersionId: 9, conflict: null, diff: null, size: 3 });
  });

  it('conflict → reloaded clears the conflict and adopts the disk hash and version', () => {
    let s = open(EMPTY_TABS, 'a');
    s = tabsReducer(s, { type: 'conflict', path: 'a', currentHash: null });
    s = tabsReducer(s, { type: 'reloaded', path: 'a', hash: 'disk', versionId: 4, size: 2, readOnly: false, truncated: false });
    expect(s.tabs[0]).toMatchObject({ hash: 'disk', savedVersionId: 4, conflict: null });
  });
});

describe('isDirty', () => {
  it('is dirty when the buffer version differs from the saved one, and clean again after undoing back', () => {
    const { models, host } = makeFakeHost();
    const m = host.createModel('a', 'x') as (typeof models)[number];
    const t = tab('a', { model: m, savedVersionId: m.getAlternativeVersionId() });
    expect(isDirty(t)).toBe(false);
    m.type('xy');
    expect(isDirty(t)).toBe(true);
    m.undoTo('x', t.savedVersionId);
    expect(isDirty(t)).toBe(false);
  });

  it('a read-only or binary tab is never dirty', () => {
    const { host } = makeFakeHost();
    const m = host.createModel('a', 'x');
    m.setValue('changed');
    expect(isDirty(tab('a', { model: m, readOnly: true }))).toBe(false);
    expect(isDirty(tab('b', { model: null, kind: 'binary' }))).toBe(false);
  });
});

describe('useTabs', () => {
  it('drop disposes the buffer; subtree drop disposes every buffer beneath', () => {
    const fake = makeFakeHost();
    const { result } = renderHook(() => useTabs(fake.host));
    const mk = (p: string) => tab(p, { model: fake.host.createModel(p, 'x') });
    act(() => { result.current.add(mk('d/a')); result.current.add(mk('d/b')); result.current.add(mk('e')); });
    act(() => result.current.drop('e'));
    expect(fake.modelFor('e').disposed).toBe(true);
    act(() => result.current.drop('d', { subtree: true }));
    expect(fake.modelFor('d/a').disposed && fake.modelFor('d/b').disposed).toBe(true);
    expect(result.current.tabs).toHaveLength(0);
  });

  it('rename updates the language of the moved buffer from its new name', () => {
    const fake = makeFakeHost();
    const { result } = renderHook(() => useTabs(fake.host));
    act(() => result.current.add(tab('src/a.txt', { model: fake.host.createModel('src/a.txt', 'x') })));
    expect(fake.modelFor('src/a.txt').language).toBe('plaintext');
    act(() => result.current.rename('src', 'lib'));
    expect(result.current.tabs[0].path).toBe('lib/a.txt');
    act(() => result.current.add(tab('lib/b.ts', { model: fake.host.createModel('lib/b.ts', 'x') })));
    act(() => result.current.rename('lib/b.ts', 'lib/b.md'));
    expect(fake.modelFor('lib/b.ts').language).toBe('markdown');
  });

  it('typing re-renders so the dirty flag shows', () => {
    const fake = makeFakeHost();
    const { result } = renderHook(() => useTabs(fake.host));
    const model = fake.host.createModel('a', 'x');
    act(() => result.current.add(tab('a', { model, savedVersionId: model.getAlternativeVersionId() })));
    expect(isDirty(result.current.tabs[0])).toBe(false);
    act(() => (model as ReturnType<typeof fake.modelFor>).type('xy'));
    expect(isDirty(result.current.tabs[0])).toBe(true);
  });
});
