import { describe, expect, it, vi } from 'vitest';
import { makeFakeHost } from '@/test/fakeEditorHost';
import { applyMonacoTheme, buildMonacoTheme, toHex } from './monacoTheme';

describe('toHex', () => {
  it('converts cc’s oklch tokens to #rrggbb (black, white, and a mid colour)', () => {
    expect(toHex('oklch(0 0 0)')).toBe('#000000');
    expect(toHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(toHex('oklch(0.66 0.17 38)')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('carries oklch alpha as a trailing byte', () => {
    expect(toHex('oklch(1 0 0 / 50%)')).toMatch(/^#ffffff[0-9a-f]{2}$/);
  });

  it('passes hex and rgb() through', () => {
    expect(toHex('#ABCDEF')).toBe('#abcdef');
    expect(toHex('#fff')).toBe('#ffffff');
    expect(toHex('rgb(255, 0, 0)')).toBe('#ff0000');
  });

  it('is undefined for a value it cannot read', () => {
    expect(toHex('not a colour')).toBeUndefined();
  });
});

describe('monaco theme', () => {
  it('builds a vs-dark theme for dark and a vs theme for light, from the page’s tokens', () => {
    document.documentElement.style.setProperty('--background', 'oklch(0.2 0 0)');
    expect(buildMonacoTheme(true).base).toBe('vs-dark');
    expect(buildMonacoTheme(false).base).toBe('vs');
    expect(buildMonacoTheme(true).colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/);
    document.documentElement.style.removeProperty('--background');
  });

  it('applies the theme through the host for the current mode', () => {
    const fake = makeFakeHost();
    applyMonacoTheme(fake.host, true);
    applyMonacoTheme(fake.host, false);
    expect(fake.themes.map((t) => t.base)).toEqual(['vs-dark', 'vs']);
  });

  it('an unreadable token leaves that colour out rather than emitting garbage', () => {
    document.documentElement.style.setProperty('--ring', 'not-a-colour');
    const theme = buildMonacoTheme(false);
    expect(theme.colors.focusBorder).toBeUndefined();
    document.documentElement.style.removeProperty('--ring');
    vi.restoreAllMocks();
  });
});
