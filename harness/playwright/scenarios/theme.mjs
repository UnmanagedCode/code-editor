// Embedded in a stand-in cc page with cc's real bridge: flipping the host's .dark flips the plugin and Monaco.
import { editor, waitTokens } from '../lib.mjs';

export const options = { embedded: true };

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?plugin=${encodeURIComponent('/plugins/code-editor/?project=app&file=src%2Fmain.ts')}`);
  await editor(app).waitFor();
  await waitTokens(app);
  const frameHtml = () => page.frames().find((f) => f.url().includes('/plugins/code-editor/')).evaluate(() => document.documentElement.className);
  check(!(await frameHtml()).includes('dark'), 'light host: the plugin is light');
  check((await editor(app).getAttribute('class')).includes('vs ') || !(await editor(app).getAttribute('class')).includes('vs-dark'), 'and Monaco uses a light theme');
  await shot('light');

  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForFunction(() => document.querySelector('#plugin').contentDocument.documentElement.classList.contains('dark'));
  await app.locator('.monaco-editor.vs-dark').waitFor();
  check(true, 'the host going dark made the plugin dark and Monaco vs-dark, live');
  await shot('dark');

  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await app.locator('.monaco-editor.vs').first().waitFor();
  check(!(await frameHtml()).includes('dark'), 'and back to light');
}
