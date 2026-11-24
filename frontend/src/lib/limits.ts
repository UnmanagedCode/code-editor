// Caps the UI alone enforces (the backend never sees these values).

/** The largest line number a deep link may name; a larger `ccLine` is ignored and a larger `ccEndLine` is clamped to it. */
export const MAX_LINK_LINE = 10_000_000;
/** The longest comment the comment dialog accepts. */
export const MAX_COMMENT_CHARS = 10_000;
/** Selected text past this many characters is cut at a line boundary in the prompt, with a marker naming the lines kept. */
export const MAX_COMMENT_SELECTION_CHARS = 20_000;
/** How long a `ccBridge.sendPrompt` may take before the dialog reports that cc did not answer. */
export const SEND_PROMPT_TIMEOUT_MS = 15_000;
