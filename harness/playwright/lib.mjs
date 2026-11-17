// Shared scenario helpers. `app` is the page (standalone) or the plugin's frame locator (embedded); both take getByRole.
import fs from 'node:fs';
import path from 'node:path';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const row = (app, name) => app.getByRole('treeitem', { name: new RegExp(`^${escapeRe(name)}(?=\\s|$)`) });
export const rowButton = (app, name) => app.getByRole('button', { name, exact: true });
export const editor = (app) => app.locator('.monaco-editor').first();
export const dirtyDot = (app) => app.getByRole('img', { name: 'unsaved changes', exact: true });

/** Clicks a tree file/folder row's button and (for a file) waits for the editor. */
export async function openFromTree(app, name) {
  await rowButton(app, name).click();
  await editor(app).waitFor();
}

/** Types at the start of the focused editor (Ctrl+Home first) and waits for the dirty mark. */
export async function typeAtStart(page, app, text) {
  await editor(app).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type(text);
  await dirtyDot(app).waitFor();
}

export const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Waits until Monaco has tokenised the visible lines (syntax colours are applied). */
export async function waitTokens(app) {
  await app.locator('.view-line span[class*="mtk"]').nth(3).waitFor();
}
