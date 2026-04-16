# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.cjs >> signup then signin flow
- Location: e2e\auth.spec.cjs:9:1

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
  4  | function randomEmail() {
  5  |   const t = Date.now();
  6  |   return `test+${t}@example.com`;
  7  | }
  8  | 
  9  | test('signup then signin flow', async ({ page }) => {
  10 |   const logs = [];
  11 |   page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  12 |   page.on('response', res => logs.push(`RESPONSE ${res.status()} ${res.url()}`));
  13 | 
> 14 |   await page.goto('http://localhost:5173/');
     |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
  15 |   await page.waitForLoadState('networkidle');
  16 | 
  17 |   // Click "Criar conta" toggle
  18 |   await page.click('text=Criar conta');
  19 |   await page.waitForSelector('text=Nome completo');
  20 | 
  21 |   const email = randomEmail();
  22 |   const password = 'Password123!';
  23 |   const name = 'E2E Test User';
  24 | 
  25 |   // Preencher nome e email
  26 |   await page.fill('input[placeholder="Mário Bento"]', name);
  27 |   await page.fill('input[placeholder="exemplo@gmail.com"]', email);
  28 | 
  29 |   // Usar fluxo Passageiro (link mágico) para tornar o teste determinístico.
  30 |   await page.click('text=CRIAR CONTA');
  31 |   // Esperar por mensagem de sucesso 'Link mágico' ou similar
  32 |   await page.waitForTimeout(2000);
  33 |   fs.mkdirSync('e2e-screenshots', { recursive: true });
  34 |   await page.screenshot({ path: 'e2e-screenshots/signup-passenger.png', fullPage: true });
  35 |   fs.writeFileSync('e2e-screenshots/signup-passenger-console.log', logs.join('\n'));
  36 |   const magicCount = await page.locator('text=Link mágico').count();
  37 |   expect(magicCount).toBeGreaterThan(0);
  38 | });
  39 | 
```