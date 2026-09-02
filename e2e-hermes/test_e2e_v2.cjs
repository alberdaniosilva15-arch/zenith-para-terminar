const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const SUPABASE_ANON_KEY = require('fs').readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP_URL = 'http://127.0.0.1:5173';
const PREFIX = `t${Date.now().toString(36)}`;
const DRV_EMAIL = `${PREFIX}-d@zt.ao`;
const PASS_EMAIL = `${PREFIX}-p@zt.ao`;
const PASSWORD = 'Teste123!';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function clickButton(page, text) {
  const btns = await page.locator('button').all();
  for (const b of btns) {
    const t = (await b.textContent())?.trim() || '';
    if (t.includes(text)) { await b.click(); return true; }
  }
  return false;
}

async function pageText(page) { return page.evaluate(() => document.body.innerText); }

(async () => {
  // 1. Criar contas
  console.log(`Criar driver: ${DRV_EMAIL}`);
  const { data: d } = await supabase.auth.signUp({ email: DRV_EMAIL, password: PASSWORD, options: { data: { name: 'Teste D' } } });
  await sleep(3000);
  const { data: dl } = await supabase.auth.signInWithPassword({ email: DRV_EMAIL, password: PASSWORD });
  const dClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${dl.session.access_token}` } } });
  await dClient.rpc('set_my_role_driver');
  await dClient.from('driver_documents').upsert({ driver_id: d.user.id, car_brand: 'T', car_model: 'C', car_plate: 'LD-00-AA', car_color: 'P', status: 'approved' }, { onConflict: 'driver_id' });
  await dClient.from('profiles').update({ emergency_contact_name: 'Mae', emergency_contact_phone: '244923456789' }).eq('user_id', d.user.id);
  await dClient.from('driver_locations').upsert({ driver_id: d.user.id, status: 'available', location: 'POINT(13.2343 -8.8368)' }, { onConflict: 'driver_id' });
  await supabase.auth.signOut();
  console.log('Driver pronto');

  console.log(`Criar passageiro: ${PASS_EMAIL}`);
  await supabase.auth.signUp({ email: PASS_EMAIL, password: PASSWORD, options: { data: { name: 'Teste P' } } });
  await sleep(3000);
  await supabase.auth.signOut();
  console.log('Passageiro pronto');

  // 2. Browser
  const browser = await chromium.launch({ headless: true });
  try {
    // ─── LOGIN DRIVER ──────────────────────────────────────
    const drv = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await drv.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
    await drv.waitForTimeout(2000);
    console.log('Driver page load:', (await pageText(drv)).slice(0, 100));

    // Selecionar role Motorista
    await clickButton(drv, 'Motorista');
    await drv.waitForTimeout(500);
    // Clicar "ENTRAR" tab (btn[0])
    const btns = await drv.locator('button').all();
    await btns[0].click(); // Entrar
    await drv.waitForTimeout(500);
    // Preencher email + password
    await drv.fill('input', DRV_EMAIL);
    await drv.waitForTimeout(300);
    // Password field
    const inputs = await drv.locator('input').all();
    if (inputs.length >= 2) await inputs[1].fill(PASSWORD);
    await drv.waitForTimeout(300);
    // Clicar submit "Entrar" (apenas o botão .zr-button--block, não o tab)
    await drv.locator('button.zr-button.zr-button--block', { hasText: 'Entrar' }).click();
    console.log('Submit clicado');
    await drv.waitForTimeout(6000);
    console.log('Driver login:', (await pageText(drv)).slice(0, 250));

    // ─── LOGIN PASSAGEIRO ──────────────────────────────────
    const pass = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await pass.goto(APP_URL, { waitUntil: 'load', timeout: 30000 });
    await pass.waitForTimeout(2000);
    // Selecionar role Motorista (para mostrar campos de password)
    await clickButton(pass, 'Motorista');
    await pass.waitForTimeout(300);
    await clickButton(pass, 'Entrar');
    await pass.waitForTimeout(300);
    await pass.fill('input', PASS_EMAIL);
    await pass.waitForTimeout(300);
    const inputs2 = await pass.locator('input').all();
    if (inputs2.length >= 2) await inputs2[1].fill(PASSWORD);
    await pass.waitForTimeout(300);
    for (const b of await pass.locator('button').all()) {
      const t = (await b.textContent())?.trim() || '';
      if (t === 'Entrar') { await b.click(); break; }
    }
    await pass.waitForTimeout(5000);
    console.log('Pass login:', (await pageText(pass)).slice(0, 200));

    // Capturar estado
    await drv.screenshot({ path: '/tmp/e2e-s1-drv.png' });
    await pass.screenshot({ path: '/tmp/e2e-s1-pass.png' });

    // ─── DRIVER FICAR ONLINE ────────────────────────────────
    await drv.bringToFront();
    await clickButton(drv, 'FICAR ONLINE');
    await drv.waitForTimeout(3000);
    console.log('Driver online:', (await pageText(drv)).slice(0, 200));
    await drv.screenshot({ path: '/tmp/e2e-s2-drv-online.png' });

    // ─── PASSAGEIRO PEDIR CORRIDA ~6KM ─────────────────────
    await pass.bringToFront();
    await pass.waitForTimeout(1000);
    // Clicar pickup → "Localização de partida"
    // O app tem um input de pesquisa e um mapa
    const passTxt = await pageText(pass);
    console.log('Pass UI:', passTxt.slice(0, 300));

    // Tentar preencher origem via input de pesquisa
    const searchInputs = await pass.locator('input[placeholder*="Onde"]').all();
    if (searchInputs.length === 0) {
      // Se não achar, tentar clicar no texto "Localização de partida" ou "Para onde vamos?"
      const links = await pass.locator('text=Localização de partida').all();
      if (links.length > 0) await links[0].click();
      else {
        const dest = await pass.locator('text=Para onde vamos').all();
        if (dest.length > 0) await dest[0].click();
      }
    }
    await pass.waitForTimeout(1000);
    console.log('Após clique origem:', (await pageText(pass)).slice(0, 300));

    // Escrever "Ingombota" para simular 6km de Luanda centro
    const inputElem = await pass.locator('input').first();
    await inputElem.fill('Ingombota');
    await pass.waitForTimeout(1500);
    await pass.keyboard.press('Enter');
    await pass.waitForTimeout(2000);
    await pass.screenshot({ path: '/tmp/e2e-s3-origem.png' });
    console.log('Após origem:', (await pageText(pass)).slice(0, 300));

    // Destino: "Maianga"
    const destInput = await pass.locator('input[placeholder*="Onde"]').all();
    if (destInput.length > 0) {
      await destInput[0].fill('Maianga');
      await pass.waitForTimeout(1500);
      await pass.keyboard.press('Enter');
      await pass.waitForTimeout(2000);
    } else {
      // Tentar preencher outro input
      const allInputs = await pass.locator('input').all();
      if (allInputs.length > 1) {
        await allInputs[1].fill('Maianga');
        await pass.waitForTimeout(1500);
        await pass.keyboard.press('Enter');
        await pass.waitForTimeout(2000);
      }
    }
    await pass.screenshot({ path: '/tmp/e2e-s4-dest.png' });
    console.log('Após destino:', (await pageText(pass)).slice(0, 400));

    // ─── CALCULAR PREÇO E PEDIR ─────────────────────────────
    await clickButton(pass, 'Calcular Preço');
    await pass.waitForTimeout(4000);
    await pass.screenshot({ path: '/tmp/e2e-s5-fare.png' });
    console.log('Após calcular:', (await pageText(pass)).slice(0, 500));

    // Pedir corrida
    await clickButton(pass, 'Pedir corrida');
    await pass.waitForTimeout(5000);
    await pass.screenshot({ path: '/tmp/e2e-s6-requested.png' });
    console.log('Após pedir:', (await pageText(pass)).slice(0, 500));

    // ─── MOTORISTA ACEITA ──────────────────────────────────
    await drv.bringToFront();
    await drv.waitForTimeout(3000);
    await drv.screenshot({ path: '/tmp/e2e-s7-drv-before-accept.png' });
    const drvTxt = await pageText(drv);
    console.log('Driver antes de aceitar:', drvTxt.slice(0, 500));

    // Clicar ACEITAR
    await clickButton(drv, 'ACEITAR');
    await drv.waitForTimeout(3000);
    await drv.screenshot({ path: '/tmp/e2e-s8-drv-accepted.png' });
    const drvAfter = await pageText(drv);
    console.log('Driver após aceitar:', drvAfter.slice(0, 500));

    // ─── VERIFICAR BD ──────────────────────────────────────
    const { data: rides } = await dClient.from('rides')
      .select('id,status,driver_confirmed,price_kz,distance_km,driver_id,passenger_id,created_at')
      .order('created_at', { ascending: false }).limit(5);
    console.log('\n══════ RESULTADOS BD ══════');
    for (const r of (rides || [])) {
      console.log(`  Ride ${r.id.slice(0,8)}: status=${r.status} conf=${r.driver_confirmed} price=${r.price_kz} dist=${r.distance_km} driver=${(r.driver_id||'').slice(0,8)} pass=${(r.passenger_id||'').slice(0,8)}`);
    }

    const { data: dl } = await dClient.from('driver_locations').select('driver_id,status').eq('driver_id', d.user.id).maybeSingle();
    console.log(`Driver location: ${dl?.status}`);

    await pass.screenshot({ path: '/tmp/e2e-final-pass.png' });
    await drv.screenshot({ path: '/tmp/e2e-final-drv.png' });
    console.log('══════ E2E CONCLUÍDO ══════');
  } catch (e) {
    console.error('ERRO:', e.message);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });