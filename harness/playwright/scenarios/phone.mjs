// A 390×844 touch device: Files sheet, long-press a row for the menu, open + type + Save button, Search sheet, quick open.
import { dirtyDot, editor, read, row } from '../lib.mjs';

export const options = { context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };

export default async function ({ page, context, url, app, world, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await app.getByRole('button', { name: 'Files', exact: true }).waitFor();
  check(await app.getByRole('tree').count() === 0, 'no sidebar on a phone: the tree is behind the Files button');
  await shot('empty');

  await app.getByRole('button', { name: 'Files', exact: true }).tap();
  await row(app, 'notes.txt').waitFor();
  await page.waitForTimeout(600); // the sheet slides in
  await shot('files-sheet');

  // A long press: touch down, hold past Radix's long-press delay, release.
  const box = await row(app, 'README.md').boundingBox();
  const cdp = await context.newCDPSession(page);
  const point = [{ x: box.x + 60, y: box.y + box.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  await page.waitForTimeout(900);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const menuShown = await app.getByRole('menuitem', { name: 'Rename', exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false);
  if (menuShown) { await shot('long-press-menu'); await page.keyboard.press('Escape'); }
  check(menuShown, 'long-pressing a row opens its menu');

  await app.getByRole('button', { name: 'Actions for README.md', exact: true }).tap();
  await app.getByRole('menuitem', { name: 'Delete', exact: true }).waitFor();
  check(true, 'the ⋮ button opens the menu on touch');
  await page.keyboard.press('Escape');

  await app.getByRole('button', { name: 'notes.txt', exact: true }).tap();
  await editor(app).waitFor();
  await app.getByRole('tree').waitFor({ state: 'detached' });
  check(true, 'opening a file closes the Files sheet');
  await editor(app).tap();
  await page.keyboard.type('PHONE ');
  await dirtyDot(app).waitFor();
  await shot('editing');
  await app.getByRole('button', { name: 'Save file', exact: true }).tap();
  await dirtyDot(app).waitFor({ state: 'detached' });
  check(read(world.trees.app, 'notes.txt').includes('PHONE '), 'the Save button saved the edit');

  await app.getByRole('button', { name: 'Search', exact: true }).tap();
  await app.getByRole('textbox', { name: 'Search query', exact: true }).fill('needle');
  await page.keyboard.press('Enter');
  await app.getByText(/matches? in \d+ files?/).waitFor();
  await shot('search-sheet');
  await page.keyboard.press('Escape');

  await app.getByRole('button', { name: 'Quick open', exact: true }).tap();
  await app.getByRole('combobox', { name: 'Find file', exact: true }).waitFor();
  await shot('quick-open');
}
