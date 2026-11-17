export type FuzzyMatch = { path: string; score: number; indices: number[] };

const isBoundary = (s: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = s[i - 1];
  const cur = s[i];
  if (prev === '/' || prev === '-' || prev === '_' || prev === '.' || prev === ' ') return true;
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase();
};

/**
 * Subsequence match of `query` in `path` (case-insensitive), scored for consecutive runs, hits in the file's basename
 * and word-boundary / camelCase starts. Null when `query` is not a subsequence. Greedy per start position, best start kept.
 */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  if (q === '') return { path, score: 0, indices: [] };
  const baseStart = path.lastIndexOf('/') + 1;
  let best: FuzzyMatch | null = null;
  for (let start = p.indexOf(q[0]); start !== -1; start = p.indexOf(q[0], start + 1)) {
    const indices: number[] = [];
    let score = 0;
    let at = start;
    let ok = true;
    for (let qi = 0; qi < q.length; qi++) {
      const found = qi === 0 ? at : p.indexOf(q[qi], at);
      if (found === -1) { ok = false; break; }
      let s = 1;
      if (qi > 0 && found === at) s += 5; // consecutive run
      if (isBoundary(path, found)) s += 4;
      if (found >= baseStart) s += 3; // in the basename
      indices.push(found);
      score += s;
      at = found + 1;
    }
    if (!ok) break; // a later start cannot match either
    score -= (path.length - q.length) * 0.01; // shorter paths first on ties
    score -= (indices[indices.length - 1] - indices[0] - (q.length - 1)) * 0.2; // tighter spans first
    if (!best || score > best.score) best = { path, score, indices };
  }
  return best;
}

/** The best `limit` matches, best first (ties alphabetical). */
export function rank(query: string, paths: readonly string[], limit = 100): FuzzyMatch[] {
  const out: FuzzyMatch[] = [];
  for (const p of paths) {
    const m = fuzzyMatch(query, p);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out.slice(0, limit);
}
