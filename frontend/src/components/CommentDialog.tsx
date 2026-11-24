import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { Selection } from '@/editor/EditorHost';
import { activeSession, sendPromptWithin, type BridgeSession } from '@/lib/ccBridge';
import { buildCommentPrompt } from '@/lib/commentPrompt';
import { endpoints, type Session, type Target } from '@/lib/endpoints';
import { MAX_COMMENT_CHARS, SEND_PROMPT_TIMEOUT_MS } from '@/lib/limits';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** What a comment is about: the open root (and its absolute path), the file, the selection, and the tab's state. */
export type CommentRequest = { root: Target; rootPath: string; path: string; selection: Selection; dirty: boolean; lang: string };

const REFUSALS: Record<string, string> = {
  SESSION_NOT_READY: 'That session cannot take a prompt right now (it is starting, or waiting out a usage limit). Try again shortly.',
  SESSION_NOT_LIVE: 'That session is no longer running. Choose another one.',
  SESSION_UNKNOWN: 'cc does not know that session. Choose another one.',
  VIEW_ONLY: 'cc is in view-only mode, so it does not send prompts.',
  SEND_FAILED: 'cc could not send the comment. Try again.',
  TIMEOUT: 'cc did not answer in time, so the comment may or may not have been sent. Check the session before sending again.',
};
const refusalText = (code: string | undefined) => REFUSALS[code ?? ''] ?? `cc refused the comment (${code ?? 'no reason given'}).`;

export const sessionLabel = (s: Session) => `${s.label} · ${s.project}${s.worktree ? ` / ${s.worktree}` : ''}`;

/**
 * The session a comment goes to by default: cc's active session when it is listed and works in the open root, else the
 * most recently active live session in the open root, else none.
 */
export function defaultSessionId(sessions: Session[], root: Target, active: BridgeSession | null): string {
  const inRoot = (s: { project: string; worktree: string | null }) => s.project === root.project && (s.worktree ?? null) === (root.worktree ?? null);
  if (active && inRoot(active) && sessions.some((s) => s.sessionId === active.sessionId)) return active.sessionId;
  const here = sessions.filter(inRoot).sort((a, b) => b.lastActive - a.lastActive);
  return here[0]?.sessionId ?? '';
}

/** The absolute path of `path` under the root at `rootPath`. */
export const absPath = (rootPath: string, path: string) => `${rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath}/${path}`;

/** "Comment on selection": write a comment and send it, with a link to the selection, to a live cc session. */
export function CommentDialog({ request, onClose, onSent }: { request: CommentRequest | null; onClose: () => void; onSent: (sessionLabel: string) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { comment: useId(), session: useId() };

  useEffect(() => {
    setSessions(null); setLoadError(null); setComment(''); setChosen(''); setBusy(false); setError(null);
    if (!request) return;
    const controller = new AbortController();
    endpoints.sessions(controller.signal).then(
      (r) => { setSessions(r.sessions); setChosen(defaultSessionId(r.sessions, request.root, activeSession())); },
      (e) => { if (!controller.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e)); },
    );
    return () => controller.abort();
  }, [request]);

  const abs = request ? absPath(request.rootPath, request.path) : '';
  const range = request?.selection.range;
  const reference = range ? `${abs}:${range.start}${range.end !== null ? `-${range.end}` : ''}` : '';
  const target = sessions?.find((s) => s.sessionId === chosen) ?? null;
  const canSend = !!request && !!target && comment.trim() !== '' && !busy;

  const send = async () => {
    if (!canSend || !request || !target) return;
    setBusy(true);
    setError(null);
    const text = buildCommentPrompt({
      abs, range: request.selection.range, project: request.root.project, worktree: request.root.worktree,
      comment, selection: request.selection.text, lang: request.lang, dirty: request.dirty,
    });
    const r = await sendPromptWithin(target.sessionId, text, SEND_PROMPT_TIMEOUT_MS);
    setBusy(false);
    if (r.ok) onSent(sessionLabel(target));
    else setError(refusalText(r.code));
  };

  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="grid min-w-0 gap-4">
          <DialogHeader>
            <DialogTitle>Comment on selection</DialogTitle>
            <DialogDescription className="break-all font-mono text-xs">{reference}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={ids.comment} className="text-sm font-medium">Comment</label>
            <textarea
              id={ids.comment} value={comment} maxLength={MAX_COMMENT_CHARS} rows={5} disabled={busy}
              onChange={(e) => { setComment(e.target.value); setError(null); }}
              className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={ids.session} className="text-sm font-medium">Send to</label>
            {loadError ? <p role="alert" className="text-sm text-destructive">Could not list sessions: {loadError}</p>
              : sessions === null ? <p className="text-sm text-muted-foreground">Loading sessions…</p>
              : sessions.length === 0 ? <p className="text-sm text-muted-foreground">No live sessions.</p>
              : (
                <select
                  id={ids.session} value={chosen} disabled={busy} onChange={(e) => { setChosen(e.target.value); setError(null); }}
                  className="h-9 w-full min-w-0 truncate rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="" disabled>Choose a session…</option>
                  {sessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{sessionLabel(s)}</option>)}
                </select>
              )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSend}>{busy && <LoaderCircleIcon className="animate-spin" />}Send</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
