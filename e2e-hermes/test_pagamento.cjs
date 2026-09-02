const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const ANON = fs.readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const c = createClient(URL, ANON);
const u = (t, path, body) => fetch(URL+path, {method: body?'POST':'GET', headers: {apikey: ANON, Authorization:'Bearer '+t, 'Content-Type':'application/json', Prefer:'return=representation'}, body: body?JSON.stringify(body):undefined}).then(async r=>({s:r.status, j:await r.json().catch(()=>({}))}));

(async () => {
  const P = 'pay' + Date.now().toString(36);
  const PE = P + '-p@zt.ao', DE = P + '-d@zt.ao';
  const PW = 'Teste123!';
  // contas
  await c.auth.signUp({ email: DE, password: PW, options: { data: { name: 'D' } } });
  await sleep(3000);
  const { data: dl } = await c.auth.signInWithPassword({ email: DE, password: PW });
  await u(dl.session.access_token, '/rest/v1/rpc/set_my_role_driver', {});
  await u(dl.session.access_token, '/rest/v1/driver_documents', { driver_id: dl.user.id, car_brand:'T', car_model:'C', car_plate:'LD-PP', car_color:'P', status:'approved' });
  await u(dl.session.access_token, '/rest/v1/profiles/' + dl.user.id, { emergency_contact_phone:'244923456789' });
  await u(dl.session.access_token, '/rest/v1/driver_locations', { driver_id: dl.user.id, status:'available', location:'POINT(13.2343 -8.8368)' });
  await c.auth.signOut();
  await c.auth.signUp({ email: PE, password: PW, options: { data: { name: 'P' } } });
  await sleep(3000);
  const { data: pl } = await c.auth.signInWithPassword({ email: PE, password: PW });
  const pT = pl.session.access_token;
  await c.auth.signOut();
  console.log('Contas: D=' + dl.user.id.slice(0,8) + ' P=' + pl.user.id.slice(0,8));

  // 1. Criar pending_payment para o passageiro (colunas corretas)
  const ref = 'REF-' + Date.now().toString(36).toUpperCase();
  const pp = await u(pT, '/rest/v1/pending_payments', {
    reference: ref, user_id: pl.user.id, amount: 3000, phone_number: '244900000000',
    provider: 'multicaixa', status: 'pending', provider_payload: {}, callback_payload: {}
  });
  console.log('pending_payment:', pp.s === 201 ? '✓' : '✗ ' + pp.s + ' ' + JSON.stringify(pp.j));

  // 2. Creditar 3000 Kz via supabase-js (named args corretos)
  const c2 = createClient(URL, ANON);
  await c2.auth.setSession(pl.session);
  const { data: credData, error: credErr } = await c2.rpc('credit_wallet_atomic', {
    p_user_id: pl.user.id, p_amount: 3000, p_description: 'Top-up teste', p_reference: ref
  });
  const credited = Array.isArray(credData) && credData[0]?.credited === true;
  console.log('credit_wallet:', credited ? '✓ saldo=' + credData[0].balance_after : '✗ ' + JSON.stringify(credErr || credData));

  // 3. Criar corrida 6km
  const ride = await u(pT, '/rest/v1/rides', {
    passenger_id: pl.user.id, origin_address:'Ingombota', origin_lat:-8.819, origin_lng:13.250,
    dest_address:'Maianga', dest_lat:-8.829, dest_lng:13.196,
    distance_km:6.0, duration_min:14, surge_multiplier:1.0, price_kz:2000,
    status:'searching', vehicle_type:'standard'
  });
  const rid = ride.j?.[0]?.id;
  console.log('Ride:', (rid||'').slice(0,8), ride.j?.[0]?.status);

  // 4. Ciclo completo: aceitar → picking_up → in_progress → completed
  await u(dl.session.access_token, '/rest/v1/rpc/accept_ride_atomic', { p_ride_id: rid });
  await u(dl.session.access_token, '/rest/v1/rpc/confirm_pickup', { p_ride_id: rid });
  await u(dl.session.access_token, '/rest/v1/rpc/start_ride', { p_ride_id: rid });
  const comp = await u(dl.session.access_token, '/rest/v1/rpc/complete_ride', { p_ride_id: rid });
  console.log('complete_ride:', comp.j?.success === true ? '✓' : '✗ ' + JSON.stringify(comp.j));

  // 5. Verificar carteiras e transações
  const wD = (await u(dl.session.access_token, '/rest/v1/wallets?user_id=eq.'+dl.user.id+'&select=user_id,balance', null)).j?.[0];
  const wP = (await u(pT, '/rest/v1/wallets?user_id=eq.'+pl.user.id+'&select=user_id,balance', null)).j?.[0];
  const tx = (await u(dl.session.access_token, '/rest/v1/transactions?ride_id=eq.'+rid+'&select=id,user_id,amount,type', null)).j || [];
  console.log('\n══════════ PROVA DE PAGAMENTO ══════════');
  console.log(`Carteira PASSAGEIRO: ${wP?.balance}Kz (esperado ~1000 = 3000-2000)`);
  console.log(`Carteira MOTORISTA:  ${wD?.balance}Kz (esperado 1700 = 85% de 2000)`);
  for (const t of tx) console.log(`  tx: ${t.type} ${t.amount}Kz (${(t.user_id||'').slice(0,8)})`);
  const pass = Number(wP?.balance) === 1000 && Number(wD?.balance) === 1700 && tx.length === 2;
  console.log(`\nPAYMENTO CORRETO: ${pass ? '✓✓ SIM (carteira debitada, motorista 85%, 2 transações)' : '✗'}`);
  console.log('══════════ FIM ══════════');
})().catch(e => console.log('ERRO', e.message));