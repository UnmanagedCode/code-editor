// Search: regex + match-case toggles, grouped results, truncation notice, click a result → editor at that line.
import { editor, row } from '../lib.mjs';

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await row(app, 'README.md').waitFor();
  await app.getByRole('tab', { name: 'Search', exact: true }).click();
  const q = app.getByRole('textbox', { name: 'Search query', exact: true });

  await q.fill('ne+dle');
  await app.getByRole('button', { name: 'Regex', exact: true }).click();
  await app.getByRole('button', { name: 'Match case', exact: true }).click();
  await q.press('Enter');
  await app.getByText(/matches? in \d+ files?/).waitFor();
  check(await app.getByRole('button', { name: /src\/main\.ts/ }).count() === 1, 'results are grouped by file');
  check(await app.getByText('// needle here').count() === 1, 'the matching line is shown as text');
  await shot('regex-results');

  await app.getByRole('button', { name: 'Regex', exact: true }).click();
  await q.fill('repeat');
  await q.press('Enter');
  await app.getByText('Results were capped; refine the search.').waitFor();
  await shot('truncated');

  await q.fill('repeat-400 ');
  await q.press('Enter');
  await app.getByText('400:', { exact: true }).waitFor();
  await app.getByText('repeat-400 some filler text', { exact: true }).click();
  await editor(app).waitFor();
  await page.waitForTimeout(300);
  const visible = await app.locator('.view-lines').first().textContent();
  check(visible.includes('repeat-400'), 'clicking a result reveals its line in the editor');
  await shot('revealed');
}
