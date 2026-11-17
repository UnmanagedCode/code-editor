// Single source for refusal codes and their HTTP status. Anything that refuses throws a `Refusal`;
// the route wrapper (src/http/route.js) renders it as `{error, code, …extra}` with this status.
export const HTTP_STATUS = {
  INVALID_ARGUMENT: 400, NOT_A_DIRECTORY: 400, NOT_A_FILE: 400, SEARCH_INVALID: 400,
  REQUEST_REFUSED: 403, PATH_OUTSIDE_ROOT: 403, PATH_REFUSED: 403, PERMISSION_DENIED: 403,
  NOT_FOUND: 404, PROJECT_UNKNOWN: 404, WORKTREE_UNKNOWN: 404,
  ALREADY_EXISTS: 409, SAVE_CONFLICT: 409, CANCELLED: 409,
  TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  OP_FAILED: 422, OUTPUT_TOO_LARGE: 422,
  INTERNAL: 500,
  SEARCH_UNAVAILABLE: 501, TOOL_MISSING: 501,
  SYSTEM_UNREACHABLE: 502,
  CONDUCTOR_UNAVAILABLE: 503,
  TIMEOUT: 504,
};

export class Refusal extends Error {
  /** `extra` fields are sent beside `{error, code}`; keep them JSON-safe. */
  constructor(code, message, extra = {}) {
    if (!(code in HTTP_STATUS)) throw new Error(`Refusal: unknown code ${code}`);
    super(message);
    this.code = code;
    this.extra = extra;
  }

  get status() { return HTTP_STATUS[this.code]; }

  toBody() { return { error: this.message, code: this.code, ...this.extra }; }
}
