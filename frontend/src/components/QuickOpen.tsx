import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { rank, type FuzzyMatch } from '@/lib/fuzzy';
import { leaf } from '@/lib/paths';
import { cn } from '@/lib/utils';

export type FileList = { files: string[]; truncated: boolean; limit: number };

/** A path with its matched characters highlighted: split into text spans, never markup. */
function Highlighted({ match }: { match: FuzzyMatch }) {
  const hit = new Set(match.indices);
  const spans: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < match.path.length; i++) {
    const h = hit.has(i);
    const last = spans[spans.length - 1];
    if (last && last.hit === h) last.text += match.path[i]; else spans.push({ text: match.path[i], hit: h });
  }
  return <>{spans.map((s, i) => (s.hit ? <mark key={i} className="bg-transparent font-semibold text-primary">{s.text}</mark> : <span key={i}>{s.text}</span>))}</>;
}

/** Ctrl/Cmd+P: fuzzy file open over the project's file list (the parent caches and refreshes it). */
export function QuickOpen({ open, list, loading, error, onClose, onOpenFile }: {
  open: boolean; list: FileList | null; loading: boolean; error: string | null; onClose: () => void; onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  useEffect(() => { if (open) { setQuery(''); setCursor(0); } }, [open]);
  const matches = useMemo(() => (list ? rank(query, list.files, 100) : []), [list, query]);
  useEffect(() => setCursor(0), [query]);
  const choose = (m: FuzzyMatch | undefined) => { if (m) { onClose(); onOpenFile(m.path); } };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="top-[20%] translate-y-0 gap-2 p-3 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Quick open</DialogTitle>
          <DialogDescription>Type to find a file by name or path.</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Find file"
          role="combobox"
          aria-expanded
          aria-controls="quick-open-list"
          aria-activedescendant={matches[cursor] ? `qo-${cursor}` : undefined}
          placeholder="Go to file…"
          value={query}
          autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(matches[cursor]); }
          }}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {loading && !list && <p className="p-2 text-sm text-muted-foreground">Loading files…</p>}
        {list?.truncated && <p className="px-1 text-xs text-warning">Only the first {list.limit} files are listed; some files may be missing.</p>}
        <ul id="quick-open-list" role="listbox" aria-label="Files" className="max-h-72 overflow-y-auto">
          {matches.map((m, i) => (
            <li
              key={m.path}
              id={`qo-${i}`}
              role="option"
              aria-selected={i === cursor}
              onMouseMove={() => setCursor(i)}
              onClick={() => choose(m)}
              className={cn('flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-sm', i === cursor && 'bg-accent text-accent-foreground')}
            >
              <span className="shrink-0 font-medium">{leaf(m.path)}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground"><Highlighted match={m} /></span>
            </li>
          ))}
          {list && matches.length === 0 && <li className="p-2 text-sm text-muted-foreground" role="presentation">No matching files.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
