import { LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { isUnder, join } from '@/lib/paths';
import type { useTree } from '@/state/tree';
import { EntryContextItems, type EntryActionHandler } from './EntryMenu';
import { RefusalAlert } from './RefusalAlert';
import { behaviorOf, TreeRow } from './TreeRow';

type Tree = ReturnType<typeof useTree>;

function Children({ tree, dir, depth, showIgnored, activePath, busyPaths, onOpen, onAction }: {
  tree: Tree; dir: string; depth: number; showIgnored: boolean; activePath: string | null; busyPaths: string[];
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
            <TreeRow entry={e} path={path} depth={depth} expanded={open} active={activePath === path} locked={busyPaths.some((b) => isUnder(b, path))} onToggle={() => tree.toggle(path)} onOpen={() => onOpen(path)} onAction={onAction} />
            {open && <Children tree={tree} dir={path} depth={depth + 1} showIgnored={showIgnored} activePath={activePath} busyPaths={busyPaths} onOpen={onOpen} onAction={onAction} />}
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
export function FileTree({ tree, rootName, showIgnored, activePath, busyPaths, onOpen, onAction }: {
  tree: Tree; rootName: string; busyPaths: string[]; showIgnored: boolean; activePath: string | null; onOpen: (path: string) => void; onAction: EntryActionHandler;
}) {
  const root = tree.dirs[''];
  if (root?.status === 'error' && root.entries.length === 0) {
    return <div className="p-2"><RefusalAlert title={`Cannot list ${rootName}`} error={root.error} onRetry={() => tree.reload([''])} /></div>;
  }
  // The rows carry their own menus; the blank space below them is the root's (the two are siblings, never nested, so a
  // long-press on a row opens only that row's menu).
  return (
    <div className="flex min-h-full flex-col py-1">
      <div role="tree" aria-label="Files">
        {!root || (root.status === 'loading' && root.entries.length === 0)
          ? <p className="flex items-center gap-1.5 p-2 text-xs text-muted-foreground"><LoaderCircleIcon className="size-3 animate-spin" /> Loading…</p>
          : <Children tree={tree} dir="" depth={0} showIgnored={showIgnored} activePath={activePath} busyPaths={busyPaths} onOpen={onOpen} onAction={onAction} />}
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild><div data-testid="tree-background" className="min-h-16 flex-1" /></ContextMenuTrigger>
        <ContextMenuContent><EntryContextItems entry={{ path: '', kind: 'dir', dir: '', isRoot: true }} onAction={onAction} /></ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
