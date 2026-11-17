import { CaseSensitiveIcon, LoaderCircleIcon, RegexIcon, SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { endpoints, type SearchResult, type Target } from '@/lib/endpoints';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const ENGINE_LABEL = { rg: 'ripgrep', git: 'git grep' } as const;

/** Search across the project: query, Regex and Match-case toggles, results grouped by file; a result opens the file at its line. */
export function SearchPanel({ target, onOpen }: { target: Target; onOpen: (path: string, line: number) => void }) {
  const [q, setQ] = useState('');
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [state, setState] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'done'; result: SearchResult } | { status: 'error'; error: ApiError }>({ status: 'idle' });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    if (q === '') return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setState({ status: 'loading' });
    setCollapsed(new Set());
    try {
      const result = await endpoints.search(target, q, { regex, matchCase }, c.signal);
      if (!c.signal.aborted) setState({ status: 'done', result });
    } catch (e) {
      if (!c.signal.aborted) setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError(0, String(e)) });
    }
  };

  const toggle = (path: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="flex items-center gap-1 p-2" role="search" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Input aria-label="Search query" placeholder="Search in files" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className="min-w-0 flex-1" />
        <Button type="button" variant={regex ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Regex" aria-pressed={regex} onClick={() => setRegex((v) => !v)}><RegexIcon /></Button>
        <Button type="button" variant={matchCase ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Match case" aria-pressed={matchCase} onClick={() => setMatchCase((v) => !v)}><CaseSensitiveIcon /></Button>
        <Button type="submit" variant="outline" size="icon-sm" aria-label="Search" disabled={q === '' || state.status === 'loading'}>
          {state.status === 'loading' ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 text-sm">
        {state.status === 'error' && <p role="alert" className="p-1 text-destructive">{state.error.message}</p>}
        {state.status === 'done' && (
          <>
            <p className="px-1 pb-1 text-xs text-muted-foreground">
              {state.result.total} {state.result.total === 1 ? 'match' : 'matches'} in {state.result.files.length} {state.result.files.length === 1 ? 'file' : 'files'} · {ENGINE_LABEL[state.result.engine]}
            </p>
            {state.result.truncated && <p className="px-1 pb-1 text-xs text-warning">Showing the first {state.result.limit} results; refine the search.</p>}
            {state.result.files.length === 0 && <p className="p-1 text-muted-foreground">No results.</p>}
            {state.result.files.map((f) => (
              <div key={f.path}>
                <button type="button" aria-expanded={!collapsed.has(f.path)} onClick={() => toggle(f.path)} className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left font-medium hover:bg-accent/60">
                  <span className="min-w-0 flex-1 truncate" title={f.path}>{f.path}</span>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{f.matches.length}</span>
                </button>
                {!collapsed.has(f.path) && f.matches.map((m, i) => (
                  <button key={i} type="button" onClick={() => onOpen(f.path, m.line)} className={cn('flex w-full gap-2 rounded-md py-1 pl-4 pr-1 text-left hover:bg-accent/60')}>
                    <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{m.line}:</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs leading-5">{m.text}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
