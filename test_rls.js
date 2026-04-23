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
  envVars['VITE_SUPABASE_ANON_KEY'] // NOTA: sem role permissão para ver pg_policies precisamos do SERVICE_ROLE.
);
