#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const outDir = path.join(__dirname, '..', 'e2e-screenshots', 'console-run');
  fs.mkdirSync(outDir, { recursive: true });
  const logs = [];
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', msg => logs.push(`CONSOLE ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => logs.push(`PAGE_ERROR: ${err.message}`));
    page.on('response', res => { if (res.status() >= 400) logs.push(`RESPONSE ${res.status()} ${res.url()}`); });

    const url = 'http://localhost:5173/';
    logs.push(`NAVIGATING ${url} (forced reload)`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Emular reload forçado: limpar cache e recarregar
    await context.clearCookies();
    await context.storageState({ path: path.join(outDir, 'storage-state.json') }).catch(()=>{});
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });

    await page.screenshot({ path: path.join(outDir, 'forced-reload.png'), fullPage: true });
    const html = await page.content();
    fs.writeFileSync(path.join(outDir, 'forced-page.html'), html, 'utf8');

    await browser.close();
  } catch (e) {
    logs.push(`ERROR_RUN: ${e.stack || e.message}`);
  } finally {
    fs.writeFileSync(path.join(outDir, 'forced-console.log'), logs.join('\n'), 'utf8');
    console.log('Done forced reload. Logs saved to', outDir);
    process.exit(0);
  }
})();
