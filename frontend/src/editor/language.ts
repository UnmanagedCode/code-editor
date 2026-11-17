export type LanguageInfo = { id: string; extensions?: string[]; filenames?: string[]; filenamePatterns?: string[] };

const globToRegExp = (glob: string): RegExp => {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`, 'i');
};

/**
 * The language id for a file path from Monaco's registered languages: exact file name, then file-name pattern, then the
 * longest matching extension (case-insensitive), else 'plaintext'.
 */
export function languageForPath(path: string, languages: readonly LanguageInfo[]): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const lower = name.toLowerCase();
  for (const l of languages) if (l.filenames?.some((f) => f === name || f.toLowerCase() === lower)) return l.id;
  for (const l of languages) if (l.filenamePatterns?.some((p) => globToRegExp(p).test(name))) return l.id;
  let best: { id: string; len: number } | null = null;
  for (const l of languages) {
    for (const ext of l.extensions ?? []) {
      if (lower.endsWith(ext.toLowerCase()) && lower.length > ext.length && (!best || ext.length > best.len)) best = { id: l.id, len: ext.length };
    }
  }
  return best?.id ?? 'plaintext';
}
