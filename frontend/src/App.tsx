import { useCallback, useEffect, useRef, useState } from 'react';
import { RefusalAlert } from '@/components/RefusalAlert';
import { RootList, RootPicker, rootLabel, type RootChoice } from '@/components/RootPicker';
import { SwitchRootDialog } from '@/components/SwitchRootDialog';
import { Workspace, type WorkspaceHandle } from '@/components/Workspace';
import { resolveCcRequest, useRoots } from '@/state/roots';
import { useRoute } from '@/state/route';

const sameRoot = (a: RootChoice | null, b: RootChoice | null) => a?.project === b?.project && (a?.worktree ?? null) === (b?.worktree ?? null);

export function App() {
  const { route, setRoute, setFile, cc, clearCc } = useRoute();
  const { state: roots, reload } = useRoots();
  const urlRoot: RootChoice | null = route.project ? { project: route.project, worktree: route.worktree } : null;
  // The root the workspace actually shows. It follows the URL, except while unsaved buffers hold a switch back.
  const [committed, setCommitted] = useState<RootChoice | null>(urlRoot);
  const [initialFile, setInitialFile] = useState<string | null>(route.file);
  const [switching, setSwitching] = useState<{ dirty: string[]; busy: boolean } | null>(null);
  const [ccError, setCcError] = useState<string | null>(null);
  const workspace = useRef<WorkspaceHandle>(null);

  // A cc ⋮ menu request (untrusted text) becomes the route only when api/roots lists it.
  useEffect(() => {
    if (!cc || roots.status === 'loading') return;
    if (roots.status === 'ready') {
      const resolved = resolveCcRequest(roots.projects, cc);
      if (resolved) { setCcError(null); setRoute({ project: resolved.project, worktree: resolved.worktree, file: null }); }
      else setCcError(`Project not found: ${cc.project}${cc.worktree ? ` / ${cc.worktree}` : ''}`);
    }
    clearCc();
  }, [cc, roots, setRoute, clearCc]);

  // Every root change (picker, cc request, back/forward) arrives through the URL route and is checked here.
  useEffect(() => {
    if (sameRoot(urlRoot, committed)) return;
    const dirty = workspace.current?.dirtyPaths() ?? [];
    if (dirty.length === 0) { setCommitted(urlRoot); setInitialFile(route.file); return; }
    setSwitching((s) => s ?? { dirty, busy: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.project, route.worktree]);

  const onFileChange = useCallback((path: string | null) => { if (sameRoot(urlRoot, committed)) setFile(path); }, [urlRoot?.project, urlRoot?.worktree, committed?.project, committed?.worktree, setFile]);

  const commitSwitch = () => { setSwitching(null); setCommitted(urlRoot); setInitialFile(route.file); };
  const cancelSwitch = () => {
    setSwitching(null);
    setRoute({ project: committed?.project ?? null, worktree: committed?.worktree ?? null, file: committed ? route.file : null });
  };
  const saveAllThenSwitch = async () => {
    setSwitching((s) => (s ? { ...s, busy: true } : s));
    if (await workspace.current?.saveAll()) commitSwitch();
    else setSwitching((s) => (s ? { dirty: workspace.current?.dirtyPaths() ?? [], busy: false } : s));
  };

  const projects = roots.status === 'ready' ? roots.projects : [];
  const current = committed ? roots.status === 'ready' ? projects.find((p) => p.name === committed.project) : undefined : undefined;
  const pick = (r: RootChoice) => setRoute({ project: r.project, worktree: r.worktree, file: null });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2">
        <h1 className="text-base font-semibold">Code Editor</h1>
        {committed && <RootPicker root={committed} system={current ? { system: current.system, remoteId: current.remoteId } : null} projects={projects} onPick={pick} />}
      </header>
      {ccError && <div className="p-3"><p role="alert" className="text-sm text-destructive">{ccError}</p></div>}
      {committed ? (
        <Workspace key={rootLabel(committed)} ref={workspace} target={committed} initialFile={initialFile} onFileChange={onFileChange} />
      ) : (
        <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-4">
          <h2 className="mb-2 text-lg font-medium">Open a project</h2>
          {roots.status === 'loading' && <p className="text-sm text-muted-foreground">Loading projects…</p>}
          {roots.status === 'error' && <RefusalAlert title="Cannot load projects" error={roots.error} onRetry={reload} />}
          {roots.status === 'ready' && <RootList projects={projects} onPick={pick} />}
        </main>
      )}
      <SwitchRootDialog dirty={switching?.dirty ?? null} busy={switching?.busy ?? false} onSaveAll={() => void saveAllThenSwitch()} onDiscard={commitSwitch} onCancel={cancelSwitch} />
    </div>
  );
}
