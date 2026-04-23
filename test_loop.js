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

const supabasePass   = createClient(envVars['VITE_SUPABASE_URL'], envVars['VITE_SUPABASE_ANON_KEY']);
const supabaseDriver = createClient(envVars['VITE_SUPABASE_URL'], envVars['VITE_SUPABASE_ANON_KEY']);

async function runTest() {
  const dEmail = `driver_${Date.now()}@test.com`;
  const pEmail = `pass_${Date.now()}@test.com`;

  const pLogin = await supabasePass.auth.signUp({ email: pEmail, password: 'password123', options: { data: { role: 'passenger' } } });
  const dLogin = await supabaseDriver.auth.signUp({ email: dEmail, password: 'password123', options: { data: { role: 'driver' } } });

  const passenger = pLogin.data?.user;
  const driver   = dLogin.data?.user;
  console.log("Passenger:", passenger?.id, "Driver:", driver?.id);

  if (!passenger || !driver) { console.error("Falha ao criar", pLogin.error, dLogin.error); return; }

  // Driver goes online
  const driverData = {
    driver_id: driver.id,
    status: 'available',
    location: 'POINT(13.2343 -8.8390)',
    updated_at: new Date().toISOString()
  };
  const { error: dErr } = await supabaseDriver.from('driver_locations').upsert(driverData);
  console.log("DriverOnline Error:", dErr);

  // Passenger creates ride
  const rData = {
    passenger_id: passenger.id,
    origin_address: 'O', origin_lat: -8.8, origin_lng: 13.2,
    dest_address: 'D', dest_lat: -8.9, dest_lng: 13.3,
    distance_km: 1, surge_multiplier: 1, price_kz: 1000,
    status: 'searching'
  };
  const { data: ride, error: ptrErr } = await supabasePass.from('rides').insert(rData).select('*').single();
  console.log("PassengerRide Error:", ptrErr);

  if (!ride) return;

  // Driver calls accept
  console.log("Chamando RPC accept_ride_atomic...");
  const { data: rpcRes, error: rpcErr } = await supabaseDriver.rpc('accept_ride_atomic', {
    p_ride_id: ride.id,
    p_driver_id: driver.id
  });
  console.log("RPC Result:", rpcRes, "Err:", rpcErr);

  // Read ride status as passsenger
  const { data: finalRide } = await supabasePass.from('rides').select('*').eq('id', ride.id).single();
  console.log("Final Ride Status:", finalRide?.status, "Driver_id:", finalRide?.driver_id);
}
runTest();
