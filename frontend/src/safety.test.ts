import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// File content, names, paths, snippets and error text are untrusted: they render only as text. This scans the UI source for
// the sinks that would turn them into markup, script or a URL, and for the other ways a plugin page can reach out of its origin.

const SRC = __dirname;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || rel(f).startsWith('test/');
const sources = walk(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !isTest(f));

export const BANNED: { name: string; re: RegExp; bad: string }[] = [
  { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML/, bad: '<div dangerouslySetInnerHTML={{ __html: x }} />' },
  { name: 'innerHTML', re: /\binnerHTML\b/, bad: 'el.innerHTML = x;' },
  { name: 'outerHTML', re: /\bouterHTML\b/, bad: 'el.outerHTML = x;' },
  { name: 'insertAdjacentHTML', re: /insertAdjacentHTML/, bad: 'el.insertAdjacentHTML("beforeend", x)' },
  { name: 'document.write', re: /document\.write\b/, bad: 'document.write(x)' },
  { name: 'eval', re: /\beval\s*\(/, bad: 'eval(x)' },
  { name: 'new Function', re: /new\s+Function\b/, bad: 'new Function(x)' },
  { name: 'srcDoc', re: /\bsrcDoc\b|\bsrcdoc\b/, bad: '<iframe srcDoc={x} />' },
  { name: 'href built from a value', re: /\bhref=\{/, bad: '<a href={url}>x</a>' },
  { name: 'src built from a value', re: /\bsrc=\{/, bad: '<img src={url} />' },
  { name: 'style from a variable', re: /\bstyle=\{(?!\{)/, bad: '<div style={s} />' },
  { name: 'location.hash assignment', re: /location\.hash\s*=(?!=)/, bad: 'location.hash = "#x"' },
  { name: 'root-relative fetch', re: /fetch\(\s*['"`]\//, bad: "fetch('/api/x')" },
  { name: 'window.parent', re: /window\.parent\b/, bad: 'window.parent.postMessage(x)' },
  { name: 'window.open', re: /window\.open\s*\(/, bad: 'window.open(url)' },
  { name: 'document.cookie', re: /document\.cookie/, bad: 'document.cookie = x' },
];

describe('banned sinks', () => {
  for (const b of BANNED) {
    it(`${b.name}: the pattern flags a known-bad sample`, () => {
      expect(b.re.test(b.bad)).toBe(true);
    });
    it(`${b.name}: not present in the UI source`, () => {
      const hits = sources.filter((f) => b.re.test(fs.readFileSync(f, 'utf8'))).map(rel);
      expect(hits).toEqual([]);
    });
  }

  it('inline style objects are allowed (numbers only); a style bound to a variable is not', () => {
    const style = BANNED.find((b) => b.name === 'style from a variable')!;
    expect(style.re.test('<div style={{ paddingLeft: `${depth * 12}px` }} />')).toBe(false);
  });
});

describe('monaco-editor is imported only by its host module', () => {
  it('only editor/monaco.ts (and the worker wiring it imports) import monaco-editor', () => {
    const importers = sources.filter((f) => /from\s+['"]monaco-editor/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    expect(importers).toEqual(['editor/monaco.ts', 'editor/monacoEnv.ts']);
  });

  it('monacoEnv.ts is imported by monaco.ts alone', () => {
    const importers = sources.filter((f) => /from\s+['"]\.\/monacoEnv|import\s+['"]\.\/monacoEnv/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(importers).toEqual(['editor/monaco.ts']);
  });

  it('the scan sees the real source tree (guards against an empty glob)', () => {
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.map(rel)).toContain('components/Workspace.tsx');
  });
});
