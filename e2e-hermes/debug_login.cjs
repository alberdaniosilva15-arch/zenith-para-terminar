const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  const btns = await page.locator('button').all();
  console.log('=== Antes de selecionar role ===');
  for (let i = 0; i < btns.length; i++) console.log(`[${i}] "${(await btns[i].textContent())?.trim()}"`);
  // Clicar role Motorista (btn com texto 'two_wheeler Motorista' ou contendo Motorista)
  for (const b of btns) {
    const t = (await b.textContent())?.trim() || '';
    if (t.includes('Motorista')) { await b.click(); break; }
  }
  await page.waitForTimeout(800);
  console.log('=== Depois de selecionar Motorista ===');
  const btns2 = await page.locator('button').all();
  for (let i = 0; i < btns2.length; i++) console.log(`[${i}] "${(await btns2[i].textContent())?.trim()}"`);
  const inputs = await page.locator('input').all();
  console.log('Inputs:', inputs.length);
  await page.screenshot({ path: '/tmp/e2e-debug-login.png' });
  await browser.close();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });