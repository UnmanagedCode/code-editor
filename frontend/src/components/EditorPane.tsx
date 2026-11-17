import { useEffect, useRef } from 'react';
import { useEditorHost, type EditorHandle } from '@/editor/EditorHost';
import type { Tab } from '@/state/tabs';
import { BinaryPlaceholder } from './BinaryPlaceholder';

/** The Monaco editor of one tab (a binary tab shows a placeholder instead). Remounts per tab and when it turns read-only. */
export function EditorPane({ tab, narrow, onSave, onQuickOpen, onRevealed }: {
  tab: Tab; narrow: boolean; onSave: () => void; onQuickOpen: () => void; onRevealed: () => void;
}) {
  const host = useEditorHost();
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const cb = useRef({ onSave, onQuickOpen, onRevealed });
  cb.current = { onSave, onQuickOpen, onRevealed };

  useEffect(() => {
    if (!tab.model || !el.current) return;
    const h = host.mount(el.current, tab.model, { readOnly: tab.readOnly, narrow, onSave: () => cb.current.onSave(), onQuickOpen: () => cb.current.onQuickOpen() });
    handle.current = h;
    return () => { h.dispose(); handle.current = null; };
    // The tab's buffer identity decides the mount; `reveal` is handled by the next effect (which runs after this one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, tab.model, tab.readOnly, narrow]);

  useEffect(() => {
    if (tab.reveal !== null && handle.current) { handle.current.revealLine(tab.reveal); onRevealed(); }
  }, [tab.reveal, onRevealed]);

  if (tab.kind === 'binary') return <BinaryPlaceholder size={tab.size} />;
  return <div ref={el} data-testid="editor" className="h-full min-h-0 w-full" />;
}
