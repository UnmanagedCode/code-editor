import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildSearch, parseSearch, useRoute } from './route';
import { resolveCcRequest } from './roots';

describe('route query string', () => {
  it('parses project, worktree and file', () => {
    expect(parseSearch('?project=app&worktree=w1&file=src%2Fa.ts').route).toEqual({ project: 'app', worktree: 'w1', file: 'src/a.ts' });
  });

  it('ignores worktree and file without a project', () => {
    expect(parseSearch('?worktree=w&file=a').route).toEqual({ project: null, worktree: null, file: null });
  });

  it('ccProject/ccWorktree become a pending cc request, not a route', () => {
    const p = parseSearch('?ccProject=app&ccWorktree=wt1&project=other');
    expect(p.route.project).toBeNull();
    expect(p.cc).toEqual({ project: 'app', worktree: 'wt1' });
  });

  it('build round-trips, omits empty parts, and never uses the hash', () => {
    expect(buildSearch({ project: 'app', worktree: null, file: 'a b.ts' })).toBe('?project=app&file=a+b.ts');
    expect(buildSearch({ project: null, worktree: 'w', file: 'f' })).toBe('');
    const r = { project: 'a', worktree: 'w', file: 'x/y.ts' };
    expect(parseSearch(buildSearch(r)).route).toEqual(r);
  });
});

describe('useRoute', () => {
  it('reads the URL on load and writes route changes with replaceState (no history entries, no hash)', () => {
    window.history.replaceState(null, '', '/?project=app&file=a.ts');
    const before = window.history.length;
    const { result } = renderHook(() => useRoute());
    expect(result.current.route).toEqual({ project: 'app', worktree: null, file: 'a.ts' });
    act(() => result.current.setRoute({ project: 'app', worktree: 'w1', file: null }));
    expect(window.location.search).toBe('?project=app&worktree=w1');
    expect(window.location.hash).toBe('');
    expect(window.history.length).toBe(before);
  });

  it('setFile changes only the file', () => {
    window.history.replaceState(null, '', '/?project=app&worktree=w');
    const { result } = renderHook(() => useRoute());
    act(() => result.current.setFile('src/x.ts'));
    expect(result.current.route).toEqual({ project: 'app', worktree: 'w', file: 'src/x.ts' });
    expect(window.location.search).toBe('?project=app&worktree=w&file=src%2Fx.ts');
  });

  it('consumes ccProject/ccWorktree on load: the URL is cleaned and the request is pending', () => {
    window.history.replaceState(null, '', '/?ccProject=app&ccWorktree=wt1');
    const { result } = renderHook(() => useRoute());
    expect(result.current.cc).toEqual({ project: 'app', worktree: 'wt1' });
    expect(window.location.search).toBe('');
    act(() => result.current.clearCc());
    expect(result.current.cc).toBeNull();
  });

  it('re-reads on popstate, consuming cc parameters that arrive then', () => {
    window.history.replaceState(null, '', '/?project=app');
    const { result } = renderHook(() => useRoute());
    act(() => {
      window.history.replaceState(null, '', '/?project=other&file=z.ts');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.route).toEqual({ project: 'other', worktree: null, file: 'z.ts' });
    act(() => {
      window.history.replaceState(null, '', '/?ccProject=app');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.cc).toEqual({ project: 'app', worktree: null });
    expect(window.location.search).toBe('');
  });
});

describe('resolveCcRequest', () => {
  const projects = [{ name: 'app', workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, worktrees: [{ name: 'wt1', branch: null }] }];
  it('accepts a listed project and worktree', () => {
    expect(resolveCcRequest(projects, { project: 'app', worktree: 'wt1' })).toEqual({ project: 'app', worktree: 'wt1' });
    expect(resolveCcRequest(projects, { project: 'app', worktree: null })).toEqual({ project: 'app', worktree: null });
  });
  it('rejects an unknown project or worktree', () => {
    expect(resolveCcRequest(projects, { project: 'nope', worktree: null })).toBeNull();
    expect(resolveCcRequest(projects, { project: 'app', worktree: 'ghost' })).toBeNull();
  });
});
