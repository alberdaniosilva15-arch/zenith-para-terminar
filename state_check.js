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

async function checkState() {
  console.log("---- DB STATE ----");
  const { data: drivers } = await supabase.from('users').select('id, email').eq('role', 'driver').limit(5);
  console.log("Drivers:", drivers);

  // Sem anon key nao vou conseguir ler roles dps. Vou olhar public.rides
  const { data: rides } = await supabase.from('rides').select('id, status, driver_id').order('created_at', { ascending: false }).limit(3);
  console.log("Rides recentes:", rides);
}

checkState();
