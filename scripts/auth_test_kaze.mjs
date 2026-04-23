import { createClient } from '@supabase/supabase-js';

const url = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oYWhuaG5zYXF1cWdxdm5ud2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTcwODQsImV4cCI6MjA4OTkzMzA4NH0.uwVKadNB4p5jzbyBrz49hmFVm1HEqG2ty_KOgS02w28';

const supabase = createClient(url, anonKey);

async function test() {
  console.log("Signing up dummy user...");
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: `test_kaze_${Date.now()}@test.com`,
    password: 'password123'
  });

  if (authErr) {
    console.error("Signup failed:", authErr.message);
    return;
  }

  const token = authData.session?.access_token;
  if (!token) {
    console.error("No session token generated.");
    return;
  }

  console.log("Calling gemini-proxy inside Edge Function...");
  const start = Date.now();
  try {
    const res = await fetch(`${url}/functions/v1/gemini-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'kaze_chat', message: 'teste', history: [] })
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text}`);
  } catch (e) {
    console.error(`Error after ${Date.now() - start}ms:`, e);
  }
  console.log(`Execution time: ${Date.now() - start}ms`);
}

test();
