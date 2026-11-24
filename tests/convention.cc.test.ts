// @vitest-environment node
// Gated (`CC_CHECKOUT=<code-conductor checkout> npm run test:cc`): cc's real fragment parser and manifest validator accept
// the plugin's conductor convention as it ships.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from 'cc-manifest'; // aliased to $CC_CHECKOUT/src/plugins/manifest.ts by frontend/vitest.cc.config.ts
import { splitSkillPart } from 'cc-skill-part'; // aliased to $CC_CHECKOUT/shared/skillPart.ts
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'conductor.plugin.json'), 'utf8'));
const [convention] = manifest.conventions;
/** The two calls readManifest makes of a System, served from this checkout. */
const localSystem = {
  readFile: (p: string) => fs.readFile(p, 'utf8'),
  stat: (p: string) => fs.stat(p).then(() => ({}), () => null),
};

describe('the code-links conductor convention under cc’s own parsers', () => {
  // Invariant: the fragment splits into a non-empty inline part carrying the link template, and a non-empty skill body.
  it('splitSkillPart gives a non-empty inline part with the URL template and a non-empty skill body', async () => {
    const parts = splitSkillPart(await fs.readFile(path.join(root, convention.file), 'utf8'));
    expect(parts.inline.length).toBeGreaterThan(0);
    expect(parts.inline).toContain('http://cc.internal/#plugin/code-editor/?ccPath=');
    expect(parts.skill?.description.length).toBeGreaterThan(0);
    expect(parts.skill?.body.length).toBeGreaterThan(0);
  });

  // Invariant: cc's manifest loader (shape validation plus the fragment-file and skill-marker check) accepts the manifest with the convention.
  it('readManifest accepts the manifest and keeps the conductor convention', async () => {
    const result = await readManifest(localSystem as never, root);
    expect(result).not.toBeNull();
    expect(result && 'errors' in result ? result.errors : []).toEqual([]);
    expect(result && 'manifest' in result ? result.manifest.conventions : null).toEqual([expect.objectContaining({ slug: 'code-links', scope: 'conductor', file: 'conventions/code-links.md' })]);
  });
});
