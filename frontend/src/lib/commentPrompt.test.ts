import { describe, expect, it } from 'vitest';
import { parseSearch } from '@/state/route';
import { buildCommentPrompt, DIRTY_NOTE, escapeInline, fenceFor, truncateSelection, type CommentInput } from './commentPrompt';

const input = (over: Partial<CommentInput> = {}): CommentInput => ({
  abs: '/srv/app/src/app.ts', range: { start: 12, end: 18 }, project: 'app', worktree: 'w1',
  comment: '  Why is this cached?  ', selection: 'const x = cache.get(k);', lang: 'typescript', dirty: false, ...over,
});
/** The deep link inside the prompt's first line, decoded the way the editor reads it after cc opens it. */
const linkOf = (prompt: string) => {
  const m = /\]\((http:\/\/cc\.internal\/#plugin\/code-editor\/[^)\s]*)\)/.exec(prompt.split('\n')[0]);
  if (!m) throw new Error('no link');
  const frame = new URL(`/plugins/code-editor/${new URL(m[1]).hash.slice('#plugin/code-editor/'.length)}`, 'http://h/');
  return parseSearch(frame.search).cc;
};

describe('buildCommentPrompt', () => {
  // Invariant: the prompt's exact shape: linked reference with place, the trimmed comment, then the fenced selection.
  it('builds the exact prompt text', () => {
    expect(buildCommentPrompt(input())).toBe([
      'Comment on [/srv/app/src/app.ts:12-18](http://cc.internal/#plugin/code-editor/?ccPath=/srv/app/src/app.ts&ccLine=12&ccEndLine=18) (project app, worktree w1)',
      '',
      'Why is this cached?',
      '',
      'Selected text:',
      '```typescript',
      'const x = cache.get(k);',
      '```',
    ].join('\n'));
  });

  // Invariant: a main-checkout comment names only the project; a single line has no range in the label or link.
  it('has no worktree clause for a main checkout, and a single line has no end', () => {
    const p = buildCommentPrompt(input({ worktree: null, range: { start: 3, end: null } }));
    expect(p.split('\n')[0]).toBe('Comment on [/srv/app/src/app.ts:3](http://cc.internal/#plugin/code-editor/?ccPath=/srv/app/src/app.ts&ccLine=3) (project app)');
  });

  // Invariant: the link in the prompt opens the selection's own path and lines, whatever characters the path holds.
  it('the link round-trips to the selection’s path and lines', () => {
    const abs = '/srv/my app/[x]*_#+%&=(1)/café.ts';
    expect(linkOf(buildCommentPrompt(input({ abs })))).toEqual({ kind: 'path', path: abs, range: { start: 12, end: 18 }, invalid: false });
  });

  // Invariant: path characters that are markdown syntax cannot break or restyle the label.
  it('escapes markdown punctuation in the label', () => {
    expect(escapeInline('/a/[b]*c_d`e<f>.ts:1-2')).toBe('/a/\\[b\\]\\*c\\_d\\`e\\<f\\>.ts:1-2');
    expect(escapeInline('/a\nb')).toBe('/a%0Ab');
    const first = buildCommentPrompt(input({ abs: '/srv/[x]/__init__.py' })).split('\n')[0];
    expect(first.startsWith('Comment on [/srv/\\[x\\]/\\_\\_init\\_\\_.py:12-18](')).toBe(true);
  });

  // Invariant: project and worktree names are untrusted: they cannot break the first line or inject markdown into the session.
  it('escapes the project and worktree names', () => {
    const p = buildCommentPrompt(input({ project: 'app\n\n[click](http://evil.example/)', worktree: 'w_*1*\r\n# hi' }));
    const lines = p.split('\n');
    expect(lines[0].endsWith('(project app%0A%0A\\[click\\]\\(http://evil.example/\\), worktree w\\_\\*1\\*%0D%0A\\# hi)')).toBe(true);
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Why is this cached?');
    expect(p.match(/\]\(/g)).toHaveLength(1);
  });

  // Invariant: the code fence is longer than any backtick run in the selection, so the selection cannot close it.
  it('the fence outgrows an embedded fence', () => {
    expect(fenceFor('no ticks')).toBe('```');
    expect(fenceFor('a ```` b ` c')).toBe('`````');
    const p = buildCommentPrompt(input({ selection: '```js\nx\n```' }));
    expect(p.split('\n').slice(-5)).toEqual(['````typescript', '```js', 'x', '```', '````']);
  });

  // Invariant: the unsaved-buffer note appears exactly when the tab is dirty.
  it('adds the dirty note only when dirty', () => {
    expect(buildCommentPrompt(input({ dirty: true })).split('\n')[0].endsWith(`(project app, worktree w1)${DIRTY_NOTE}`)).toBe(true);
    expect(buildCommentPrompt(input()).includes(DIRTY_NOTE)).toBe(false);
  });

  // Invariant: an overlong selection is cut at a line boundary and followed by a marker naming the lines kept.
  it('truncates at a line boundary with a marker', () => {
    const r = truncateSelection('aaaa\nbbbb\ncccc\ndddd', { start: 10, end: 13 }, 12);
    expect(r).toEqual({ text: 'aaaa\nbbbb', marker: '[selection truncated: showing lines 10–11 of 10–13]' });
    expect(truncateSelection('short', { start: 1, end: null }, 12)).toEqual({ text: 'short', marker: null });
    expect(truncateSelection('x'.repeat(20), { start: 4, end: null }, 5)).toEqual({ text: 'xxxxx', marker: '[selection truncated: showing lines 4–4 of 4–4]' });
    const p = buildCommentPrompt(input({ selection: 'y'.repeat(30_000) + '\nz' }));
    expect(p.endsWith('```\n[selection truncated: showing lines 12–12 of 12–18]')).toBe(true);
  });
});
