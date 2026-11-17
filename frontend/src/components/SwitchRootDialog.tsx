import { LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Switching root with unsaved buffers: Save all / Discard / Cancel. */
export function SwitchRootDialog({ dirty, busy, onSaveAll, onDiscard, onCancel }: { dirty: string[] | null; busy: boolean; onSaveAll: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <Dialog open={dirty !== null} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>Switching project closes these files, which have unsaved changes:</DialogDescription>
        </DialogHeader>
        <ul className="list-disc pl-5 text-sm">{(dirty ?? []).map((p) => <li key={p}>{p}</li>)}</ul>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onDiscard}>Discard</Button>
          <Button type="button" disabled={busy} onClick={onSaveAll}>{busy && <LoaderCircleIcon className="animate-spin" />}Save all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
