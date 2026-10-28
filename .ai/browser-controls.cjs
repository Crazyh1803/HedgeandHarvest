async function clickControl(page, selector) {
  const control = page.locator(selector);
  if (await control.count() !== 1) throw new Error('Expected one control for ' + selector);
  let lastMenu = null;
  for (let i = 0; i < 4 && !await control.isVisible(); i++) {
    const menu = await control.evaluate(el => el.closest('details:not([open])')?.id || null);
    if (!menu) break;
    if (menu === lastMenu) throw new Error('Control remains hidden after opening ' + menu + ': ' + selector);
    lastMenu = menu;
    await page.locator('#' + menu + ' > summary').click();
  }
  await control.click();
}
module.exports = { clickControl };
