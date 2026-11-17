// Expand a folder, open a TypeScript file (syntax colours), toggle "Show ignored", and see an outside symlink greyed.
import { editor, openFromTree, row, rowButton, waitTokens } from '../lib.mjs';

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await row(app, 'README.md').waitFor();
  check(await row(app, 'src').getAttribute('aria-expanded') === 'false', 'folders start collapsed');
  await rowButton(app, 'src').click();
  await row(app, 'main.ts').waitFor();
  await openFromTree(app, 'main.ts');
  await waitTokens(app);
  check(await app.getByRole('tab', { name: 'main.ts' }).count() === 1, 'main.ts opened in a tab');
  check((await page.evaluate(() => location.search)).includes('file=src%2Fmain.ts'), 'the URL carries the open file');
  await shot('open-file');

  check(await row(app, 'ignored.txt').count() === 0, 'ignored files are hidden by default');
  await app.getByRole('switch', { name: 'Show ignored' }).click();
  await row(app, 'ignored.txt').waitFor();
  check(await row(app, 'build').count() === 1 && await row(app, 'debug.log').count() === 1, 'Show ignored reveals ignored entries');
  const out = row(app, 'out');
  check(await out.getAttribute('aria-disabled') === 'true', 'a symlink to outside the root is disabled');
  check((await out.textContent()).includes('points outside the root'), 'and says why');
  check(await row(app, '.git').count() === 0, '.git is never listed');
  await shot('show-ignored');
  check(await editor(app).count() >= 1, 'the editor is still mounted');
}
