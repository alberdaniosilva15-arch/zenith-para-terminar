const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const SUPABASE_ANON_KEY = require('fs').readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP_URL = 'http://127.0.0.1:5173';
const PREFIX = `f${Date.now().toString(36)}`;
const DRV_EMAIL = `${PREFIX}-d@zt.ao`;
const PASS_EMAIL = `${PREFIX}-p@zt.ao`;
const PASSWORD = 'Teste123!';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function injectSession(page, url, anonKey, accessToken, refreshToken) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  const projectRef = url.replace('https://','').split('.')[0];
  const key = `sb-${projectRef}-auth-token`;
  const session = {
    access_token: accessToken, refresh_token: refreshToken,
    expires_in: 3600, expires_at: Math.floor(Date.now()/1000) + 3600,
    token_type: 'bearer', user: null
  };
  await page.evaluate(({ k, s }) => { localStorage.setItem(k, JSON.stringify(s)); }, { k: key, s: session });
  await page.reload({ waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(4000);
  return page.evaluate(() => document.body.innerText);
}

(async () => {
  // 1. Criar contas
  console.log('Criar contas...');
  const { data: d } = await supabase.auth.signUp({ email: DRV_EMAIL, password: PASSWORD, options: { data: { name: 'Motorista T' } } });
  await sleep(3000);
  const { data: dl } = await supabase.auth.signInWithPassword({ email: DRV_EMAIL, password: PASSWORD });
  const dClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${dl.session.access_token}` } } });
  await dClient.rpc('set_my_role_driver');
  await dClient.from('driver_documents').upsert({ driver_id: d.user.id, car_brand: 'T', car_model: 'C', car_plate: 'LD-00-AA', car_color: 'P', status: 'approved' }, { onConflict: 'driver_id' });
  await dClient.from('profiles').update({ emergency_contact_name: 'Mae', emergency_contact_phone: '244923456789' }).eq('user_id', d.user.id);
  await dClient.from('driver_locations').upsert({ driver_id: d.user.id, status: 'available', location: 'POINT(13.2343 -8.8368)' }, { onConflict: 'driver_id' });
  await supabase.auth.signOut();

  const { data: p } = await supabase.auth.signUp({ email: PASS_EMAIL, password: PASSWORD, options: { data: { name: 'Passageiro T' } } });
  await sleep(3000);
  await supabase.auth.signOut();
  console.log('Contas prontas');

  // 2. Obter tokens
  const { data: ds } = await supabase.auth.signInWithPassword({ email: DRV_EMAIL, password: PASSWORD });
  const { data: ps } = await supabase.auth.signInWithPassword({ email: PASS_EMAIL, password: PASSWORD });
  if (!ds?.session || !ps?.session) throw new Error('Login falhou');
  const dTok = ds.session.access_token, pTok = ps.session.access_token;
  const dRef = ds.session.refresh_token, pRef = ps.session.refresh_token;
  console.log('Tokens obtidos');

  // 3. Browser
  const browser = await chromium.launch({ headless: true });
  try {
    // ─── DRIVER PAGE ──────────────────────────────────────
    console.log('Abrir driver...');
    const drv = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const drvBody = await injectSession(drv, APP_URL, SUPABASE_ANON_KEY, dTok, dRef);
    console.log('Driver:', drvBody.slice(0, 150));

    // Ficar online
    await drv.locator('button.zr-button', { hasText: 'FICAR ONLINE' }).click();
    await drv.waitForTimeout(3000);
    console.log('Driver ONLINE');

    // ─── PASSENGER PAGE ────────────────────────────────────
    console.log('Abrir passageiro...');
    const pass = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const passBody = await injectSession(pass, APP_URL, SUPABASE_ANON_KEY, pTok, pRef);
    console.log('Passageiro:', passBody.slice(0, 150));

    if (passBody.includes('Luanda') || passBody.includes('Passageiro')) {
      console.log('✓ Passageiro logado');
    } else {
      console.log('⚠ Passageiro não logado. Tentando login alternativo...');
      // Fallback: login via UI
      await pass.goto(APP_URL + '/login', { waitUntil: 'load' });
      await pass.waitForTimeout(2000);
      // Selecionar Motorista no login (pra mostrar password)
      await pass.locator('.zr-role-card', { hasText: 'Motorista' }).click();
      await pass.waitForTimeout(500);
      // Fill email
      await pass.locator('input').first().fill(PASS_EMAIL);
      await pass.locator('input[type="password"]').fill(PASSWORD);
      await pass.waitForTimeout(500);
      await pass.locator('button.zr-button.zr-button--block', { hasText: 'Entrar' }).click();
      await pass.waitForTimeout(5000);
      const fb = await pass.evaluate(() => document.body.innerText);
      console.log('Fallback login:', fb.slice(0, 200));
      if (fb.includes('Luanda') || fb.includes('Passageiro')) {
        console.log('✓ Fallback funcionou');
      } else {
        console.log('⚠ Fallback também falhou');
        await pass.screenshot({ path: '/tmp/e2e-pass-fallback.png' });
      }
    }

    // ─── PEDIR CORRIDA (~6km LUANDA) ─────────────────────
    await pass.bringToFront();
    await pass.waitForTimeout(1000);
    const passUI = await pass.evaluate(() => document.body.innerText);
    console.log('UI passageiro:', passUI.slice(0, 400));

    // Preencher destino: Ingombota → Maianga (~6km)
    // Clicar no input de partida
    const pickupLabel = await pass.locator('text=Localização de partida').all();
    if (pickupLabel.length > 0) {
      await pickupLabel[0].click();
      await pass.waitForTimeout(500);
      await pass.locator('input').first().fill('Ingombota');
      await pass.waitForTimeout(1500);
      // Enter para selecionar sugestão
      await pass.keyboard.press('ArrowDown');
      await pass.waitForTimeout(300);
      await pass.keyboard.press('Enter');
      await pass.waitForTimeout(1500);
      console.log('Origem preenchida');
    }

    // Destino
    const destLabel = await pass.locator('text=Para onde vamos').all();
    if (destLabel.length > 0) {
      await destLabel[0].click();
      await pass.waitForTimeout(500);
      const inputs = await pass.locator('input').all();
      if (inputs.length > 0) await inputs[inputs.length - 1].fill('Maianga');
      await pass.waitForTimeout(1500);
      await pass.keyboard.press('ArrowDown');
      await pass.waitForTimeout(300);
      await pass.keyboard.press('Enter');
      await pass.waitForTimeout(1500);
      console.log('Destino preenchido');
    }

    await pass.screenshot({ path: '/tmp/e2e-route-set.png' });
    const routeUI = await pass.evaluate(() => document.body.innerText);
    console.log('Rota:', routeUI.slice(0, 500));

    // Calcular preço
    await pass.locator('button', { hasText: 'Calcular Preço' }).click();
    await pass.waitForTimeout(5000);
    await pass.screenshot({ path: '/tmp/e2e-fare.png' });
    const fareUI = await pass.evaluate(() => document.body.innerText);
    console.log('Preço:', fareUI.slice(0, 500));

    // Pedir corrida
    await pass.locator('button', { hasText: 'Pedir corrida' }).click();
    await pass.waitForTimeout(8000);
    await pass.screenshot({ path: '/tmp/e2e-requested.png' });
    const reqUI = await pass.evaluate(() => document.body.innerText);
    console.log('Pedido:', reqUI.slice(0, 500));

    // ─── MOTORISTA ACEITA ─────────────────────────────────
    // O driver recebe a notificação via polling (~5-10s)
    await drv.bringToFront();
    await drv.waitForTimeout(6000);
    await drv.screenshot({ path: '/tmp/e2e-drv-before.png' });
    const drvUI = await drv.evaluate(() => document.body.innerText);
    console.log('Driver notif:', drvUI.slice(0, 500));

    // ACEITAR
    const acceptBtn = await drv.locator('button', { hasText: 'ACEITAR' }).all();
    if (acceptBtn.length > 0) {
      await acceptBtn[0].click();
      await drv.waitForTimeout(3000);
      console.log('✓ ACEITOU corrida');
    } else {
      console.log('⚠ Nenhum botão ACEITAR encontrado');
      // Verificar se a corrida chegou
      const { data: rides } = await dClient.from('rides')
        .select('id,status,driver_id,price_kz,distance_km,created_at')
        .order('created_at', { ascending: false }).limit(5);
      console.log('Rides:', JSON.stringify(rides, null, 1));
    }

    await drv.screenshot({ path: '/tmp/e2e-drv-accepted.png' });
    await pass.screenshot({ path: '/tmp/e2e-pass-final.png' });

    // ─── VERIFICAR BD ─────────────────────────────────────
    const { data: rides } = await dClient.from('rides')
      .select('id,status,driver_confirmed,price_kz,distance_km,driver_id,passenger_id,created_at,accepted_at,origin_address,dest_address')
      .order('created_at', { ascending: false }).limit(5);

    console.log('\n══════ RESULTADOS BD ══════');
    for (const r of (rides || [])) {
      console.log(`  Ride ${r.id.slice(0,8)}: ${r.status} conf=${r.driver_confirmed} ${r.price_kz}Kz ${r.distance_km}km "${r.origin_address}"→"${r.dest_address}"`);
      if (r.driver_id) console.log(`    driver=${r.driver_id.slice(0,8)} pass=${r.passenger_id.slice(0,8)}`);
    }

    const { data: dl } = await dClient.from('driver_locations').select('driver_id,status').eq('driver_id', d.user.id).maybeSingle();
    console.log(`Driver location: ${dl?.status}`);

    console.log('\n══════ E2E CONCLUÍDO ══════');
  } catch (e) {
    console.error('ERRO:', e.message);
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });