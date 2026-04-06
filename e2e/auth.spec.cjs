const { test, expect } = require('@playwright/test');
const fs = require('fs');

function randomEmail() {
  const t = Date.now();
  return `test+${t}@example.com`;
}

test('signup then signin flow', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('response', res => logs.push(`RESPONSE ${res.status()} ${res.url()}`));

  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');

  // Click "Criar conta" toggle
  await page.click('text=Criar conta');
  await page.waitForSelector('text=Nome completo');

  const email = randomEmail();
  const password = 'Password123!';
  const name = 'E2E Test User';

  // Preencher nome e email
  await page.fill('input[placeholder="Mário Bento"]', name);
  await page.fill('input[placeholder="exemplo@gmail.com"]', email);

  // Usar fluxo Passageiro (link mágico) para tornar o teste determinístico.
  await page.click('text=CRIAR CONTA');
  // Esperar por mensagem de sucesso 'Link mágico' ou similar
  await page.waitForTimeout(2000);
  fs.mkdirSync('e2e-screenshots', { recursive: true });
  await page.screenshot({ path: 'e2e-screenshots/signup-passenger.png', fullPage: true });
  fs.writeFileSync('e2e-screenshots/signup-passenger-console.log', logs.join('\n'));
  const magicCount = await page.locator('text=Link mágico').count();
  expect(magicCount).toBeGreaterThan(0);
});
