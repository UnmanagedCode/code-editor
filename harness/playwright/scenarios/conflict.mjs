// A worker edits the file behind the editor: Ctrl+S → conflict bar → View diff (diff editor) → Overwrite.
import fs from 'node:fs';
import path from 'node:path';
import { dirtyDot, openFromTree, read, row, typeAtStart } from '../lib.mjs';

export default async function ({ page, url, app, world, shot, check, allow }) {
  allow(409, /\/api\/file/);
  await page.goto(`${url}/?project=app`);
  await row(app, 'notes.txt').waitFor();
  await openFromTree(app, 'notes.txt');
  await typeAtStart(page, app, 'MINE ');
  fs.writeFileSync(path.join(world.trees.app, 'notes.txt'), 'worker changed this\nsecond line\n');
  await page.keyboard.press('Control+s');
  const bar = app.getByText('This file changed on disk since you opened it.', { exact: true });
  await bar.waitFor();
  check(read(world.trees.app, 'notes.txt') === 'worker changed this\nsecond line\n', 'the worker’s version is untouched by the failed save');
  for (const name of ['View diff', 'Overwrite', 'Reload']) await app.getByRole('button', { name, exact: true }).waitFor();
  await shot('conflict-bar');

  await app.getByRole('button', { name: 'View diff', exact: true }).click();
  await app.locator('.monaco-diff-editor').waitFor();
  check(await app.getByText(/On disk \(left, read-only\)/).count() === 1, 'the diff is labelled disk vs buffer');
  await shot('diff');

  await app.getByRole('button', { name: 'Overwrite', exact: true }).click();
  await bar.waitFor({ state: 'detached' });
  await dirtyDot(app).waitFor({ state: 'detached' });
  check(read(world.trees.app, 'notes.txt').startsWith('MINE alpha'), 'Overwrite wrote the buffer');
  await shot('overwritten');
}
