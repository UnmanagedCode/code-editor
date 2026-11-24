import { describe, expect, it } from 'vitest';
import type { RootProject } from '@/lib/endpoints';
import { groupKey, groupLabel, groupRoots, matchRoot } from './rootFilter';

const p = (name: string, over: Partial<RootProject> = {}): RootProject => ({ name, workspace: null, system: 'local', remoteId: null, unreachable: null, degraded: null, path: null, worktrees: [], ...over });
const PROJECTS = [
  p('zed'), p('beta', { workspace: 'team' }), p('alpha', { workspace: 'team', worktrees: [{ name: 'wt1', branch: 'feat/login', path: null }] }),
  p('pp', { workspace: 'Acme' }), p('amber'),
];

describe('matching is a case-insensitive substring', () => {
  const names = (filter: string, list: RootProject[]) => groupRoots(list, filter).flatMap((g) => g.projects.map((x) => x.project.name));
  const MIXED = [p('Delta', { workspace: 'Ops', worktrees: [{ name: 'Feature-X', branch: 'Release/Two', path: null }] }), p('alpha')];

  it('mixed-case data is found by lower-case terms, on name and workspace', () => {
    expect(names('delta', MIXED)).toEqual(['Delta']);
    expect(names('ops', MIXED)).toEqual(['Delta']);
  });
  it('a mid-string query matches a name, a workspace and a worktree name or branch', () => {
    expect(names('lph', MIXED)).toEqual(['alpha']);
    expect(names('el', MIXED)).toEqual(['Delta']);
    expect(groupRoots(MIXED, 'ps')[0].projects[0].worktreeHit).toBe(false);
    expect(names('ps', MIXED)).toEqual(['Delta']);
    expect(groupRoots(MIXED, 'ature-')[0].projects[0].worktreeHit).toBe(true);
    expect(groupRoots(MIXED, 'lease/tw')[0].projects[0].worktreeHit).toBe(true);
  });
  it('a worktree name matches regardless of case on either side', () => {
    expect(names('feature-x', MIXED)).toEqual(['Delta']);
    expect(names('FEATURE-X', MIXED)).toEqual(['Delta']);
    expect(groupRoots(MIXED, 'FEATURE-X')[0].projects[0].worktreeHit).toBe(true);
    expect(groupRoots(MIXED, 'release/two')[0].projects[0].worktreeHit).toBe(true);
  });
});

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
    const wts = [{ name: 'hidden', branch: null, path: null }];
    expect(matchRoot(p('a', { unreachable: 'down', worktrees: wts }), 'hidden').hit).toBe(false);
    expect(matchRoot(p('a', { degraded: 'bad', worktrees: wts }), 'hidden').hit).toBe(false);
  });

  it('a workspace literally named "No workspace" has a different key from the no-workspace group', () => {
    const g = groupRoots([p('a', { workspace: 'No workspace' }), p('b')], '');
    expect(g).toHaveLength(2);
    expect(new Set(g.map(groupKey)).size).toBe(2);
  });
});
