import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: null };
const mount = () => renderWithHost(<Workspace target={target} initialFile={null} onFileChange={() => {}} />);
const FILES = { 'README.md': 'x', 'src/main.ts': 'y', 'src/lib/util.ts': 'z', 'ignored.log': 'i', 'build/out.js': 'o' };

describe('refresh', () => {
  it('a Refresh button re-lists the root and every expanded folder, so new files appear', async () => {
    const backend = installBackend({ files: FILES });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: /^src$/ }));
    await screen.findByRole('treeitem', { name: /main\.ts/ });
    backend.disk.set('added-at-root.txt', { key: 'k1', content: 'x', version: 1 });
    backend.disk.set('src/added-in-src.ts', { key: 'k2', content: 'x', version: 1 });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('treeitem', { name: /added-at-root\.txt/ });
    await screen.findByRole('treeitem', { name: /added-in-src\.ts/ });
    expect(backend.calls.list).toEqual(['', 'src', '', 'src']);
  });

  it('Refresh also drops the quick-open file list, so the next open does not show stale files', async () => {
    const backend = installBackend({ files: FILES });
    const { user } = mount();
    await screen.findByRole('treeitem', { name: /README\.md/ });
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true });
    await screen.findAllByRole('option');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const real = vi.mocked(endpoints.files).getMockImplementation()!;
    vi.mocked(endpoints.files).mockImplementation(() => new Promise(() => {}));
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true });
    expect(await screen.findByText('Loading files…')).toBeTruthy();
    vi.mocked(endpoints.files).mockImplementation(real);
    void backend;
  });
});

describe('FileTree', () => {
  it('lists only the root at first and fetches a folder only when it is expanded', async () => {
    const backend = installBackend({ files: FILES });
    const { user } = mount();
    await screen.findByRole('treeitem', { name: /README\.md/ });
    expect(backend.calls.list).toEqual(['']);
    await user.click(screen.getByRole('button', { name: /^src$/ }));
    await screen.findByRole('treeitem', { name: /main\.ts/ });
    expect(backend.calls.list).toEqual(['', 'src']);
    await user.click(screen.getByRole('button', { name: /^src$/ })); // collapse
    await user.click(screen.getByRole('button', { name: /^src$/ })); // expand again: already loaded
    expect(backend.calls.list).toEqual(['', 'src']);
  });

  it('hides ignored entries until "Show ignored" is switched on', async () => {
    installBackend({ files: FILES, ignored: ['ignored.log', 'build'] });
    const { user } = mount();
    await screen.findByRole('treeitem', { name: /README\.md/ });
    expect(screen.queryByRole('treeitem', { name: /ignored\.log/ })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: /build/ })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Show ignored' }));
    expect(screen.getByRole('treeitem', { name: /ignored\.log/ })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /build/ })).toBeTruthy();
  });

  it('an outside or broken link is greyed and can be neither expanded nor opened', async () => {
    const backend = installBackend({ files: { 'a.txt': 'a' }, links: { out: 'outside', dead: 'broken', inner: 'dir', alias: 'file' } });
    const { user } = mount();
    await screen.findByRole('treeitem', { name: /a\.txt/ });
    for (const name of ['out', 'dead']) {
      const row = screen.getByRole('treeitem', { name: new RegExp(`^${name}`) });
      expect(row.getAttribute('aria-disabled')).toBe('true');
      const button = within(row).getAllByRole('button')[0] as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      await user.click(button);
    }
    expect(screen.getByRole('treeitem', { name: /^out/ }).textContent).toContain('points outside the root');
    expect(screen.getByRole('treeitem', { name: /^dead/ }).textContent).toContain('broken link');
    expect(backend.calls.list).toEqual(['']);
    expect(backend.calls.read).toEqual([]);
    // An in-root link to a folder behaves like a folder.
    expect(screen.getByRole('treeitem', { name: /^inner/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a hostile file name as literal text, never as an element', async () => {
    const name = '<img src=x onerror=alert(1)>.txt';
    installBackend({ files: { [name]: 'x' } });
    const { container } = mount();
    const row = await screen.findByRole('treeitem', { name: new RegExp('onerror') });
    expect(row.textContent).toContain(name);
    expect(container.querySelector('img')).toBeNull();
  });

  it('a System that cannot be reached replaces the tree with an alert naming the root; Retry lists again', async () => {
    const backend = installBackend({ files: FILES });
    backend.listError = new ApiError(502, 'the System of app is unreachable', 'SYSTEM_UNREACHABLE');
    const { user } = mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('app');
    expect(alert.textContent).toContain('unreachable');
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    backend.listError = null;
    await user.click(within(alert).getByRole('button', { name: /retry/i }));
    await screen.findByRole('treeitem', { name: /README\.md/ });
    expect(backend.calls.list).toEqual(['', '']);
  });

  it('a folder that fails to load shows its error inline with a Retry, and the rest of the tree stays', async () => {
    installBackend({ files: FILES });
    const { user } = mount();
    await screen.findByRole('treeitem', { name: /README\.md/ });
    const original = vi.mocked(endpoints.list).getMockImplementation()!;
    vi.mocked(endpoints.list).mockImplementationOnce(async () => { throw new ApiError(403, 'permission denied', 'PERMISSION_DENIED'); });
    await user.click(screen.getByRole('button', { name: /^src$/ }));
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes('permission denied'))).toBe(true));
    expect(screen.getByRole('treeitem', { name: /README\.md/ })).toBeTruthy();
    vi.mocked(endpoints.list).mockImplementation(original);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('treeitem', { name: /main\.ts/ });
    expect(vi.mocked(endpoints.list).mock.calls.filter(([, d]) => d === 'src')).toHaveLength(2);
  });

  it('opening a file from the tree reads it once and marks its row selected', async () => {
    const backend = installBackend({ files: FILES });
    const { user } = mount();
    await user.click(await screen.findByRole('button', { name: /^README\.md$/ }));
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /README\.md/ }).getAttribute('aria-selected')).toBe('true'));
    expect(backend.calls.read).toEqual(['README.md']);
  });
});
