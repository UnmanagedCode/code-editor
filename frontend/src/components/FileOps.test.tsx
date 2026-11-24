import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: null };
const FILES = { 'a.txt': 'a', 'src/main.ts': 'm', 'src/lib/util.ts': 'u' };

async function setup(files: Record<string, string> = FILES) {
  const backend = installBackend({ files });
  const ctx = renderWithHost(<Workspace target={target} rootPath="/srv/app" initialFile={null} reveal={null} onRevealHandled={() => {}} onFileChange={() => {}} />);
  await screen.findByRole('treeitem', { name: /a\.txt/ });
  return { backend, ...ctx };
}
const rowMenu = async (user: ReturnType<typeof renderWithHost>['user'], name: string) => {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
};
const dialog = () => screen.findByRole('dialog');

describe('entry menus', () => {
  it('the per-row ⋮ menu offers New file, New folder, Rename and Delete', async () => {
    const { user } = await setup();
    const menu = await rowMenu(user, 'a.txt');
    for (const label of ['New file', 'New folder', 'Rename', 'Delete']) expect(within(menu).getByRole('menuitem', { name: label })).toBeTruthy();
  });

  it('right-click opens the same items as a context menu on a row, and only that row’s menu', async () => {
    await setup();
    fireEvent.contextMenu(screen.getByRole('treeitem', { name: /a\.txt/ }));
    const menu = await screen.findByRole('menu');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['New file', 'New folder', 'Rename', 'Delete']);
  });

  it('the tree background menu creates at the root and has no Rename or Delete', async () => {
    await setup();
    fireEvent.contextMenu(screen.getByTestId('tree-background'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['New file', 'New folder']);
  });
});

describe('create', () => {
  it('New file in a folder creates it, refreshes the folder and opens it in a tab', async () => {
    const { user, backend } = await setup();
    await user.click(screen.getByRole('button', { name: /^src$/ }));
    await screen.findByRole('treeitem', { name: /main\.ts/ });
    await user.click(await (async () => { await rowMenu(user, 'src'); return screen.getByRole('menuitem', { name: 'New file' }); })());
    const d = await dialog();
    await user.type(within(d).getByRole('textbox', { name: 'Name' }), 'new.ts');
    await user.click(within(d).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(backend.calls.create).toEqual(['src/new.ts']));
    await screen.findByRole('tab', { name: /new\.ts/ });
    await screen.findByRole('treeitem', { name: /new\.ts/ });
  });

  it('refuses "..", ".git", a slash and an empty name locally, without calling the backend', async () => {
    const { user, backend } = await setup();
    await user.click(await (async () => { await rowMenu(user, 'a.txt'); return screen.getByRole('menuitem', { name: 'New file' }); })());
    const d = await dialog();
    const input = within(d).getByRole('textbox', { name: 'Name' });
    const create = within(d).getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    for (const bad of ['..', '.git', 'a/b']) {
      await user.clear(input);
      await user.type(input, bad);
      expect(within(d).getByRole('alert')).toBeTruthy();
      expect(create.disabled).toBe(true);
    }
    expect(backend.calls.create).toEqual([]);
  });

  it('an existing name is reported inline as "<name> already exists" and the dialog stays open', async () => {
    const { user } = await setup();
    await user.click(await (async () => { await rowMenu(user, 'a.txt'); return screen.getByRole('menuitem', { name: 'New file' }); })());
    const d = await dialog();
    await user.type(within(d).getByRole('textbox', { name: 'Name' }), 'a.txt');
    await user.click(within(d).getByRole('button', { name: 'Create' }));
    expect((await within(d).findByRole('alert')).textContent).toBe('a.txt already exists');
  });

  it('New folder creates and expands it', async () => {
    const { user, backend } = await setup();
    fireEvent.contextMenu(screen.getByTestId('tree-background'));
    await user.click(await screen.findByRole('menuitem', { name: 'New folder' }));
    const d = await dialog();
    await user.type(within(d).getByRole('textbox', { name: 'Name' }), 'docs');
    await user.click(within(d).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(backend.calls.create).toEqual(['docs']));
    await screen.findByRole('treeitem', { name: /^docs/ });
  });
});

describe('rename', () => {
  it('renaming a folder moves the open tabs beneath it and refreshes the tree', async () => {
    const { user, fake, backend } = await setup();
    await user.click(screen.getByRole('button', { name: /^src$/ }));
    await user.click(await screen.findByRole('button', { name: /^main\.ts$/ }));
    await screen.findByRole('tab', { name: /main\.ts/ });
    await user.click(await (async () => { await rowMenu(user, 'src'); return screen.getByRole('menuitem', { name: 'Rename' }); })());
    const d = await dialog();
    const input = within(d).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(input.value).toBe('src');
    await user.clear(input);
    await user.type(input, 'source');
    await user.click(within(d).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(backend.calls.rename).toEqual([['src', 'source']]));
    await screen.findByRole('treeitem', { name: /^source/ });
    expect(screen.getByRole('tab', { name: /main\.ts/ }).getAttribute('title')).toBe('source/main.ts');
    expect(fake.modelFor('src/main.ts').getValue()).toBe('m'); // the same buffer, not reloaded
  });

  it('renaming onto an existing name is reported inline and nothing moves', async () => {
    const { user, backend } = await setup({ 'a.txt': 'a', 'b.txt': 'b' });
    await user.click(await (async () => { await rowMenu(user, 'a.txt'); return screen.getByRole('menuitem', { name: 'Rename' }); })());
    const d = await dialog();
    const input = within(d).getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, 'b.txt');
    await user.click(within(d).getByRole('button', { name: 'Rename' }));
    expect((await within(d).findByRole('alert')).textContent).toBe('b.txt already exists');
    expect(backend.disk.get('a.txt')!.content).toBe('a');
  });
});

describe('delete', () => {
  it('names the path; a folder adds the "everything in it" sentence; a plain file does not', async () => {
    const { user } = await setup();
    await user.click(await (async () => { await rowMenu(user, 'a.txt'); return screen.getByRole('menuitem', { name: 'Delete' }); })());
    let d = await dialog();
    expect(within(d).getByText('Delete a.txt?')).toBeTruthy();
    expect(within(d).queryByText(/everything in it/)).toBeNull();
    await user.click(within(d).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(await (async () => { await rowMenu(user, 'src'); return screen.getByRole('menuitem', { name: 'Delete' }); })());
    d = await dialog();
    expect(within(d).getByText(/The folder and everything in it will be deleted/)).toBeTruthy();
  });

  it('deleting a folder closes the tabs beneath it and refreshes the tree', async () => {
    const { user, backend, fake } = await setup();
    await user.click(screen.getByRole('button', { name: /^src$/ }));
    await user.click(await screen.findByRole('button', { name: /^main\.ts$/ }));
    await screen.findByRole('tab', { name: /main\.ts/ });
    await user.click(await (async () => { await rowMenu(user, 'src'); return screen.getByRole('menuitem', { name: 'Delete' }); })());
    await user.click(within(await dialog()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(backend.calls.remove).toEqual(['src']));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /main\.ts/ })).toBeNull());
    expect(screen.queryByRole('treeitem', { name: /^src/ })).toBeNull();
    expect(fake.modelFor('src/main.ts').disposed).toBe(true);
  });

  it('unsaved tabs beneath the path are listed, the loss is warned of, and the button says so', async () => {
    const { user, fake } = await setup();
    await user.click(screen.getByRole('button', { name: /^src$/ }));
    await user.click(await screen.findByRole('button', { name: /^main\.ts$/ }));
    await screen.findByRole('tab', { name: /main\.ts/ });
    act(() => fake.modelFor('src/main.ts').type('edited'));
    await user.click(await (async () => { await rowMenu(user, 'src'); return screen.getByRole('menuitem', { name: 'Delete' }); })());
    const d = await dialog();
    expect(within(d).getByText(/unsaved changes that will be lost/)).toBeTruthy();
    expect(within(d).getByText('src/main.ts')).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Delete and discard changes' })).toBeTruthy();
    expect(within(d).queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
