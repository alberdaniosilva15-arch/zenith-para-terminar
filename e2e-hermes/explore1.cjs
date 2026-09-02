const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  console.log('=== URL:', page.url());
  const text = await page.evaluate(() => document.body.innerText);
  console.log('=== BODY TEXT (primeiros 1500 chars) ===');
  console.log(text.slice(0, 1500));
  // Listar inputs e botões
  const controls = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, ph: i.placeholder }));
    const buttons = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 20);
    return { inputs, buttons };
  });
  console.log('=== INPUTS ===', JSON.stringify(controls.inputs, null, 1));
  console.log('=== BOTÕES ===', JSON.stringify(controls.buttons, null, 1));
  await page.screenshot({ path: '/tmp/e2e-01-login.png' });
  await browser.close();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
