const { test, expect } = require('@playwright/test');
const fs = require('fs');

function randomEmail() {
  const t = Date.now();
  return `zenith.e2e+${t}@gmail.com`;
}

test('auth screens expose passenger, driver and recovery flows', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('response', res => logs.push(`RESPONSE ${res.status()} ${res.url()}`));

  await page.goto('/');
  await expect(page.getByText('Acesso Zenith')).toBeVisible();

  await page.locator('.zr-tab').filter({ hasText: 'Criar conta' }).click();
  await expect(page.getByText(/Nome completo/i)).toBeVisible();
  await expect(page.getByText(/conta de passageiro.*link mágico/i)).toBeVisible();

  const email = randomEmail();
  const name = 'E2E Test User';

  await page.locator('input[placeholder="Mario Bento"]').fill(name);
  await page.locator('input[placeholder="mario@zenithride.ao"]').fill(email);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await page.locator('.zr-role-card').filter({ hasText: 'Motorista' }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('.zr-tab').filter({ hasText: 'Entrar' }).click();
  await page.locator('.zr-role-card').filter({ hasText: 'Motorista' }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  
  await page.locator('.zr-tab').filter({ hasText: 'Recuperar' }).click();
  await expect(page.getByText(/Iremos enviar um link/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Enviar recuperação/i })).toBeVisible();

  await page.locator('input[placeholder="exemplo@zenithride.ao"]').fill(email);

  fs.mkdirSync('e2e-screenshots', { recursive: true });
  await page.screenshot({ path: 'e2e-screenshots/auth-flows.png', fullPage: true });
  fs.writeFileSync('e2e-screenshots/auth-flows-console.log', logs.join('\n'));
});
