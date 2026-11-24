import { describe, expect, it } from 'vitest';
import type { RootProject } from './endpoints';
import { placeForPath } from './placeFor';

const project = (name: string, path: string | null, worktrees: { name: string; path: string | null }[] = []): RootProject => ({
  name, workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, path,
  worktrees: worktrees.map((w) => ({ ...w, branch: null })),
});

describe('placeForPath', () => {
  // Invariant: the longest root containing the path wins, so a worktree nested under its project's tree claims its files.
  it('a worktree nested under its project’s tree beats the project', () => {
    const projects = [project('app', '/srv/app', [{ name: 'w1', path: '/srv/app/.worktrees/w1' }])];
    expect(placeForPath('/srv/app/.worktrees/w1/src/a.ts', projects, null)).toEqual({ project: 'app', worktree: 'w1', file: 'src/a.ts' });
    expect(placeForPath('/srv/app/src/a.ts', projects, null)).toEqual({ project: 'app', worktree: null, file: 'src/a.ts' });
  });

  // Invariant: matching is across every project and worktree, not just the open one.
  it('finds a worktree of another project, and a worktree outside its project’s tree', () => {
    const projects = [project('app', '/srv/app'), project('lib', '/srv/lib', [{ name: 'fix', path: '/wt/lib-fix' }])];
    expect(placeForPath('/wt/lib-fix/x/y.c', projects, { project: 'app', worktree: null })).toEqual({ project: 'lib', worktree: 'fix', file: 'x/y.c' });
  });

  // Invariant: a root matches only at a `/` boundary: /p does not contain /pp/x.
  it('a root is a prefix only at a / boundary', () => {
    const projects = [project('p', '/p'), project('pp', '/pp')];
    expect(placeForPath('/pp/x', projects, null)).toEqual({ project: 'pp', worktree: null, file: 'x' });
    expect(placeForPath('/p/x', projects, null)).toEqual({ project: 'p', worktree: null, file: 'x' });
    expect(placeForPath('/px', projects, null)).toBeNull();
  });

  // Invariant: one trailing / on a root path is ignored.
  it('a trailing / on a root path is stripped', () => {
    expect(placeForPath('/srv/app/a.ts', [project('app', '/srv/app/')], null)).toEqual({ project: 'app', worktree: null, file: 'a.ts' });
  });

  // Invariant: a path no root contains, the root itself, and roots without a path give no place.
  it('no match, the root itself, or a root with no path is null', () => {
    const projects = [project('app', '/srv/app'), project('degraded', null)];
    expect(placeForPath('/elsewhere/a.ts', projects, null)).toBeNull();
    expect(placeForPath('/srv/app', projects, null)).toBeNull();
    expect(placeForPath('/srv/app/', projects, null)).toBeNull();
  });

  // Invariant: the remainder must be a path the backend accepts; a .git segment in any letter case gives null.
  it('a .git segment in any case, or an empty segment, in the remainder is null', () => {
    const projects = [project('app', '/srv/app')];
    expect(placeForPath('/srv/app/.git/config', projects, null)).toBeNull();
    expect(placeForPath('/srv/app/sub/.GiT/HEAD', projects, null)).toBeNull();
    expect(placeForPath('/srv/app/a//b', projects, null)).toBeNull();
  });

  // Invariant: identical root paths (projects on different Systems) resolve to cc's active session's place, else nothing.
  it('a tie goes to the active session’s place, else null', () => {
    const projects = [project('local-app', '/srv/app'), project('box-app', '/srv/app')];
    expect(placeForPath('/srv/app/a.ts', projects, { project: 'box-app', worktree: null })).toEqual({ project: 'box-app', worktree: null, file: 'a.ts' });
    expect(placeForPath('/srv/app/a.ts', projects, { project: 'other', worktree: null })).toBeNull();
    expect(placeForPath('/srv/app/a.ts', projects, null)).toBeNull();
    expect(placeForPath('/srv/app/a.ts', projects, undefined)).toBeNull();
  });
});
