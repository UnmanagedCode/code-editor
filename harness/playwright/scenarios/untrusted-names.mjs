// Hostile names and content are text everywhere: tree, tab, quick-open, search results. A JS dialog fails the run (run.mjs).
import { editor, row, rowButton } from '../lib.mjs';

export default async function ({ page, url, app, world, shot, check }) {
  const name = world.hostileName;
  await page.goto(`${url}/?project=app`);
  await row(app, name).waitFor();
  check((await row(app, name).textContent()).includes(name), 'the hostile name is shown literally in the tree');
  await rowButton(app, name).click();
  await editor(app).waitFor();
  check((await app.getByRole('tab', { name: new RegExp('onerror') }).textContent()).includes('<img src=x'), 'and in the tab');

  await page.keyboard.press('Control+p');
  await app.getByRole('combobox', { name: 'Find file', exact: true }).fill('onerror');
  await app.getByRole('option').first().waitFor();
  check((await app.getByRole('option').first().textContent()).includes(name), 'and in quick open');
  await shot('quick-open');
  await page.keyboard.press('Escape');

  await app.getByRole('tab', { name: 'Search', exact: true }).click();
  await app.getByRole('textbox', { name: 'Search query', exact: true }).fill('onerror');
  await page.keyboard.press('Enter');
  await app.getByText('hostile-content.txt').first().waitFor();
  check(await app.getByText('x <img src=x onerror=alert(1)> <script>alert(2)</script>', { exact: true }).count() === 1, 'and a hostile snippet in search results');
  await shot('search');
  check(await page.locator('img[src="x"]').count() === 0 && await page.locator('body script:not([src])').count() === 0, 'no element was created from the text');
  await page.waitForTimeout(300); // an onerror would have fired by now
}
