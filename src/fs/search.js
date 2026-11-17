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

function parseLine(engine, line) {
  const z = line.indexOf(0);
  if (z < 0) return null;
  const path = stripDot(decodeName(line.subarray(0, z)).text);
  const rest = line.subarray(z + 1);
  if (engine === 'rg') {
    const c = rest.indexOf(0x3a);
    if (c < 0) return null;
    return { path, line: Number(rest.subarray(0, c).toString('latin1')), text: rest.subarray(c + 1) };
  }
  const z2 = rest.indexOf(0);
  if (z2 < 0) return null;
  return { path, line: Number(rest.subarray(0, z2).toString('latin1')), text: rest.subarray(z2 + 1) };
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
  const lines = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === 0x0a) { lines.push(body.subarray(start, i)); start = i + 1; }
  }
  if (start < body.length) lines.push(body.subarray(start));
  const truncated = lines.length > max;
  const files = [];
  const byPath = new Map();
  let total = 0;
  for (const l of lines.slice(0, max)) {
    const m = parseLine(engine, l);
    if (!m) continue;
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
  const all = splitNul(body).map((b) => stripDot(decodeName(b).text));
  return { engine, files: all.slice(0, max), truncated: all.length > max, limit: max };
}
