// Single source of the plugin's caps. Everything derived from MAX_EDIT_BYTES is computed here, never restated.

/** The largest file the editor opens for editing or saves, in bytes. A larger file opens read-only, truncated to this. */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
export const MAX_DIR_ENTRIES = 5000;
export const MAX_SEARCH_RESULTS = 500;
export const MAX_SNIPPET_BYTES = 300;
export const MAX_QUICKOPEN_FILES = 20000;
export const MAX_QUERY_LENGTH = 500;
export const MAX_PATH_LENGTH = 4096;

export const OP_TIMEOUT_MS = 30_000;
export const SEARCH_TIMEOUT_MS = 30_000;

/** Worst-case JSON escaping of the cap (each byte as a 6-char \u00XX escape) plus the envelope. */
export const WRITE_BODY_LIMIT = MAX_EDIT_BYTES * 6 + 64 * 1024;
/** Other JSON bodies are small. */
export const SMALL_BODY_LIMIT = 64 * 1024;

/** The stdin of a save as cc receives it: base64 of at most MAX_EDIT_BYTES. */
export const maxWriteStdinB64 = (cap = MAX_EDIT_BYTES) => Math.ceil(cap / 3) * 4;

/** cc stdout cap for a read: the size line, plus the file bytes in base64. */
export const readOutputBytes = (cap = MAX_EDIT_BYTES) => Math.ceil((cap + 64) / 3) * 4 + 1024;

/** cc stdout cap for a search: each result line is bounded by the snippet cap plus its path and line number. */
export const searchOutputBytes = (max = MAX_SEARCH_RESULTS, snip = MAX_SNIPPET_BYTES) => Math.ceil(((max + 1) * (snip + MAX_PATH_LENGTH + 32) + 64) / 3) * 4 + 1024;
export const filesOutputBytes = (max = MAX_QUICKOPEN_FILES) => Math.ceil(((max + 1) * (MAX_PATH_LENGTH + 1) + 64) / 3) * 4 + 1024;
export const listOutputBytes = (max = MAX_DIR_ENTRIES) => Math.ceil(((max + 1) * (MAX_PATH_LENGTH + 8) * 2 + 64) / 3) * 4 + 1024;
