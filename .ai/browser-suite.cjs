const { spawnSync } = require('node:child_process');
if (process.env.BROWSER_TESTS !== '1') {
  console.log('Browser checks skipped; run ak-test with BROWSER_TESTS=1 and Playwright to include them.');
} else {
  for (const file of ['.ai/browser-smoke.cjs', '.ai/render-regression.cjs', '.ai/storage-regression.cjs', '.ai/play-regression.cjs', '.ai/lively-regression.cjs', '.ai/mobile-regression.cjs', '.ai/polish-regression.cjs', '.ai/toolbar-regression.cjs', '.ai/large-fields-regression.cjs']) {
    const result = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
