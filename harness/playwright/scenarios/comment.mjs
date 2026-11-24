// Comment on selection inside cc: select, the header button, the editor context-menu action, the session picker's default
// (cc's active session), send through cc's real bridge, and the "Sent to" status.
import { editor } from '../lib.mjs';
import { SESSION } from '../host.mjs';

export const options = { embedded: true };

export default async function ({ page, url, app, world, shot, check }) {
  await page.goto(`${url}/?plugin=${encodeURIComponent('/plugins/code-editor/?project=app&worktree=wt1&file=src%2Fwt.ts')}`);
  await editor(app).waitFor();
  check(await app.getByRole('button', { name: 'Comment on selection', exact: true }).count() === 0, 'no selection: no Comment button');

  await editor(app).click();
  await page.keyboard.press('Control+A');
  const button = app.getByRole('button', { name: 'Comment on selection', exact: true });
  await button.waitFor();
  check(await button.isEnabled(), 'a selection inside cc enables the Comment button');
  await shot('selection');

  await editor(app).click({ button: 'right' });
  const action = app.getByRole('menuitem', { name: /Comment on selection/ });
  await action.waitFor();
  await shot('context-menu');
  // Monaco's menu drops a click that lands right after it opens (its guard against the opening right-click's release),
  // so click while the item is shown and enabled until the dialog it opens appears, a bounded number of times.
  const dialog = app.getByRole('dialog', { name: 'Comment on selection' });
  for (let attempt = 1; ; attempt++) {
    if (await action.isVisible() && await action.isEnabled()) await action.click({ timeout: 2000 }).catch(() => {});
    try { await dialog.waitFor({ timeout: 1000 }); break; } catch (e) { if (attempt === 5) throw e; }
  }
  const picker = dialog.getByRole('combobox', { name: 'Send to' });
  await picker.waitFor();
  check(await picker.inputValue() === SESSION.sessionId, 'cc’s active session in this worktree is preselected');
  check(await dialog.getByRole('option', { name: 'Main checkout <b>review</b> · app', exact: true }).count() === 1, 'a label with markup is listed as text');
  check(await dialog.getByRole('option', { name: /Finished run/ }).count() === 0, 'an exited session is not offered');
  check(await dialog.getByRole('button', { name: 'Send', exact: true }).isDisabled(), 'Send waits for a comment');
  await dialog.getByRole('textbox', { name: 'Comment', exact: true }).fill('Is this flag still needed?');
  await shot('dialog');

  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await app.getByRole('status').filter({ hasText: 'Sent to Worktree worker · app / wt1' }).waitFor();
  const prompts = await page.evaluate(() => window.__prompts);
  check(prompts.length === 1 && prompts[0].sessionId === SESSION.sessionId, 'one prompt went to the chosen session');
  check(prompts[0].text.startsWith(`Comment on [${world.trees.wt.replace(/_/g, '\\_')}/src/wt.ts:1](http://cc.internal/#plugin/code-editor/?ccPath=`), 'the prompt opens with a link to the selection');
  check(prompts[0].text.includes('\n\nIs this flag still needed?\n\nSelected text:\n```typescript\nexport const wt = true;'), 'the prompt carries the comment and the fenced selection');
  await shot('sent');
}
