import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { RootProject } from '@/lib/endpoints';
import { RootBrowser, RootPicker, type RootChoice } from './RootPicker';

const project = (name: string, over: Partial<RootProject> = {}): RootProject => ({ name, workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, worktrees: [], ...over });
const PROJECTS = [
  project('app', { workspace: 'team', worktrees: [{ name: 'wt1', branch: 'feat/one' }, { name: 'wt2', branch: null }] }),
  project('box', { workspace: 'team', system: 'docker', remoteId: 'ssh1' }),
  project('solo'),
  project('down', { unreachable: 'provider died', worktrees: [{ name: 'hidden', branch: null }] }),
  project('bad', { degraded: 'record unreadable' }),
];
const ROOT: RootChoice = { project: 'solo', worktree: null };

function setup(over: Partial<Parameters<typeof RootPicker>[0]> = {}) {
  const onPick = vi.fn<(r: RootChoice) => void>();
  const props = { root: ROOT, system: null, projects: PROJECTS, error: null, onRetry: vi.fn(), onOpen: vi.fn(), onPick, ...over };
  const user = userEvent.setup();
  render(<RootPicker {...props} />);
  return { props: { ...props, onPick }, user };
}
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Switch root/ }));
  return screen.findByRole('dialog');
};

describe('RootPicker dialog', () => {
  it('focuses "Filter projects" on open and calls onOpen once', async () => {
    const { props, user } = setup();
    const dialog = await open(user);
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: 'Filter projects' })));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('typing narrows sections and rows, no match says so, and clearing restores everything', async () => {
    const { user } = setup();
    const dialog = await open(user);
    const filter = within(dialog).getByRole('textbox', { name: 'Filter projects' });
    expect(within(dialog).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['team', 'No workspace']);
    await user.type(filter, 'BOX');
    expect(within(dialog).getAllByRole('region')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: /^box/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'app' })).toBeNull();
    await user.clear(filter);
    await user.type(filter, 'zzz');
    expect(within(dialog).getByText('No project matches.')).toBeTruthy();
    await user.clear(filter);
    expect(within(dialog).getAllByRole('region')).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'app' })).toBeTruthy();
  });

  it('the chevron expands the checkouts; worktrees pick {project, worktree}; the name and "(main checkout)" pick the project; a pick closes the dialog', async () => {
    const { props, user } = setup();
    let dialog = await open(user);
    const chevron = within(dialog).getByRole('button', { name: 'Show worktrees of app' });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    await user.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    const list = within(dialog).getByRole('list', { name: 'Checkouts of app' });
    expect(within(list).getByText('(main checkout)')).toBeTruthy();
    expect(within(list).getByText('feat/one')).toBeTruthy();
    await user.click(within(list).getByRole('button', { name: /^wt1/ }));
    expect(props.onPick).toHaveBeenLastCalledWith({ project: 'app', worktree: 'wt1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'app' }));
    expect(props.onPick).toHaveBeenLastCalledWith({ project: 'app', worktree: null });
    dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'Show worktrees of app' }));
    await user.click(within(dialog).getByRole('button', { name: '(main checkout)' }));
    expect(props.onPick).toHaveBeenLastCalledWith({ project: 'app', worktree: null });
  });

  it('a filter that matches only a worktree shows its project already expanded', async () => {
    const { user } = setup();
    const dialog = await open(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Filter projects' }), 'feat/one');
    expect(within(dialog).getByRole('button', { name: 'Show worktrees of app' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByRole('list', { name: 'Checkouts of app' })).toBeTruthy();
  });

  it('an unreachable or degraded project is disabled with its reason, and its worktrees stay hidden', async () => {
    const { user } = setup();
    const dialog = await open(user);
    for (const [name, reason] of [['down', 'provider died'], ['bad', 'record unreadable']]) {
      expect((within(dialog).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
      expect((within(dialog).getByRole('button', { name: `Show worktrees of ${name}` }) as HTMLButtonElement).disabled).toBe(true);
      expect(within(dialog).getByText(reason)).toBeTruthy();
    }
    expect(within(dialog).queryByText('hidden')).toBeNull();
  });

  it('renders hostile names and reasons as text, never markup', async () => {
    const hostile = [project('<b>x</b>', { degraded: '<b>y</b>' })];
    setup({ projects: hostile });
    const dialog = await open(userEvent.setup());
    expect(dialog.querySelector('b')).toBeNull();
    expect(within(dialog).getByText('<b>x</b>')).toBeTruthy();
    expect(within(dialog).getByText('<b>y</b>')).toBeTruthy();
  });

  it('marks a remote project with its System badge', async () => {
    const { user } = setup();
    expect(within(await open(user)).getByText('docker · ssh1')).toBeTruthy();
  });

  it('marks the current root aria-current; a current worktree starts its project expanded', async () => {
    const { user } = setup({ root: { project: 'app', worktree: 'wt2' } });
    const dialog = await open(user);
    expect(within(dialog).getByRole('button', { name: /^wt2/ }).getAttribute('aria-current')).toBe('true');
    expect(within(dialog).getByRole('button', { name: /^wt1/ }).getAttribute('aria-current')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'app' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks a current project root aria-current on its name button', async () => {
    const { user } = setup();
    expect(within(await open(user)).getByRole('button', { name: 'solo' }).getAttribute('aria-current')).toBe('true');
  });

  it('Tab goes from the filter to a chevron to the name; Enter picks; Escape closes without picking', async () => {
    const { props, user } = setup();
    let dialog = await open(user);
    const filter = within(dialog).getByRole('textbox', { name: 'Filter projects' });
    await waitFor(() => expect(document.activeElement).toBe(filter));
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Show worktrees of app' }));
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'app' }));
    await user.keyboard('{Enter}');
    expect(props.onPick).toHaveBeenCalledWith({ project: 'app', worktree: null });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    props.onPick.mockClear();
    dialog = await open(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(props.onPick).not.toHaveBeenCalled();
  });
});

describe('RootPicker details', () => {
  it('the filter clears when the dialog is reopened', async () => {
    const { user } = setup();
    let dialog = await open(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Filter projects' }), 'box');
    expect(within(dialog).getAllByRole('region')).toHaveLength(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await open(user);
    expect((within(dialog).getByRole('textbox', { name: 'Filter projects' }) as HTMLInputElement).value).toBe('');
    expect(within(dialog).getAllByRole('region')).toHaveLength(2);
  });

  it('with the open root on a main checkout, exactly one target is current: the name when collapsed, "(main checkout)" when expanded', async () => {
    const { user } = setup({ root: { project: 'app', worktree: null } });
    const dialog = await open(user);
    const current = () => within(dialog).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'true').map((b) => b.textContent);
    expect(current()).toEqual(['app']);
    await user.click(within(dialog).getByRole('button', { name: 'Show worktrees of app' }));
    expect(current()).toEqual(['(main checkout)']);
  });

  it('with no projects and no filter it says "No projects."', async () => {
    const { user } = setup({ projects: [] });
    const dialog = await open(user);
    expect(within(dialog).getByText('No projects.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Filter projects' }), 'x');
    expect(within(dialog).getByText('No project matches.')).toBeTruthy();
  });
});

describe('RootBrowser states', () => {
  const browse = (over: Partial<Parameters<typeof RootBrowser>[0]> = {}) => {
    const props = { projects: PROJECTS, error: null, current: null, onRetry: vi.fn(), onPick: vi.fn(), ...over };
    render(<RootBrowser {...props} />);
    return props;
  };

  it('shows the error with Retry that calls onRetry', async () => {
    const props = browse({ projects: null, error: new ApiError(503, 'cc is down') });
    expect(screen.getByRole('alert').textContent).toContain('cc is down');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalled();
    expect(screen.queryByText('Loading projects…')).toBeNull();
  });

  it('shows "Loading projects…" while there is no list and no error', () => {
    browse({ projects: null });
    expect(screen.getByText('Loading projects…')).toBeTruthy();
  });

  it('with an error and a stale list shows both', () => {
    browse({ error: new ApiError(503, 'cc is down') });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'solo' })).toBeTruthy();
  });
});
