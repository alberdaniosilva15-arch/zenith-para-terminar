const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // Clicar no botão "CRIAR CONTA"
  const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b, i) => ({ i, t: (b.innerText||'').trim().slice(0,30) })));
  console.log('BOTÕES:', JSON.stringify(buttons));
  await page.getByText('CRIAR CONTA', { exact: true }).first().click();
  await page.waitForTimeout(1500);

  const text = await page.evaluate(() => document.body.innerText);
  console.log('=== APÓS CRIAR CONTA ===');
  console.log(text.slice(0, 1800));
  const controls = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, ph: i.placeholder })),
    buttons: [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 20)
  }));
  console.log('=== INPUTS ===', JSON.stringify(controls.inputs, null, 1));
  console.log('=== BOTÕES ===', JSON.stringify(controls.buttons, null, 1));
  await page.screenshot({ path: '/tmp/e2e-02-signup.png' });
  await browser.close();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
