import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { leafNameError } from '@/lib/paths';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export type NameRequest = { mode: 'file' | 'dir' | 'rename'; /** the folder created in, or the renamed entry's folder */ dir: string; /** rename only */ current?: string };

const TITLES = { file: 'New file', dir: 'New folder', rename: 'Rename' } as const;

/** Create / rename prompt. The name is checked locally; the backend's ALREADY_EXISTS is shown inline. */
export function NameDialog({ request, onSubmit, onClose }: { request: NameRequest | null; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => { setName(request?.current ?? ''); setServerError(null); setBusy(false); }, [request]);
  const localError = name === '' ? null : leafNameError(name);
  const unchanged = request?.mode === 'rename' && name === request.current;
  const submit = async () => {
    if (busy || name === '' || localError || unchanged) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit(name);
    } catch (e) {
      setServerError(e instanceof ApiError && e.code === 'ALREADY_EXISTS' ? `${name} already exists` : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  const error = localError ?? serverError;
  return (
    <Dialog open={request !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{request ? TITLES[request.mode] : ''}</DialogTitle>
            <DialogDescription>{request?.dir ? `In ${request.dir}` : 'In the project root'}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Input aria-label="Name" aria-invalid={error ? true : undefined} value={name} onChange={(e) => { setName(e.target.value); setServerError(null); }} autoComplete="off" autoCapitalize="off" spellCheck={false} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || name === '' || !!localError || unchanged}>
              {busy && <LoaderCircleIcon className="animate-spin" />}{request?.mode === 'rename' ? 'Rename' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
