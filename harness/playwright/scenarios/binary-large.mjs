// A binary file shows a placeholder; a file over the edit limit opens read-only with a notice.
import { editor, row, rowButton } from '../lib.mjs';

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await row(app, 'bin.dat').waitFor();
  await rowButton(app, 'bin.dat').click();
  await app.getByText('Binary file, 5 bytes', { exact: true }).waitFor();
  check(await app.locator('.monaco-editor').count() === 0, 'no editor for a binary file');
  await shot('binary');

  await rowButton(app, 'huge.txt').click();
  await app.getByText(/This file is \d+ bytes; showing the first \d+ bytes, read-only\./).waitFor();
  await editor(app).waitFor();
  check(await app.getByRole('tab', { name: /huge\.txt/ }).textContent().then((t) => t.includes('read-only')), 'the tab is marked read-only');
  await editor(app).click();
  await page.keyboard.type('x');
  check(await app.getByRole('img', { name: 'unsaved changes' }).count() === 0, 'typing into the truncated file changes nothing');
  await shot('too-large');
}
