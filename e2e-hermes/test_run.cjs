const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const SUPABASE_ANON_KEY = require('fs').readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP_URL = 'http://127.0.0.1:5173';
const PREFIX = `g${Date.now().toString(36)}`;
const DRV_EMAIL = `${PREFIX}-d@zt.ao`;
const PASS_EMAIL = `${PREFIX}-p@zt.ao`;
const PASSWORD = 'Teste123!';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function uiLogin(page, email, password) {
  await page.goto(APP_URL + '/login', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  // Selecionar role Motorista (mostra campo password)
  await page.locator('.zr-role-card', { hasText: 'Motorista' }).click();
  await page.waitForTimeout(500);
  await page.locator('input').first().fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForTimeout(300);
  await page.locator('button.zr-button.zr-button--block', { hasText: 'Entrar' }).click();
  await page.waitForTimeout(6000);
  return page.evaluate(() => document.body.innerText);
}

(async () => {
  console.log('=== E2E FINAL: Pedir + Aceitar corrida (6km) ===');
  // 1. Contas
  const { data: d } = await supabase.auth.signUp({ email: DRV_EMAIL, password: PASSWORD, options: { data: { name: 'Moto T' } } });
  await sleep(3000);
  const { data: dl } = await supabase.auth.signInWithPassword({ email: DRV_EMAIL, password: PASSWORD });
  const dClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${dl.session.access_token}` } } });
  await dClient.rpc('set_my_role_driver');
  await dClient.from('driver_documents').upsert({ driver_id: d.user.id, car_brand: 'T', car_model: 'C', car_plate: 'LD-00-AA', car_color: 'P', status: 'approved' }, { onConflict: 'driver_id' });
  await dClient.from('profiles').update({ emergency_contact_name: 'Mae', emergency_contact_phone: '244923456789' }).eq('user_id', d.user.id);
  await dClient.from('driver_locations').upsert({ driver_id: d.user.id, status: 'available', location: 'POINT(13.2343 -8.8368)' }, { onConflict: 'driver_id' });
  await supabase.auth.signOut();
  const { data: p } = await supabase.auth.signUp({ email: PASS_EMAIL, password: PASSWORD, options: { data: { name: 'Pass T' } } });
  await sleep(3000);
  const { data: pl } = await supabase.auth.signInWithPassword({ email: PASS_EMAIL, password: PASSWORD });
  const pClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${pl.session.access_token}` } } });
  await supabase.auth.signOut();
  console.log(`Driver: ${d.user.id.slice(0,8)} | Pass: ${p.user.id.slice(0,8)}`);

  const browser = await chromium.launch({ headless: true });
  try {
    // 2. Driver UI + online
    const drv = await browser.newPage({ viewport: { width: 420, height: 900 } });
    let t = await uiLogin(drv, DRV_EMAIL, PASSWORD);
    console.log('Driver login:', t.includes('Cockpit') ? 'OK' : 'FALHOU');
    await drv.locator('button.zr-button', { hasText: 'FICAR ONLINE' }).click();
    await drv.waitForTimeout(3000);
    t = await drv.evaluate(() => document.body.innerText);
    console.log('Driver online:', t.includes('ONLINE') ? 'OK' : '?');

    // 3. Passenger UI login
    const pass = await browser.newPage({ viewport: { width: 420, height: 900 } });
    t = await uiLogin(pass, PASS_EMAIL, PASSWORD);
    console.log('Pass login:', t.includes('Luanda') || t.includes('Passageiro') ? 'OK' : 'FALHOU: ' + t.slice(0,120));
    await pass.screenshot({ path: '/tmp/e2e-0-pass-home.png' });

    // 4. Criar corrida ~6km como passageiro (o que a app faz ao clicar "Pedir corrida")
    // Ingombota (-8.819,13.250) -> Maianga (-8.829,13.196) ~6km
    const DIST = 6.0, DUR = 14;
    const PRICE = 2000;
    const ridePayload = {
      passenger_id: p.user.id,
      origin_address: 'Ingombota, Luanda',
      origin_lat: -8.8190, origin_lng: 13.2500,
      dest_address: 'Maianga, Luanda',
      dest_lat: -8.8290, dest_lng: 13.1960,
      distance_km: DIST, duration_min: DUR,
      surge_multiplier: 1.0, price_kz: PRICE,
      driver_id: null, status: 'searching',
      accepted_at: null, driver_confirmed: false,
      vehicle_type: 'standard', traffic_factor: 1.0
    };
    const { data: ride, error: rideErr } = await pClient.from('rides').insert(ridePayload).select().single();
    console.log('Criar corrida:', rideErr ? 'ERRO ' + rideErr.message : `OK id=${ride.id.slice(0,8)}`);
    if (rideErr) { console.log('DETALHE:', JSON.stringify(rideErr)); }

    // 5. Driver recebe a corrida (polling 5-10s)
    console.log('A aguardar driver receber (polling)...');
    let accepted = false;
    for (let i = 0; i < 6; i++) {
      await drv.bringToFront();
      await drv.waitForTimeout(6000);
      await drv.screenshot({ path: `/tmp/e2e-${i}-drv-poll.png` });
      const d = await drv.evaluate(() => document.body.innerText);
      if (d.includes('ACEITAR')) {
        console.log('✓ Driver viu a corrida (iteração ' + i + ')');
        await drv.locator('button', { hasText: 'ACEITAR' }).first().click();
        await drv.waitForTimeout(4000);
        accepted = true;
        break;
      }
      console.log(`  poll ${i}: ainda sem corrida (${d.slice(0,60).replace(/\n/g,' ')})`);
    }
    if (accepted) {
      const da = await drv.evaluate(() => document.body.innerText);
      console.log('Após aceitar — driver:', da.slice(0, 250).replace(/\n/g, ' | '));
      await drv.screenshot({ path: '/tmp/e2e-drv-accepted.png' });

      // Passenger UI deve refletir ACCEPTED
      await pass.bringToFront();
      await pass.waitForTimeout(3000);
      await pass.screenshot({ path: '/tmp/e2e-pass-accepted.png' });
      const pa = await pass.evaluate(() => document.body.innerText);
      console.log('Passageiro após aceite:', pa.slice(0, 250).replace(/\n/g, ' | '));
    }

    // 6. Verificar BD
    const { data: rides } = await pClient.from('rides')
      .select('id,status,driver_confirmed,price_kz,distance_km,duration_min,driver_id,passenger_id,origin_address,dest_address,vehicle_type,accepted_at')
      .order('created_at', { ascending: false }).limit(3);
    console.log('\n══════ RESULTADOS BD ══════');
    for (const r of (rides || [])) {
      console.log(`  ${r.id.slice(0,8)} status=${r.status} conf=${r.driver_confirmed} ${r.price_kz}Kz ${r.distance_km}km ${r.vehicle_type} driver=${(r.driver_id||'').slice(0,8)}`);
    }
    const { data: dl2 } = await dClient.from('driver_locations').select('status').eq('driver_id', d.user.id).maybeSingle();
    console.log(`Driver location: ${dl2?.status}`);
    console.log('══════ FIM ══════');
  } catch (e) {
    console.error('ERRO:', e.message);
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });