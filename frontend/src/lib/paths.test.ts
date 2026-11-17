import { describe, expect, it } from 'vitest';
import { isUnder, join, leaf, leafNameError, parent, retarget } from './paths';

describe('paths', () => {
  it('joins, splits parent and leaf, with the root as an empty string', () => {
    expect(join('', 'a')).toBe('a');
    expect(join('a/b', 'c')).toBe('a/b/c');
    expect(parent('a/b/c')).toBe('a/b');
    expect(parent('a')).toBe('');
    expect(leaf('a/b/c')).toBe('c');
    expect(leaf('c')).toBe('c');
  });

  it('isUnder is true for the path itself and its descendants only', () => {
    expect(isUnder('a/b', 'a')).toBe(true);
    expect(isUnder('a', 'a')).toBe(true);
    expect(isUnder('ab', 'a')).toBe(false);
    expect(isUnder('x', '')).toBe(true);
  });

  it('retarget follows a renamed file exactly and a renamed folder by prefix, leaving look-alikes alone', () => {
    expect(retarget('src/a.ts', 'src/a.ts', 'src/b.ts')).toBe('src/b.ts');
    expect(retarget('src/lib/x.ts', 'src', 'source')).toBe('source/lib/x.ts');
    expect(retarget('src2/x.ts', 'src', 'source')).toBe('src2/x.ts');
    expect(retarget('other.ts', 'src', 'source')).toBe('other.ts');
  });

  it('leafNameError refuses empty, slash, dot segments, .git and NUL; accepts ordinary and dotted names', () => {
    for (const bad of ['', '  ', 'a/b', '.', '..', '.git', 'a\0b']) expect(leafNameError(bad), JSON.stringify(bad)).not.toBeNull();
    for (const ok of ['a', '.gitignore', 'a b', '-rf', 'a..b', '.github']) expect(leafNameError(ok), ok).toBeNull();
  });
});
