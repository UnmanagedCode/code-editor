import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rank } from './fuzzy';

describe('fuzzy', () => {
  it('matches a subsequence case-insensitively and reports the matched indices', () => {
    const m = fuzzyMatch('smt', 'src/Main.ts')!;
    expect(m).not.toBeNull();
    expect(m.indices.map((i) => 'src/Main.ts'[i].toLowerCase()).join('')).toBe('smt');
  });

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'src/main.ts')).toBeNull();
    expect(fuzzyMatch('tsm', 'src/main.ts')).toBeNull(); // wrong order
  });

  it('ranks a basename hit above the same letters scattered through the directories', () => {
    const r = rank('main', ['m/a/i/n/readme.txt', 'src/main.ts']);
    expect(r[0].path).toBe('src/main.ts');
  });

  it('ranks a consecutive run above a scattered match in the same name', () => {
    const r = rank('util', ['src/u_t_i_l.ts', 'src/util.ts']);
    expect(r.map((m) => m.path)).toEqual(['src/util.ts', 'src/u_t_i_l.ts']);
  });

  it('prefers word-boundary and camelCase starts', () => {
    const r = rank('fb', ['src/fooBar.ts', 'src/xfxbx.ts']);
    expect(r[0].path).toBe('src/fooBar.ts');
  });

  it('limits the result count and drops non-matches', () => {
    const paths = Array.from({ length: 300 }, (_, i) => `dir/file${i}.ts`).concat('other.md');
    expect(rank('file', paths, 100)).toHaveLength(100);
    expect(rank('file', paths).every((m) => m.path !== 'other.md')).toBe(true);
  });

  it('an empty query matches everything with no highlighted characters', () => {
    const m = fuzzyMatch('', 'a.ts')!;
    expect(m.indices).toEqual([]);
  });
});
