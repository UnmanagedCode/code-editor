import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { endpoints } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: null };
const BOM = '\uFEFF';
const FILES = { 'a.txt': 'alpha\n', 'b.txt': 'beta\n', 'bom.txt': `${BOM}hello\n`, 'plain.txt': 'plain\n', 'crlf.txt': 'one\r\ntwo\r\n', 'blob.bin': { binary: true as const, size: 1234 }, 'big.txt': { content: 'first part', truncated: true as const, size: 9_999_999 } };

async function open(name = 'a.txt', onFileChange: (p: string | null) => void = () => {}) {
  const backend = installBackend({ files: FILES, limitBytes: 2_097_152 });
  const ctx = renderWithHost(<Workspace target={target} rootPath="/srv/app" initialFile={null} reveal={null} onRevealHandled={() => {}} onFileChange={onFileChange} />);
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

  it('a binary tab is not labelled read-only (it is not editable at all)', async () => {
    await open('blob.bin');
    expect(screen.getByRole('tab', { name: /blob\.bin/ }).textContent).not.toContain('read-only');
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

describe('byte order mark', () => {
  it('a BOM is kept out of the buffer (Monaco drops it) and written back on save, on every save', async () => {
    const { fake, backend } = await open('bom.txt');
    expect(fake.modelFor('bom.txt').getValue()).toBe('hello\n');
    act(() => fake.modelFor('bom.txt').type('hello!\n'));
    ctrlS();
    await waitFor(() => expect(dirtyDot()).toBeNull());
    expect(backend.calls.write[0].content).toBe(`${BOM}hello!\n`);
    act(() => fake.modelFor('bom.txt').type('again\n'));
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(2));
    expect(backend.calls.write[1].content).toBe(`${BOM}again\n`);
  });

  it('a file without a BOM does not gain one', async () => {
    const { fake, backend } = await open('plain.txt');
    act(() => fake.modelFor('plain.txt').type('x\n'));
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    expect(backend.calls.write[0].content).toBe('x\n');
  });

  it('Reload and the diff view handle a BOM on disk: the buffer and the diff text are BOM-free, the next save restores it', async () => {
    const { fake, backend, user } = await open('bom.txt');
    act(() => fake.modelFor('bom.txt').type('mine\n'));
    backend.diskEdit('bom.txt', `${BOM}worker\n`);
    ctrlS();
    await screen.findByText('This file changed on disk since you opened it.');
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await waitFor(() => expect(fake.diffs).toHaveLength(1));
    expect(fake.diffs[0].diskText).toBe('worker\n');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull());
    expect(fake.modelFor('bom.txt').getValue()).toBe('worker\n');
    act(() => fake.modelFor('bom.txt').type('after reload\n'));
    ctrlS();
    await waitFor(() => expect(backend.calls.write.at(-1)!.content).toBe(`${BOM}after reload\n`));
  });

  it('a conflict on a file that LOSES its BOM on disk: Reload adopts the disk state (no BOM) for later saves', async () => {
    const { fake, backend, user } = await open('bom.txt');
    act(() => fake.modelFor('bom.txt').type('mine\n'));
    backend.diskEdit('bom.txt', 'no bom now\n');
    ctrlS();
    await screen.findByText('This file changed on disk since you opened it.');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull());
    act(() => fake.modelFor('bom.txt').type('x\n'));
    ctrlS();
    await waitFor(() => expect(backend.calls.write.at(-1)!.content).toBe('x\n'));
  });

  it('CRLF text is written back as the buffer holds it', async () => {
    const { fake, backend } = await open('crlf.txt');
    expect(fake.modelFor('crlf.txt').getValue()).toBe('one\r\ntwo\r\n');
    act(() => fake.modelFor('crlf.txt').type('X one\r\ntwo\r\n'));
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    expect(backend.calls.write[0].content).toBe('X one\r\ntwo\r\n');
  });
});

/** Makes the NEXT write apply on the (fake) server at once but answer only when the returned release() is called. */
function holdNextWrite() {
  const real = vi.mocked(endpoints.write).getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.mocked(endpoints.write).mockImplementationOnce(async (...args) => { const r = await real(...args); await gate; return r; });
  return release;
}

describe('overlapping saves', () => {
  it('pressing Ctrl+S twice while a save is in flight is one write and no false conflict', async () => {
    const { fake, backend } = await open();
    act(() => fake.modelFor('a.txt').type('one\n'));
    const release = holdNextWrite();
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    ctrlS();
    release();
    await waitFor(() => expect(dirtyDot()).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(backend.calls.write).toHaveLength(1);
    expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull();
  });

  it('text typed while a save is in flight is saved by the queued save, against the new hash', async () => {
    const { fake, backend } = await open();
    act(() => fake.modelFor('a.txt').type('one\n'));
    const release = holdNextWrite();
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    act(() => fake.modelFor('a.txt').type('two\n'));
    ctrlS();
    release();
    await waitFor(() => expect(backend.calls.write).toHaveLength(2));
    expect(backend.calls.write[1]).toEqual({ path: 'a.txt', content: 'two\n', expectedHash: 'hash:a.txt:2' });
    await waitFor(() => expect(dirtyDot()).toBeNull());
    expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull();
  });

  it('Rename and Delete are disabled in the row menu while that file is being saved', async () => {
    const { fake, user } = await open();
    act(() => fake.modelFor('a.txt').type('one\n'));
    const release = holdNextWrite();
    ctrlS();
    await user.click(await screen.findByRole('button', { name: 'Actions for a.txt' }));
    const menu = await screen.findByRole('menu');
    for (const name of ['Rename', 'Delete']) expect(within(menu).getByRole('menuitem', { name }).getAttribute('aria-disabled')).toBe('true');
    expect(within(menu).getByRole('menuitem', { name: 'New file' }).getAttribute('aria-disabled')).toBeNull();
    await user.keyboard('{Escape}');
    release();
    await waitFor(() => expect(dirtyDot()).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Actions for a.txt' }));
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Rename' }).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('rename and delete through a dialog opened before the save', () => {
  const openDialog = async (user: ReturnType<typeof renderWithHost>['user'], item: 'Rename' | 'Delete') => {
    await user.click(screen.getByRole('button', { name: 'Actions for a.txt' }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
    return screen.findByRole('dialog');
  };
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it('a rename submitted while the file’s save is in flight is held until the save finishes, so the save is not misdirected', async () => {
    const { fake, backend, user } = await open();
    act(() => fake.modelFor('a.txt').type('typed\n'));
    const dialog = await openDialog(user, 'Rename');
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, 'renamed.txt');
    const release = holdNextWrite();
    ctrlS(); // inside the open dialog
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await tick();
    expect(backend.calls.rename).toEqual([]);
    release();
    await waitFor(() => expect(backend.calls.rename).toEqual([['a.txt', 'renamed.txt']]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('tab', { name: /renamed\.txt/ })).toBeTruthy());
    expect(screen.queryByText('This file changed on disk since you opened it.')).toBeNull();
    expect(dirtyDot()).toBeNull();
    expect(backend.disk.get('renamed.txt')!.content).toBe('typed\n');
  });

  it('a delete confirmed while the file’s save is in flight is held until the save finishes', async () => {
    const { fake, backend, user } = await open();
    act(() => fake.modelFor('a.txt').type('typed\n'));
    const dialog = await openDialog(user, 'Delete');
    const release = holdNextWrite();
    ctrlS();
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    await user.click(within(dialog).getByRole('button', { name: /^Delete/ }));
    await tick();
    expect(backend.calls.remove).toEqual([]);
    release();
    await waitFor(() => expect(backend.calls.remove).toEqual(['a.txt']));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /a\.txt/ })).toBeNull());
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

  it('Ctrl/Cmd+S works from the diff’s editable side: the diff editor is given a save handler that saves', async () => {
    const { user, fake, backend } = await conflicted();
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await waitFor(() => expect(fake.diffs).toHaveLength(1));
    const writes = backend.calls.write.length;
    expect(typeof fake.diffs[0].options.onSave).toBe('function');
    act(() => fake.diffs[0].options.onSave());
    await waitFor(() => expect(backend.calls.write.length).toBe(writes + 1));
    expect(backend.calls.write.at(-1)!.content).toBe('mine\n');
  });

  it('Ctrl/Cmd+P works from the diff too: the diff editor is given a quick-open handler that opens it', async () => {
    const { user, fake } = await conflicted();
    await user.click(screen.getByRole('button', { name: 'View diff' }));
    await waitFor(() => expect(fake.diffs).toHaveLength(1));
    expect(typeof fake.diffs[0].options.onQuickOpen).toBe('function');
    act(() => fake.diffs[0].options.onQuickOpen());
    expect(await screen.findByRole('combobox', { name: 'Find file' })).toBeTruthy();
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
