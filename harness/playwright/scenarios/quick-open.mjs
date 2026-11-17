// Ctrl+P, fuzzy query, Enter opens the file.
import { editor, row } from '../lib.mjs';

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await row(app, 'README.md').waitFor();
  await page.keyboard.press('Control+p');
  const input = app.getByRole('combobox', { name: 'Find file', exact: true });
  await input.waitFor();
  await app.getByRole('option').first().waitFor();
  await input.fill('utl');
  await shot('fuzzy');
  const first = app.getByRole('option').first();
  check((await first.textContent()).includes('util.ts'), 'the fuzzy query ranks src/lib/util.ts first');
  await page.keyboard.press('Enter');
  await editor(app).waitFor();
  await app.getByRole('combobox').waitFor({ state: 'detached' }); // while a modal closes, the page behind it is still aria-hidden
  check(await app.getByRole('tab', { name: 'util.ts' }).count() === 1, 'Enter opened the file and closed quick open');
  await shot('opened');
}
