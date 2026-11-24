import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAX_LINK_LINE } from '@/lib/limits';
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
    expect(p.cc).toEqual({ kind: 'place', project: 'app', worktree: 'wt1' });
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
    expect(result.current.cc).toEqual({ kind: 'place', project: 'app', worktree: 'wt1' });
    expect(window.location.search).toBe('');
    act(() => result.current.clearCc());
    expect(result.current.cc).toBeNull();
  });

  // Invariant: a cc request arriving on popstate (cc's navigate into an open page) keeps the current route and writes it back over the cc keys.
  it('re-reads on popstate; cc parameters arriving then are consumed and the current route is written back', () => {
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
    expect(result.current.cc).toEqual({ kind: 'place', project: 'app', worktree: null });
    expect(result.current.route).toEqual({ project: 'other', worktree: null, file: 'z.ts' });
    expect(window.location.search).toBe('?project=other&file=z.ts');
    act(() => {
      window.history.replaceState(null, '', '/?ccPath=%2Fsrv%2Fa.ts&ccLine=4&ccEndLine=9');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.cc).toEqual({ kind: 'path', path: '/srv/a.ts', range: { start: 4, end: 9 }, invalid: false });
    expect(window.location.search).toBe('?project=other&file=z.ts');
  });

  // Invariant: every cc key is stripped from the URL on load, ccPath ones included.
  it('consumes ccPath/ccLine/ccEndLine on load', () => {
    window.history.replaceState(null, '', '/?ccPath=/srv/a.ts&ccLine=2&ccEndLine=3');
    const { result } = renderHook(() => useRoute());
    expect(result.current.cc).toEqual({ kind: 'path', path: '/srv/a.ts', range: { start: 2, end: 3 }, invalid: false });
    expect(window.location.search).toBe('');
  });
});

describe('deep link keys (ccPath, ccLine, ccEndLine)', () => {
  const path = (search: string) => {
    const { cc } = parseSearch(search);
    if (cc?.kind !== 'path') throw new Error(`not a path request: ${JSON.stringify(cc)}`);
    return cc;
  };

  // Invariant: a valid ccPath with a line and a greater end line is a path request with that range.
  it('parses path, line and end line', () => {
    expect(path('?ccPath=/srv/app/a.ts&ccLine=12&ccEndLine=18')).toEqual({ kind: 'path', path: '/srv/app/a.ts', range: { start: 12, end: 18 }, invalid: false });
    expect(path('?ccPath=/srv/app/a.ts&ccLine=12')).toEqual({ kind: 'path', path: '/srv/app/a.ts', range: { start: 12, end: null }, invalid: false });
  });

  // Invariant: a bad or missing ccLine still opens the file, with no reveal.
  it('a missing or invalid ccLine means no range', () => {
    for (const q of ['', '&ccLine=', '&ccLine=0', '&ccLine=-3', '&ccLine=1.5', '&ccLine=abc', '&ccLine=1e3', `&ccLine=${MAX_LINK_LINE + 1}`, '&ccLine=+4', '&ccEndLine=9']) {
      expect(path(`?ccPath=/a/b.ts${q}`).range, q).toBeNull();
    }
    expect(path(`?ccPath=/a/b.ts&ccLine=${MAX_LINK_LINE}`).range).toEqual({ start: MAX_LINK_LINE, end: null });
  });

  // Invariant: ccEndLine is used only when greater than ccLine, and is clamped to MAX_LINK_LINE.
  it('an end line not past the line, or invalid, is a single line; a huge one is clamped', () => {
    for (const e of ['5', '4', '0', 'x', '-9', '']) expect(path(`?ccPath=/a/b&ccLine=5&ccEndLine=${e}`).range, e).toEqual({ start: 5, end: null });
    expect(path('?ccPath=/a/b&ccLine=5&ccEndLine=99999999999').range).toEqual({ start: 5, end: MAX_LINK_LINE });
    expect(path(`?ccPath=/a/b&ccLine=${MAX_LINK_LINE}&ccEndLine=99999999999`).range).toEqual({ start: MAX_LINK_LINE, end: null });
  });

  // Invariant: only a clean absolute file path is valid: relative, `.`/`..`/empty segments, trailing /, NUL and empty are invalid.
  it('refuses a path that is not a clean absolute file path', () => {
    for (const bad of ['', 'srv/a.ts', '/', '/srv/../etc/passwd', '/srv/./a', '/srv//a', '/srv/a/', '/srv/a%00b', '/..', '/.']) {
      expect(path(`?ccPath=${bad}`).invalid, bad).toBe(true);
    }
    expect(path('?ccPath=/srv/.hidden/..x/a').invalid).toBe(false);
  });

  // Invariant: ccPath wins over ccProject when both arrive, and any cc key marks the URL for consumption.
  it('ccPath wins over ccProject; any cc key is consumed and blanks the route', () => {
    expect(parseSearch('?ccProject=app&ccPath=/a/b&project=x').cc).toMatchObject({ kind: 'path', path: '/a/b' });
    const lone = parseSearch('?project=x&ccLine=3');
    expect(lone).toEqual({ route: { project: null, worktree: null, file: null }, cc: null, consume: true });
    expect(parseSearch('?project=x').consume).toBe(false);
  });

  // Invariant: the ⋮ menu-item form is unchanged.
  it('the menu-item form is a place request', () => {
    expect(parseSearch('?ccProject=app&ccWorktree=w').cc).toEqual({ kind: 'place', project: 'app', worktree: 'w' });
  });
});

describe('resolveCcRequest', () => {
  const projects = [{ name: 'app', workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, path: null, worktrees: [{ name: 'wt1', branch: null, path: null }] }];
  it('accepts a listed project and worktree', () => {
    expect(resolveCcRequest(projects, { project: 'app', worktree: 'wt1' })).toEqual({ project: 'app', worktree: 'wt1' });
    expect(resolveCcRequest(projects, { project: 'app', worktree: null })).toEqual({ project: 'app', worktree: null });
  });
  it('rejects an unknown project or worktree', () => {
    expect(resolveCcRequest(projects, { project: 'nope', worktree: null })).toBeNull();
    expect(resolveCcRequest(projects, { project: 'app', worktree: 'ghost' })).toBeNull();
  });
});
