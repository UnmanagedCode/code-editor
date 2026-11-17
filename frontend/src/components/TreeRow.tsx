import { ChevronDownIcon, ChevronRightIcon, EllipsisVerticalIcon, FileIcon, FolderIcon, FolderOpenIcon, LinkIcon } from 'lucide-react';
import type { Entry } from '@/lib/endpoints';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { EntryContextItems, EntryDropdownItems, type EntryActionHandler, type EntryRef } from './EntryMenu';

/** What a row does when activated: toggle a folder, open a file, or nothing (an outside/broken link, a special file). */
export type RowBehavior = 'dir' | 'file' | 'none';

export function behaviorOf(e: Entry): RowBehavior {
  if (e.unsupported) return 'none';
  if (e.kind === 'dir') return 'dir';
  if (e.kind === 'file') return 'file';
  if (e.kind === 'symlink') return e.target === 'dir' ? 'dir' : e.target === 'file' ? 'file' : 'none';
  return 'none';
}

const noteFor = (e: Entry): string | null => {
  if (e.unsupported) return 'name is not valid UTF-8';
  if (e.kind === 'symlink') {
    if (e.target === 'outside') return 'points outside the root';
    if (e.target === 'broken') return 'broken link';
    if (e.target === 'other') return 'link to a special file';
  }
  if (e.kind === 'other') return 'special file';
  return null;
};

export function TreeRow({ entry, path, depth, expanded, active, locked, onToggle, onOpen, onAction }: {
  entry: Entry; path: string; depth: number; expanded: boolean; active: boolean; locked: boolean;
  onToggle: () => void; onOpen: () => void; onAction: EntryActionHandler;
}) {
  const behavior = behaviorOf(entry);
  const note = noteFor(entry);
  const isDir = behavior === 'dir';
  const ref: EntryRef = { path, kind: isDir ? 'dir' : 'file', dir: isDir ? path : path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', locked };
  const Icon = entry.kind === 'symlink' ? LinkIcon : isDir ? (expanded ? FolderOpenIcon : FolderIcon) : FileIcon;
  const suffix = entry.kind === 'symlink' && !note && entry.target ? ` → ${entry.target}` : '';
  const inert = behavior === 'none';
  const row = (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDir ? expanded : undefined}
      aria-selected={active}
      aria-disabled={inert || undefined}
      data-path={path}
      className={cn('tree-row group flex items-center rounded-md text-sm', active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60', (entry.ignored || inert) && 'opacity-60')}
    >
      <button
        type="button"
        title={note ?? path}
        disabled={inert}
        onClick={isDir ? onToggle : onOpen}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-left disabled:cursor-not-allowed"
      >
        {isDir ? (expanded ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />) : <span className="size-3.5 shrink-0" />}
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
        {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
        {note && <span className="shrink-0 text-xs text-muted-foreground">({note})</span>}
      </button>
      {!entry.unsupported && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Actions for ${entry.name}`} className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 any-pointer-coarse:opacity-100">
              <EllipsisVerticalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end"><EntryDropdownItems entry={ref} onAction={onAction} /></DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  if (entry.unsupported) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent><EntryContextItems entry={ref} onAction={onAction} /></ContextMenuContent>
    </ContextMenu>
  );
}
