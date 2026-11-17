// The root picker on a touch phone: opening it does not raise the soft keyboard; filter and pick by tap.
export const options = { context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await app.getByRole('button', { name: 'Files', exact: true }).waitFor();
  // Record every focus the document receives from before the tap, so a transient focus on the filter is caught too.
  await page.evaluate(() => {
    window.__focused = [];
    document.addEventListener('focusin', (e) => window.__focused.push(e.target.getAttribute('aria-label') ?? e.target.tagName), true);
  });
  await app.getByRole('button', { name: /Switch root/ }).tap();
  const dialog = app.getByRole('dialog');
  const filter = dialog.getByRole('textbox', { name: 'Filter projects', exact: true });
  await filter.waitFor();
  await page.waitForTimeout(400);
  check(!(await filter.evaluate((el) => el === el.ownerDocument.activeElement)), 'the filter is not focused on open, so no soft keyboard');
  check(!(await page.evaluate(() => window.__focused.includes('Filter projects'))), 'the filter never received focus while opening');
  const dlg = await dialog.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  check(dlg[0] <= dlg[1], 'long names do not overflow the dialog horizontally');
  const listFits = () => dialog.locator('[data-slot="root-list"]').evaluate((el) => el.scrollWidth <= el.clientWidth);
  check(await listFits(), 'nor does the list scroller (long project name)');
  await shot('phone-dialog');
  await dialog.getByRole('button', { name: 'Show worktrees of app', exact: true }).tap();
  await dialog.getByRole('list', { name: 'Checkouts of app', exact: true }).waitFor();
  check(await listFits(), 'nor with the long worktree and branch row expanded');
  check((await dialog.evaluate((el) => [el.scrollWidth, el.clientWidth])).reduce((a, b) => a <= b), 'the dialog still fits with it expanded');
  await shot('phone-expanded');

  await filter.tap();
  await page.keyboard.type('box');
  await dialog.getByRole('button', { name: /^box/ }).tap();
  await dialog.waitFor({ state: 'detached' });
  const header = await app.getByRole('button', { name: /Switch root/ }).textContent();
  check(header.includes('box') && header.includes('docker · box'), 'tapping box opens it');
  await shot('phone-picked');
}
