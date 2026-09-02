const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const ANON = fs.readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const email = 'diag' + Date.now().toString(36) + '@zt.ao';
  const c = createClient(URL, ANON);
  const { data: su } = await c.auth.signUp({ email, password: 'Teste123!', options: { data: { name: 'Diag' } } });
  console.log('signUp user:', su.user?.id);
  await sleep(4000);
  const { data: login } = await c.auth.signInWithPassword({ email, password: 'Teste123!' });
  if (!login?.session) { console.log('login falhou'); return; }
  const t = login.session.access_token;
  const res = await fetch(URL + '/rest/v1/users?select=id,email,role&id=eq.' + login.user.id, {
    headers: { apikey: ANON, Authorization: 'Bearer ' + t }
  });
  console.log('USERS:', await res.text());
  // tentar inserir ride
  const ins = await fetch(URL + '/rest/v1/rides', {
    method: 'POST',
    headers: { apikey: ANON, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      passenger_id: login.user.id,
      origin_address: 'A', origin_lat: -8.8, origin_lng: 13.2,
      dest_address: 'B', dest_lat: -8.82, dest_lng: 13.18,
      distance_km: 6, duration_min: 14, price_kz: 2000,
      status: 'searching', vehicle_type: 'standard'
    })
  });
  console.log('INSERT ride:', ins.status, await ins.text());
})().catch(e => console.log('ERRO', e.message));