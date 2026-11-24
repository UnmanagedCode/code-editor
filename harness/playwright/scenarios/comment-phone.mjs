// The Comment button on a phone (the editor context menu is not the touch path), inside cc.
import { editor } from '../lib.mjs';

export const options = { embedded: true, context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } };

export default async function ({ page, url, app, shot, check }) {
  await page.goto(`${url}/?plugin=${encodeURIComponent('/plugins/code-editor/?project=app&file=src%2Fmain.ts')}`);
  await editor(app).waitFor();
  await editor(app).tap();
  await page.keyboard.press('Control+A');
  const button = app.getByRole('button', { name: 'Comment on selection', exact: true });
  await button.waitFor();
  await shot('button');
  await button.tap();
  const dialog = app.getByRole('dialog', { name: 'Comment on selection' });
  await dialog.getByRole('combobox', { name: 'Send to' }).waitFor();
  check(await dialog.getByRole('combobox', { name: 'Send to' }).inputValue() === 's-app', 'the most recent session in this root is preselected (the active one works elsewhere)');
  await shot('dialog');
}
