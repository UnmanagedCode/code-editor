import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type DeleteRequest = { path: string; isDir: boolean; /** open tabs at or under the path with unsaved changes */ dirtyTabs: string[] };

export function DeleteDialog({ request, onConfirm, onClose }: { request: DeleteRequest | null; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setBusy(false); setError(null); }, [request]);
  const dirty = request?.dirtyTabs ?? [];
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {request?.path}?</DialogTitle>
          <DialogDescription>{request?.isDir ? 'The folder and everything in it will be deleted.' : 'The file will be deleted.'} This cannot be undone.</DialogDescription>
        </DialogHeader>
        {dirty.length > 0 && (
          <div role="alert" className="grid gap-1 rounded-md border border-warning/30 bg-warning/8 p-3 text-sm">
            <p>These open files have unsaved changes that will be lost:</p>
            <ul className="list-disc pl-5">{dirty.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy && <LoaderCircleIcon className="animate-spin" />}{dirty.length > 0 ? 'Delete and discard changes' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
