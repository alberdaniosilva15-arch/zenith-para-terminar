const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const SUPABASE_ANON_KEY = require('fs').readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP_URL = 'http://127.0.0.1:5173';
const PREFIX = `h${Date.now().toString(36)}`;
const DRV_EMAIL = `${PREFIX}-d@zt.ao`;
const PASS_EMAIL = `${PREFIX}-p@zt.ao`;
const PASSWORD = 'Teste123!';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function uiLogin(page, email, password) {
  await page.goto(APP_URL + '/login', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
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
  console.log('=== E2E RÁPIDO: Pedir + Aceitar corrida ===');
  // 1. Contas
  const { data: d } = await supabase.auth.signUp({ email: DRV_EMAIL, password: PASSWORD, options: { data: { name: 'Moto T' } } });
  await sleep(3000);
  const { data: dl } = await supabase.auth.signInWithPassword({ email: DRV_EMAIL, password: PASSWORD });
  const dClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  await dClient.auth.setSession(dl.session);
  await dClient.rpc('set_my_role_driver');
  await dClient.from('driver_documents').upsert({ driver_id: d.user.id, car_brand: 'T', car_model: 'C', car_plate: 'LD-00-AA', car_color: 'P', status: 'approved' }, { onConflict: 'driver_id' });
  await dClient.from('profiles').update({ emergency_contact_name: 'Mae', emergency_contact_phone: '244923456789' }).eq('user_id', d.user.id);
  await dClient.from('driver_locations').upsert({ driver_id: d.user.id, status: 'available', location: 'POINT(13.2343 -8.8368)' }, { onConflict: 'driver_id' });
  await dClient.auth.signOut();

  await supabase.auth.signUp({ email: PASS_EMAIL, password: PASSWORD, options: { data: { name: 'Pass T' } } });
  await sleep(3000);
  console.log('Contas criadas');

  // 2. Browser
  const browser = await chromium.launch({ headless: true });
  try {
    // Driver login via UI
    const drv = await browser.newPage({ viewport: { width: 420, height: 900 } });
    let t = await uiLogin(drv, DRV_EMAIL, PASSWORD);
    console.log('Driver:', t.includes('Cockpit') ? 'OK' : '?');
    // Ficar online
    const online = await drv.locator('button.zr-button', { hasText: 'FICAR ONLINE' }).all();
    if (online.length > 0) { await online[0].click(); await drv.waitForTimeout(3000); }
    console.log('Online:', await drv.evaluate(() => document.body.innerText.indexOf('ONLINE') > -1 ? 'OK' : '?'));

    // Passenger login via UI
    const pass = await browser.newPage({ viewport: { width: 420, height: 900 } });
    t = await uiLogin(pass, PASS_EMAIL, PASSWORD);
    console.log('Pass:', t.includes('Luanda') || t.includes('Passageiro') ? 'OK' : '?' + t.slice(0,80));
    await pass.screenshot({ path: '/tmp/e2e-0-pass.png' });

    // Criar corrida com sessão via setSession
    const pClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: pl } = await supabase.auth.signInWithPassword({ email: PASS_EMAIL, password: PASSWORD });
    await pClient.auth.setSession(pl.session);
    const ridePayload = {
      passenger_id: pl.user.id,
      origin_address: 'Ingombota, Luanda', origin_lat: -8.819, origin_lng: 13.250,
      dest_address: 'Maianga, Luanda', dest_lat: -8.829, dest_lng: 13.196,
      distance_km: 6.0, duration_min: 14, surge_multiplier: 1.0, price_kz: 2000,
      status: 'searching', vehicle_type: 'standard', traffic_factor: 1.0
    };
    const { data: ride, error: rideErr } = await pClient.from('rides').insert(ridePayload).select().single();
    if (rideErr) console.log('ERRO INSERT:', rideErr.message, rideErr.code, JSON.stringify(rideErr));
    else console.log('Ride criada:', ride.id.slice(0,8), ride.status);

    // Se falhou, tentar via RPC create_selected_ride_atomic não serve (precisa driver).
    // Tentar de novo com select amplo para diagnosticar RLS

    // Wait for driver polling
    for (let i = 0; i < 8; i++) {
      await drv.bringToFront();
      await drv.waitForTimeout(5000);
      const d = await drv.evaluate(() => document.body.innerText);
      if (d.includes('ACEITAR')) {
        console.log('✓ Driver recebeu');
        await drv.locator('button', { hasText: 'ACEITAR' }).first().click();
        await drv.waitForTimeout(3000);
        // Verificar na BD
        const { data: rides } = await pClient.from('rides')
          .select('id,status,driver_confirmed,price_kz,distance_km,duration_min,driver_id')
          .order('created_at', { ascending: false }).limit(2);
        for (const r of (rides || [])) console.log(`  BD: ${r.id.slice(0,8)} ${r.status} conf=${r.driver_confirmed} ${r.price_kz}Kz ${r.distance_km}km`);
        const { data: dl2 } = await pClient.from('driver_locations').select('status').eq('driver_id', d.user.id).maybeSingle();
        console.log('Driver loc:', dl2?.status);
        break;
      }
      if (i === 7) console.log('⚠ Driver não recebeu após 40s');
    }
    console.log('══════ FIM ══════');
  } catch (e) { console.error('ERRO:', e.message); }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });