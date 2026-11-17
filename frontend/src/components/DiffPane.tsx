import { useEffect, useRef } from 'react';
import { useEditorHost } from '@/editor/EditorHost';
import type { Tab } from '@/state/tabs';

/** Disk version (read-only, left) against the live buffer (editable, right). */
export function DiffPane({ tab, narrow }: { tab: Tab; narrow: boolean }) {
  const host = useEditorHost();
  const el = useRef<HTMLDivElement>(null);
  const diff = tab.diff;
  useEffect(() => {
    if (!diff || !tab.model || !el.current) return;
    const h = host.mountDiff(el.current, diff.text, tab.model, { narrow, path: tab.path });
    return () => h.dispose();
  }, [host, diff, tab.model, tab.path, narrow]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="border-b bg-card px-3 py-1.5 text-xs text-muted-foreground">
        {diff?.deleted ? 'Deleted on disk (left is empty)' : 'On disk (left, read-only)'} · Your buffer (right, editable)
      </p>
      <div ref={el} data-testid="diff-editor" className="min-h-0 flex-1" />
    </div>
  );
}
