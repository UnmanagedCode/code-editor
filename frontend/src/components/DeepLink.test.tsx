import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RootProject } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { App } from '../App';

const project = (name: string, path: string | null, worktrees: { name: string; path: string }[] = []): RootProject => ({
  name, workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, path,
  worktrees: worktrees.map((w) => ({ ...w, branch: `code-conductor/${w.name}` })),
});
const PROJECTS = [project('app', '/srv/app', [{ name: 'w1', path: '/srv/app/.worktrees/w1' }]), project('other', '/srv/other')];
const FILES = { 'src/a.ts': Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'), 'b.txt': 'beta' };

function start(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  const backend = installBackend({ files: FILES, projects: PROJECTS });
  return { backend, ...renderWithHost(<App />) };
}
/** cc's `navigate` as the page sees it: the frame URL replaced, then a popstate. */
const navigate = (search: string) => act(() => {
  window.history.replaceState(null, '', `/${search}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
});
type Ctx = ReturnType<typeof start>;
const revealsOf = (ctx: Ctx, path: string) => ctx.fake.mounts.filter((m) => m.model.path === path).flatMap((m) => m.revealed);
const tabNames = () => within(screen.getByRole('tablist', { name: 'Open files' })).getAllByRole('tab').map((t) => t.textContent);
const rootButton = () => screen.findByRole('button', { name: /Switch root/ });

describe('deep links (ccPath / ccLine / ccEndLine)', () => {
  // Invariant: a link on load opens the containing root and file, reveals the range, and leaves only the plain route in the URL.
  it('a link on load opens the file at the range', async () => {
    const ctx = start('?ccPath=/srv/app/src/a.ts&ccLine=12&ccEndLine=18');
    await waitFor(() => expect(revealsOf(ctx, 'src/a.ts')).toEqual([{ start: 12, end: 18 }]));
    expect((await rootButton()).textContent).toContain('app');
    expect(window.location.search).toBe('?project=app&file=src%2Fa.ts');
  });

  // Invariant: a path under a worktree nested in its project's tree opens in that worktree.
  it('a link into a worktree opens that worktree', async () => {
    const ctx = start('?ccPath=%2Fsrv%2Fapp%2F.worktrees%2Fw1%2Fsrc%2Fa.ts&ccLine=2');
    await waitFor(() => expect(revealsOf(ctx, 'src/a.ts')).toEqual([{ start: 2, end: null }]));
    expect((await rootButton()).textContent).toContain('app / w1');
    expect(window.location.search).toBe('?project=app&worktree=w1&file=src%2Fa.ts');
  });

  // Invariant: a link without a valid line opens the file and reveals nothing.
  it('a link without a line opens the file with no reveal', async () => {
    const ctx = start('?ccPath=/srv/app/b.txt&ccLine=zero');
    await waitFor(() => expect(ctx.fake.liveMounts().map((m) => m.model.path)).toEqual(['b.txt']));
    expect(revealsOf(ctx, 'b.txt')).toEqual([]);
  });

  // Invariant: a link into the open root opens the file without remounting the workspace (other tabs and buffers survive).
  it('a popstate link to another file of the open root opens and reveals it without a remount', async () => {
    const ctx = start('?project=app&file=b.txt');
    await waitFor(() => expect(ctx.fake.liveMounts()).toHaveLength(1));
    act(() => ctx.fake.modelFor('b.txt').type('edited'));
    navigate('?ccPath=/srv/app/src/a.ts&ccLine=5&ccEndLine=7');
    await waitFor(() => expect(revealsOf(ctx, 'src/a.ts')).toEqual([{ start: 5, end: 7 }]));
    expect(tabNames()).toEqual([expect.stringContaining('b.txt'), expect.stringContaining('a.ts')]);
    expect(ctx.fake.modelFor('b.txt').disposed).toBe(false);
    expect(ctx.fake.modelFor('b.txt').getValue()).toBe('edited');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('?project=app&file=src%2Fa.ts');
  });

  // Invariant: the same link followed twice reveals twice (each request is new, even for an already active file and range).
  it('the same link twice re-reveals', async () => {
    const ctx = start('?project=app');
    await rootButton();
    navigate('?ccPath=/srv/app/src/a.ts&ccLine=9');
    await waitFor(() => expect(revealsOf(ctx, 'src/a.ts')).toHaveLength(1));
    navigate('?ccPath=/srv/app/src/a.ts&ccLine=9');
    await waitFor(() => expect(revealsOf(ctx, 'src/a.ts')).toEqual([{ start: 9, end: null }, { start: 9, end: null }]));
  });

  // Invariant: a link into another root goes through the unsaved-buffers guard first, then opens and reveals there.
  it('a link into another root with a dirty buffer asks first, then opens at the range', async () => {
    const ctx = start('?project=other&file=b.txt');
    await waitFor(() => expect(ctx.fake.liveMounts()).toHaveLength(1));
    act(() => ctx.fake.modelFor('b.txt').type('edited'));
    navigate('?ccPath=/srv/app/src/a.ts&ccLine=3&ccEndLine=4');
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(revealsOf(ctx, 'src/a.ts')).toEqual([]);
    await ctx.user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(revealsOf(ctx, 'src/a.ts')).toEqual([{ start: 3, end: 4 }]));
    expect((await rootButton()).textContent).toContain('app');
  });

  // Invariant: cancelling the root switch drops the pending reveal, so it never fires later.
  it('cancelling the switch keeps the open root and drops the link', async () => {
    const ctx = start('?project=other&file=b.txt');
    await waitFor(() => expect(ctx.fake.liveMounts()).toHaveLength(1));
    act(() => ctx.fake.modelFor('b.txt').type('edited'));
    navigate('?ccPath=/srv/app/src/a.ts&ccLine=3');
    await ctx.user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(window.location.search).toBe('?project=other&file=b.txt'));
    expect((await rootButton()).textContent).toContain('other');
    expect(ctx.backend.calls.read).toEqual(['b.txt']);
  });

  // Invariant: a link to a file that does not exist shows the backend's NOT_FOUND refusal.
  it('a missing file shows the not-found refusal', async () => {
    start('?ccPath=/srv/app/nope.ts&ccLine=1');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('no such file or directory');
  });

  // Invariant: a path no root contains (or an invalid one) is a text-only notice, and the open root and its tabs stay.
  it('an unmatched or invalid path is a text notice and leaves the open root alone', async () => {
    const ctx = start('?project=app&file=b.txt');
    await waitFor(() => expect(ctx.fake.liveMounts()).toHaveLength(1));
    navigate('?ccPath=%2Felsewhere%2F%3Cb%3Ex%3C%2Fb%3E.ts&ccLine=1');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('No project contains /elsewhere/<b>x</b>.ts');
    expect(ctx.container.querySelector('b')).toBeNull();
    expect(window.location.search).toBe('?project=app&file=b.txt');
    expect(tabNames()).toEqual([expect.stringContaining('b.txt')]);
    navigate('?ccPath=/srv/app/../other/b.txt');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No project contains /srv/app/../other/b.txt'));
    expect((await rootButton()).textContent).toContain('app');
    expect(ctx.backend.calls.read).toEqual(['b.txt']);
  });

  // Invariant: the ⋮ menu-item form still opens a root with no file.
  it('the menu-item form still opens the root only', async () => {
    const ctx = start('?ccProject=other');
    expect((await rootButton()).textContent).toContain('other');
    expect(window.location.search).toBe('?project=other');
    expect(ctx.backend.calls.read).toEqual([]);
  });
});
