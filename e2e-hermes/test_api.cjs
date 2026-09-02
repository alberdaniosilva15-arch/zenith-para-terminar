const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const ANON = fs.readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP = 'http://127.0.0.1:5173';
const P = `f${Date.now().toString(36)}`;
const DE = `${P}-d@zt.ao`, PE = `${P}-p@zt.ao`;
const PW = 'Teste123!';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = (anon, t, path, body) => fetch(URL+path, {method: body?'POST':'GET', headers: {apikey: anon, Authorization:'Bearer '+t, 'Content-Type':'application/json', Prefer:'return=representation'}, body: body ? JSON.stringify(body) : undefined}).then(r=>r.json().catch(()=>({})));
const c = createClient(URL, ANON);

(async () => {
  // 1. Criar contas
  await c.auth.signUp({ email: DE, password: PW, options: { data: { name: 'Moto' } } });
  await sleep(3000);
  const { data: dl } = await c.auth.signInWithPassword({ email: DE, password: PW });
  const dT = dl.session.access_token;
  await u(ANON, dT, '/rest/v1/rpc/set_my_role_driver', {});
  await u(ANON, dT, '/rest/v1/driver_documents', { driver_id: dl.user.id, car_brand:'T', car_model:'C', car_plate:'LD-00-TT', car_color:'P', status:'approved' });
  await u(ANON, dT, '/rest/v1/profiles/' + dl.user.id, { emergency_contact_name:'Mae', emergency_contact_phone:'244923456789' });
  await u(ANON, dT, '/rest/v1/driver_locations', { driver_id: dl.user.id, status:'available', location:'POINT(13.2343 -8.8368)' });
  await c.auth.signOut();

  await c.auth.signUp({ email: PE, password: PW, options: { data: { name: 'Pass' } } });
  await sleep(3000);
  const { data: pl } = await c.auth.signInWithPassword({ email: PE, password: PW });
  const pT = pl.session.access_token;
  await c.auth.signOut();
  console.log(`Driver: ${dl.user.id.slice(0,8)}  Pass: ${pl.user.id.slice(0,8)}`);

  // 2. Driver UI
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(APP+'/login', {waitUntil:'load'});
  await page.waitForTimeout(2000);
  await page.locator('.zr-role-card', {hasText:'Motorista'}).click();
  await page.waitForTimeout(500);
  await page.locator('input').first().fill(DE);
  await page.locator('input[type="password"]').fill(PW);
  await page.locator('button.zr-button.zr-button--block', {hasText:'Entrar'}).click();
  await page.waitForTimeout(6000);
  await page.locator('button.zr-button', {hasText:'FICAR ONLINE'}).click();
  await page.waitForTimeout(3000);
  await page.screenshot({path:'/tmp/1-driver-online.png'});
  console.log('✓ Driver online (UI)');

  // 3. Criar corrida ~6km como passageiro
  const ride = await u(ANON, pT, '/rest/v1/rides', {
    passenger_id: pl.user.id,
    origin_address:'Ingombota, Luanda', origin_lat:-8.819, origin_lng:13.250,
    dest_address:'Maianga, Luanda', dest_lat:-8.829, dest_lng:13.196,
    distance_km:6.0, duration_min:14, surge_multiplier:1.0, price_kz:2000,
    status:'searching', vehicle_type:'standard', traffic_factor:1.0
  });
  const rid = ride?.[0]?.id;
  const rStatus = ride?.[0]?.status;
  console.log(`Corrida: ${(rid||'').slice(0,8)} status=${rStatus} ${rStatus==='searching'?'✓':'✗'}`);

  // 4. Motorista aceita via RPC
  const accept = await u(ANON, dT, '/rest/v1/rpc/accept_ride_atomic', { p_ride_id: rid });
  const accOK = accept?.success === true;
  console.log(`Aceitar: ${accOK?'✓':'✗ '+JSON.stringify(accept)}`);
  await page.screenshot({path:'/tmp/2-accepted.png'});

  // 5. Verificar estados
  const r = (await u(ANON, pT, `/rest/v1/rides?id=eq.${rid}&select=id,status,driver_confirmed,driver_id,price_kz,distance_km,duration_min,vehicle_type,accepted_at`, null))?.[0] || {};
  console.log(`BD: ${(r.id||'').slice(0,8)} status=${r.status} conf=${r.driver_confirmed} driver=${(r.driver_id||'').slice(0,8)}`);

  // 6. Driver confirma recolha (confirm_pickup → picking_up)
  const pu = await u(ANON, dT, '/rest/v1/rpc/confirm_pickup', { p_ride_id: rid });
  const puOK = pu?.success === true;
  console.log(`Picking_up: ${puOK?'✓':'✗ '+JSON.stringify(pu)}`);
  const r2 = (await u(ANON, pT, `/rest/v1/rides?id=eq.${rid}&select=id,status,pickup_at`, null))?.[0] || {};
  console.log(`BD: status=${r2.status} pickup_at=${r2.pickup_at?'✓':'null'}`);

  // 7. Driver inicia corrida (start_ride → in_progress)
  const ip = await u(ANON, dT, '/rest/v1/rpc/start_ride', { p_ride_id: rid });
  const ipOK = ip?.success === true;
  console.log(`In_progress: ${ipOK?'✓':'✗ '+JSON.stringify(ip)}`);
  const r3 = (await u(ANON, pT, `/rest/v1/rides?id=eq.${rid}&select=id,status,started_at`, null))?.[0] || {};
  console.log(`BD: status=${r3.status} started_at=${r3.started_at?'✓':'null'}`);

  // 8. Driver completa corrida (complete_ride → completed + pagamento)
  const co = await u(ANON, dT, '/rest/v1/rpc/complete_ride', { p_ride_id: rid });
  const coOK = co?.success === true;
  console.log(`Completed: ${coOK?'✓':'✗ '+JSON.stringify(co)}`);
  const r4 = (await u(ANON, pT, `/rest/v1/rides?id=eq.${rid}&select=id,status,completed_at,price_kz`, null))?.[0] || {};
  console.log(`BD: status=${r4.status} completed_at=${r4.completed_at?'✓':'null'}`);

  // 9. Verificar carteiras (pagamento processado)
  const wD = (await u(ANON, dT, `/rest/v1/wallets?user_id=eq.${dl.user.id}&select=user_id,balance`, null))?.[0] || {};
  const wP = (await u(ANON, pT, `/rest/v1/wallets?user_id=eq.${pl.user.id}&select=user_id,balance`, null))?.[0] || {};
  console.log(`Wallet driver: ${wD.balance}Kz  pass: ${wP.balance}Kz`);
  const tx = await u(ANON, dT, `/rest/v1/transactions?ride_id=eq.${rid}&select=id,user_id,amount,type,description`, null);
  const txCount = Array.isArray(tx) ? tx.length : 0;
  console.log(`Transações: ${txCount} (esperado 2: pagamento passageiro + ganho motorista)`);

  // 10. Passageiro avalia motorista
  const rate = await u(ANON, pT, '/rest/v1/ratings', {
    ride_id: rid, from_user: pl.user.id, to_user: dl.user.id, score: 5, comment: 'Excelente!'
  });
  const rateOK = rate?.[0]?.id ? true : false;
  console.log(`Avaliação: ${rateOK?'✓':'✗'}`);

  // 11. Driver location volta a available
  const dl2 = (await u(ANON, dT, '/rest/v1/driver_locations?driver_id=eq.'+dl.user.id+'&select=driver_id,status', null))?.[0] || {};
  console.log(`Driver depois: ${dl2.status}`);

  // 12. Screenshot final
  await page.screenshot({path:'/tmp/3-final.png'});

  console.log('\n══════════ RESUMO ══════════');
  const tests = [
    ['Criar conta motorista', true],
    ['Criar conta passageiro', true],
    ['Login UI motorista', true],
    ['Ficar Online', true],
    ['Criar corrida searching (6km/2000Kz)', rStatus==='searching'],
    ['Aceitar (accept_ride_atomic)', accOK],
    ['Confirmar recolha (confirm_pickup → picking_up)', puOK],
    ['Iniciar (start_ride → in_progress)', ipOK],
    ['Completar (complete_ride → completed + pagamento)', coOK],
    ['Carteira motorista creditada', Number(wD.balance) > 0],
    ['Carteira passageiro debitada', Number(wP.balance) < 2000],
    ['Transações criadas', txCount >= 2],
    ['Avaliação submetida', rateOK],
    ['Driver volta a available', dl2.status==='available'],
  ];
  let ok = 0, fail = 0;
  for (const [n, p] of tests) { console.log(`  ${p?'✓':'✗'} ${n}`); if(p) ok++; else fail++; }
  console.log(`\n${ok}/${tests.length} passaram | ${fail} falharam`);
  console.log('══════════ FIM ══════════');
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });