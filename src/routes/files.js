import express from 'express';
import * as files from '../fs/files.js';
import { normalizeRel } from '../fs/paths.js';
import { bodyObject, queryString, targetOf } from '../http/params.js';
import { clientAbort, route } from '../http/route.js';
import { Refusal } from '../refusals.js';

export function mountFileRoutes(api, limits) {
  const small = express.json({ limit: limits.SMALL_BODY_LIMIT });
  const large = express.json({ limit: limits.WRITE_BODY_LIMIT });
  const ctx = { limits };

  api.get('/list', route(async (req, res) => {
    const target = targetOf(req.query);
    const rel = normalizeRel(queryString(req.query, 'path') ?? '', { allowRoot: true });
    res.json(await files.list(target, rel, { ...ctx, signal: clientAbort(req, res) }));
  }));

  api.get('/file', route(async (req, res) => {
    const target = targetOf(req.query);
    const rel = normalizeRel(queryString(req.query, 'path', { required: true }));
    res.json(await files.read(target, rel, { ...ctx, signal: clientAbort(req, res) }));
  }));

  api.put('/file', large, route(async (req, res) => {
    const b = bodyObject(req);
    const target = targetOf(b);
    const rel = normalizeRel(b.path);
    if (b.expectedHash === undefined) throw new Refusal('INVALID_ARGUMENT', 'expectedHash is required (null for a new file)');
    res.json(await files.write(target, rel, b.content, b.expectedHash, ctx));
  }));

  api.post('/entries', small, route(async (req, res) => {
    const b = bodyObject(req);
    const target = targetOf(b);
    const rel = normalizeRel(b.path);
    if (b.type !== 'file' && b.type !== 'dir') throw new Refusal('INVALID_ARGUMENT', "type must be 'file' or 'dir'");
    res.status(201).json(await files.create(target, rel, b.type, ctx));
  }));

  api.post('/rename', small, route(async (req, res) => {
    const b = bodyObject(req);
    const target = targetOf(b);
    res.json(await files.rename(target, normalizeRel(b.from), normalizeRel(b.to), ctx));
  }));

  api.post('/delete', small, route(async (req, res) => {
    const b = bodyObject(req);
    res.json(await files.remove(targetOf(b), normalizeRel(b.path), ctx));
  }));
}
