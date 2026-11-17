import { LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { join } from '@/lib/paths';
import type { useTree } from '@/state/tree';
import { EntryContextItems, type EntryActionHandler } from './EntryMenu';
import { RefusalAlert } from './RefusalAlert';
import { behaviorOf, TreeRow } from './TreeRow';

type Tree = ReturnType<typeof useTree>;

function Children({ tree, dir, depth, showIgnored, activePath, onOpen, onAction }: {
  tree: Tree; dir: string; depth: number; showIgnored: boolean; activePath: string | null;
  onOpen: (path: string) => void; onAction: EntryActionHandler;
}): ReactNode {
  const state = tree.dirs[dir];
  if (!state) return null;
  const rows = state.entries.filter((e) => showIgnored || !e.ignored);
  return (
    <>
      {rows.map((e) => {
        const path = join(dir, e.name);
        const behavior = behaviorOf(e);
        const open = behavior === 'dir' && tree.expanded.has(path);
        return (
          <div key={e.name} role="group">
            <TreeRow entry={e} path={path} depth={depth} expanded={open} active={activePath === path} onToggle={() => tree.toggle(path)} onOpen={() => onOpen(path)} onAction={onAction} />
            {open && <Children tree={tree} dir={path} depth={depth + 1} showIgnored={showIgnored} activePath={activePath} onOpen={onOpen} onAction={onAction} />}
          </div>
        );
      })}
      {state.status === 'loading' && (
        <p className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${depth * 12 + 20}px` }}><LoaderCircleIcon className="size-3 animate-spin" /> Loading…</p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="py-1 text-xs text-destructive" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
          {state.error.message}{' '}
          <button type="button" className="underline" onClick={() => tree.reload([dir])}>Retry</button>
        </p>
      )}
      {state.truncated && <p className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${depth * 12 + 20}px` }}>… more entries not shown</p>}
    </>
  );
}

/** The lazily loaded tree. A root that cannot be listed is a refusal alert with Retry, never a blank tree. */
export function FileTree({ tree, rootName, showIgnored, activePath, onOpen, onAction }: {
  tree: Tree; rootName: string; showIgnored: boolean; activePath: string | null; onOpen: (path: string) => void; onAction: EntryActionHandler;
}) {
  const root = tree.dirs[''];
  if (root?.status === 'error' && root.entries.length === 0) {
    return <div className="p-2"><RefusalAlert title={`Cannot list ${rootName}`} error={root.error} onRetry={() => tree.reload([''])} /></div>;
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div role="tree" aria-label="Files" className="min-h-full py-1">
          {!root || (root.status === 'loading' && root.entries.length === 0)
            ? <p className="flex items-center gap-1.5 p-2 text-xs text-muted-foreground"><LoaderCircleIcon className="size-3 animate-spin" /> Loading…</p>
            : <Children tree={tree} dir="" depth={0} showIgnored={showIgnored} activePath={activePath} onOpen={onOpen} onAction={onAction} />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent><EntryContextItems entry={{ path: '', kind: 'dir', dir: '', isRoot: true }} onAction={onAction} /></ContextMenuContent>
    </ContextMenu>
  );
}
