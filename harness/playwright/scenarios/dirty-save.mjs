// Edit → dirty mark → Ctrl+S → clean, and the file on disk has the typed text.
import { dirtyDot, openFromTree, read, row, typeAtStart } from '../lib.mjs';

export default async function ({ page, url, app, world, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await row(app, 'notes.txt').waitFor();
  await openFromTree(app, 'notes.txt');
  check(await dirtyDot(app).count() === 0, 'a freshly opened file is clean');
  await typeAtStart(page, app, 'EDITED ');
  await shot('dirty');
  await page.keyboard.press('Control+s');
  await dirtyDot(app).waitFor({ state: 'detached' });
  check(read(world.trees.app, 'notes.txt').startsWith('EDITED alpha\n'), 'Ctrl+S wrote the typed text to disk');
  await page.keyboard.press('Control+z');
  await dirtyDot(app).waitFor();
  check(true, 'undoing after a save makes the buffer dirty again');
  await page.keyboard.press('Control+y');
  await shot('after-save');
}
