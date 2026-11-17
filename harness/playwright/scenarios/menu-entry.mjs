// cc's ⋮ menu items: ?ccProject/ccWorktree on load and via cc's navigate message, under the /plugins/code-editor prefix.
import { row } from '../lib.mjs';

export const options = { embedded: true };

export default async function ({ page, url, app, shot, check }) {
  const frame = () => page.frames().find((f) => f.url().includes('/plugins/code-editor/'));
  await page.goto(`${url}/`);
  await app.getByRole('textbox', { name: 'Filter projects', exact: true }).waitFor();
  check(true, 'no root yet: the picker is shown');

  // cc's navigate (replace + popstate) for a worktree row's ⋮ "Edit files".
  await page.evaluate(() => document.querySelector('#plugin').contentWindow.postMessage({ cc: 1, type: 'navigate', path: '/?ccProject=app&ccWorktree=wt1' }, location.origin));
  await row(app, 'wt-only.txt').waitFor();
  check((await app.getByRole('button', { name: /Switch root/ }).textContent()).includes('app / wt1'), 'the worktree root is shown as "app / wt1"');
  check(frame().url().endsWith('?project=app&worktree=wt1'), 'the cc keys were replaced by the route in the URL');
  await shot('worktree');

  await page.reload();
  await page.frames().find((f) => f.url().includes('/plugins/code-editor/')) ?? await page.waitForEvent('framenavigated');
  await row(app, 'wt-only.txt').waitFor();
  check(true, 'reloading the page keeps the same root');

  // And on load: the project row's ⋮ opens ?ccProject=app.
  await page.goto(`${url}/?plugin=${encodeURIComponent('/plugins/code-editor/?ccProject=app')}`);
  await row(app, 'README.md').waitFor();
  check((await app.getByRole('button', { name: /Switch root/ }).textContent()).trim().startsWith('app'), 'ccProject on load opens the project');
  await shot('project');
}
