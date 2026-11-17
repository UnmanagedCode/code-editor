import { describe, expect, it } from 'vitest';
import { languageForPath, type LanguageInfo } from './language';

const LANGS: LanguageInfo[] = [
  { id: 'typescript', extensions: ['.ts', '.tsx', '.mts'] },
  { id: 'javascript', extensions: ['.js'] },
  { id: 'markdown', extensions: ['.md'] },
  { id: 'dockerfile', filenames: ['Dockerfile'], extensions: ['.dockerfile'] },
  { id: 'makefile', filenames: ['Makefile', 'makefile'], extensions: ['.mk'] },
  { id: 'shell', filenamePatterns: ['.env.*'], extensions: ['.sh'] },
  { id: 'json', extensions: ['.json'] },
  { id: 'jsonc', filenames: ['tsconfig.json'] },
  { id: 'handlebars', extensions: ['.d.ts.map', '.hbs'] },
];

describe('languageForPath', () => {
  it('matches exact file names (Dockerfile, Makefile) in any directory', () => {
    expect(languageForPath('Dockerfile', LANGS)).toBe('dockerfile');
    expect(languageForPath('build/Makefile', LANGS)).toBe('makefile');
  });

  it('a file name beats an extension (tsconfig.json is jsonc, not json)', () => {
    expect(languageForPath('tsconfig.json', LANGS)).toBe('jsonc');
    expect(languageForPath('package.json', LANGS)).toBe('json');
  });

  it('matches file-name patterns', () => {
    expect(languageForPath('config/.env.local', LANGS)).toBe('shell');
  });

  it('matches extensions case-insensitively and prefers the longest', () => {
    expect(languageForPath('src/Main.TS', LANGS)).toBe('typescript');
    expect(languageForPath('types/a.d.ts.map', LANGS)).toBe('handlebars');
  });

  it('falls back to plaintext for unknown or extensionless names', () => {
    expect(languageForPath('notes.unknownext', LANGS)).toBe('plaintext');
    expect(languageForPath('LICENSE', LANGS)).toBe('plaintext');
    expect(languageForPath('.ts', LANGS)).toBe('plaintext'); // a dotfile named like an extension has no stem
  });
});
