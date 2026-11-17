import { Refusal } from '../refusals.js';
import { decodeName, splitNul } from './files.js';
import { filesOutputBytes, searchOutputBytes } from '../limits.js';
import { runOp } from './script.js';

/** The engine name the helper prints on its first line, and the rest of its output. */
function engineAndBody(stdout) {
  const nl = stdout.indexOf(0x0a);
  const engine = stdout.subarray(0, nl).toString('latin1');
  if (engine !== 'rg' && engine !== 'git') throw new Refusal('OP_FAILED', 'the search helper answered garbage');
  return { engine, body: stdout.subarray(nl + 1) };
}

/** Cuts a line of text to at most `max` bytes without splitting a UTF-8 character. */
function snippet(buf, max) {
  let end = Math.min(buf.length, max);
  if (end < buf.length) while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8').replace(/\r$/, '');
}

const stripDot = (p) => (p.startsWith('./') ? p.slice(2) : p);

/**
 * Parses the engine's records: `path NUL line : text NL` (rg --null) or `path NUL line NUL text NL` (git grep -z).
 * The path is NUL-terminated, so a newline inside a file name cannot be mistaken for a record boundary; only the text,
 * which cannot contain a newline, ends at one. `lines` counts raw newlines, which is what the helper's cap counted.
 */
function parseRecords(engine, body) {
  const records = [];
  let lines = 0;
  for (const b of body) if (b === 0x0a) lines++;
  for (let i = 0; i < body.length;) {
    const z = body.indexOf(0, i);
    if (z < 0) break;
    const path = stripDot(decodeName(body.subarray(i, z)).text);
    let nl = body.indexOf(0x0a, z + 1);
    if (nl < 0) nl = body.length;
    const rest = body.subarray(z + 1, nl);
    const sep = rest.indexOf(engine === 'rg' ? 0x3a : 0);
    if (sep >= 0) records.push({ path, line: Number(rest.subarray(0, sep).toString('latin1')), text: rest.subarray(sep + 1) });
    i = nl + 1;
  }
  return { records, lines };
}

/** Searches the tree: matching lines grouped by file, capped at MAX_SEARCH_RESULTS. */
export async function search(target, { q, regex, matchCase }, { limits, signal }) {
  const max = limits.MAX_SEARCH_RESULTS;
  const snip = limits.MAX_SNIPPET_BYTES;
  let stdout;
  try {
    ({ stdout } = await runOp(target, 'search', [regex ? 'regex' : 'fixed', matchCase ? 'sensitive' : 'insensitive', String(max), String(snip), q], {
      timeoutMs: limits.SEARCH_TIMEOUT_MS, maxOutputBytes: searchOutputBytes(max, snip), signal, retry: true,
    }));
  } catch (e) {
    if (e instanceof Refusal && e.code === 'TIMEOUT') throw new Refusal('TIMEOUT', 'search timed out');
    throw e;
  }
  const { engine, body } = engineAndBody(stdout);
  const { records, lines } = parseRecords(engine, body);
  const truncated = lines > max || records.length > max;
  const files = [];
  const byPath = new Map();
  let total = 0;
  for (const m of records.slice(0, max)) {
    let f = byPath.get(m.path);
    if (!f) { f = { path: m.path, matches: [] }; byPath.set(m.path, f); files.push(f); }
    f.matches.push({ line: m.line, text: snippet(m.text, snip) });
    total++;
  }
  return { engine, files, total, truncated, limit: max };
}

/** Every file of the tree for quick-open, ignore rules applied, capped at MAX_QUICKOPEN_FILES. */
export async function listFiles(target, { limits, signal }) {
  const max = limits.MAX_QUICKOPEN_FILES;
  const { stdout } = await runOp(target, 'files', [String(max)], {
    timeoutMs: limits.SEARCH_TIMEOUT_MS, maxOutputBytes: filesOutputBytes(max), signal, retry: true,
  });
  const { engine, body } = engineAndBody(stdout);
  const parts = splitNul(body).map((b) => stripDot(decodeName(b).text));
  const marker = parts.indexOf('/ignored');
  const listed = marker < 0 ? parts : parts.slice(0, marker);
  // The git engine appends the tracked files an ignore rule matches (rg never lists them); subtract them.
  const ignored = new Set(marker < 0 ? [] : parts.slice(marker + 1));
  const all = ignored.size ? listed.filter((p) => !ignored.has(p)) : listed;
  return { engine, files: all.slice(0, max), truncated: all.length > max, limit: max };
}
