/** A 1-based line range; `end` null is a single line. */
export type LineRange = { start: number; end: number | null };

/** cc's in-app deep link to this plugin's page (cc's docs/plugin-ui.md → Deep links). */
export const CC_LINK_BASE = 'http://cc.internal/#plugin/code-editor/';

const SAFE = /[A-Za-z0-9/._-]/;

/**
 * Percent-encodes the UTF-8 bytes of every character of `path` outside `A–Z a–z 0–9 / . _ -`. Raw `#` would become the
 * frame's own hash, `+` would decode as a space, and a space or parenthesis would end a markdown link.
 */
export function encodeCcPath(path: string): string {
  let out = '';
  for (const ch of path) out += SAFE.test(ch) ? ch : encodeURIComponent(ch).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return out;
}

/** The deep link that opens `abs` (an absolute path on the project's System) at `range` in Code Editor. */
export function ccLink(abs: string, range: LineRange): string {
  return `${CC_LINK_BASE}?ccPath=${encodeCcPath(abs)}&ccLine=${range.start}${range.end !== null ? `&ccEndLine=${range.end}` : ''}`;
}
