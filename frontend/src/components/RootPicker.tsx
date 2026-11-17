import { CheckIcon, ChevronRightIcon, FolderGitIcon } from 'lucide-react';
import { useState } from 'react';
import { RefusalAlert } from '@/components/RefusalAlert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ApiError } from '@/lib/api';
import type { RootProject } from '@/lib/endpoints';
import { groupKey, groupLabel, groupRoots } from '@/lib/rootFilter';

export type RootChoice = { project: string; worktree: string | null };

/** `project` or `project / worktree`, as text. */
export const rootLabel = (r: RootChoice) => (r.worktree ? `${r.project} / ${r.worktree}` : r.project);

/** The System badge for a project that is not local: `system · remoteId`. */
export function SystemBadge({ system, remoteId }: { system: string; remoteId: string | null }) {
  if (system === 'local') return null;
  return <Badge variant="outline">{remoteId ? `${system} · ${remoteId}` : system}</Badge>;
}

const ROW = 'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent';

function CurrentMark({ current }: { current: boolean }) {
  return current ? <CheckIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null;
}

function ProjectRow({ project, worktreeHit, current, onPick }: { project: RootProject; worktreeHit: boolean; current: RootChoice | null; onPick: (r: RootChoice) => void }) {
  const reason = project.unreachable ?? project.degraded;
  const isCurrent = current?.project === project.name;
  const [expanded, setExpanded] = useState(worktreeHit || (isCurrent && current.worktree !== null));
  const pickMain = () => onPick({ project: project.name, worktree: null });
  return (
    <li>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-expanded={expanded} aria-label={`Show worktrees of ${project.name}`} disabled={reason !== null} onClick={() => setExpanded((e) => !e)}>
          <ChevronRightIcon className={expanded ? 'rotate-90' : ''} />
        </Button>
        <button type="button" disabled={reason !== null} aria-current={isCurrent && current.worktree === null ? 'true' : undefined} onClick={pickMain} className={ROW}>
          <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
          <CurrentMark current={isCurrent && current.worktree === null} />
          <SystemBadge system={project.system} remoteId={project.remoteId} />
        </button>
      </div>
      {reason !== null && <p className="ml-9 truncate text-xs text-muted-foreground" title={reason}>{reason}</p>}
      {expanded && reason === null && (
        <ul aria-label={`Checkouts of ${project.name}`} className="ml-9 flex flex-col">
          <li>
            <button type="button" aria-current={isCurrent && current.worktree === null ? 'true' : undefined} onClick={pickMain} className={`${ROW} w-full`}>
              <span className="min-w-0 flex-1 truncate">(main checkout)</span>
            </button>
          </li>
          {project.worktrees.map((w) => {
            const here = isCurrent && current.worktree === w.name;
            return (
              <li key={w.name}>
                <button type="button" aria-current={here ? 'true' : undefined} onClick={() => onPick({ project: project.name, worktree: w.name })} className={`${ROW} w-full`}>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <CurrentMark current={here} />
                  {w.branch && <span className="max-w-[50%] truncate font-mono text-xs text-muted-foreground">{w.branch}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** The filterable, workspace-grouped project list: used in the header dialog and on the landing page. */
export function RootBrowser({ projects, error, current, onRetry, onPick, autoFocus }: { projects: RootProject[] | null; error: ApiError | null; current: RootChoice | null; onRetry: () => void; onPick: (r: RootChoice) => void; autoFocus?: boolean }) {
  const [filter, setFilter] = useState('');
  const groups = projects ? groupRoots(projects, filter) : [];
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Input type="text" aria-label="Filter projects" placeholder="Filter projects" autoFocus={autoFocus} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className={autoFocus ? 'max-h-[60dvh] overflow-y-auto pr-1' : ''}>
        {error && <RefusalAlert title="Cannot load projects" error={error} onRetry={onRetry} />}
        {projects === null && !error && <p className="p-2 text-sm text-muted-foreground">Loading projects…</p>}
        {projects !== null && groups.length === 0 && <p className="p-2 text-sm text-muted-foreground">No project matches.</p>}
        {groups.map((g) => (
          <section key={groupKey(g)} aria-label={groupLabel(g)} className="mt-2 first:mt-0">
            <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{groupLabel(g)}</h3>
            <ul className="flex flex-col">
              {g.projects.map(({ project, worktreeHit }) => (
                <ProjectRow key={`${groupKey(g)}:${project.name}:${worktreeHit}`} project={project} worktreeHit={worktreeHit} current={current} onPick={onPick} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** The open root as text in the header, opening a dialog to switch. */
export function RootPicker({ root, system, projects, error, onRetry, onOpen, onPick }: { root: RootChoice; system: { system: string; remoteId: string | null } | null; projects: RootProject[] | null; error: ApiError | null; onRetry: () => void; onOpen: () => void; onPick: (r: RootChoice) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(true); onOpen(); }} aria-label={`Open root: ${rootLabel(root)}. Switch root`} className="max-w-[60vw]">
        <FolderGitIcon />
        <span className="truncate">{rootLabel(root)}</span>
        {system && <SystemBadge {...system} />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Open a project</DialogTitle>
            <DialogDescription>Projects registered in code-conductor, on any System.</DialogDescription>
          </DialogHeader>
          <RootBrowser autoFocus projects={projects} error={error} current={root} onRetry={onRetry} onPick={(r) => { setOpen(false); onPick(r); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
