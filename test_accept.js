import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf-8');
const envVars = Object.fromEntries(
  envFile.split('\n')
  .filter(line => line && !line.startsWith('#'))
  .map(line => {
    const [key, ...vals] = line.split('=');
    return [key.trim(), vals.join('=').trim()];
  })
);

const supabase = createClient(
  envVars['VITE_SUPABASE_URL'],
  envVars['VITE_SUPABASE_ANON_KEY']
);

async function testAuthAccept() {
  console.log("---- BUBBLE DEBUG ----");

  const DRIVER_EMAIL = 'zenith_driver_test123@gmail.com'; // Create this user if needed
  const DRIVER_PASS = '123456';

  let login = await supabase.auth.signInWithPassword({ email: DRIVER_EMAIL, password: DRIVER_PASS });
  if (login.error) {
    console.log("Motorista não existe, criando...");
    login = await supabase.auth.signUp({ 
      email: DRIVER_EMAIL, 
      password: DRIVER_PASS,
      options: { data: { role: 'driver', name: 'Zezinho Teste' } }
    });
  }

  const user = login.data.user;
  if (!user) {
    console.error("Não foi possível logar motorista.", login.error);
    return;
  }
  console.log("Motorista Autenticado! ID:", user.id);

  // Forçar location available (para passar pelo RLS)
  const { error: updErr } = await supabase.from('driver_locations').upsert({
    driver_id: user.id,
    status: 'available',
    location: 'POINT(13.2343 -8.8390)',
    updated_at: new Date().toISOString()
  });
  console.log("Motorista -> Update Location:", updErr ? "ERRO " + JSON.stringify(updErr) : "OK");

  // Criar uma corrida de teste como PASSAGEIRO (preciso deslogar e logar como passageiro)
  console.log("Criando corrida de teste via RPC ou inserção anônima...");
  const { data: ride, error: rideErr } = await supabase.from('rides').insert({
    passenger_id: user.id, // gambiarra: usar o driver como passageiro e motorista
    origin_address: 'Teste Origin',
    origin_lat: -8.8390,
    origin_lng: 13.2343,
    dest_address: 'Teste Dest',
    dest_lat: -8.8395,
    dest_lng: 13.2345,
    distance_km: 1,
    surge_multiplier: 1,
    price_kz: 1500,
    status: 'searching'
  }).select('*').single();

  if (rideErr || !ride) {
    console.error("ERRO ao criar corrida teste:", rideErr);
    return;
  }
  console.log("Corrida Teste criada! ID:", ride.id);

  console.log("Executando accept_ride_atomic...");
  const { data: result, error: rpcErr } = await supabase.rpc('accept_ride_atomic', {
    p_ride_id: ride.id,
    p_driver_id: user.id
  });

  console.log("RPC RESULTADO:");
  console.log(result);
  if (rpcErr) console.log("RPC ERROR:", rpcErr);
}

testAuthAccept();
