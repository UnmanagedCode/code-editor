import assert from 'node:assert/strict';
import test from 'node:test';
import { isUnder, normalizeRel, toArg } from '../src/fs/paths.js';
import { Refusal } from '../src/refusals.js';

const refused = (v, opts) => assert.throws(() => normalizeRel(v, opts), (e) => e instanceof Refusal && e.code === 'INVALID_ARGUMENT');

test('normalizeRel accepts plain relative paths, dotfiles and .gitignore-like names', () => {
  for (const ok of ['a', 'a/b/c.txt', '.gitignore', '.github/workflows/x.yml', 'a b/c', '-rf', 'a..b', '..a', 'x/.gitkeep']) {
    assert.equal(normalizeRel(ok), ok);
  }
});

test('normalizeRel refuses traversal, absolute, empty and dot segments', () => {
  for (const v of ['..', '../x', 'a/../b', 'a/..', '/abs', '/', 'a//b', 'a/./b', './a', 'a/', '.', '']) refused(v);
});

test('normalizeRel refuses any .git segment, however deep', () => {
  for (const v of ['.git', '.git/config', 'x/.git/y', 'x/.git']) refused(v);
});

test('normalizeRel refuses .git in any letter case (case-insensitive file systems)', () => {
  for (const v of ['.GIT', '.Git', 'x/.gIt/y', 'a/.GIT']) refused(v);
  for (const ok of ['.github', '.gitignore', '.GITIGNORE', 'git', 'x.git']) assert.equal(normalizeRel(ok), ok);
});

test('normalizeRel refuses NUL, lone surrogates, non-strings and over-long paths', () => {
  refused('a\0b');
  refused('a\ud800b');
  refused(undefined);
  refused(42);
  refused('a'.repeat(11), { maxLength: 10 });
});

test("the root '' is allowed only when asked for", () => {
  assert.equal(normalizeRel('', { allowRoot: true }), '');
  refused('');
});

test('isUnder and toArg', () => {
  assert.ok(isUnder('a/b', 'a'));
  assert.ok(isUnder('a', 'a'));
  assert.ok(!isUnder('ab', 'a'));
  assert.ok(!isUnder('a', 'a/b'));
  assert.ok(isUnder('x', ''));
  assert.equal(toArg('-rf'), './-rf');
  assert.equal(toArg(''), '.');
});
