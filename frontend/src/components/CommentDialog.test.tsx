import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPromptWithin } from '@/lib/ccBridge';
import { DIRTY_NOTE } from '@/lib/commentPrompt';
import { endpoints, type Session } from '@/lib/endpoints';
import { installBackend } from '@/test/fakeBackend';
import { renderWithHost } from '@/test/render';
import { Workspace } from './Workspace';

const target = { project: 'app', worktree: 'w1' };
const ROOT = '/srv/app/.worktrees/w1';
const FILES = { 'src/a.ts': 'one\ntwo\nthree\nfour\n' };
const session = (sessionId: string, over: Partial<Session> = {}): Session => ({ sessionId, project: 'app', worktree: 'w1', label: `label ${sessionId}`, status: 'idle', lastActive: 1, ...over });

type Bridge = { session?: { sessionId: string; project: string; worktree: string | null } | null; sendPrompt: ReturnType<typeof vi.fn> };
const win = window as unknown as { ccBridge?: Bridge };
function installBridge(active: Bridge['session'], result: { ok: boolean; code?: string } = { ok: true }) {
  const bridge: Bridge = { session: active, sendPrompt: vi.fn(async () => result) };
  win.ccBridge = bridge;
  return bridge;
}
afterEach(() => { delete win.ccBridge; vi.useRealTimers(); });

/** The workspace on src/a.ts with lines 2–3 selected. */
async function selected(sessions: Session[]) {
  installBackend({ files: FILES });
  vi.spyOn(endpoints, 'sessions').mockResolvedValue({ sessions });
  const ctx = renderWithHost(<Workspace target={target} rootPath={ROOT} initialFile="src/a.ts" reveal={null} onRevealHandled={() => {}} onFileChange={() => {}} />);
  await waitFor(() => expect(ctx.fake.liveMounts()).toHaveLength(1));
  expect(screen.queryByRole('button', { name: 'Comment on selection' })).toBeNull();
  act(() => ctx.fake.lastMount().select({ range: { start: 2, end: 3 }, text: 'two\nthree' }));
  return ctx;
}
async function openDialog(ctx: Awaited<ReturnType<typeof selected>>) {
  await ctx.user.click(screen.getByRole('button', { name: 'Comment on selection' }));
  const dialog = await screen.findByRole('dialog', { name: 'Comment on selection' });
  await within(dialog).findByRole('combobox', { name: 'Send to' });
  return dialog;
}
const picked = (dialog: HTMLElement) => (within(dialog).getByRole('combobox', { name: 'Send to' }) as HTMLSelectElement).value;
const sendButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Send' }) as HTMLButtonElement;

describe('comment on selection', () => {
  // Invariant: Send delivers exactly the built prompt (linked reference, place, comment, fenced selection) to the chosen session.
  it('sends the exact prompt to the chosen session and reports it', async () => {
    const bridge = installBridge({ sessionId: 's1', project: 'app', worktree: 'w1' });
    const ctx = await selected([session('s1'), session('s2', { lastActive: 99 })]);
    const dialog = await openDialog(ctx);
    expect(within(dialog).getByText(`${ROOT}/src/a.ts:2-3`)).toBeTruthy();
    await ctx.user.type(within(dialog).getByRole('textbox', { name: 'Comment' }), 'Why two lines?');
    await ctx.user.click(sendButton(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bridge.sendPrompt).toHaveBeenCalledTimes(1);
    expect(bridge.sendPrompt).toHaveBeenCalledWith('s1', [
      'Comment on [/srv/app/.worktrees/w1/src/a.ts:2-3](http://cc.internal/#plugin/code-editor/?ccPath=/srv/app/.worktrees/w1/src/a.ts&ccLine=2&ccEndLine=3) (project app, worktree w1)',
      '',
      'Why two lines?',
      '',
      'Selected text:',
      '```typescript',
      'two\nthree',
      '```',
    ].join('\n'));
    expect(screen.getByRole('status').textContent).toBe('Sent to label s1 · app / w1');
  });

  // Invariant: the prompt says the line numbers refer to the buffer when the tab has unsaved changes.
  it('a dirty tab adds the unsaved-buffer note', async () => {
    const bridge = installBridge(null);
    const ctx = await selected([session('s1')]);
    act(() => ctx.fake.modelFor('src/a.ts').type('one\ntwo\nthree\nfour\nfive\n'));
    const dialog = await openDialog(ctx);
    await ctx.user.type(within(dialog).getByRole('textbox', { name: 'Comment' }), 'x');
    await ctx.user.click(sendButton(dialog));
    await waitFor(() => expect(bridge.sendPrompt).toHaveBeenCalled());
    expect((bridge.sendPrompt.mock.calls[0][1] as string).split('\n')[0].endsWith(DIRTY_NOTE)).toBe(true);
  });

  // Invariant: the editor's own action (context menu / keybinding) opens the same dialog.
  it('the editor action opens the dialog', async () => {
    installBridge(null);
    const ctx = await selected([session('s1')]);
    act(() => ctx.fake.lastMount().options.onComment());
    expect(await screen.findByRole('dialog', { name: 'Comment on selection' })).toBeTruthy();
  });

  // Invariant: preselection is cc's active session when it works in the open root and is listed.
  it('preselects the active session when it is in the open root', async () => {
    installBridge({ sessionId: 's1', project: 'app', worktree: 'w1' });
    const dialog = await openDialog(await selected([session('s1', { lastActive: 1 }), session('s2', { lastActive: 99 })]));
    expect(picked(dialog)).toBe('s1');
  });

  // Invariant: otherwise the most recently active live session in the open root is preselected.
  it('else preselects the most recent session in the open root', async () => {
    installBridge({ sessionId: 'elsewhere', project: 'other', worktree: null });
    const dialog = await openDialog(await selected([
      session('elsewhere', { project: 'other', worktree: null, lastActive: 500 }),
      session('main', { worktree: null, lastActive: 400 }),
      session('old', { lastActive: 10 }), session('new', { lastActive: 20 }),
    ]));
    expect(picked(dialog)).toBe('new');
  });

  // Invariant: with no session in the open root nothing is preselected, and Send needs a chosen session and a non-blank comment.
  it('else preselects none; Send waits for a session and a non-blank comment', async () => {
    const bridge = installBridge(null);
    const ctx = await selected([session('far', { project: 'other', worktree: null })]);
    const dialog = await openDialog(ctx);
    expect(picked(dialog)).toBe('');
    await ctx.user.type(within(dialog).getByRole('textbox', { name: 'Comment' }), '   ');
    expect(sendButton(dialog).disabled).toBe(true);
    await ctx.user.selectOptions(within(dialog).getByRole('combobox', { name: 'Send to' }), 'far');
    expect(sendButton(dialog).disabled).toBe(true);
    await ctx.user.type(within(dialog).getByRole('textbox', { name: 'Comment' }), 'ok');
    expect(sendButton(dialog).disabled).toBe(false);
    await ctx.user.click(sendButton(dialog));
    await waitFor(() => expect(bridge.sendPrompt).toHaveBeenCalledWith('far', expect.stringContaining('\nok\n')));
  });

  // Invariant: a refusal keeps the dialog and the typed comment and says why.
  it('a refusal code keeps the dialog and the text and explains it', async () => {
    installBridge(null, { ok: false, code: 'SESSION_NOT_READY' });
    const ctx = await selected([session('s1')]);
    const dialog = await openDialog(ctx);
    const box = within(dialog).getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
    await ctx.user.type(box, 'keep me');
    await ctx.user.click(sendButton(dialog));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/cannot take a prompt right now/);
    expect(screen.getByRole('dialog', { name: 'Comment on selection' })).toBeTruthy();
    expect(box.value).toBe('keep me');
    expect(screen.queryByRole('status')).toBeNull();
  });

  // Invariant: session labels are untrusted text and never become markup.
  it('session labels render as text', async () => {
    installBridge(null);
    const ctx = await selected([session('s1', { label: '<b>evil</b>' })]);
    const dialog = await openDialog(ctx);
    expect(within(dialog).getByRole('option', { name: '<b>evil</b> · app / w1' })).toBeTruthy();
    expect(ctx.container.ownerDocument.querySelector('b')).toBeNull();
  });

  // Invariant: without cc's bridge both entry points are disabled with the reason, and no dialog opens.
  it('without ccBridge the button is disabled with the reason and the action only says why', async () => {
    const ctx = await selected([session('s1')]);
    const button = screen.getByRole('button', { name: 'Comment on selection' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Open Code Editor inside cc to send comments');
    act(() => ctx.fake.lastMount().options.onComment());
    expect(screen.getByRole('status').textContent).toBe('Open Code Editor inside cc to send comments');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Invariant: clearing the selection hides the header button.
  it('the header button shows only while there is a selection', async () => {
    installBridge(null);
    const ctx = await selected([session('s1')]);
    expect(screen.getByRole('button', { name: 'Comment on selection' })).toBeTruthy();
    act(() => ctx.fake.lastMount().select(null));
    expect(screen.queryByRole('button', { name: 'Comment on selection' })).toBeNull();
  });
});

describe('sendPromptWithin', () => {
  // Invariant: a bridge that never answers resolves as TIMEOUT at the deadline instead of hanging the dialog.
  it('resolves TIMEOUT when cc does not answer in time', async () => {
    vi.useFakeTimers();
    win.ccBridge = { sendPrompt: vi.fn(() => new Promise(() => {})) };
    const result = sendPromptWithin('s1', 'text', 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ ok: false, code: 'TIMEOUT' });
  });

  // Invariant: without a bridge nothing is sent.
  it('without a bridge it refuses with NO_BRIDGE', async () => {
    await expect(sendPromptWithin('s1', 'text', 50)).resolves.toEqual({ ok: false, code: 'NO_BRIDGE' });
  });
});
