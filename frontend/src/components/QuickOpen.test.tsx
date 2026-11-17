import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { endpoints } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: null };
const FILES = { 'src/main.ts': 'm', 'src/lib/util.ts': 'u', 'README.md': 'r', 'docs/guide.md': 'g' };

async function setup(files: Record<string, string> = FILES) {
  const backend = installBackend({ files });
  const ctx = renderWithHost(<Workspace target={target} initialFile={null} onFileChange={() => {}} />);
  await screen.findAllByRole('treeitem');
  return { backend, ...ctx };
}
const ctrlP = () => fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true });

describe('QuickOpen', () => {
  it('Ctrl+P opens it (and cancels the browser’s print dialog) and loads the file list', async () => {
    const { backend } = await setup();
    const e = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await screen.findByRole('combobox', { name: 'Find file' });
    await waitFor(() => expect(backend.calls.files).toBe(1));
    expect(await screen.findAllByRole('option')).toHaveLength(4);
  });

  it('typing filters by fuzzy rank, best match first', async () => {
    const { user } = await setup();
    ctrlP();
    const input = await screen.findByRole('combobox', { name: 'Find file' });
    await screen.findAllByRole('option');
    await user.type(input, 'mn');
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('main.ts');
    expect(options.some((o) => o.textContent?.includes('guide.md'))).toBe(false);
  });

  it('Enter opens the highlighted file; arrow keys move the highlight', async () => {
    const { user, backend } = await setup();
    ctrlP();
    const input = await screen.findByRole('combobox', { name: 'Find file' });
    await screen.findAllByRole('option');
    await user.type(input, 'md');
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowDown}');
    const second = screen.getAllByRole('option')[1];
    expect(second.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.calls.read).toHaveLength(1));
    expect(backend.calls.read[0]).toBe(second.textContent?.includes('README') ? 'README.md' : 'docs/guide.md');
    await within(screen.getByRole('tablist', { name: 'Open files' })).findByRole('tab');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('matched characters are highlighted with text spans, not markup from the file name', async () => {
    const name = '<b>x</b>.ts';
    const { user } = await setup({ [name]: 'x' });
    ctrlP();
    await user.type(await screen.findByRole('combobox', { name: 'Find file' }), 'x');
    const option = await screen.findByRole('option');
    expect(option.textContent).toContain(name);
    expect(option.querySelector('b')).toBeNull();
    expect(option.querySelector('mark')).not.toBeNull();
  });

  it('shows the dimmed path only when it differs from the file name (a root-level file is not printed twice)', async () => {
    const { user } = await setup();
    ctrlP();
    await user.type(await screen.findByRole('combobox', { name: 'Find file' }), 'readme');
    const option = await screen.findByRole('option');
    expect(option.textContent).toBe('README.md');
    await user.clear(screen.getByRole('combobox', { name: 'Find file' }));
    await user.type(screen.getByRole('combobox', { name: 'Find file' }), 'util');
    expect((await screen.findByRole('option')).textContent).toBe('util.tssrc/lib/util.ts');
  });

  it('refetches the list on every open and again after a file operation changes the tree', async () => {
    const { backend, user } = await setup();
    ctrlP();
    await screen.findAllByRole('option');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    ctrlP();
    await waitFor(() => expect(backend.calls.files).toBe(2));
  });

  it('says when the list was cut off', async () => {
    installBackend({ files: FILES });
    vi.mocked(endpoints.files).mockImplementation(async () => ({ engine: 'rg', files: ['a.ts'], truncated: true, limit: 1 }));
    renderWithHost(<Workspace target={target} initialFile={null} onFileChange={() => {}} />);
    await screen.findByRole('treeitem', { name: /README\.md/ });
    ctrlP();
    expect(await screen.findByText(/Only the first 1 files are listed/)).toBeTruthy();
  });
});
