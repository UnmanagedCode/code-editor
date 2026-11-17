import { SaveIcon, XIcon } from 'lucide-react';
import { isDirty, type Tab } from '@/state/tabs';
import { Button } from '@/components/ui/button';
import { leaf } from '@/lib/paths';
import { cn } from '@/lib/utils';

export function TabBar({ tabs, active, onActivate, onClose, onSave }: {
  tabs: Tab[]; active: string | null; onActivate: (path: string) => void; onClose: (path: string) => void; onSave: () => void;
}) {
  const current = tabs.find((t) => t.path === active);
  return (
    <div className="flex items-stretch border-b bg-card">
      <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((t) => {
          const dirty = isDirty(t);
          return (
            <div key={t.path} className={cn('group flex shrink-0 items-center border-r', t.path === active ? 'bg-background' : 'bg-card text-muted-foreground hover:bg-accent/50')}>
              <button type="button" role="tab" aria-selected={t.path === active} title={t.path} onClick={() => onActivate(t.path)} className="flex min-h-9 items-center gap-1.5 pl-3 pr-1 text-sm">
                <span className="max-w-48 truncate">{leaf(t.path)}</span>
                {t.readOnly && <span className="text-xs text-muted-foreground">(read-only)</span>}
                {dirty && <span role="img" aria-label="unsaved changes" className="size-2 shrink-0 rounded-full bg-primary" />}
              </button>
              <button type="button" aria-label={`Close ${leaf(t.path)}`} onClick={() => onClose(t.path)} className="flex size-8 items-center justify-center rounded-md hover:bg-accent">
                <XIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" className="m-1 shrink-0" disabled={!current || !isDirty(current)} onClick={onSave} aria-label="Save">
        <SaveIcon /> <span className="hidden sm:inline">Save</span>
      </Button>
    </div>
  );
}
