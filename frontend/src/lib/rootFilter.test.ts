import { describe, expect, it } from 'vitest';
import type { RootProject } from '@/lib/endpoints';
import { groupKey, groupLabel, groupRoots, matchRoot } from './rootFilter';

const p = (name: string, over: Partial<RootProject> = {}): RootProject => ({ name, workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, worktrees: [], ...over });
const PROJECTS = [
  p('zed'), p('beta', { workspace: 'team' }), p('alpha', { workspace: 'team', worktrees: [{ name: 'wt1', branch: 'feat/login' }] }),
  p('pp', { workspace: 'Acme' }), p('amber'),
];

describe('groupRoots', () => {
  it('orders groups alphabetically with "No workspace" last, and projects alphabetically within', () => {
    const g = groupRoots(PROJECTS, '');
    expect(g.map(groupLabel)).toEqual(['Acme', 'team', 'No workspace']);
    expect(g[1].projects.map((x) => x.project.name)).toEqual(['alpha', 'beta']);
    expect(g[2].projects.map((x) => x.project.name)).toEqual(['amber', 'zed']);
  });

  it('empty and whitespace match all; matching is case-insensitive on name or workspace; no match is []', () => {
    expect(groupRoots(PROJECTS, '   ').flatMap((x) => x.projects)).toHaveLength(5);
    expect(groupRoots(PROJECTS, 'TEAM').flatMap((x) => x.projects.map((y) => y.project.name))).toEqual(['alpha', 'beta']);
    expect(groupRoots(PROJECTS, ' PP ').flatMap((x) => x.projects.map((y) => y.project.name))).toEqual(['pp']);
    expect(groupRoots(PROJECTS, 'zzz')).toEqual([]);
  });

  it('a worktree name or branch match includes the project with worktreeHit; a name match does not', () => {
    expect(groupRoots(PROJECTS, 'wt1')[0].projects).toEqual([{ project: PROJECTS[2], worktreeHit: true }]);
    expect(groupRoots(PROJECTS, 'LOGIN')[0].projects[0].worktreeHit).toBe(true);
    expect(groupRoots(PROJECTS, 'alpha')[0].projects[0].worktreeHit).toBe(false);
  });

  it('a worktree hit on an unreachable or degraded project does not include it', () => {
    const wts = [{ name: 'hidden', branch: null }];
    expect(matchRoot(p('a', { unreachable: 'down', worktrees: wts }), 'hidden').hit).toBe(false);
    expect(matchRoot(p('a', { degraded: 'bad', worktrees: wts }), 'hidden').hit).toBe(false);
  });

  it('a workspace literally named "No workspace" has a different key from the no-workspace group', () => {
    const g = groupRoots([p('a', { workspace: 'No workspace' }), p('b')], '');
    expect(g).toHaveLength(2);
    expect(new Set(g.map(groupKey)).size).toBe(2);
  });
});
