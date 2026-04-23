import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oYWhuaG5zYXF1cWdxdm5ud2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTcwODQsImV4cCI6MjA4OTkzMzA4NH0.uwVKadNB4p5jzbyBrz49hmFVm1HEqG2ty_KOgS02w28';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'admin');
  if (error) console.error(error);
  console.log("Admins:", JSON.stringify(data, null, 2));
}

check();
