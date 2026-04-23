const url = 'https://mhahnhnsaquqgqvnnwld.supabase.co/functions/v1/gemini-proxy';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oYWhuaG5zYXF1cWdxdm5ud2xkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTcwODQsImV4cCI6MjA4OTkzMzA4NH0.uwVKadNB4p5jzbyBrz49hmFVm1HEqG2ty_KOgS02w28';

async function test() {
  console.log("Testing Kaze proxy...");
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'kaze_chat', message: 'teste', history: [] })
    });
    console.log("Status:", res.status);
    console.log("Response:", await res.text());
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
