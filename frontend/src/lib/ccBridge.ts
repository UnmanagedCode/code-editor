// cc's optional session-awareness bridge (`window.ccBridge`, set by cc's pluginBridge.js inside a cc frame; cc's
// docs/plugin-ui.md → Session awareness). Absent standalone and on a cc without it, so every use tests for it.

export type BridgeSession = { sessionId: string; project: string; worktree: string | null };
/** A call's result; the promise never rejects. */
export type BridgeResult = { ok: boolean; code?: string };
type CcBridge = { readonly session?: BridgeSession | null; sendPrompt?: (sessionId: string, text: string) => Promise<BridgeResult> };

const bridge = (): CcBridge | null => (window as unknown as { ccBridge?: CcBridge }).ccBridge ?? null;

/** Why a comment cannot be sent from this page, or null when it can. */
export const sendUnavailableReason = (): string | null => (typeof bridge()?.sendPrompt === 'function' ? null : 'Open Code Editor inside cc to send comments');

/** cc's active session, or null when there is none (or no bridge). */
export function activeSession(): BridgeSession | null {
  const s = bridge()?.session;
  return s && typeof s.sessionId === 'string' && typeof s.project === 'string' ? { sessionId: s.sessionId, project: s.project, worktree: s.worktree ?? null } : null;
}

/** `ccBridge.sendPrompt` with a deadline: a page that navigates mid-call never gets cc's reply, so an answer later than `ms` is `TIMEOUT`. */
export async function sendPromptWithin(sessionId: string, text: string, ms: number): Promise<BridgeResult> {
  const send = bridge()?.sendPrompt;
  if (typeof send !== 'function') return { ok: false, code: 'NO_BRIDGE' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<BridgeResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), ms); });
  try {
    return await Promise.race([send(sessionId, text), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
