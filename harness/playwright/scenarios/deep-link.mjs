// Deep links (`ccPath`/`ccLine`/`ccEndLine`) as cc opens them: on load and via cc's navigate into the open page, same-root
// re-reveal, a worktree whose path ties with another (resolved by the active session), and an unmatched path.
import { editor } from '../lib.mjs';
import { SESSION } from '../host.mjs';

export const options = { embedded: true };

const subpath = (abs, line, end) => `/?ccPath=${encodeURIComponent(abs)}&ccLine=${line}${end ? `&ccEndLine=${end}` : ''}`;

export default async function ({ page, url, app, world, shot, check }) {
  const navigate = (path) => page.evaluate((p) => document.querySelector('#plugin').contentWindow.postMessage({ cc: 1, type: 'navigate', path: p }, location.origin), path);
  const frameUrl = () => page.frames().find((f) => f.url().includes('/plugins/code-editor/')).url();
  const highlighted = app.locator('.cc-ref-highlight');
  const tabs = app.getByRole('tablist', { name: 'Open files' }).getByRole('tab');

  await page.goto(`${url}/?plugin=${encodeURIComponent(`/plugins/code-editor${subpath(`${world.trees.app}/src/main.ts`, 9, 12)}`)}`);
  await editor(app).waitFor();
  await highlighted.first().waitFor();
  check(await highlighted.count() === 4, 'lines 9–12 are highlighted');
  check((await app.getByRole('button', { name: /Switch root/ }).textContent()).trim().startsWith('app'), 'the link opened project app');
  check(frameUrl().endsWith('?project=app&file=src%2Fmain.ts'), 'the cc keys were replaced by the route');
  await shot('on-load');

  await navigate(subpath(`${world.trees.app}/many.txt`, 400, 402));
  await app.getByText('repeat-400 some filler text', { exact: true }).waitFor();
  check(await tabs.count() === 2, 'same root: the earlier tab is still open (no remount)');
  await page.waitForTimeout(200);
  check(await highlighted.count() === 3, 'lines 400–402 are highlighted');
  await shot('same-root');

  await editor(app).click();
  await page.keyboard.press('Control+Home');
  await app.getByText('repeat-1 some filler text', { exact: true }).waitFor();
  check(await highlighted.count() === 0, 'the highlighted lines are scrolled out of view');
  await navigate(subpath(`${world.trees.app}/many.txt`, 400, 402));
  await app.getByText('repeat-400 some filler text', { exact: true }).waitFor();
  check(true, 'the same link again re-reveals the range');

  // wt1 and the long-named worktree share one directory: the active session (app / wt1) breaks the tie.
  await navigate(subpath(`${world.trees.wt}/src/wt.ts`, 1));
  await app.getByRole('button', { name: /Switch root/ }).filter({ hasText: `app / ${SESSION.worktree}` }).waitFor();
  await highlighted.first().waitFor();
  check(true, 'a tied worktree path opens in the active session’s worktree');
  await shot('worktree');

  await navigate('/?ccPath=%2Fnowhere%2F%3Cb%3Ex%3C%2Fb%3E.ts&ccLine=1');
  await app.getByText('No project contains /nowhere/<b>x</b>.ts', { exact: true }).waitFor();
  check((await app.getByRole('button', { name: /Switch root/ }).textContent()).includes('app / wt1'), 'an unmatched path leaves the open root alone');
  await shot('unmatched');
}
