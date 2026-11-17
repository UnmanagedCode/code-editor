// A controllable window.matchMedia: tests flip `media` to a phone or a touch device, then render.
export const media = { narrow: false, coarse: false };

const evaluate = (query: string): boolean => {
  if (query.includes('min-width: 48rem') || query.includes('min-width: 768px')) return !media.narrow;
  if (query.includes('any-pointer: coarse') || query.includes('pointer: coarse')) return media.coarse;
  if (query.includes('hover: none')) return media.coarse;
  return false;
};

export function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() { return evaluate(query); },
    onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
