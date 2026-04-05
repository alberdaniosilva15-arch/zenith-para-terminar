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

    page.on('console', msg => {
      try {
        logs.push(`CONSOLE ${msg.type()}: ${msg.text()}`);
      } catch (e) { logs.push('CONSOLE_CAPTURE_ERROR'); }
    });

    page.on('pageerror', err => {
      logs.push(`PAGE_ERROR: ${err.message}\n${err.stack}`);
    });

    page.on('response', res => {
      try {
        if (res.status() >= 400) logs.push(`RESPONSE ${res.status()} ${res.url()}`);
      } catch (e) { }
    });

    page.on('requestfailed', req => {
      try {
        const f = req.failure ? (req.failure().errorText || '') : '';
        logs.push(`REQUEST_FAILED ${req.url()} ${f}`);
      } catch (e) { logs.push(`REQUEST_FAILED ${req.url()}`); }
    });

    const url = 'http://localhost:5173/';
    logs.push(`NAVIGATING ${url}`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => logs.push('GOTO_FAILED:' + (e.message||e)));

    // Try to open signup to trigger any client-side flows
    try {
      await page.click('text=Criar conta', { timeout: 3000 }).catch(()=>{});
      await page.waitForTimeout(500);
    } catch (e) { logs.push('CLICK_CRIAR_CONTA_FAILED'); }

    // Save HTML & screenshot
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(outDir, 'page.html'), html, 'utf8');
      await page.screenshot({ path: path.join(outDir, 'console-run.png'), fullPage: true });
    } catch (e) { logs.push(`SCREENSHOT_HTML_ERROR: ${e.message}`); }

    // Wait to capture network/console activity
    await page.waitForTimeout(8000);

    await browser.close();
  } catch (e) {
    logs.push(`ERROR_RUN: ${e.stack || e.message || e}`);
  } finally {
    fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'), 'utf8');
    console.log('Done. Logs saved to', outDir);
    process.exit(0);
  }
})();
