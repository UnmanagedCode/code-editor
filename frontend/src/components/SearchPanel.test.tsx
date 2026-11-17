import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { installBackend } from '@/test/fakeBackend';
import { SearchPanel } from './SearchPanel';

const target = { project: 'app', worktree: null };
const result = (over = {}) => ({
  engine: 'rg' as const, total: 3, truncated: false, limit: 500,
  files: [
    { path: 'src/a.ts', matches: [{ line: 3, text: 'const needle = 1;' }, { line: 9, text: 'needle()' }] },
    { path: 'b.md', matches: [{ line: 1, text: '<img src=x onerror=alert(1)>' }] },
  ],
  ...over,
});

async function run(over = {}) {
  const backend = installBackend({ files: {} });
  backend.searchResult = result(over);
  const onOpen = vi.fn();
  const user = userEvent.setup();
  render(<SearchPanel target={target} onOpen={onOpen} />);
  await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'needle{Enter}');
  await screen.findByText(/in 2 files/);
  return { backend, onOpen, user };
}

describe('SearchPanel', () => {
  it('sends the query with the Regex and Match case flags as toggled', async () => {
    const backend = installBackend({ files: {} });
    const user = userEvent.setup();
    render(<SearchPanel target={target} onOpen={() => {}} />);
    const q = screen.getByRole('textbox', { name: 'Search query' });
    await user.type(q, 'a.b{Enter}');
    await waitFor(() => expect(backend.calls.search).toHaveLength(1));
    expect(backend.calls.search[0]).toEqual({ q: 'a.b', regex: false, matchCase: false });
    await user.click(screen.getByRole('button', { name: 'Regex' }));
    await user.click(screen.getByRole('button', { name: 'Match case' }));
    expect(screen.getByRole('button', { name: 'Regex' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Match case' }).getAttribute('aria-pressed')).toBe('true');
    await user.type(q, '{Enter}');
    await waitFor(() => expect(backend.calls.search).toHaveLength(2));
    expect(backend.calls.search[1]).toEqual({ q: 'a.b', regex: true, matchCase: true });
  });

  it('an empty query is not sent', async () => {
    const backend = installBackend({ files: {} });
    const user = userEvent.setup();
    render(<SearchPanel target={target} onOpen={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Search query' }), '{Enter}');
    expect(backend.calls.search).toEqual([]);
  });

  it('groups results by file with a match count, names the engine, and collapses a file', async () => {
    const { user } = await run();
    expect(screen.getByText(/3 matches in 2 files · ripgrep/)).toBeTruthy();
    const group = screen.getByRole('button', { name: /src\/a\.ts/ });
    expect(group.textContent).toContain('2');
    expect(screen.getByText('const needle = 1;')).toBeTruthy();
    await user.click(group);
    expect(screen.queryByText('const needle = 1;')).toBeNull();
  });

  it('a truncated result set says so and tells the user to refine', async () => {
    await run({ truncated: true, limit: 500 });
    expect(screen.getByText('Showing the first 500 results; refine the search.')).toBeTruthy();
  });

  it('a snippet containing markup is shown as text, never as an element', async () => {
    const { } = await run();
    const snippet = screen.getByText('<img src=x onerror=alert(1)>');
    expect(snippet.tagName).toBe('SPAN');
    expect(document.querySelector('img')).toBeNull();
  });

  it('clicking a result opens that file at that line', async () => {
    const { user, onOpen } = await run();
    await user.click(screen.getByText('needle()'));
    expect(onOpen).toHaveBeenCalledWith('src/a.ts', 9);
  });

  it('an invalid pattern is shown inline', async () => {
    const backend = installBackend({ files: {} });
    backend.searchError = new ApiError(400, 'regex parse error: unclosed group', 'SEARCH_INVALID');
    const user = userEvent.setup();
    render(<SearchPanel target={target} onOpen={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Search query' }), '({Enter}');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/unclosed group/)).toBeTruthy();
  });

  it('no matches says so', async () => {
    const backend = installBackend({ files: {} });
    backend.searchResult = { engine: 'git', files: [], total: 0, truncated: false, limit: 500 };
    const user = userEvent.setup();
    render(<SearchPanel target={target} onOpen={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: 'Search query' }), 'zzz{Enter}');
    await screen.findByText('No results.');
    expect(screen.getByText(/git grep/)).toBeTruthy();
  });
});
