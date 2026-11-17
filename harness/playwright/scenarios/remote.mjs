// A remote-System project works like a local one and shows its System badge; an unreachable one is a refusal alert.
import fs from 'node:fs';
import path from 'node:path';
import { dirtyDot, openFromTree, read, row, typeAtStart } from '../lib.mjs';

export default async function ({ page, url, app, world, shot, check, allow }) {
  allow(502, /\/api\/list/);
  await page.goto(`${url}/?project=box`);
  await row(app, 'README.md').waitFor();
  check((await app.getByRole('button', { name: /Switch root/ }).textContent()).includes('docker · box'), 'the root shows its System badge');
  await openFromTree(app, 'README.md');
  await typeAtStart(page, app, 'REMOTE ');
  await page.keyboard.press('Control+s');
  await dirtyDot(app).waitFor({ state: 'detached' });
  check(read(world.trees.box, 'README.md').startsWith('REMOTE # App'), 'a save through a remote System reached the tree');
  check(!fs.existsSync(path.join(world.trees.box, '.code-editor-tmp')), 'no helper temp file is left');
  await shot('remote-open');

  await page.goto(`${url}/?project=down`);
  const alert = app.getByRole('alert').filter({ hasText: 'unreachable' });
  await alert.waitFor();
  check((await alert.textContent()).includes('down'), 'an unreachable System is an alert naming the root');
  check(await app.getByRole('treeitem').count() === 0, 'with no tree rows');
  check(await alert.getByRole('button', { name: 'Retry', exact: true }).count() === 1, 'and a Retry');
  await shot('unreachable');

  await page.goto(`${url}/`);
  await app.getByRole('list', { name: 'Projects', exact: true }).waitFor();
  check(await app.getByRole('button', { name: /^gone/ }).isDisabled(), 'a project cc reports unreachable is listed disabled');
  check(await app.getByText('provider died').count() === 1, 'with its reason');
  await shot('picker');
}
