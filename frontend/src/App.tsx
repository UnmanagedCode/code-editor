import { useCallback, useEffect, useRef, useState } from 'react';
import { RootBrowser, RootPicker, rootLabel, type RootChoice } from '@/components/RootPicker';
import { SwitchRootDialog } from '@/components/SwitchRootDialog';
import { Workspace, type RevealRequest, type WorkspaceHandle } from '@/components/Workspace';
import { activeSession } from '@/lib/ccBridge';
import { placeForPath } from '@/lib/placeFor';
import { resolveCcRequest, useRoots } from '@/state/roots';
import { useRoute } from '@/state/route';

const sameRoot = (a: RootChoice | null, b: RootChoice | null) => a?.project === b?.project && (a?.worktree ?? null) === (b?.worktree ?? null);

export function App() {
  const { route, setRoute, setFile, cc, clearCc } = useRoute();
  const { projects, error, loading, reload } = useRoots();
  const urlRoot: RootChoice | null = route.project ? { project: route.project, worktree: route.worktree } : null;
  // The root the workspace actually shows. It follows the URL, except while unsaved buffers hold a switch back.
  const [committed, setCommitted] = useState<RootChoice | null>(urlRoot);
  const [initialFile, setInitialFile] = useState<string | null>(route.file);
  const [switching, setSwitching] = useState<{ dirty: string[]; busy: boolean } | null>(null);
  const [ccError, setCcError] = useState<string | null>(null);
  // A deep link waiting for the workspace of its root (which may first need a root switch).
  const [reveal, setReveal] = useState<(RevealRequest & { root: RootChoice }) | null>(null);
  const revealSeq = useRef(0);
  const workspace = useRef<WorkspaceHandle>(null);
  // The open file of the committed root, so Cancel can put the whole route back (the URL already names the new root).
  const committedFile = useRef<string | null>(route.file);

  // A cc request (untrusted text) changes the route only when api/roots lists its place: a ⋮ menu item's project/worktree,
  // or the root containing a deep link's absolute path. An unresolved one leaves the open root alone.
  useEffect(() => {
    if (!cc || loading) return;
    if (cc.kind === 'place') {
      if (projects) {
        const resolved = resolveCcRequest(projects, cc);
        if (resolved) { setCcError(null); setRoute({ project: resolved.project, worktree: resolved.worktree, file: null }); }
        else setCcError(`Project not found: ${cc.project}${cc.worktree ? ` / ${cc.worktree}` : ''}`);
      }
    } else {
      const place = projects && !cc.invalid ? placeForPath(cc.path, projects, activeSession()) : null;
      if (!projects) setCcError(`Could not open ${cc.path}: the project list did not load`);
      else if (!place) setCcError(`No project contains ${cc.path}`);
      else {
        setCcError(null);
        const root = { project: place.project, worktree: place.worktree };
        setReveal({ root, file: place.file, range: cc.range, seq: ++revealSeq.current });
        setRoute({ ...root, file: place.file });
      }
    }
    clearCc();
  }, [cc, projects, loading, setRoute, clearCc]);

  // Every root change (picker, cc request, back/forward) arrives through the URL route and is checked here.
  useEffect(() => {
    if (sameRoot(urlRoot, committed)) return;
    const dirty = workspace.current?.dirtyPaths() ?? [];
    if (dirty.length === 0) { setCommitted(urlRoot); setInitialFile(route.file); return; }
    setSwitching((s) => s ?? { dirty, busy: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.project, route.worktree]);

  const onFileChange = useCallback((path: string | null) => { if (sameRoot(urlRoot, committed)) { committedFile.current = path; setFile(path); } }, [urlRoot?.project, urlRoot?.worktree, committed?.project, committed?.worktree, setFile]);

  const commitSwitch = () => { setSwitching(null); setCommitted(urlRoot); setInitialFile(route.file); };
  const cancelSwitch = () => {
    setSwitching(null);
    setReveal(null);
    setRoute({ project: committed?.project ?? null, worktree: committed?.worktree ?? null, file: committed ? committedFile.current : null });
  };
  const saveAllThenSwitch = async () => {
    setSwitching((s) => (s ? { ...s, busy: true } : s));
    if (await workspace.current?.saveAll()) commitSwitch();
    else setSwitching((s) => (s ? { dirty: workspace.current?.dirtyPaths() ?? [], busy: false } : s));
  };

  const current = committed ? (projects ?? []).find((p) => p.name === committed.project) : undefined;
  const rootPath = (committed?.worktree ? current?.worktrees.find((w) => w.name === committed.worktree)?.path : current?.path) ?? null;
  const onRevealHandled = useCallback(() => setReveal(null), []);
  const pick = (r: RootChoice) => setRoute({ project: r.project, worktree: r.worktree, file: null });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2">
        <h1 className="text-base font-semibold">Code Editor</h1>
        {committed && <RootPicker root={committed} system={current ? { system: current.system, remoteId: current.remoteId } : null} projects={projects} error={error} onRetry={reload} onOpen={reload} onPick={pick} />}
      </header>
      {ccError && <div className="p-3"><p role="alert" className="text-sm text-destructive">{ccError}</p></div>}
      {committed ? (
        <Workspace
          key={rootLabel(committed)} ref={workspace} target={committed} rootPath={rootPath} initialFile={initialFile} onFileChange={onFileChange}
          reveal={reveal && sameRoot(reveal.root, committed) ? reveal : null} onRevealHandled={onRevealHandled}
        />
      ) : (
        <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-4">
          <h2 className="mb-2 text-lg font-medium">Open a project</h2>
          <RootBrowser projects={projects} error={error} current={null} onRetry={reload} onPick={pick} />
        </main>
      )}
      <SwitchRootDialog dirty={switching?.dirty ?? null} busy={switching?.busy ?? false} onSaveAll={() => void saveAllThenSwitch()} onDiscard={commitSwitch} onCancel={cancelSwitch} />
    </div>
  );
}
