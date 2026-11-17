import type { EditorHost, ThemeDefinition } from './EditorHost';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const hex2 = (n: number) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');

/** oklch → sRGB, per Björn Ottosson's OKLab matrices. `l` 0..1, `c` chroma, `h` degrees. */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
  return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2])];
}

/**
 * A CSS colour as Monaco's `#rrggbb[aa]`. Handles `#hex`, `rgb()/rgba()` and `oklch()` (cc's tokens) directly; anything else
 * goes through a canvas where one exists. Undefined when the value cannot be read.
 */
export function toHex(css: string): string | undefined {
  const v = css.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i.exec(v);
  if (ok) {
    const l = Number(ok[1]) / (ok[2] ? 100 : 1);
    const [r, g, b] = oklchToRgb(l, Number(ok[3]), Number(ok[4]));
    const alpha = ok[5] === undefined ? 1 : Number(ok[5]) / (ok[6] ? 100 : 1);
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha < 1 ? hex2(alpha) : ''}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(v);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
    return `#${hex2(Number(rgb[1]) / 255)}${hex2(Number(rgb[2]) / 255)}${hex2(Number(rgb[3]) / 255)}${alpha < 1 ? hex2(alpha) : ''}`;
  }
  return viaCanvas(v);
}

function viaCanvas(v: string): string | undefined {
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.fillStyle = '#000';
    ctx.fillStyle = v;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${hex2(r / 255)}${hex2(g / 255)}${hex2(b / 255)}${a < 255 ? hex2(a / 255) : ''}`;
  } catch {
    return undefined;
  }
}

const token = (name: string): string | undefined => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return raw ? toHex(raw) : undefined;
};

/** The Monaco theme for cc's current palette tokens. Tokens that cannot be read are left to the base theme. */
export function buildMonacoTheme(dark: boolean): ThemeDefinition {
  const t = (name: string) => token(name);
  const background = t('--background');
  const foreground = t('--foreground');
  const muted = t('--muted');
  const mutedForeground = t('--muted-foreground');
  const border = t('--border');
  const primary = t('--primary');
  const accent = t('--accent');
  const popover = t('--popover');
  const popoverForeground = t('--popover-foreground');
  const ring = t('--ring');
  const destructive = t('--destructive');
  const withAlpha = (hex: string | undefined, alpha: string) => (hex ? hex.slice(0, 7) + alpha : undefined);
  const entries: [string, string | undefined][] = [
    ['editor.background', background],
    ['editor.foreground', foreground],
    ['editorLineNumber.foreground', mutedForeground],
    ['editorLineNumber.activeForeground', foreground],
    ['editor.selectionBackground', withAlpha(primary, '40')],
    ['editor.inactiveSelectionBackground', withAlpha(primary, '22')],
    ['editor.lineHighlightBackground', muted],
    ['editorCursor.foreground', primary],
    ['editorWidget.background', popover],
    ['editorWidget.foreground', popoverForeground],
    ['editorWidget.border', border],
    ['editorGutter.background', background],
    ['editorIndentGuide.background1', border],
    ['editorWhitespace.foreground', border],
    ['scrollbarSlider.background', withAlpha(mutedForeground, '33')],
    ['scrollbarSlider.hoverBackground', withAlpha(mutedForeground, '55')],
    ['focusBorder', ring],
    ['diffEditor.insertedTextBackground', withAlpha(dark ? '#3fb950' : '#1a7f37', '33')],
    ['diffEditor.removedTextBackground', withAlpha(destructive, '33')],
    ['diffEditor.insertedLineBackground', withAlpha(dark ? '#3fb950' : '#1a7f37', '1a')],
    ['diffEditor.removedLineBackground', withAlpha(destructive, '1a')],
    ['diffEditor.border', border],
    ['editorOverviewRuler.border', border],
    ['list.hoverBackground', accent],
  ];
  const colors: Record<string, string> = {};
  for (const [k, v] of entries) if (v) colors[k] = v;
  return { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [], colors };
}

/** Applies the theme for the page's current light/dark state. */
export const applyMonacoTheme = (host: EditorHost, dark: boolean): void => host.applyTheme(buildMonacoTheme(dark));
