import { Refusal } from '../refusals.js';

// cc's plugin-ui.md Part 2 minimum, plus: inline styles (Monaco and Radix inject <style> and style attributes),
// same-origin workers (Monaco's), and data: images (Monaco's inline SVG in CSS).
export const CSP = "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** First middleware: every response carries the CSP and friends, whatever its status. */
export function securityHeaders(_req, res, next) {
  res.set(SECURITY_HEADERS);
  next();
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const defaultPort = (protocol) => (protocol === 'https:' ? 443 : 80);

/**
 * Why the request is refused, or null. cc's proxy passes the browser's Host and Origin unchanged, so Origin↔Host
 * (by host and port, under Origin's scheme) is the proof of where a request came from. A Host naming this backend's
 * own port with a non-loopback name is DNS rebinding. `requireOrigin` is set for state-changing requests; a GET may
 * lack an Origin, but one it carries must match.
 */
export function requestRefusal(headers, listenPort, { requireOrigin }) {
  const origin = headers.origin;
  let scheme = 'http:';
  let o = null;
  if (origin !== undefined) {
    try { o = new URL(origin); } catch { return 'Origin is not a URL'; }
    if ((o.protocol !== 'http:' && o.protocol !== 'https:') || o.origin !== origin) return 'Origin is not an http(s) origin';
    scheme = o.protocol;
  } else if (requireOrigin) {
    return 'no Origin';
  }
  const host = headers.host;
  if (!host) return 'no Host';
  let h;
  try { h = new URL(`${scheme}//${host}`); } catch { return 'Host is malformed'; }
  if (h.username || h.password || h.pathname !== '/' || h.search || h.hash) return 'Host is malformed';
  if (o && h.host !== o.host) return 'Origin does not match Host';
  const port = h.port === '' ? defaultPort(h.protocol) : Number(h.port);
  if (port === listenPort && !LOOPBACK_HOSTS.has(h.hostname)) return "Host names this backend's own port but is not a loopback name";
  return null;
}

const SAFE = new Set(['GET', 'HEAD']);

/** The Origin↔Host gate for every /api request. */
export function requestGuard(req, _res, next) {
  const why = requestRefusal(req.headers, req.socket.localPort, { requireOrigin: !SAFE.has(req.method) });
  if (why) return next(new Refusal('REQUEST_REFUSED', `request refused: ${why}`));
  next();
}

const JSON_TYPE = /^application\/json\s*(;|$)/i;

/** A state-changing request must be JSON, which a cross-site "simple" request cannot send (415 otherwise). */
export function requireJson(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  if (!JSON_TYPE.test(req.get('content-type') ?? '')) {
    return next(new Refusal('UNSUPPORTED_MEDIA_TYPE', 'state-changing requests must have Content-Type: application/json'));
  }
  next();
}
