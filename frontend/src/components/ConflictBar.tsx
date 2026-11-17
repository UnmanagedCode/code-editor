import { LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ConflictBar({ deleted, busy, diffShown, onViewDiff, onOverwrite, onReload }: {
  deleted: boolean; busy: boolean; diffShown: boolean; onViewDiff: () => void; onOverwrite: () => void; onReload: () => void;
}) {
  return (
    <Alert variant="warning" className="rounded-none border-x-0">
      <TriangleAlertIcon />
      <AlertTitle>This file changed on disk since you opened it.</AlertTitle>
      <AlertDescription>
        {deleted && <p>It was deleted on disk.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onViewDiff}>{diffShown ? 'Refresh diff' : 'View diff'}</Button>
          <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={onOverwrite}>{busy && <LoaderCircleIcon className="animate-spin" />}Overwrite</Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || deleted} onClick={onReload}>Reload</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
