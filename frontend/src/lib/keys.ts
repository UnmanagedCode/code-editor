import { useEffect, useRef } from 'react';

type Shortcuts = { onSave: () => void; onQuickOpen: () => void };

/**
 * Ctrl/Cmd+S and Ctrl/Cmd+P at the window, capture phase, so the browser's own Save and Print never open. Inside a Monaco
 * editor the editor's own command handles the key (registered in editor/monaco.ts), so it is not handled twice.
 */
export function useGlobalShortcuts(handlers: Shortcuts): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== 's' && key !== 'p') return;
      e.preventDefault();
      if ((e.target as Element | null)?.closest?.('.monaco-editor')) return;
      if (key === 's') ref.current.onSave(); else ref.current.onQuickOpen();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
