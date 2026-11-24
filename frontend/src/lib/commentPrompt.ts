import { ccLink, type LineRange } from './ccLink';
import { MAX_COMMENT_SELECTION_CHARS } from './limits';

export type CommentInput = {
  /** The file's absolute path on its System. */
  abs: string;
  range: LineRange;
  project: string;
  worktree: string | null;
  comment: string;
  /** Exactly the selected text. */
  selection: string;
  /** The editor's language id for the file, the code fence's info string. */
  lang: string;
  /** The tab has unsaved changes, so its line numbers may not match the file on disk. */
  dirty: boolean;
};

export const DIRTY_NOTE = ' — the editor buffer has unsaved changes; line numbers refer to the buffer, not the file on disk';

/**
 * Untrusted text (a path, a project or worktree name) made inert inside one markdown line: ASCII punctuation other than
 * `/ . - :` is backslash-escaped (so `[`, `]`, `*`, `_` cannot open a link or emphasis), and control characters are
 * percent-encoded so it cannot start a new line or block.
 */
export function escapeInline(text: string): string {
  return text
    .replace(/[!-,;-@[-`{-~]/g, (c) => `\\${c}`)
    .replace(/[\x00-\x1f\x7f]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** A backtick fence longer than any backtick run in `text`, at least three. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** The selection cut to MAX_COMMENT_SELECTION_CHARS at a line boundary (a single overlong first line is cut inside it), with the marker naming the lines kept. */
export function truncateSelection(text: string, range: LineRange, max = MAX_COMMENT_SELECTION_CHARS): { text: string; marker: string | null } {
  if (text.length <= max) return { text, marker: null };
  const lines = text.split('\n');
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const add = (kept.length ? 1 : 0) + line.length;
    if (length + add > max) break;
    kept.push(line);
    length += add;
  }
  if (kept.length === 0) kept.push(lines[0].slice(0, max));
  const last = range.start + kept.length - 1;
  return { text: kept.join('\n'), marker: `[selection truncated: showing lines ${range.start}–${last} of ${range.start}–${range.end ?? range.start}]` };
}

/** The prompt a comment sends: a clickable deep link to the selection, where it lives, the comment, then the selected text. */
export function buildCommentPrompt(i: CommentInput): string {
  const label = escapeInline(`${i.abs}:${i.range.start}${i.range.end !== null ? `-${i.range.end}` : ''}`);
  const where = `(project ${escapeInline(i.project)}${i.worktree ? `, worktree ${escapeInline(i.worktree)}` : ''})`;
  const { text, marker } = truncateSelection(i.selection, i.range);
  const fence = fenceFor(text);
  return [
    `Comment on [${label}](${ccLink(i.abs, i.range)}) ${where}${i.dirty ? DIRTY_NOTE : ''}`,
    '',
    i.comment.trim(),
    '',
    'Selected text:',
    `${fence}${i.lang}`,
    text,
    fence,
    ...(marker ? [marker] : []),
  ].join('\n');
}
