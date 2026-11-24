// One table of deep links as a session writes them, shared by the always-on decoder test (state/ccLink.test.ts) and the
// gated test against cc's real link parser (state/ccLink.cc.test.ts). `hash` is what cc's viewLinkHash accepts the link as
// (the WHATWG URL's fragment), or null when cc refuses it; `path`/`line`/`endLine` are what Code Editor then reads from
// the frame URL cc builds from that hash.

export type CcLinkFixture = {
  name: string;
  link: string;
  hash: string | null;
  /** Null on a refused row, and where the link loses the path (a documented failure). */
  path: string | null;
  line: number | null;
  endLine: number | null;
  /** True on a row that documents what goes wrong when a path character is written raw. */
  failure?: true;
};

const B = 'http://cc.internal/#plugin/code-editor/';
const H = '#plugin/code-editor/';

export const CC_LINK_FIXTURES: CcLinkFixture[] = [
  { name: 'a plain path', link: `${B}?ccPath=/srv/app/src/app.ts&ccLine=12`, hash: `${H}?ccPath=/srv/app/src/app.ts&ccLine=12`, path: '/srv/app/src/app.ts', line: 12, endLine: null },
  { name: 'a range', link: `${B}?ccPath=/srv/app/src/app.ts&ccLine=12&ccEndLine=18`, hash: `${H}?ccPath=/srv/app/src/app.ts&ccLine=12&ccEndLine=18`, path: '/srv/app/src/app.ts', line: 12, endLine: 18 },
  { name: 'a space as %20', link: `${B}?ccPath=/srv/my%20app/a.ts&ccLine=1`, hash: `${H}?ccPath=/srv/my%20app/a.ts&ccLine=1`, path: '/srv/my app/a.ts', line: 1, endLine: null },
  { name: '# as %23', link: `${B}?ccPath=/srv/a%23b.ts&ccLine=3`, hash: `${H}?ccPath=/srv/a%23b.ts&ccLine=3`, path: '/srv/a#b.ts', line: 3, endLine: null },
  { name: '+ as %2B', link: `${B}?ccPath=/srv/c%2B%2B/x.cc&ccLine=4`, hash: `${H}?ccPath=/srv/c%2B%2B/x.cc&ccLine=4`, path: '/srv/c++/x.cc', line: 4, endLine: null },
  { name: '% as %25', link: `${B}?ccPath=/srv/100%25/x.md&ccLine=5`, hash: `${H}?ccPath=/srv/100%25/x.md&ccLine=5`, path: '/srv/100%/x.md', line: 5, endLine: null },
  { name: '& and = as %26 %3D', link: `${B}?ccPath=/srv/a%26b%3Dc.ts&ccLine=6`, hash: `${H}?ccPath=/srv/a%26b%3Dc.ts&ccLine=6`, path: '/srv/a&b=c.ts', line: 6, endLine: null },
  { name: 'parentheses as %28 %29', link: `${B}?ccPath=/srv/f%281%29.ts&ccLine=7`, hash: `${H}?ccPath=/srv/f%281%29.ts&ccLine=7`, path: '/srv/f(1).ts', line: 7, endLine: null },
  { name: 'slashes as %2F', link: `${B}?ccPath=%2Fsrv%2Fapp%2Fa.ts&ccLine=8`, hash: `${H}?ccPath=%2Fsrv%2Fapp%2Fa.ts&ccLine=8`, path: '/srv/app/a.ts', line: 8, endLine: null },
  { name: 'raw non-ASCII', link: `${B}?ccPath=/srv/café.ts&ccLine=9`, hash: `${H}?ccPath=/srv/caf%C3%A9.ts&ccLine=9`, path: '/srv/café.ts', line: 9, endLine: null },
  { name: 'a raw ? inside the fragment', link: `${B}?ccPath=/srv/a?b.ts&ccLine=2`, hash: `${H}?ccPath=/srv/a?b.ts&ccLine=2`, path: '/srv/a?b.ts', line: 2, endLine: null },
  { name: 'a raw # truncates ccPath (it becomes the frame’s own hash)', link: `${B}?ccPath=/srv/a#b.ts&ccLine=3`, hash: `${H}?ccPath=/srv/a#b.ts&ccLine=3`, path: '/srv/a', line: null, endLine: null, failure: true },
  { name: 'a raw + decodes as a space', link: `${B}?ccPath=/srv/c++/x.cc&ccLine=4`, hash: `${H}?ccPath=/srv/c++/x.cc&ccLine=4`, path: '/srv/c  /x.cc', line: 4, endLine: null, failure: true },
  { name: 'a query before the fragment is refused', link: `http://cc.internal/?ccPath=/srv/a.ts#plugin/code-editor/`, hash: null, path: null, line: null, endLine: null, failure: true },
];
