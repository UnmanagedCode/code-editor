import { MAX_PATH_LENGTH } from '../limits.js';
import { Refusal } from '../refusals.js';

const bad = (why) => new Refusal('INVALID_ARGUMENT', `invalid path: ${why}`);

/**
 * Validates a project-relative POSIX path and returns it. `''` is the root: allowed only with `allowRoot`.
 * Refuses anything that could leave the root or touch `.git` before it reaches cc; the target re-checks (ops.sh).
 */
export function normalizeRel(value, { allowRoot = false, maxLength = MAX_PATH_LENGTH } = {}) {
  if (typeof value !== 'string') throw bad('must be a string');
  if (value.length > maxLength) throw bad('too long');
  if (!value.isWellFormed()) throw bad('not well-formed text');
  if (value.includes('\0')) throw bad('contains NUL');
  if (value === '') {
    if (!allowRoot) throw bad('the root is not allowed here');
    return '';
  }
  if (value.startsWith('/')) throw bad('must be relative');
  for (const seg of value.split('/')) {
    if (seg === '') throw bad('empty segment');
    if (seg === '.' || seg === '..') throw bad(`'${seg}' segment`);
    if (seg.toLowerCase() === '.git') throw bad("'.git' segment"); // any case: case-insensitive file systems
  }
  return value;
}

/** True when `child` is `ancestor` or lies beneath it. The root ('') contains everything. */
export const isUnder = (child, ancestor) => ancestor === '' || child === ancestor || child.startsWith(`${ancestor}/`);

/** The argument form ops.sh takes: always `./`-led so a leading dash is never an option. */
export const toArg = (rel) => (rel === '' ? '.' : `./${rel}`);
