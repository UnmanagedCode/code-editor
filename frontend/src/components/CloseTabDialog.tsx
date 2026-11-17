import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Closing a tab with unsaved changes: Save / Discard / Cancel. */
export function CloseTabDialog({ path, onSave, onDiscard, onCancel }: { path: string | null; onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <Dialog open={path !== null} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save changes to {path}?</DialogTitle>
          <DialogDescription>Your changes will be lost if you do not save them.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="outline" onClick={onDiscard}>Discard</Button>
          <Button type="button" onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
