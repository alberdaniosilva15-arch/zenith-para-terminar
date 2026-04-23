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
  await expect(page.getByRole('heading', { name: /Zenith/i })).toBeVisible();

  await page.getByRole('button', { name: /Criar conta/i }).click();
  await expect(page.getByText(/Nome completo/i)).toBeVisible();
  await expect(page.getByText(/Os passageiros usam link mágico/i)).toBeVisible();

  const email = randomEmail();
  const name = 'E2E Test User';

  await page.locator('input[type="text"]').first().fill(name);
  await page.locator('input[type="email"]').first().fill(email);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await page.getByRole('button', { name: /Motorista/i }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.getByText(/Google como alternativa/i)).toBeVisible();

  await page.getByRole('button', { name: /Entrar/i }).click();
  await page.getByRole('button', { name: /MOTORISTA/i }).click();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button').filter({ hasText: /^ENTRAR$/ })).toBeVisible();

  await page.getByRole('button', { name: /Esqueci-me da Palavra-Passe/i }).click();
  await expect(page.getByText(/link seguro para redefinir/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /ENVIAR RECUPERACAO/i })).toBeVisible();

  await page.locator('input[type="email"]').first().fill(email);

  fs.mkdirSync('e2e-screenshots', { recursive: true });
  await page.screenshot({ path: 'e2e-screenshots/auth-flows.png', fullPage: true });
  fs.writeFileSync('e2e-screenshots/auth-flows-console.log', logs.join('\n'));
});
