import { FolderGitIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { RootProject } from '@/lib/endpoints';

export type RootChoice = { project: string; worktree: string | null };

/** `project` or `project / worktree`, as text. */
export const rootLabel = (r: RootChoice) => (r.worktree ? `${r.project} / ${r.worktree}` : r.project);

/** The System badge for a project that is not local: `system · remoteId`. */
export function SystemBadge({ system, remoteId }: { system: string; remoteId: string | null }) {
  if (system === 'local') return null;
  return <Badge variant="outline">{remoteId ? `${system} · ${remoteId}` : system}</Badge>;
}

function RootRow({ label, disabledReason, onPick, badge, nested }: { label: string; disabledReason: string | null; onPick: () => void; badge?: React.ReactNode; nested?: boolean }) {
  return (
    <li>
      <button
        type="button"
        disabled={disabledReason !== null}
        onClick={onPick}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${nested ? 'pl-8' : ''}`}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {badge}
        {disabledReason !== null && <span className="max-w-[50%] truncate text-xs text-muted-foreground">{disabledReason}</span>}
      </button>
    </li>
  );
}

/** Projects with their worktrees nested; an unreachable or unreadable project is listed disabled with its reason. */
export function RootList({ projects, onPick }: { projects: RootProject[]; onPick: (r: RootChoice) => void }) {
  if (projects.length === 0) return <p className="p-2 text-sm text-muted-foreground">No projects.</p>;
  return (
    <ul className="flex flex-col" aria-label="Projects">
      {projects.map((p) => {
        const reason = p.unreachable ?? p.degraded;
        return (
          <div key={p.name}>
            <RootRow label={p.name} disabledReason={reason} onPick={() => onPick({ project: p.name, worktree: null })} badge={<SystemBadge system={p.system} remoteId={p.remoteId} />} />
            {reason === null && p.worktrees.map((w) => (
              <RootRow key={w.name} nested label={w.name} disabledReason={null} onPick={() => onPick({ project: p.name, worktree: w.name })} badge={w.branch ? <span className="truncate text-xs text-muted-foreground">{w.branch}</span> : undefined} />
            ))}
          </div>
        );
      })}
    </ul>
  );
}

/** The open root as text in the header, opening a dialog to switch. */
export function RootPicker({ root, system, projects, onPick }: { root: RootChoice; system: { system: string; remoteId: string | null } | null; projects: RootProject[]; onPick: (r: RootChoice) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Open root: ${rootLabel(root)}. Switch root`} className="max-w-[60vw]">
        <FolderGitIcon />
        <span className="truncate">{rootLabel(root)}</span>
        {system && <SystemBadge {...system} />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open a project</DialogTitle>
            <DialogDescription>Pick a project or one of its worktrees.</DialogDescription>
          </DialogHeader>
          <RootList projects={projects} onPick={(r) => { setOpen(false); onPick(r); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
