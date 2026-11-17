import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: null };
const FILES = { 'a.txt': 'alpha\n', 'b.txt': 'beta\n', 'blob.bin': { binary: true as const, size: 1234 }, 'big.txt': { content: 'first part', truncated: true as const, size: 9_999_999 } };

async function open(name = 'a.txt', onFileChange: (p: string | null) => void = () => {}) {
  const backend = installBackend({ files: FILES, limitBytes: 2_097_152 });
  const ctx = renderWithHost(<Workspace target={target} initialFile={null} onFileChange={onFileChange} />);
  await ctx.user.click(await screen.findByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}$`) }));
  await waitFor(() => expect(ctx.fake.liveMounts().length + (name === 'blob.bin' ? 1 : 0)).toBeGreaterThan(0));
  return { backend, ...ctx };
}
const ctrlS = () => fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
const dirtyDot = () => screen.queryByRole('img', { name: 'unsaved changes' });

describe('editing and saving', () => {
  it('opens the file into a buffer, shows no dirty mark, and marks it dirty when typed in', async () => {
    const { fake } = await open();
    expect(fake.modelFor('a.txt').getValue()).toBe('alpha\n');
    expect(dirtyDot()).toBeNull();
    act(() => fake.modelFor('a.txt').type('alpha!\n'));
    expect(dirtyDot()).not.toBeNull();
  });

  it('Ctrl+S saves with the hash the buffer was loaded with and clears the dirty mark; the next save uses the new hash', async () => {
    const { fake, backend } = await open();
    act(() => fake.modelFor('a.txt').type('one\n'));
    ctrlS();
    await waitFor(() => expect(dirtyDot()).toBeNull());
    expect(backend.calls.write).toEqual([{ path: 'a.txt', content: 'one\n', expectedHash: 'hash:a.txt:1' }]);
    expect(backend.disk.get('a.txt')!.content).toBe('one\n');
    act(() => fake.modelFor('a.txt').type('two\n'));
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(2));
    expect(backend.calls.write[1].expectedHash).toBe('hash:a.txt:2');
  });

  it('Ctrl+S on a clean buffer writes nothing', async () => {
    const { backend } = await open();
    ctrlS();
    await Promise.resolve();
    expect(backend.calls.write).toEqual([]);
  });

  it('the Save button is enabled only while the buffer is dirty, and saves', async () => {
    const { fake, backend, user } = await open();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    act(() => fake.modelFor('a.txt').type('x'));
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
  });

  it('undoing back to the saved text makes the buffer clean again', async () => {
    const { fake } = await open();
    const m = fake.modelFor('a.txt');
    const saved = m.getAlternativeVersionId();
    act(() => m.type('changed'));
    expect(dirtyDot()).not.toBeNull();
    act(() => m.undoTo('alpha\n', saved));
    expect(dirtyDot()).toBeNull();
  });

  it('a binary file shows a placeholder with its size and no editor', async () => {
    const { fake } = await open('blob.bin');
    expect(await screen.findByText('Binary file, 1234 bytes')).toBeTruthy();
    expect(fake.liveMounts()).toHaveLength(0);
  });

  it('a file over the limit opens read-only with a notice naming its size and the limit', async () => {
    const { fake } = await open('big.txt');
    expect(await screen.findByText(/This file is 9999999 bytes; showing the first 2097152 bytes, read-only\./)).toBeTruthy();
    expect(fake.lastMount().options.readOnly).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the URL’s file follows the active tab', async () => {
    const onFile = vi.fn();
    const { user } = await open('a.txt', onFile);
    expect(onFile).toHaveBeenLastCalledWith('a.txt');
    await user.click(screen.getByRole('button', { name: /^b\.txt$/ }));
    await waitFor(() => expect(onFile).toHaveBeenLastCalledWith('b.txt'));
  });
});

describe('save conflict', () => {
  async function conflicted() {
    const ctx = await open();
    act(() => ctx.fake.modelFor('a.txt').type('mine\n'));
    ctx.backend.diskEdit('a.txt', 'worker\n');
    ctrlS();
    const bar = await screen.findByText('This file changed on disk since you opened it.');
    return { ...ctx, bar };
  }

  it('a change on disk is a conflict: three actions are offered, the buffer stays dirty and the disk is untouched', async () => {
    const { backend } = await conflicted();
    for (const name of ['View diff', 'Overwrite', 'Reload']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(dirtyDot()).not.toBeNull();
    expect(backend.disk.get('a.txt')!.content).toBe('worker\n');
  });

  it('View diff reads the disk afresh and mounts a diff of disk (original) against the live buffer', async () => {
    const { user, fake, backend } = await conflicted();
    const reads = backend.calls.read.length;
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await waitFor(() => expect(fake.diffs).toHaveLength(1));
    expect(backend.calls.read.length).toBe(reads + 1);
    expect(fake.diffs[0].diskText).toBe('worker\n');
    expect(fake.diffs[0].live).toBe(fake.modelFor('a.txt'));
    expect(fake.diffs[0].live.getValue()).toBe('mine\n');
  });

  it('Overwrite after the diff sends the hash of the disk version the user was shown', async () => {
    const { user, backend } = await conflicted();
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await screen.findByTestId('diff-editor');
    await user.click(screen.getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull());
    expect(backend.calls.write.at(-1)).toEqual({ path: 'a.txt', content: 'mine\n', expectedHash: 'hash:a.txt:2' });
    expect(backend.disk.get('a.txt')!.content).toBe('mine\n');
    expect(dirtyDot()).toBeNull();
  });

  it('if the disk changed again after the diff, Overwrite conflicts again instead of clobbering', async () => {
    const { user, backend } = await conflicted();
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await screen.findByTestId('diff-editor');
    backend.diskEdit('a.txt', 'worker again\n');
    await user.click(screen.getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(backend.calls.write).toHaveLength(2));
    expect(backend.disk.get('a.txt')!.content).toBe('worker again\n');
    expect(screen.getByText('This file changed on disk since you opened it.')).toBeTruthy();
  });

  it('Overwrite without viewing the diff sends the current hash from the 409', async () => {
    const { user, backend } = await conflicted();
    await user.click(screen.getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(backend.calls.write).toHaveLength(2));
    expect(backend.calls.write[1].expectedHash).toBe('hash:a.txt:2');
    expect(backend.disk.get('a.txt')!.content).toBe('mine\n');
  });

  it('Reload replaces the buffer with the disk version and marks it clean', async () => {
    const { user, fake } = await conflicted();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull());
    expect(fake.modelFor('a.txt').getValue()).toBe('worker\n');
    expect(dirtyDot()).toBeNull();
  });

  it('a file deleted on disk: the bar says so, the diff has an empty original, and Overwrite re-creates the file', async () => {
    const ctx = await open();
    act(() => ctx.fake.modelFor('a.txt').type('mine\n'));
    ctx.backend.diskDelete('a.txt');
    ctrlS();
    await screen.findByText('It was deleted on disk.');
    expect((screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement).disabled).toBe(true);
    await ctx.user.click(screen.getByRole('button', { name: 'View diff' }));
    await waitFor(() => expect(ctx.fake.diffs).toHaveLength(1));
    expect(ctx.fake.diffs[0].diskText).toBe('');
    expect(screen.getByText(/Deleted on disk/)).toBeTruthy();
    await ctx.user.click(screen.getByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(ctx.backend.disk.get('a.txt')?.content).toBe('mine\n'));
    expect(ctx.backend.calls.write.at(-1)!.expectedHash).toBeNull();
  });

  it('the conflict bar is announced as an alert', async () => {
    const { bar } = await conflicted();
    expect(bar.closest('[role="alert"]')).not.toBeNull();
    expect(within(bar.closest('[role="alert"]') as HTMLElement).getAllByRole('button')).toHaveLength(3);
  });
});

describe('guards', () => {
  it('closing a clean tab closes it at once', async () => {
    const { user, fake } = await open();
    await user.click(screen.getByRole('button', { name: 'Close a.txt' }));
    expect(screen.queryByRole('tab', { name: /a\.txt/ })).toBeNull();
    expect(fake.modelFor('a.txt').disposed).toBe(true);
  });

  it('closing a dirty tab asks: Cancel keeps it, Discard closes it, Save saves then closes it', async () => {
    const { user, fake, backend } = await open();
    act(() => fake.modelFor('a.txt').type('edited'));
    await user.click(screen.getByRole('button', { name: 'Close a.txt' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('tab', { name: /a\.txt/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close a.txt' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /a\.txt/ })).toBeNull());
    expect(backend.disk.get('a.txt')!.content).toBe('edited');
  });

  it('Discard closes a dirty tab without writing', async () => {
    const { user, fake, backend } = await open();
    act(() => fake.modelFor('a.txt').type('edited'));
    await user.click(screen.getByRole('button', { name: 'Close a.txt' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('tab', { name: /a\.txt/ })).toBeNull();
    expect(backend.calls.write).toEqual([]);
  });

  it('beforeunload is guarded only while a buffer is dirty', async () => {
    const { fake } = await open();
    const fire = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(fire()).toBe(false);
    act(() => fake.modelFor('a.txt').type('edited'));
    expect(fire()).toBe(true);
    ctrlS();
    await waitFor(() => expect(dirtyDot()).toBeNull());
    expect(fire()).toBe(false);
  });
});
