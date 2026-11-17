// The root picker on a touch phone: opening it does not raise the soft keyboard; filter and pick by tap.
export const options = { context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?project=app`);
  await app.getByRole('button', { name: 'Files', exact: true }).waitFor();
  await app.getByRole('button', { name: /Switch root/ }).tap();
  const dialog = app.getByRole('dialog');
  const filter = dialog.getByRole('textbox', { name: 'Filter projects', exact: true });
  await filter.waitFor();
  await page.waitForTimeout(400);
  check(!(await filter.evaluate((el) => el === el.ownerDocument.activeElement)), 'the filter is not focused on open, so no soft keyboard');
  await shot('phone-dialog');

  await filter.tap();
  await page.keyboard.type('box');
  await dialog.getByRole('button', { name: /^box/ }).tap();
  await dialog.waitFor({ state: 'detached' });
  const header = await app.getByRole('button', { name: /Switch root/ }).textContent();
  check(header.includes('box') && header.includes('docker · box'), 'tapping box opens it');
  await shot('phone-picked');
}
