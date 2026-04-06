const { test, expect } = require('@playwright/test');
const fs = require('fs');

test('home loads and capture screenshot and console logs', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');

  fs.mkdirSync('e2e-screenshots', { recursive: true });
  await page.screenshot({ path: 'e2e-screenshots/home.png', fullPage: true });
  fs.writeFileSync('e2e-screenshots/console.log', logs.join('\n'));

  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
});
