import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installBackend } from '@/test/fakeBackend';
import { media } from '@/test/media';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: null };
const FILES = { 'a.txt': 'alpha', 'src/main.ts': 'm' };

async function phone(coarse = true) {
  media.narrow = true;
  media.coarse = coarse;
  const backend = installBackend({ files: FILES });
  const ctx = renderWithHost(<Workspace target={target} initialFile={null} onFileChange={() => {}} />);
  await waitFor(() => expect(backend.calls.list).toEqual(['']));
  return { backend, ...ctx };
}

describe('phone layout (below md)', () => {
  it('has no sidebar: the file tree is behind a Files button, and Search, Quick open and Save are header buttons', async () => {
    await phone();
    expect(screen.queryByRole('tree')).toBeNull();
    for (const name of ['Files', 'Search', 'Quick open', 'Save file']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('the empty state points to the Files menu, not to a keyboard shortcut a phone lacks', async () => {
    await phone();
    expect(screen.queryByText(/Ctrl/)).toBeNull();
    expect(screen.getByText(/Open a file from the Files menu/)).toBeTruthy();
  });

  it('the Files button opens a sheet with the tree; opening a file closes the sheet and opens the tab', async () => {
    const { user, backend } = await phone();
    await user.click(screen.getByRole('button', { name: 'Files' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: /^a\.txt$/ }));
    await waitFor(() => expect(screen.queryByRole('tree')).toBeNull());
    expect(backend.calls.read).toEqual(['a.txt']);
    await within(screen.getByRole('tablist', { name: 'Open files' })).findByRole('tab', { name: /a\.txt/ });
  });

  it('the Search button opens a search sheet', async () => {
    const { user } = await phone();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('textbox', { name: 'Search query' })).toBeTruthy();
  });

  it('Quick open opens the quick-open dialog', async () => {
    const { user } = await phone();
    await user.click(screen.getByRole('button', { name: 'Quick open' }));
    expect(await screen.findByRole('combobox', { name: 'Find file' })).toBeTruthy();
  });

  it('the Save button saves the dirty buffer, and is disabled when clean', async () => {
    const { user, fake, backend } = await phone();
    await user.click(screen.getByRole('button', { name: 'Files' }));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: /^a\.txt$/ }));
    await waitFor(() => expect(fake.liveMounts()).toHaveLength(1));
    const save = screen.getByRole('button', { name: 'Save file' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    act(() => fake.modelFor('a.txt').type('alpha!'));
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    expect(fake.lastMount().options.narrow).toBe(true);
  });

  it('on a touch device every row has its ⋮ menu button, which opens the entry menu', async () => {
    const { user } = await phone(true);
    await user.click(screen.getByRole('button', { name: 'Files' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: 'Actions for a.txt' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
  });

  it('long-press (the browser’s contextmenu on touch) opens the same menu on a row', async () => {
    const { user } = await phone(true);
    await user.click(screen.getByRole('button', { name: 'Files' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.contextMenu(await within(sheet).findByRole('treeitem', { name: /a\.txt/ }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });
});

describe('desktop layout', () => {
  it('shows the Files | Search sidebar and no sheet buttons', async () => {
    media.narrow = false;
    installBackend({ files: FILES });
    renderWithHost(<Workspace target={target} initialFile={null} onFileChange={() => {}} />);
    await screen.findAllByRole('treeitem');
    expect(screen.getByRole('tab', { name: 'Files' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Search' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save file' })).toBeNull();
  });
});
