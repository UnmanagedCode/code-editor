import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeCcPath } from './ccLink';

// The conductor convention's skill (conventions/code-links.md) restates the deep-link path encoding for the model.
// This keeps that restatement in step with the encoder the editor itself uses.
const fragment = fs.readFileSync(path.join(__dirname, '../../../conventions/code-links.md'), 'utf8');
const bullet = /^- Keep `([^`]+)` raw\. Percent-encode every other character as its UTF-8 bytes: (.+)\.$/m.exec(fragment);

/** The characters `A–Z a–z 0–9 / . _ -` names, ranges expanded. */
function rawSet(spec: string): Set<string> {
  const out = new Set<string>();
  for (const token of spec.split(' ')) {
    const range = /^(.)–(.)$/u.exec(token);
    if (range) for (let c = range[1].codePointAt(0)!; c <= range[2].codePointAt(0)!; c++) out.add(String.fromCodePoint(c));
    else if ([...token].length === 1) out.add(token);
    else throw new Error(`unparsed raw-set token ${JSON.stringify(token)}`);
  }
  return out;
}

/** `space `%20``, `` `#` `%23` `` … as [character, encoding] pairs. */
function examples(list: string): [string, string][] {
  return list.split(', ').map((item) => {
    const m = /^(?:space|`(.+)`) `((?:%[0-9A-F]{2})+)`$/u.exec(item);
    if (!m) throw new Error(`unparsed encoding example ${JSON.stringify(item)}`);
    return [m[1] ?? ' ', m[2]];
  });
}

describe('the code-links skill’s encoding rule matches encodeCcPath', () => {
  // Invariant: rewording the skill's encoding bullet fails here instead of silently leaving it unchecked.
  it('the fragment has the encoding bullet', () => {
    expect(bullet).not.toBeNull();
  });

  // Invariant: every %XX example the skill teaches is exactly what the editor's encoder produces for that character.
  it('each percent-encoding example is encodeCcPath’s output', () => {
    const pairs = examples(bullet![2]);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [ch, encoded] of pairs) expect(encodeCcPath(ch), JSON.stringify(ch)).toBe(encoded);
  });

  // Invariant: the characters the skill says to keep raw are exactly those encodeCcPath leaves raw (printable ASCII, plus non-ASCII samples).
  it('the raw set is exactly what encodeCcPath leaves unencoded', () => {
    const raw = rawSet(bullet![1]);
    const sample = [...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)), 'é', '中', '😀', '\t', '\n'];
    for (const ch of sample) expect(encodeCcPath(ch) === ch, JSON.stringify(ch)).toBe(raw.has(ch));
    for (const ch of raw) expect(sample).toContain(ch);
  });
});
