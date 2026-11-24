import { useEffect, useRef } from 'react';
import { useEditorHost, type EditorHandle } from '@/editor/EditorHost';
import type { Tab } from '@/state/tabs';
import { BinaryPlaceholder } from './BinaryPlaceholder';

/** The Monaco editor of one tab (a binary tab shows a placeholder instead). Remounts per tab and when it turns read-only. */
export function EditorPane({ tab, narrow, onSave, onQuickOpen, onRevealed, onComment, onHandle }: {
  tab: Tab; narrow: boolean; onSave: () => void; onQuickOpen: () => void; onRevealed: () => void;
  onComment: () => void;
  /** The mounted editor (null when it goes away), and whether its selection is non-empty. */
  onHandle: (handle: EditorHandle | null, hasSelection: boolean) => void;
}) {
  const host = useEditorHost();
  const el = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const cb = useRef({ onSave, onQuickOpen, onRevealed, onComment, onHandle });
  cb.current = { onSave, onQuickOpen, onRevealed, onComment, onHandle };

  useEffect(() => {
    if (!tab.model || !el.current) return;
    const h = host.mount(el.current, tab.model, {
      readOnly: tab.readOnly, narrow,
      onSave: () => cb.current.onSave(), onQuickOpen: () => cb.current.onQuickOpen(), onComment: () => cb.current.onComment(),
      onSelectionChange: (has) => cb.current.onHandle(h, has),
    });
    handle.current = h;
    cb.current.onHandle(h, false);
    return () => { h.dispose(); handle.current = null; cb.current.onHandle(null, false); };
    // The tab's buffer identity decides the mount; `reveal` is handled by the next effect (which runs after this one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, tab.model, tab.readOnly, narrow]);

  useEffect(() => {
    if (tab.reveal !== null && handle.current) { handle.current.revealRange(tab.reveal.start, tab.reveal.end); onRevealed(); }
  }, [tab.reveal, onRevealed]);

  if (tab.kind === 'binary') return <BinaryPlaceholder size={tab.size} />;
  return <div ref={el} data-testid="editor" className="h-full min-h-0 w-full" />;
}
