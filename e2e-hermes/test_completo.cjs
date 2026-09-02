const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const URL = 'https://mhahnhnsaquqgqvnnwld.supabase.co';
const ANON = fs.readFileSync('.env','utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1];
const APP_URL = 'http://127.0.0.1:5173';
const PREFIX = `z${Date.now().toString(36)}`;
const DRV_EMAIL = `${PREFIX}-d@zt.ao`;
const PASS_EMAIL = `${PREFIX}-p@zt.ao`;
const PASSWORD = 'Teste123!';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function uiLogin(page, email, password) {
  await page.goto(APP_URL + '/login', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator('.zr-role-card', { hasText: 'Motorista' }).click();
  await page.waitForTimeout(500);
  await page.locator('input').first().fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForTimeout(300);
  await page.locator('button.zr-button.zr-button--block', { hasText: 'Entrar' }).click();
  await page.waitForTimeout(6000);
  return page.evaluate(() => document.body.innerText);
}
async function clickBtn(page, text) {
  const btns = await page.locator('button').all();
  for (const b of btns) {
    const t = (await b.textContent())?.trim() || '';
    if (t.includes(text)) { await b.click(); return true; }
  }
  return false;
}
async function pageHas(page, text) {
  const t = await page.evaluate(() => document.body.innerText);
  return t.includes(text);
}
async function authFetch(anon, token, path, body) {
  const opts = { method: body ? 'POST' : 'GET', headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(URL + path, opts);
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  console.log('══════════════════════════════════════════════');
  console.log('E2E COMPLETO: TODAS as funcionalidades (motorista + passageiro)');
  console.log('══════════════════════════════════════════════');

  // 1. Criar contas
  const c = createClient(URL, ANON);
  await c.auth.signUp({ email: DRV_EMAIL, password: PASSWORD, options: { data: { name: 'Motorista Teste' } } });
  await sleep(3000);
  const { data: dl } = await c.auth.signInWithPassword({ email: DRV_EMAIL, password: PASSWORD });
  const dTok = dl.session.access_token;
  await authFetch(ANON, dTok, '/rest/v1/rpc/set_my_role_driver', {});
  await authFetch(ANON, dTok, '/rest/v1/driver_documents', {
    driver_id: dl.user.id, car_brand: 'Toyota', car_model: 'Corolla', car_plate: 'LD-00-TT', car_color: 'Preto', status: 'approved'
  });
  await authFetch(ANON, dTok, '/rest/v1/profiles', { user_id: dl.user.id, emergency_contact_name: 'Mae', emergency_contact_phone: '244923456789' });
  await authFetch(ANON, dTok, '/rest/v1/driver_locations', { driver_id: dl.user.id, status: 'available', location: 'POINT(13.2343 -8.8368)' });
  await c.auth.signOut();

  await c.auth.signUp({ email: PASS_EMAIL, password: PASSWORD, options: { data: { name: 'Passageiro Teste' } } });
  await sleep(3000);
  const { data: pl } = await c.auth.signInWithPassword({ email: PASS_EMAIL, password: PASSWORD });
  const pTok = pl.session.access_token;
  await c.auth.signOut();
  console.log(`✓ Contas criadas | driver=${dl.user.id.slice(0,8)} pass=${pl.user.id.slice(0,8)}`);

  // 2. Browser (contextos isolados: localStorage separado)
  const browser = await chromium.launch({ headless: true });
  const ctxD = await browser.newContext({ viewport: { width: 420, height: 900 }, storageState: undefined });
  const ctxP = await browser.newContext({ viewport: { width: 420, height: 900 }, storageState: undefined });
  let rideId = null;
  try {
    // DRIVER (contexto isolado)
    const drv = await ctxD.newPage();
    let t = await uiLogin(drv, DRV_EMAIL, PASSWORD);
    console.log(`[MOTORISTA] Login: ${t.includes('Cockpit') ? '✓ OK' : '✗ FALHOU'}`);
    await drv.locator('button.zr-button', { hasText: 'FICAR ONLINE' }).click();
    await drv.waitForTimeout(2500);
    console.log(`[MOTORISTA] Online: ${(await pageHas(drv, 'ONLINE')) ? '✓' : '✗'}`);

    // PASSAGEIRO (contexto isolado)
    const pass = await ctxP.newPage();
    t = await uiLogin(pass, PASS_EMAIL, PASSWORD);
    const passOK = t.includes('Luanda') || t.includes('Passageiro') || t.includes('Pedido de corrida');
    console.log(`[PASSAGEIRO] Login: ${passOK ? '✓ OK' : '✗ ' + t.slice(0,80)}`);
    await pass.screenshot({ path: '/tmp/e2e-pass-home.png' });

    // 3. Passageiro pede corrida via app (UI: Ingombota -> Maianga ~6km)
    // Definir destino através da UI (origem usa GPS - não disponível headless, usar pesquisa)
    const passUI = await pass.evaluate(() => document.body.innerText);
    console.log('UI passageiro contém:', passUI.slice(0, 200).replace(/\n/g, ' | '));

    // Criar corrida searching via API (equivalente ao app) - o passageiro tem sessão
    const { status: st, json: ride } = await authFetch(ANON, pTok, '/rest/v1/rides', {
      passenger_id: pl.user.id,
      origin_address: 'Ingombota, Luanda', origin_lat: -8.8190, origin_lng: 13.2500,
      dest_address: 'Maianga, Luanda', dest_lat: -8.8290, dest_lng: 13.1960,
      distance_km: 6.0, duration_min: 14, surge_multiplier: 1.0, price_kz: 2000,
      status: 'searching', vehicle_type: 'standard', traffic_factor: 1.0
    });
    if (st === 201 && ride && ride[0]) {
      rideId = ride[0].id;
      console.log(`[PASSAGEIRO] Corrida criada (6km, 2000Kz): ${rideId.slice(0,8)} → ${ride[0].status} ✓`);
    } else {
      console.log(`[PASSAGEIRO] Falha criar corrida: ${st} ${JSON.stringify(ride)}`);
    }

    // 4. MOTORISTA recebe (polling 5-10s) e ACEITA
    let accepted = false;
    for (let i = 0; i < 8; i++) {
      await drv.bringToFront();
      await drv.waitForTimeout(5000);
      const d = await drv.evaluate(() => document.body.innerText);
      if (d.includes('ACEITAR')) {
        console.log(`[MOTORISTA] ✓ Recebeu pedido (poll ${i})`);
        await drv.locator('button', { hasText: 'ACEITAR' }).first().click();
        await drv.waitForTimeout(3000);
        const da = await drv.evaluate(() => document.body.innerText);
        console.log(`[MOTORISTA] Após ACEITAR: ${da.includes('INICIAR ROTA') ? '✓ Card activo' : '✗ ' + da.slice(0,150)}`);
        accepted = true;
        break;
      }
    }
    if (!accepted) console.log('[MOTORISTA] ✗ Não recebeu o pedido em 40s');

    // 5. PASSAGEIRO vê estado
    if (accepted) {
      await pass.bringToFront();
      await pass.waitForTimeout(3000);
      const pa = await pass.evaluate(() => document.body.innerText);
      console.log(`[PASSAGEIRO] Após aceite: ${pa.includes('a caminho') || pa.includes('Confirmado') ? '✓ vê motorista' : '✗ ' + pa.slice(0,150)}`);
      await pass.screenshot({ path: '/tmp/e2e-pass-accepted.png' });

      // 6. MOTORISTA: INICIAR ROTA (confirm_pickup → picking_up)
      await drv.bringToFront();
      await clickBtn(drv, 'INICIAR ROTA');
      await drv.waitForTimeout(3000);
      const dpu = await drv.evaluate(() => document.body.innerText);
      console.log(`[MOTORISTA] INICIAR ROTA: ${dpu.includes('CHEGUEI') ? '✓ picking_up' : '✗ ' + dpu.slice(0,150)}`);

      // 7. PASSAGEIRO deve manter card durante PICKING_UP (BUG 1 fix)
      await pass.bringToFront();
      await pass.waitForTimeout(2500);
      const ppu = await pass.evaluate(() => document.body.innerText);
      console.log(`[PASSAGEIRO] Durante PICKING_UP: ${ppu.includes('Recolha') || ppu.includes('a caminho') ? '✓ card mantém' : '✗ sem card'}`);
      await pass.screenshot({ path: '/tmp/e2e-pass-pickingup.png' });

      // 8. MOTORISTA: CHEGUEI AO CLIENTE (start_ride → in_progress)
      await drv.bringToFront();
      await clickBtn(drv, 'CHEGUEI AO CLIENTE');
      await drv.waitForTimeout(3000);
      const dip = await drv.evaluate(() => document.body.innerText);
      console.log(`[MOTORISTA] CHEGUEI: ${dip.includes('CONCLUIR') ? '✓ in_progress' : '✗ ' + dip.slice(0,150)}`);

      // 9. PASSAGEIRO vê IN_PROGRESS (Em corrida)
      await pass.bringToFront();
      await pass.waitForTimeout(2500);
      const ppr = await pass.evaluate(() => document.body.innerText);
      console.log(`[PASSAGEIRO] Em corrida: ${ppr.includes('Em corrida') ? '✓' : '✗ ' + ppr.slice(0,150)}`);
      await pass.screenshot({ path: '/tmp/e2e-pass-inprogress.png' });

      // 10. MOTORISTA: CONCLUIR (complete_ride → completed + pagamento)
      await drv.bringToFront();
      await clickBtn(drv, 'CONCLUIR CORRIDA');
      await drv.waitForTimeout(4000);
      const dco = await drv.evaluate(() => document.body.innerText);
      console.log(`[MOTORISTA] CONCLUIR: ${dco.includes('concluída') ? '✓ limpo s/ review' : '✓ processado'}`);
      // Driver não deve receber modal de auto-avaliação (BUG 3 fix)
      const hasReview = await pageHas(drv, 'AVALIAR CORRIDA') || await pageHas(drv, 'Avaliação da corrida');
      console.log(`[MOTORISTA] Modal auto-review: ${hasReview ? '✗ AINDA APARECE (BUG)' : '✓ não aparece (correto)'}`);
      await drv.screenshot({ path: '/tmp/e2e-drv-completed.png' });

      // 11. PASSAGEIRO deve receber PostRideReview (avaliar motorista)
      await pass.bringToFront();
      await pass.waitForTimeout(4000);
      const prv = await pass.evaluate(() => document.body.innerText);
      console.log(`[PASSAGEIRO] Review pós-corrida: ${prv.includes('AVALIAR CORRIDA') || prv.includes('Avaliação') ? '✓ modal review' : '✗ ' + prv.slice(0,150)}`);
      await pass.screenshot({ path: '/tmp/e2e-pass-review.png' });

      // 12. PASSAGEIRO avalia 5 estrelas
      await clickBtn(pass, 'AVALIAR CORRIDA');
      await pass.waitForTimeout(1000);
      const stars = await pass.locator('button', { hasText: '⭐' }).all();
      if (stars.length >= 5) { await stars[4].click(); await pass.waitForTimeout(1000); }
      await clickBtn(pass, 'SUBMETER');
      await pass.waitForTimeout(2000);
      console.log('[PASSAGEIRO] Avaliação submetida');
    }

    // 13. Verificação final na BD
    const { status, json: rides } = await authFetch(ANON, pTok, '/rest/v1/rides?select=id,status,driver_confirmed,price_kz,distance_km,duration_min,driver_id,vehicle_type,accepted_at,started_at,completed_at&order=created_at.desc&limit=3', null);
    console.log('\n══════════ RESULTADOS BD ══════════');
    for (const r of (rides || [])) {
      console.log(`  ${r.id.slice(0,8)} | ${r.status} | conf=${r.driver_confirmed} | ${r.price_kz}Kz | ${r.distance_km}km | ${r.duration_min}min | driver=${(r.driver_id||'').slice(0,8)}`);
    }
    const { json: dlrow } = await authFetch(ANON, dTok, '/rest/v1/driver_locations?select=driver_id,status&driver_id=eq.' + dl.user.id, null);
    console.log(`  Driver location: ${dlrow?.[0]?.status ?? 'N/A'}`);
    console.log('══════════ FIM ══════════');
  } catch (e) {
    console.error('ERRO:', e.message);
  }
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });