# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.cjs >> home loads and capture screenshot and console logs
- Location: e2e\home.spec.cjs:4:1

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
Call log:
  - navigating to "http://localhost:5173/", waiting until "load"

```

# Test source

```ts
  1  | const { test, expect } = require('@playwright/test');
  2  | const fs = require('fs');
  3  | 
  4  | test('home loads and capture screenshot and console logs', async ({ page }) => {
  5  |   const logs = [];
  6  |   page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  7  | 
> 8  |   await page.goto('http://localhost:5173/');
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
  9  |   await page.waitForLoadState('networkidle');
  10 | 
  11 |   fs.mkdirSync('e2e-screenshots', { recursive: true });
  12 |   await page.screenshot({ path: 'e2e-screenshots/home.png', fullPage: true });
  13 |   fs.writeFileSync('e2e-screenshots/console.log', logs.join('\n'));
  14 | 
  15 |   const title = await page.title();
  16 |   expect(title.length).toBeGreaterThan(0);
  17 | });
  18 | 
```