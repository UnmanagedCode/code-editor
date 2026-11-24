import { FilesIcon, FileSearchIcon, RefreshCwIcon, SaveIcon, SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { applyMonacoTheme } from '@/editor/monacoTheme';
import { useEditorHost, type EditorHandle } from '@/editor/EditorHost';
import { sendUnavailableReason } from '@/lib/ccBridge';
import type { LineRange } from '@/lib/ccLink';
import { endpoints, type Target } from '@/lib/endpoints';
import { useGlobalShortcuts } from '@/lib/keys';
import { useNarrow } from '@/lib/media';
import { isUnder, join, leaf, parent } from '@/lib/paths';
import { useTheme } from '@/lib/theme';
import { useFileActions } from '@/state/files';
import { isDirty, useTabs } from '@/state/tabs';
import { useTree } from '@/state/tree';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CloseTabDialog } from './CloseTabDialog';
import { CommentDialog, type CommentRequest } from './CommentDialog';
import { ConflictBar } from './ConflictBar';
import { DeleteDialog, type DeleteRequest } from './DeleteDialog';
import { DiffPane } from './DiffPane';
import { EditorPane } from './EditorPane';
import type { EntryAction, EntryRef } from './EntryMenu';
import { FileTree } from './FileTree';
import { NameDialog, type NameRequest } from './NameDialog';
import { QuickOpen, type FileList } from './QuickOpen';
import { RefusalAlert } from './RefusalAlert';
import { SearchPanel } from './SearchPanel';
import { TabBar } from './TabBar';
import { rootLabel } from './RootPicker';

/** What the App needs from the open root: whether it has unsaved buffers, and a way to save them all. */
export type WorkspaceHandle = { dirtyPaths(): string[]; saveAll(): Promise<boolean> };
/** A deep link into this root: open `file` and reveal `range`. A new `seq` is a new request, even for the same file and lines. */
export type RevealRequest = { file: string; range: LineRange | null; seq: number };

const STATUS_MS = 4000;

export function Workspace({ target, rootPath, initialFile, reveal, onRevealHandled, onFileChange, ref }: {
  target: Target;
  /** The root's absolute path on its System (null when cc reports none): comments link to files under it. */
  rootPath: string | null;
  initialFile: string | null;
  reveal: RevealRequest | null;
  onRevealHandled: () => void;
  onFileChange: (path: string | null) => void;
  ref?: Ref<WorkspaceHandle>;
}) {
  const host = useEditorHost();
  const narrow = useNarrow();
  const theme = useTheme();
  const tree = useTree(target);
  const tabsApi = useTabs(host);
  const { tabs, active } = tabsApi;
  const [showIgnored, setShowIgnored] = useState(false);
  const [sideTab, setSideTab] = useState<'files' | 'search'>('files');
  const [sheet, setSheet] = useState<'files' | 'search' | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [fileList, setFileList] = useState<FileList | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const editor = useRef<EditorHandle | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [commentRequest, setCommentRequest] = useState<CommentRequest | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => applyMonacoTheme(host, theme === 'dark'), [host, theme]);

  const files = useFileActions({
    target, host, tabs: tabsApi,
    onOpened: useCallback((path: string) => { tree.reveal(path); }, [tree.reveal]),
  });
  const { openFile } = files;

  // The URL's `file` follows the active tab; the initial one opens on mount.
  useEffect(() => { onFileChange(active?.path ?? null); }, [active?.path, onFileChange]);
  const initial = useRef(initialFile);
  useEffect(() => { if (initial.current) void openFile(initial.current); }, [openFile]);
  // A deep link: declared after the initial open, so a link naming the initial file adds its range to that open.
  useEffect(() => {
    if (!reveal) return;
    setSheet(null);
    void openFile(reveal.file, reveal.range);
    onRevealHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), STATUS_MS);
    return () => clearTimeout(t);
  }, [status]);

  useImperativeHandle(ref, () => ({
    dirtyPaths: () => tabsRef.current.filter(isDirty).map((t) => t.path),
    saveAll: () => files.saveAll(),
  }));
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Unsaved buffers: ask before a page reload or navigation (a keepAlive page leaving cc's view stays loaded, so it needs no prompt).
  const anyDirty = tabs.some(isDirty);
  useEffect(() => {
    if (!anyDirty) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [anyDirty]);

  // The quick-open list: cached per root, refetched in the background on each open, invalidated by any file operation.
  const loadFileList = useCallback(() => {
    const gen = ++listGeneration.current;
    setListLoading(true);
    setListError(null);
    endpoints.files(target).then(
      (r) => { if (gen === listGeneration.current) { setFileList({ files: r.files, truncated: r.truncated, limit: r.limit }); setListLoading(false); } },
      (e) => { if (gen === listGeneration.current) { setListError(e instanceof Error ? e.message : String(e)); setListLoading(false); } },
    );
  }, [target]);
  const openQuick = useCallback(() => { setQuickOpen(true); loadFileList(); }, [loadFileList]);
  const filesChanged = useCallback(() => { listGeneration.current++; setFileList(null); }, []);

  const saveActive = useCallback(() => { if (active) void files.save(active.path); }, [active, files.save]);
  useGlobalShortcuts({ onSave: saveActive, onQuickOpen: openQuick });

  const openFromSide = useCallback((path: string, line: number | null = null) => {
    setSheet(null);
    void openFile(path, line === null ? null : { start: line, end: null });
  }, [openFile]);

  const onHandle = useCallback((h: EditorHandle | null, has: boolean) => { editor.current = h; setHasSelection(h !== null && has); }, []);
  const commentBlocked = sendUnavailableReason() ?? (rootPath ? null : 'cc reports no path for this project, so a comment cannot link to the file');
  const startComment = () => {
    if (commentBlocked) { setStatus(commentBlocked); return; }
    const selection = editor.current?.getSelection();
    if (!active || !selection || !rootPath) return;
    setCommentRequest({ root: target, rootPath, path: active.path, selection, dirty: isDirty(active), lang: host.languageFor(active.path) });
  };

  const requestClose = (path: string) => {
    const t = tabs.find((x) => x.path === path);
    if (t && isDirty(t)) setClosing(path); else tabsApi.drop(path);
  };

  const onAction = (action: EntryAction, entry: EntryRef) => {
    // A save in flight for a file at or under the entry: renaming or deleting now would race its response.
    if ((action === 'rename' || action === 'delete') && tabs.some((t) => files.busy.has(t.id) && isUnder(t.path, entry.path))) return;
    if (action === 'new-file') setNameRequest({ mode: 'file', dir: entry.dir });
    else if (action === 'new-folder') setNameRequest({ mode: 'dir', dir: entry.dir });
    else if (action === 'rename') setNameRequest({ mode: 'rename', dir: parent(entry.path), current: leaf(entry.path) });
    else setDeleteRequest({ path: entry.path, isDir: entry.kind === 'dir', dirtyTabs: tabs.filter((t) => isUnder(t.path, entry.path) && isDirty(t)).map((t) => t.path) });
  };

  const submitName = async (name: string) => {
    const req = nameRequest!;
    if (req.mode === 'rename') {
      const from = join(req.dir, req.current!);
      const to = join(req.dir, name);
      await files.settle(from); // a save in flight for the file (or one beneath it) lands first, on the path it was sent to
      await endpoints.rename(target, from, to);
      tabsApi.rename(from, to);
      tree.moved(from, to);
      tree.reload([req.dir]);
    } else {
      const path = join(req.dir, name);
      await endpoints.create(target, path, req.mode);
      if (req.mode === 'dir') tree.reveal(`${path}/x`); // expand the folders down to it
      tree.reload([req.dir]);
      if (req.mode === 'file') void openFile(path);
    }
    filesChanged();
    setNameRequest(null);
  };

  const confirmDelete = async () => {
    const req = deleteRequest!;
    await files.settle(req.path);
    await endpoints.remove(target, req.path);
    tabsApi.drop(req.path, { subtree: true });
    if (req.isDir) tree.forget(req.path);
    tree.reload([parent(req.path)]);
    filesChanged();
    setDeleteRequest(null);
  };

  const closeSave = async () => {
    const path = closing!;
    if (await files.save(path)) { setClosing(null); tabsApi.drop(path); } else setClosing(null);
  };

  const label = rootLabel(target);
  // Paths whose rename or delete would race a save in flight.
  const busyPaths = tabs.filter((t) => files.busy.has(t.id)).map((t) => t.path);
  const treeEl = (
    <FileTree tree={tree} busyPaths={busyPaths} rootName={label} showIgnored={showIgnored} activePath={active?.path ?? null} onOpen={(p) => openFromSide(p)} onAction={onAction} />
  );
  const treeHeader = (
    <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5 text-xs text-muted-foreground">
      <label className="flex items-center gap-2"><Switch checked={showIgnored} onCheckedChange={setShowIgnored} aria-label="Show ignored" /> Show ignored</label>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Refresh" title="Refresh the file tree" onClick={() => { tree.reloadAll(); filesChanged(); }}><RefreshCwIcon /></Button>
    </div>
  );
  const searchEl = <SearchPanel target={target} onOpen={(p, l) => openFromSide(p, l)} />;

  const busy = active ? files.busy.has(active.id) : false;
  const editorArea = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs} active={active?.path ?? null} onActivate={(p) => tabsApi.dispatch({ type: 'activate', path: p })} onClose={requestClose} onSave={saveActive}
          comment={hasSelection && active && !active.diff ? { onComment: startComment, blocked: commentBlocked } : null}
        />
      )}
      {status && <p role="status" className="border-b bg-card px-3 py-1.5 text-xs">{status}</p>}
      {files.error && <div className="p-2"><RefusalAlert title="Something went wrong" error={files.error} /></div>}
      {active?.conflict && (
        <ConflictBar
          deleted={active.diff ? active.diff.deleted : active.conflict.currentHash === null}
          busy={busy} diffShown={active.diff !== null}
          onViewDiff={() => void files.viewDiff(active.path)} onOverwrite={() => void files.overwrite(active.path)} onReload={() => void files.reload(active.path)}
        />
      )}
      {active?.truncated && (
        <p className="border-b bg-card px-3 py-1.5 text-xs text-muted-foreground">This file is {active.size} bytes; showing the first {active.limitBytes} bytes, read-only.</p>
      )}
      <div className="min-h-0 flex-1">
        {active ? (
          active.diff ? <DiffPane key={`${active.path}:diff`} tab={active} narrow={narrow} onSave={saveActive} onQuickOpen={openQuick} />
            : <EditorPane key={active.path} tab={active} narrow={narrow} onSave={saveActive} onQuickOpen={openQuick} onRevealed={() => tabsApi.dispatch({ type: 'revealed', id: active.id })} onComment={startComment} onHandle={onHandle} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
            {narrow
              ? <p>Open a file from the Files menu, or use Quick open to find one.</p>
              : <p>Open a file from the tree, or press <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">P</kbd> to find one.</p>}
            {!narrow && <Button type="button" variant="outline" size="sm" onClick={openQuick}><FileSearchIcon /> Quick open</Button>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {narrow ? (
        <div className="flex items-center gap-1 border-b px-2 py-1">
          <Button type="button" variant="ghost" size="icon" aria-label="Files" onClick={() => setSheet('files')}><FilesIcon /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Search" onClick={() => setSheet('search')}><SearchIcon /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Quick open" onClick={openQuick}><FileSearchIcon /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Save file" disabled={!active || !isDirty(active)} onClick={saveActive}><SaveIcon /></Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {!narrow && (
          <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
            <Tabs value={sideTab} onValueChange={(v) => setSideTab(v as 'files' | 'search')} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="m-2 grid grid-cols-2"><TabsTrigger value="files">Files</TabsTrigger><TabsTrigger value="search">Search</TabsTrigger></TabsList>
              <TabsContent value="files" className="flex min-h-0 flex-1 flex-col">
                {treeHeader}
                <div className="min-h-0 flex-1 overflow-y-auto">{treeEl}</div>
              </TabsContent>
              <TabsContent value="search" className="min-h-0 flex-1">{searchEl}</TabsContent>
            </Tabs>
          </aside>
        )}
        {editorArea}
      </div>

      {narrow && (
        <>
          <Sheet open={sheet === 'files'} onOpenChange={(o) => { if (!o) setSheet(null); }}>
            <SheetContent side="left" className="w-[85vw] max-w-sm gap-0 p-0">
              <div className="p-3"><SheetTitle>Files</SheetTitle><SheetDescription className="sr-only">Project files</SheetDescription></div>
              {treeHeader}
              <div className="min-h-0 flex-1 overflow-y-auto">{treeEl}</div>
            </SheetContent>
          </Sheet>
          <Sheet open={sheet === 'search'} onOpenChange={(o) => { if (!o) setSheet(null); }}>
            <SheetContent side="right" className="w-[92vw] max-w-md gap-0 p-0">
              <div className="p-3"><SheetTitle>Search</SheetTitle><SheetDescription className="sr-only">Search the project</SheetDescription></div>
              {searchEl}
            </SheetContent>
          </Sheet>
        </>
      )}

      <QuickOpen open={quickOpen} list={fileList} loading={listLoading} error={listError} onClose={() => setQuickOpen(false)} onOpenFile={(p) => void openFile(p)} />
      <NameDialog request={nameRequest} onSubmit={submitName} onClose={() => setNameRequest(null)} />
      <DeleteDialog request={deleteRequest} onConfirm={confirmDelete} onClose={() => setDeleteRequest(null)} />
      <CommentDialog request={commentRequest} onClose={() => setCommentRequest(null)} onSent={(label) => { setCommentRequest(null); setStatus(`Sent to ${label}`); }} />
      <CloseTabDialog path={closing} onSave={() => void closeSave()} onDiscard={() => { tabsApi.drop(closing!); setClosing(null); }} onCancel={() => setClosing(null)} />
    </div>
  );
}
