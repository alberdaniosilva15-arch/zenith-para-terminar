const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Click tab buttons by role="tab" or text
  const pageHtml = await page.evaluate(() => document.querySelector('.login')?.innerHTML?.slice(0, 3000) || document.body.innerHTML?.slice(0, 3000));
  console.log('=== HTML SNIPPET ===');
  console.log(pageHtml?.slice(0, 2000));
  
  // Try clicking via button text index
  const btns = await page.locator('button').all();
  console.log('Total buttons:', btns.length);
  for (let i = 0; i < btns.length; i++) {
    const txt = (await btns[i].textContent())?.trim();
    console.log(`  btn[${i}]: "${txt?.slice(0, 30)}"`);
  }
  
  // Click the "CRIAR CONTA" tab (index 1)
  await btns[1].click();
  await page.waitForTimeout(1500);
  
  const text = await page.evaluate(() => document.body.innerText);
  console.log('=== APÓS CRIAR CONTA ===');
  console.log(text.slice(0, 2000));
  const inputs = await page.evaluate(() => [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, ph: i.placeholder })));
  console.log('=== INPUTS ===', JSON.stringify(inputs, null, 1));
  await page.screenshot({ path: '/tmp/e2e-03-signup.png' });
  await browser.close();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });