import { describe, expect, it } from 'vitest';
import { ccLink, encodeCcPath } from '@/lib/ccLink';
import { CC_LINK_FIXTURES } from '@/test/ccLinkFixtures';
import { parseSearch } from './route';

/** What Code Editor reads when cc opens `hash`: cc frames `/plugins/code-editor/` + the subpath, and the page parses its search. */
function readFromHash(hash: string) {
  const subpath = hash.slice('#plugin/code-editor/'.length);
  const frame = new URL(`/plugins/code-editor/${subpath}`, 'http://127.0.0.1:8787/');
  const { cc } = parseSearch(frame.search);
  if (cc?.kind !== 'path') return { path: null, line: null, endLine: null };
  return { path: cc.path, line: cc.range?.start ?? null, endLine: cc.range?.end ?? null };
}
/** The fragment the browser's URL parser gives a link (cc's viewLinkHash returns it unchanged when it accepts the link). */
const fragmentOf = (link: string) => new URL(link).hash;

describe('deep link decoding', () => {
  for (const f of CC_LINK_FIXTURES.filter((x) => x.hash !== null)) {
    // Invariant: a link as a session writes it reaches the editor as exactly this path and range (or, on a failure row, the documented loss).
    it(`${f.name}: the frame reads the fixture’s path and lines`, () => {
      expect(fragmentOf(f.link)).toBe(f.hash);
      expect(readFromHash(f.hash!)).toEqual({ path: f.path, line: f.line, endLine: f.endLine });
    });
  }

  for (const f of CC_LINK_FIXTURES.filter((x) => !x.failure)) {
    // Invariant: the editor's own encoder (used in comment prompts) round-trips every path the table covers.
    it(`${f.name}: encodeCcPath → ccLink → frame round-trips the path`, () => {
      const link = ccLink(f.path!, { start: 3, end: 5 });
      expect(readFromHash(fragmentOf(link))).toEqual({ path: f.path, line: 3, endLine: 5 });
    });
  }

  // Invariant: the encoder leaves letters, digits and / . _ - raw and percent-encodes every other character's UTF-8 bytes.
  it('encodeCcPath keeps [A-Za-z0-9/._-] raw and encodes the rest', () => {
    expect(encodeCcPath('/srv/app_1/src-x/a.ts')).toBe('/srv/app_1/src-x/a.ts');
    expect(encodeCcPath("/a b#c+d%e&f=g(h)i?j'k*l!m~n")).toBe('/a%20b%23c%2Bd%25e%26f%3Dg%28h%29i%3Fj%27k%2Al%21m%7En');
    expect(encodeCcPath('/café')).toBe('/caf%C3%A9');
  });
});
