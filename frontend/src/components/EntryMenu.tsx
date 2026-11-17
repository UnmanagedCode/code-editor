import { FilePlusIcon, FolderPlusIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

/** What a menu acts on. `dir` is the folder New file/folder create in (the entry itself when it is a folder, else its parent). */
export type EntryRef = { path: string; kind: 'dir' | 'file'; dir: string; isRoot?: boolean };
export type EntryAction = 'new-file' | 'new-folder' | 'rename' | 'delete';
export type EntryActionHandler = (action: EntryAction, entry: EntryRef) => void;

type Item = { action: EntryAction; label: string; icon: React.ReactNode; destructive?: boolean };

/** The one item list both menus render: New file, New folder, Rename, Delete (the root has no Rename/Delete). */
export function entryItems(entry: EntryRef): Item[] {
  const items: Item[] = [
    { action: 'new-file', label: 'New file', icon: <FilePlusIcon /> },
    { action: 'new-folder', label: 'New folder', icon: <FolderPlusIcon /> },
  ];
  if (!entry.isRoot) {
    items.push({ action: 'rename', label: 'Rename', icon: <PencilIcon /> });
    items.push({ action: 'delete', label: 'Delete', icon: <Trash2Icon />, destructive: true });
  }
  return items;
}

export function EntryContextItems({ entry, onAction }: { entry: EntryRef; onAction: EntryActionHandler }) {
  return entryItems(entry).map((i) => (
    <span key={i.action} className="contents">
      {i.destructive && <ContextMenuSeparator />}
      <ContextMenuItem variant={i.destructive ? 'destructive' : 'default'} onSelect={() => onAction(i.action, entry)}>{i.icon}{i.label}</ContextMenuItem>
    </span>
  ));
}

export function EntryDropdownItems({ entry, onAction }: { entry: EntryRef; onAction: EntryActionHandler }) {
  return entryItems(entry).map((i) => (
    <span key={i.action} className="contents">
      {i.destructive && <DropdownMenuSeparator />}
      <DropdownMenuItem variant={i.destructive ? 'destructive' : 'default'} onSelect={() => onAction(i.action, entry)}>{i.icon}{i.label}</DropdownMenuItem>
    </span>
  ));
}
