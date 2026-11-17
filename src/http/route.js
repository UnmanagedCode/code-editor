import { Refusal } from '../refusals.js';

/** Sends `e` as a JSON refusal: a Refusal with its own status and body, anything else as 500 INTERNAL (logged, never echoed). */
export function sendError(res, e) {
  if (res.headersSent) return void res.end();
  if (e instanceof Refusal) return void res.status(e.status).json(e.toBody());
  console.error('code-editor: unexpected error', e);
  res.status(500).json({ error: 'internal error', code: 'INTERNAL' });
}

/** Wraps an async handler: a throw becomes a refusal response, never an unhandled rejection. */
export const route = (fn) => async (req, res) => {
  req.on('error', () => {});
  res.on('error', () => {});
  try {
    await fn(req, res);
  } catch (e) {
    sendError(res, e);
  }
};

/** An AbortSignal that fires when the client disconnects before the response finished (cancel = disconnect). */
export function clientAbort(req, res) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  return controller.signal;
}
