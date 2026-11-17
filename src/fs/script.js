import fs from 'node:fs';
import { exec } from '../cc/exec.js';
import { Refusal } from '../refusals.js';

// The helper every file operation runs on the target (src/fs/ops.sh), read once. Sent as `sh -c <script> code-editor <op> <args…>`.
export const OPS_SCRIPT = fs.readFileSync(new URL('./ops.sh', import.meta.url), 'utf8');

// The helper's exit codes → refusals (docs/protocol.md → ops.sh contract). Single table.
export const EXIT_REFUSALS = {
  65: ['NOT_FOUND', 'no such file or directory'],
  66: ['PATH_OUTSIDE_ROOT', 'the path leads outside the project root'],
  67: ['ALREADY_EXISTS', 'an entry with that name already exists'],
  68: ['SAVE_CONFLICT', 'the file changed on disk since it was opened'],
  69: ['NOT_A_DIRECTORY', 'not a directory'],
  70: ['NOT_A_FILE', 'not a regular file'],
  71: ['PATH_REFUSED', 'this path cannot be used (the project root and .git are off limits)'],
  72: ['PERMISSION_DENIED', 'permission denied'],
  73: ['SEARCH_INVALID', 'invalid search pattern'],
  74: ['SEARCH_UNAVAILABLE', 'search needs ripgrep (rg) or a git work tree on the project’s System'],
  75: ['TOOL_MISSING', 'a required tool is missing on the project’s System'],
};

const tail = (buf, n) => buf.subarray(Math.max(0, buf.length - n)).toString('utf8').trim();

/**
 * Runs one helper op in `target`'s tree through cc. Resolves {stdout: Buffer} on exit 0; any other exit throws the
 * Refusal EXIT_REFUSALS maps it to (OP_FAILED for the rest).
 */
export async function runOp(target, op, args, { stdin, timeoutMs, maxOutputBytes, signal, retry = false }) {
  const { exitCode, stdout, stderr } = await exec(target, ['sh', '-c', OPS_SCRIPT, 'code-editor', op, ...args], {
    env: { LC_ALL: 'C' }, stdin, timeoutMs, maxOutputBytes, signal, retry,
  });
  if (exitCode === 0) return { stdout };
  const mapped = EXIT_REFUSALS[exitCode];
  if (!mapped) throw new Refusal('OP_FAILED', `the operation failed (exit ${exitCode}): ${tail(stderr, 500)}`);
  const [code, message] = mapped;
  if (code === 'SAVE_CONFLICT') {
    const current = stdout.toString('utf8');
    throw new Refusal(code, message, { currentHash: current === '-' || current === '' ? null : current });
  }
  if (code === 'SEARCH_INVALID') throw new Refusal(code, tail(stderr, 500) || message);
  if (code === 'TOOL_MISSING') throw new Refusal(code, `${message}: ${tail(stderr, 100)}`);
  throw new Refusal(code, message);
}
