import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RootProject } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { App } from '../App';

const project = (name: string, over: Partial<RootProject> = {}): RootProject => ({ name, system: 'local', remoteId: null, unreachable: null, degraded: null, worktrees: [], ...over });
const PROJECTS = [project('app', { worktrees: [{ name: 'w1', branch: 'code-conductor/w1' }] }), project('other'), project('box', { system: 'docker', remoteId: 'ssh1' }), project('down', { unreachable: 'provider died' })];
const FILES = { 'a.txt': 'alpha', 'b.txt': 'beta' };

function start(search = '') {
  window.history.replaceState(null, '', `/${search}`);
  const backend = installBackend({ files: FILES, projects: PROJECTS });
  return { backend, ...renderWithHost(<App />) };
}
const switchTo = async (user: ReturnType<typeof renderWithHost>['user'], name: RegExp) => {
  await user.click(screen.getByRole('button', { name: /Switch root/ }));
  await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name }));
};

describe('App', () => {
  it('the page title heading is "Code Editor"', async () => {
    start();
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Code Editor');
  });

  it('without a root it offers the projects, nesting worktrees, listing unreachable ones disabled with their reason', async () => {
    const { user } = start();
    await screen.findByRole('list', { name: 'Projects' });
    expect((screen.getByRole('button', { name: /^down/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('provider died')).toBeTruthy();
    expect(screen.getByText('docker · ssh1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^w1/ }));
    expect(window.location.search).toBe('?project=app&worktree=w1');
    expect((await screen.findByRole('button', { name: /Switch root/ })).textContent).toContain('app / w1');
  });

  it('shows the open root as text, with the System badge for a non-local project', async () => {
    start('?project=box');
    const root = await screen.findByRole('button', { name: /Switch root/ });
    expect(root.textContent).toContain('box');
    await waitFor(() => expect(root.textContent).toContain('docker · ssh1'));
  });

  it('a cc menu request for a listed worktree opens it and cleans the URL', async () => {
    start('?ccProject=app&ccWorktree=w1');
    const root = await screen.findByRole('button', { name: /Switch root/ });
    expect(root.textContent).toContain('app / w1');
    expect(window.location.search).toBe('?project=app&worktree=w1');
  });

  it('a cc request for an unknown project is a text-only "not found" message, never markup', async () => {
    const { container } = start('?ccProject=%3Cb%3Eevil%3C%2Fb%3E');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Project not found: <b>evil</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('button', { name: /Switch root/ })).toBeNull();
  });

  it('the file in the URL is opened on load and follows the active tab', async () => {
    const { backend } = start('?project=app&file=a.txt');
    await waitFor(() => expect(backend.calls.read).toEqual(['a.txt']));
    await within(screen.getByRole('tablist', { name: 'Open files' })).findByRole('tab', { name: /a\.txt/ });
    expect(window.location.search).toBe('?project=app&file=a.txt');
  });
});

describe('switching root with unsaved buffers', () => {
  async function dirtyApp() {
    const ctx = start('?project=app&file=a.txt');
    await waitFor(() => expect(ctx.fake.liveMounts()).toHaveLength(1));
    act(() => ctx.fake.modelFor('a.txt').type('edited'));
    return ctx;
  }

  it('asks first; Cancel stays on the current root and restores the URL', async () => {
    const { user } = await dirtyApp();
    await switchTo(user, /^other/);
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(within(dialog).getByText('a.txt')).toBeTruthy();
    expect(window.location.search).toContain('project=other');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(window.location.search).toContain('project=app'));
    expect(window.location.search).toBe('?project=app&file=a.txt');
    expect(screen.getByRole('button', { name: /Switch root/ }).textContent).toContain('app');
    expect(screen.getByRole('tab', { name: /a\.txt/ })).toBeTruthy();
  });

  it('Discard switches without writing', async () => {
    const { user, backend } = await dirtyApp();
    await switchTo(user, /^other/);
    await user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Switch root/ }).textContent).toContain('other'));
    expect(backend.calls.write).toEqual([]);
    expect(window.location.search).toBe('?project=other');
  });

  it('Save all writes every dirty buffer, then switches', async () => {
    const { user, backend } = await dirtyApp();
    await switchTo(user, /^other/);
    await user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save all' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Switch root/ }).textContent).toContain('other'));
    expect(backend.calls.write).toEqual([{ path: 'a.txt', content: 'edited', expectedHash: 'hash:a.txt:1' }]);
  });

  it('Save all that hits a conflict does not switch: the buffer is kept', async () => {
    const { user, backend } = await dirtyApp();
    backend.diskEdit('a.txt', 'worker');
    await switchTo(user, /^other/);
    await user.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save all' }));
    await waitFor(() => expect(backend.calls.write).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save all' })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Switch root/, hidden: true }).textContent).toContain('app');
  });

  it('a clean workspace switches at once with no prompt', async () => {
    const { user } = start('?project=app&file=a.txt');
    await screen.findByRole('tab', { name: /a\.txt/ });
    await switchTo(user, /^other/);
    await waitFor(() => expect(screen.getByRole('button', { name: /Switch root/ }).textContent).toContain('other'));
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
  });
});
