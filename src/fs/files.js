import { createHash } from 'node:crypto';
import { Refusal } from '../refusals.js';
import { isUnder, toArg } from './paths.js';
import { runOp } from './script.js';
import { listOutputBytes, readOutputBytes } from '../limits.js';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const HASH_RE = /^[0-9a-f]{64}$/;
const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Splits a buffer on NUL bytes into buffers (the trailing empty piece dropped). */
export function splitNul(buf) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) { parts.push(buf.subarray(start, i)); start = i + 1; }
  }
  if (start < buf.length) parts.push(buf.subarray(start));
  return parts;
}

/** Strict UTF-8 → {text} or {text: null, text lossy}. */
export function decodeName(buf) {
  try { return { text: strict.decode(buf), ok: true }; } catch { return { text: buf.toString('utf8'), ok: false }; }
}

const LINK_TARGETS = { 'l:d': 'dir', 'l:f': 'file', 'l:o': 'other', 'l:outside': 'outside', 'l:git': 'git', 'l:broken': 'broken' };
const PLAIN_KINDS = { d: 'dir', f: 'file', o: 'other' };

const isDirLike = (e) => e.kind === 'dir' || (e.kind === 'symlink' && e.target === 'dir');

/** Lists one directory: sorted entries (dirs first), with `ignored` flags. */
export async function list(target, rel, { limits, signal }) {
  const max = limits.MAX_DIR_ENTRIES;
  const { stdout } = await runOp(target, 'list', [toArg(rel), String(max)], {
    timeoutMs: limits.OP_TIMEOUT_MS, maxOutputBytes: listOutputBytes(max), signal, retry: true,
  });
  const parts = splitNul(stdout);
  const entries = [];
  const ignored = new Set();
  let truncated = false;
  for (let i = 0; i < parts.length;) {
    const tok = parts[i].toString('latin1');
    if (tok === '/truncated') { truncated = true; i++; continue; }
    if (tok === '/ignored') {
      for (i++; i < parts.length; i++) {
        const p = decodeName(parts[i]).text.replace(/\/$/, '');
        ignored.add(p.slice(p.lastIndexOf('/') + 1));
      }
      break;
    }
    const nameBuf = parts[i + 1];
    if (!nameBuf) break;
    const { text, ok } = decodeName(nameBuf);
    const entry = tok.startsWith('l:')
      ? { name: text, kind: 'symlink', target: LINK_TARGETS[tok] ?? 'other' }
      : { name: text, kind: PLAIN_KINDS[tok] ?? 'other' };
    if (!ok) entry.unsupported = true;
    entries.push(entry);
    i += 2;
  }
  for (const e of entries) e.ignored = ignored.has(e.name);
  entries.sort((a, b) => {
    const da = isDirLike(a) ? 0 : 1;
    const db = isDirLike(b) ? 0 : 1;
    if (da !== db) return da - db;
    const la = a.name.toLowerCase();
    const lb = b.name.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return { path: rel, entries, truncated };
}

/** Decodes file bytes as UTF-8 text, or null when they are binary. A truncated read may end inside a character. */
function decodeText(bytes, truncated) {
  if (bytes.includes(0)) return null;
  for (let back = 0; back <= (truncated ? 3 : 0); back++) {
    try { return strict.decode(bytes.subarray(0, bytes.length - back)); } catch { /* try a shorter prefix */ }
  }
  return null;
}

/** Reads a file: text with its content hash, a binary marker, or a truncated read-only prefix. */
export async function read(target, rel, { limits, signal }) {
  const cap = limits.MAX_EDIT_BYTES;
  const { stdout } = await runOp(target, 'read', [toArg(rel), String(cap)], {
    timeoutMs: limits.OP_TIMEOUT_MS, maxOutputBytes: readOutputBytes(cap), signal, retry: true,
  });
  const nl = stdout.indexOf(0x0a);
  const size = Number(stdout.subarray(0, nl).toString('latin1'));
  if (nl < 0 || !Number.isSafeInteger(size)) throw new Refusal('OP_FAILED', 'the read helper answered garbage');
  const bytes = stdout.subarray(nl + 1);
  const truncated = size > cap;
  const text = decodeText(bytes, truncated);
  if (text === null) return { path: rel, size, kind: 'binary', truncated, readOnly: true, limitBytes: cap };
  return {
    path: rel, size, kind: 'text', content: text, ...(truncated ? {} : { hash: sha256(bytes) }),
    truncated, readOnly: truncated, limitBytes: cap,
  };
}

/** Saves text conditionally: `expectedHash` is the hash of what the editor loaded (null = the file must not exist). */
export async function write(target, rel, content, expectedHash, { limits }) {
  if (typeof content !== 'string') throw new Refusal('INVALID_ARGUMENT', 'content must be a string');
  if (!content.isWellFormed()) throw new Refusal('INVALID_ARGUMENT', 'content is not well-formed text');
  if (expectedHash !== null && !(typeof expectedHash === 'string' && HASH_RE.test(expectedHash))) {
    throw new Refusal('INVALID_ARGUMENT', 'expectedHash must be a sha256 hex string or null');
  }
  const cap = limits.MAX_EDIT_BYTES;
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > cap) throw new Refusal('TOO_LARGE', `the file would be ${bytes.length} bytes; the limit is ${cap}`, { limitBytes: cap });
  await runOp(target, 'write', [toArg(rel), expectedHash ?? '-'], {
    stdin: bytes, timeoutMs: limits.OP_TIMEOUT_MS, maxOutputBytes: 4096,
  });
  return { hash: sha256(bytes), size: bytes.length };
}

export async function create(target, rel, type, { limits }) {
  await runOp(target, type === 'dir' ? 'mkdir' : 'create', [toArg(rel)], { timeoutMs: limits.OP_TIMEOUT_MS, maxOutputBytes: 4096 });
  return { path: rel };
}

export async function rename(target, from, to, { limits }) {
  if (isUnder(to, from)) throw new Refusal('INVALID_ARGUMENT', 'cannot move a folder into itself');
  await runOp(target, 'rename', [toArg(from), toArg(to)], { timeoutMs: limits.OP_TIMEOUT_MS, maxOutputBytes: 4096 });
  return { from, to };
}

export async function remove(target, rel, { limits }) {
  await runOp(target, 'delete', [toArg(rel)], { timeoutMs: limits.OP_TIMEOUT_MS, maxOutputBytes: 4096 });
  return { path: rel };
}
