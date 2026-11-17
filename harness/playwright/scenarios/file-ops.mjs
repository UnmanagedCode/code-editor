// Context menu → New file; rename the folder holding an open tab (the tab follows); delete it with a dirty tab (warned).
import fs from 'node:fs';
import path from 'node:path';
import { dirtyDot, editor, openFromTree, row, rowButton, typeAtStart } from '../lib.mjs';

export default async function ({ page, url, app, world, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await row(app, 'src').waitFor();

  await row(app, 'src').click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'New file', exact: true }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('created.ts');
  await shot('new-file-dialog');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await editor(app).waitFor();
  await app.getByRole('dialog').waitFor({ state: 'detached' });
  check(fs.existsSync(path.join(world.trees.app, 'src/created.ts')), 'the file was created on disk');
  check(await app.getByRole('tab', { name: 'created.ts' }).count() === 1, 'and opened in a tab');
  check(await row(app, 'created.ts').count() === 1, 'and the tree shows it');

  await rowButton(app, 'lib').click();
  await openFromTree(app, 'util.ts');
  await typeAtStart(page, app, '// dirty ');

  await row(app, 'src').hover();
  await app.getByRole('button', { name: 'Actions for src', exact: true }).click();
  await app.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = app.getByRole('dialog');
  await rename.getByRole('textbox', { name: 'Name', exact: true }).fill('source');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await row(app, 'source').waitFor();
  await app.getByRole('dialog').waitFor({ state: 'detached' });
  check(fs.existsSync(path.join(world.trees.app, 'source/lib/util.ts')) && !fs.existsSync(path.join(world.trees.app, 'src')), 'the folder was renamed on disk');
  check(await app.getByRole('tab', { name: /util\.ts/ }).getAttribute('title') === 'source/lib/util.ts', 'the open tab followed the rename');
  check(await dirtyDot(app).count() === 1, 'and kept its unsaved change');
  await shot('renamed');

  await row(app, 'source').hover();
  await app.getByRole('button', { name: 'Actions for source', exact: true }).click();
  await app.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const del = app.getByRole('dialog');
  await del.getByText(/unsaved changes that will be lost/).waitFor();
  await shot('delete-dirty');
  await del.getByRole('button', { name: 'Delete and discard changes', exact: true }).click();
  await row(app, 'source').waitFor({ state: 'detached' });
  await app.getByRole('dialog').waitFor({ state: 'detached' });
  check(!fs.existsSync(path.join(world.trees.app, 'source')), 'the folder was deleted on disk');
  check(await app.getByRole('tab', { name: /util\.ts/ }).count() === 0, 'and its tab closed');
  await shot('deleted');
}
