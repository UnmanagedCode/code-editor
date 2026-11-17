import { Refusal } from '../refusals.js';

const invalid = (msg) => new Refusal('INVALID_ARGUMENT', msg);

/** The target ({project, worktree}) named by a query string or JSON body; worktree is null for the main checkout. */
export function targetOf(src) {
  const { project, worktree } = src ?? {};
  if (typeof project !== 'string' || project === '') throw invalid('project is required');
  if (worktree !== undefined && worktree !== null && (typeof worktree !== 'string' || worktree === '')) throw invalid('worktree must be a non-empty string');
  return { project, worktree: worktree ?? null };
}

/** A string query parameter; arrays (repeated keys) and objects are refused. */
export function queryString(query, name, { required = false } = {}) {
  const v = query[name];
  if (v === undefined) {
    if (required) throw invalid(`${name} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw invalid(`${name} must be a string`);
  return v;
}

/** A '0' | '1' flag query parameter (default false). */
export function queryFlag(query, name) {
  const v = query[name];
  if (v === undefined || v === '0') return false;
  if (v === '1') return true;
  throw invalid(`${name} must be 0 or 1`);
}

/** A JSON body object. */
export function bodyObject(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw invalid('the body must be a JSON object');
  return req.body;
}
