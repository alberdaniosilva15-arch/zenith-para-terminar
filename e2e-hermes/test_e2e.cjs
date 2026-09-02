const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// Config
const SUPABASE_URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const SUPABASE_ANON_KEY = require('fs').readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP_URL = 'http://127.0.0.1:5173';
const ADMIN_URL = 'http://127.0.0.1:4000';
const PREFS = { viewport: { width: 420, height: 900 }, locale: 'pt-AO' };
const PREFIX = `e2e-${Date.now().toString(36)}`;
const DRIVER_EMAIL = `${PREFIX}-driver@zenith-test.ao`;
const PASS_EMAIL = `${PREFIX}-pass@zenith-test.ao`;
const PASSWORD = 'Teste123!';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function createAccount(email, password, name, role = 'passenger') {
  console.log(`[CRIAR] ${email} como ${role}`);
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name, role } }
  });
  if (error) throw new Error(`SignUp ${email}: ${error.message}`);
  console.log(`  → user ${data.user?.id}`);
  await sleep(3000); // esperar trigger handle_new_user

  // Se for driver, aplicar role intent
  if (role === 'driver') {
    // Login para obter token
    const { data: login } = await supabase.auth.signInWithPassword({ email, password });
    if (!login.session) throw new Error('Login driver falhou');
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${login.session.access_token}` } }
    });
    const { error: rpcErr } = await client.rpc('set_my_role_driver');
    if (rpcErr) console.warn(`  ⚠ RPC role: ${rpcErr.message}`);
    else console.log('  → role=driver OK');
    await supabase.auth.signOut(); // não precisa sessão aqui — vai ser via browser
  }
  return data.user;
}

async function setSession(page, accessToken, refreshToken) {
  await page.evaluate(({ url, anon, at, rt }) => {
    const key = `sb-${url.match(/https?:\/\/([^.]+)/)[1]}-auth-token`;
    localStorage.setItem(key, JSON.stringify({
      access_token: at, refresh_token: rt,
      expires_in: 3600, expires_at: Math.floor(Date.now()/1000) + 3600,
      token_type: 'bearer'
    }));
  }, { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY, at: accessToken, rt: refreshToken });
}

(async () => {
  console.log('═══════════════════════════════════════════');
  console.log('E2E: ZENITH RIDE — Teste de Pedido/Aceite');
  console.log(`Driver: ${DRIVER_EMAIL}`);
  console.log(`Passenger: ${PASS_EMAIL}`);
  console.log('═══════════════════════════════════════════');

  // 1. Criar contas
  const driverUser = await createAccount(DRIVER_EMAIL, PASSWORD, 'E2E Motorista', 'driver');
  const passUser = await createAccount(PASS_EMAIL, PASSWORD, 'E2E Passageiro', 'passenger');

  // 2. Login para obter sessões
  const { data: drvSession } = await supabase.auth.signInWithPassword({ email: DRIVER_EMAIL, password: PASSWORD });
  const { data: passSession } = await supabase.auth.signInWithPassword({ email: PASS_EMAIL, password: PASSWORD });
  if (!drvSession?.session || !passSession?.session) throw new Error('Login falhou');

  // 3. Preparar motorista (docs + emergency + go online)
  const drvClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${drvSession.session.access_token}` } }
  });
  // Inserir driver_documents com status approved (RLS permite)
  await drvClient.from('driver_documents').upsert({
    driver_id: driverUser.id,
    car_brand: 'Toyota', car_model: 'Corolla', car_plate: 'LD-00-00-AA',
    car_color: 'Preto', status: 'approved'
  }, { onConflict: 'driver_id' });
  console.log('  → driver_documents approved');
  // Set emergency contact
  await drvClient.from('profiles').update({
    emergency_contact_name: 'Mãe',
    emergency_contact_phone: '244923456789'
  }).eq('user_id', driverUser.id);
  console.log('  → emergency contact set');
  // Go online (upsert driver_locations)
  await drvClient.from('driver_locations').upsert({
    driver_id: driverUser.id,
    status: 'available',
    location: 'POINT(13.2343 -8.8368)'
  }, { onConflict: 'driver_id' });
  console.log('  → driver online (Luanda centro)');

  // 4. Iniciar Playwright
  const browser = await chromium.launch({ headless: true });
  try {
    // ─── DRIVER PAGE ──────────────────────────────────────
    const drvPage = await browser.newPage(PREFS);
    await drvPage.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await setSession(drvPage, drvSession.session.access_token, drvSession.session.refresh_token);
    await drvPage.reload({ waitUntil: 'load', timeout: 30000 });
    await drvPage.waitForTimeout(4000);
    const drvBody = await drvPage.evaluate(() => document.body.innerText);
    console.log('DRIVER PAGE:', drvBody.slice(0, 300));

    // Verificar se está logged in como motorista
    if (drvBody.includes('Cockpit Operacional')) {
      console.log('✓ Driver logado e na página de motorista');
    } else {
      // Pode estar na tela de "become driver" — verificar
      console.log('⚠ Driver pode não estar na página correta');
      await drvPage.screenshot({ path: '/tmp/e2e-driver-start.png' });
    }

    // ─── PASSENGER PAGE ────────────────────────────────────
    const passPage = await browser.newPage(PREFS);
    await passPage.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await setSession(passPage, passSession.session.access_token, passSession.session.refresh_token);
    await passPage.reload({ waitUntil: 'load', timeout: 30000 });
    await passPage.waitForTimeout(4000);
    const passBody = await passPage.evaluate(() => document.body.innerText);
    console.log('PASS PAGE:', passBody.slice(0, 300));

    if (passBody.includes('Luanda pronta para sair') || passBody.includes('Passageiro')) {
      console.log('✓ Passageiro logado');
    } else {
      console.log('⚠ Passageiro pode não estar na página correta');
      await passPage.screenshot({ path: '/tmp/e2e-pass-start.png' });
    }

    // ─── PEDIR CORRIDA (passageiro) ────────────────────────
    // Escolher origem e destino (~6km Luanda)
    // Ingombota → Maianga ≈ 6km
    // Preencher pickup
    await passPage.getByText('Localização de partida').click();
    await passPage.waitForTimeout(1000);
    await passPage.fill('input', 'Ingombota');
    await passPage.waitForTimeout(500);
    await passPage.keyboard.press('Enter');
    await passPage.waitForTimeout(500);

    // Preencher destino
    await passPage.getByText('Para onde vamos?').click();
    await passPage.waitForTimeout(500);
    await passPage.fill('input', 'Maianga');
    await passPage.waitForTimeout(500);
    await passPage.keyboard.press('Enter');
    await passPage.waitForTimeout(1000);

    const passBody2 = await passPage.evaluate(() => document.body.innerText);
    console.log('APÓS DESTINO:', passBody2.slice(0, 400));

    // Clicar "Calcular Preço" (depois "Chamar Táxi" se não)
    const btns = await passPage.locator('button').all();
    for (const b of btns) {
      const txt = (await b.textContent())?.trim();
      if (txt?.includes('Calcular Preço')) { await b.click(); break; }
    }
    await passPage.waitForTimeout(3000);
    const passBody3 = await passPage.evaluate(() => document.body.innerText);
    console.log('APÓS CALCULAR:', passBody3.slice(0, 500));

    // Clicar "Pedir corrida" ou "Ver Motoristas"
    for (const b of await passPage.locator('button').all()) {
      const txt = (await b.textContent())?.trim();
      if (txt?.includes('Pedir corrida')) { await b.click(); break; }
    }
    await passPage.waitForTimeout(5000);
    const passBody4 = await passPage.evaluate(() => document.body.innerText);
    console.log('APÓS PEDIR:', passBody4.slice(0, 500));
    await passPage.screenshot({ path: '/tmp/e2e-ride-requested.png' });

    // ─── MOTORISTA ACEITA ──────────────────────────────────
    await drvPage.bringToFront();
    await drvPage.waitForTimeout(2000);
    const drvBody2 = await drvPage.evaluate(() => document.body.innerText);
    console.log('DRIVER STATUS:', drvBody2.slice(0, 500));

    // Procurar botão ACEITAR
    for (const b of await drvPage.locator('button').all()) {
      const txt = (await b.textContent())?.trim();
      if (txt?.includes('ACEITAR')) { await b.click(); break; }
    }
    await drvPage.waitForTimeout(3000);
    const drvBody3 = await drvPage.evaluate(() => document.body.innerText);
    console.log('APÓS ACEITAR:', drvBody3.slice(0, 500));
    await drvPage.screenshot({ path: '/tmp/e2e-ride-accepted.png' });
    await passPage.screenshot({ path: '/tmp/e2e-passenger-after-accept.png' });

    // ─── VERIFICAR ESTADOS NA BD ────────────────────────────
    const { data: rides } = await drvClient.from('rides')
      .select('id, status, driver_confirmed, price_kz, distance_km, driver_id, passenger_id')
      .eq('passenger_id', passUser.id)
      .order('created_at', { ascending: false }).limit(1);
    console.log('══════ RESULTADO BD ══════');
    if (rides && rides.length > 0) {
      const r = rides[0];
      console.log(`Ride ID: ${r.id}`);
      console.log(`Status: ${r.status}`);
      console.log(`driver_confirmed: ${r.driver_confirmed}`);
      console.log(`price_kz: ${r.price_kz}`);
      console.log(`distance_km: ${r.distance_km}`);
      console.log(`driver_id: ${r.driver_id}`);
      console.log(`passenger_id: ${r.passenger_id}`);
    } else {
      console.log('Nenhuma corrida encontrada para o passageiro!');
      // Verificar todas as corridas recentes
      const { data: allRides } = await drvClient.from('rides')
        .select('id, status, passenger_id, driver_id, price_kz, distance_km')
        .order('created_at', { ascending: false }).limit(5);
      console.log('Últimas 5 corridas:', JSON.stringify(allRides, null, 1));
    }

    // Verificar driver_locations
    const { data: dl } = await drvClient.from('driver_locations')
      .select('driver_id, status')
      .eq('driver_id', driverUser.id).maybeSingle();
    console.log(`Driver location status: ${dl?.status ?? 'N/A'}`);

    // Screenshots finais
    await passPage.screenshot({ path: '/tmp/e2e-final-pass.png' });
    await drvPage.screenshot({ path: '/tmp/e2e-final-drv.png' });

    console.log('══════ TESTE E2E CONCLUÍDO ══════');
  } catch (e) {
    console.error('ERRO E2E:', e.message);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });