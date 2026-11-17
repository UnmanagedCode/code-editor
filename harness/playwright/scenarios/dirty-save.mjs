// Edit → dirty mark → Ctrl+S → clean, and the file on disk has the typed text.
import fs from 'node:fs';
import path from 'node:path';
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

  // Bytes survive the editor: a BOM (Monaco drops it from the buffer) and CRLF line endings.
  await openFromTree(app, 'bom.txt');
  await typeAtStart(page, app, 'X');
  await page.keyboard.press('Control+s');
  await dirtyDot(app).waitFor({ state: 'detached' });
  const bom = fs.readFileSync(path.join(world.trees.app, 'bom.txt'));
  check(bom.equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Xbom text\n')])), 'a BOM file keeps its BOM after an edit and save');
  await openFromTree(app, 'crlf.txt');
  await typeAtStart(page, app, 'X');
  await page.keyboard.press('Control+s');
  await dirtyDot(app).waitFor({ state: 'detached' });
  check(fs.readFileSync(path.join(world.trees.app, 'crlf.txt')).equals(Buffer.from('Xone\r\ntwo\r\n')), 'a CRLF file keeps its line endings after an edit and save');
}
