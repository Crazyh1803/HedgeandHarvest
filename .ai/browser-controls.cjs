async function clickControl(page, selector) {
  const control = page.locator(selector);
  for (let i = 0; i < 4 && !await control.isVisible(); i++) {
    const menu = await control.evaluate(el => el.closest('details:not([open])')?.id || null);
    if (!menu) break;
    await page.locator('#' + menu + ' > summary').click();
  }
  await control.click();
}
module.exports = { clickControl };
