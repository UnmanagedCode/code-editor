// The filterable root picker: workspace groups, worktree-aware filter, current-root mark, keyboard-only pick.
import { row } from '../lib.mjs';

export default async function ({ page, url, app, shot, check }) {
  const filter = app.getByRole('textbox', { name: 'Filter projects', exact: true });
  const header = app.getByRole('button', { name: /Switch root/ });

  await page.goto(`${url}/`);
  await filter.waitFor();
  await app.getByRole('region', { name: 'team', exact: true }).waitFor();
  check(await app.getByRole('region', { name: 'team', exact: true }).count() === 1, 'a "team" workspace section');
  check(await app.getByRole('region', { name: 'No workspace', exact: true }).count() === 1, 'and a "No workspace" section');
  check(await app.getByRole('button', { name: /^gone/ }).isDisabled(), 'an unreachable project is disabled');
  check(await app.getByText('provider died').count() === 1, 'with its reason');
  await shot('landing');

  await filter.fill('wt1');
  check(await app.getByRole('button', { name: 'Show worktrees of app', exact: true }).getAttribute('aria-expanded') === 'true', 'a worktree-only match shows its project expanded');
  const list = app.getByRole('list', { name: 'Checkouts of app', exact: true });
  check((await list.textContent()).includes('code-conductor/wt1'), 'with the worktree and its branch');
  check(await app.getByRole('button', { name: /^box/ }).count() === 0, 'and the other projects hidden');
  await shot('filtered-worktree');

  await list.getByRole('button', { name: /^wt1/ }).click();
  await row(app, 'wt-only.txt').waitFor();
  check((await header.textContent()).includes('app / wt1'), 'picking the worktree opens it');

  await header.click();
  const dialog = app.getByRole('dialog');
  const dialogFilter = dialog.getByRole('textbox', { name: 'Filter projects', exact: true });
  await dialogFilter.waitFor();
  await dialog.getByRole('button', { name: /^wt1/ }).waitFor();
  check(await dialogFilter.evaluate((el) => el === el.ownerDocument.activeElement), 'the dialog filter has focus');
  check(await dialog.getByRole('button', { name: /^wt1/ }).getAttribute('aria-current') === 'true', 'the open worktree is marked current');
  check(await dialog.getByRole('button', { name: 'Show worktrees of app', exact: true }).getAttribute('aria-expanded') === 'true', 'and its project is pre-expanded');
  await shot('dialog-current');

  await dialogFilter.fill('zzz');
  await dialog.getByText('No project matches.').waitFor();
  await shot('no-match');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  check((await header.textContent()).includes('app / wt1'), 'Escape closes the dialog with the root unchanged');

  await header.click();
  await dialogFilter.waitFor();
  await dialogFilter.fill('box');
  const boxName = dialog.getByRole('button', { name: /^box/ });
  for (let i = 0; i < 6 && !(await boxName.evaluate((el) => el === el.ownerDocument.activeElement)); i++) await page.keyboard.press('Tab');
  check(await boxName.evaluate((el) => el === el.ownerDocument.activeElement), 'Tab reaches the box name button');
  await page.keyboard.press('Enter');
  await row(app, 'README.md').waitFor();
  check((await header.textContent()).includes('box') && (await header.textContent()).includes('docker · box'), 'Enter picked box, with its System badge');
}
