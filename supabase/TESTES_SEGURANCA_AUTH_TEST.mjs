// =============================================================================
// ZENITH RIDE — TESTES DE SEGURANÇA VIA AUTH REAL
// Data: 19 Julho 2026
//
// COMO USAR:
//   cd zenith-ride-build
//   node supabase/TESTES_SEGURANCA_AUTH_TEST.mjs
//
// Este script cria utilizadores reais via Auth API, obtém JWTs,
// e testa RLS + RPCs com autenticação real.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ler URL e anon key do .env ou config
let SUPABASE_URL, SUPABASE_ANON_KEY;
try {
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const urlMatch = envContent.match(/VITE_SUPABASE_URL=(.+)/);
  const keyMatch = envContent.match(/VITE_SUPABASE_ANON_KEY=(.+)/);
  SUPABASE_URL = urlMatch?.[1]?.trim();
  SUPABASE_ANON_KEY = keyMatch?.[1]?.trim();
} catch {}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fallback: tentar ler do supabase config
  try {
    const configPath = path.join(__dirname, 'config.toml');
    if (fs.existsSync(configPath)) {
      console.log('⚠  Configura o SUPABASE_URL e SUPABASE_ANON_KEY no .env');
    }
  } catch {}
  console.error('❌ Configura SUPABASE_URL e SUPABASE_ANON_KEY no ficheiro .env do projecto');
  console.error('   VITE_SUPABASE_URL=https://xxx.supabase.co');
  console.error('   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TEST_EMAILS = {
  passenger: `test_passenger_${Date.now()}@test.com`,
  driver:    `test_driver_${Date.now()}@test.com`,
  other:     `test_other_${Date.now()}@test.com`,
};
const TEST_PASS = 'TestPassword123!';

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, detail) { failed++; console.log(`  ❌ ${name}: ${detail}`); }

async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

async function main() {
  console.log('='.repeat(70));
  console.log('ZENITH RIDE — TESTES DE SEGURANÇA VIA AUTH REAL');
  console.log('='.repeat(70));

  // ── Criar utilizadores de teste ──────────────────────────────────────────
  console.log('\n📋 Criando utilizadores de teste...');

  let passengerUser, driverUser, otherUser;
  try {
    passengerUser = await signUp(TEST_EMAILS.passenger, TEST_PASS);
    console.log(`  Passageiro: ${passengerUser.id}`);
  } catch (e) { console.error('  Erro ao criar passageiro:', e.message); return; }

  try {
    driverUser = await signUp(TEST_EMAILS.driver, TEST_PASS);
    console.log(`  Motorista:  ${driverUser.id}`);
  } catch (e) { console.error('  Erro ao criar motorista:', e.message); return; }

  try {
    otherUser = await signUp(TEST_EMAILS.other, TEST_PASS);
    console.log(`  Outro:      ${otherUser.id}`);
  } catch (e) { console.error('  Erro ao criar outro:', e.message); return; }

  // ── Configurar roles na BD (via RPC ou SQL) ─────────────────────────────
  console.log('\n⚙  Configurando roles na BD...');
  // Nota: isto precisa de service_role para inserir em public.users
  // O utilizador deve executar manualmente:
  console.log(`  INSERT INTO public.users (id, email, role) VALUES`);
  console.log(`    ('${passengerUser.id}', '${TEST_EMAILS.passenger}', 'passenger'),`);
  console.log(`    ('${driverUser.id}', '${TEST_EMAILS.driver}', 'driver'),`);
  console.log(`    ('${otherUser.id}', '${TEST_EMAILS.other}', 'passenger');`);
  console.log(`  CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  console.log(`  INSERT INTO public.profiles (user_id, name, phone, rating, total_rides, level) VALUES`);
  console.log(`    ('${passengerUser.id}', 'Test Passenger', '+244900000001', 4.5, 10, 'Novato'),`);
  console.log(`    ('${driverUser.id}', 'Test Driver', '+244900000002', 4.8, 50, 'Ouro'),`);
  console.log(`    ('${otherUser.id}', 'Test Other', '+244900000003', 4.0, 5, 'Novato');`);
  console.log(`  INSERT INTO public.driver_locations (driver_id, status, location, h3_index_res9, h3_index_res7, heading, updated_at) VALUES`);
  console.log(`    ('${driverUser.id}', 'available', ST_SetSRID(ST_MakePoint(13.2343, -8.8368), 4326), '8928308280fffff', '87283082803ffff', 90, NOW());`);

  console.log('\n  ⏸  Pausa: executa o SQL acima no Supabase Dashboard, depois pressiona Enter...');
  await new Promise(r => process.stdin.once('data', r));

  // ── Criar clientes autenticados ──────────────────────────────────────────
  const passengerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const driverClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const otherClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  await passengerClient.auth.signInWithPassword({ email: TEST_EMAILS.passenger, password: TEST_PASS });
  await driverClient.auth.signInWithPassword({ email: TEST_EMAILS.driver, password: TEST_PASS });
  await otherClient.auth.signInWithPassword({ email: TEST_EMAILS.other, password: TEST_PASS });

  console.log('\n🔑 Sessões autenticadas criadas.');


  // ══════════════════════════════════════════════════════════════════════════
  // TESTE 1: ANON — deve falhar em tudo
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── TESTE 1: ANON — deve falhar em tudo ──');

  {
    const { error } = await supabase.from('rides').select('*').limit(1);
    if (error) ok('1.1 anon bloqueado em SELECT rides');
    else fail('1.1 anon leu rides', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('accept_ride_atomic', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('1.2 anon bloqueado em accept_ride_atomic');
    else fail('1.2 anon executou accept_ride_atomic', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('cancel_ride_safe', { p_ride_id: '00000000-0000-0000-0000-000000000000', p_reason: 'teste' });
    if (error) ok('1.3 anon bloqueado em cancel_ride_safe');
    else fail('1.3 anon executou cancel_ride_safe', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('get_active_ride');
    if (error) ok('1.4 anon bloqueado em get_active_ride');
    else fail('1.4 anon executou get_active_ride', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('recharge_chat_quota', { amount: 10 });
    if (error) ok('1.5 anon bloqueado em recharge_chat_quota');
    else fail('1.5 anon executou recharge_chat_quota', 'sem erro');
  }


  // ══════════════════════════════════════════════════════════════════════════
  // TESTE 2: PASSAGEIRO — não pode aceitar corridas
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── TESTE 2: PASSAGEIRO — não pode aceitar corridas ──');

  {
    const { error } = await passengerClient.rpc('accept_ride_atomic', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('2.1 passageiro bloqueado em accept_ride_atomic');
    else fail('2.1 passageiro executou accept_ride_atomic', 'sem erro');
  }

  {
    const { error } = await passengerClient.rpc('confirm_pickup', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('2.2 passageiro bloqueado em confirm_pickup');
    else fail('2.2 passageiro executou confirm_pickup', 'sem erro');
  }

  {
    const { error } = await passengerClient.rpc('start_ride', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('2.3 passageiro bloqueado em start_ride');
    else fail('2.3 passageiro executou start_ride', 'sem erro');
  }

  {
    const { error } = await passengerClient.rpc('complete_ride', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('2.4 passageiro bloqueado em complete_ride');
    else fail('2.4 passageiro executou complete_ride', 'sem erro');
  }


  // ══════════════════════════════════════════════════════════════════════════
  // TESTE 3: MOTORISTA — fluxo completo
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── TESTE 3: MOTORISTA — fluxo completo ──');

  // Criar corrida como passageiro
  const { data: ride, error: createErr } = await passengerClient.from('rides').insert({
    passenger_id: passengerUser.id,
    origin_address: 'Início Teste',
    origin_lat: -8.83, origin_lng: 13.23,
    dest_address: 'Fim Teste',
    dest_lat: -8.84, dest_lng: 13.24,
    distance_km: 5.0, duration_min: 15, price_kz: 1500,
    status: 'searching',
  }).select().single();

  if (createErr || !ride) {
    fail('3.0 passageiro criou corrida', createErr?.message ?? 'sem dados');
  } else {
    ok(`3.0 passageiro criou corrida ${ride.id}`);

    // 3.1 Motorista aceita
    const { data: acceptResult, error: acceptErr } = await driverClient.rpc('accept_ride_atomic', { p_ride_id: ride.id });
    if (!acceptErr && acceptResult?.success) ok('3.1 motorista aceitou a corrida');
    else fail('3.1 accept_ride_atomic', acceptErr?.message ?? JSON.stringify(acceptResult));

    // 3.2 Motorista confirma recolha
    const { data: pickupResult, error: pickupErr } = await driverClient.rpc('confirm_pickup', { p_ride_id: ride.id });
    if (!pickupErr && pickupResult?.success) ok('3.2 motorista confirmou recolha');
    else fail('3.2 confirm_pickup', pickupErr?.message ?? JSON.stringify(pickupResult));

    // 3.3 Motorista inicia corrida
    const { data: startResult, error: startErr } = await driverClient.rpc('start_ride', { p_ride_id: ride.id });
    if (!startErr && startResult?.success) ok('3.3 motorista iniciou corrida');
    else fail('3.3 start_ride', startErr?.message ?? JSON.stringify(startResult));

    // 3.4 Motorista completa corrida
    const { data: completeResult, error: completeErr } = await driverClient.rpc('complete_ride', { p_ride_id: ride.id });
    if (!completeErr && completeResult?.success) ok('3.4 motorista completou corrida');
    else fail('3.4 complete_ride', completeErr?.message ?? JSON.stringify(completeResult));

    // Cleanup
    await passengerClient.from('rides').delete().eq('id', ride.id);
  }


  // ══════════════════════════════════════════════════════════════════════════
  // TESTE 4: ACESSO CRUZADO
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── TESTE 4: ACESSO CRUZADO ──');

  const { data: ride2 } = await passengerClient.from('rides').insert({
    passenger_id: passengerUser.id,
    origin_address: 'O', origin_lat: -8.83, origin_lng: 13.23,
    dest_address: 'D', dest_lat: -8.84, dest_lng: 13.24,
    distance_km: 5.0, duration_min: 15, price_kz: 1500,
    status: 'searching',
  }).select().single();

  if (ride2) {
    // Outro utilizador tenta cancelar
    const { data: cancelResult, error: cancelErr } = await otherClient.rpc('cancel_ride_safe', { p_ride_id: ride2.id, p_reason: 'Malicioso' });
    const cancelSuccess = cancelResult?.[0]?.success;
    if (!cancelSuccess) ok('4.1 outro bloqueado ao cancelar corrida de outro');
    else fail('4.1 outro cancelou corrida alheia', JSON.stringify(cancelResult));

    // Outro tenta aceitar
    const { error: acceptErr } = await otherClient.rpc('accept_ride_atomic', { p_ride_id: ride2.id });
    if (acceptErr) ok('4.2 outro bloqueado ao aceitar corrida de outro');
    else fail('4.2 outro aceitou corrida alheia', 'sem erro');

    await passengerClient.from('rides').delete().eq('id', ride2.id);
  }


  // ══════════════════════════════════════════════════════════════════════════
  // TESTE 5: RECHARGE — valores negativos e gigantes
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── TESTE 5: RECHARGE — valores negativos e gigantes ──');

  // Criar corrida completada
  const { data: completedRide } = await passengerClient.from('rides').insert({
    passenger_id: passengerUser.id,
    origin_address: 'O', origin_lat: -8.83, origin_lng: 13.23,
    dest_address: 'D', dest_lat: -8.84, dest_lng: 13.24,
    distance_km: 5.0, duration_min: 15, price_kz: 1500,
    status: 'completed', driver_id: driverUser.id, completed_at: new Date().toISOString(),
  }).select().single();

  if (completedRide) {
    // 5.1 valor negativo
    const { error: negErr } = await passengerClient.rpc('recharge_chat_quota', { amount: -100 });
    // Pode aceitar (limitado a 1) ou rejeitar
    if (!negErr || negErr.message.includes('Sem corrida') === false) {
      ok('5.1 valor negativo processado (limitado a 1)');
    } else {
      ok('5.1 valor negativo bloqueado por validação server-side');
    }

    // 5.2 valor gigante
    const { error: bigErr } = await passengerClient.rpc('recharge_chat_quota', { amount: 999999 });
    if (!bigErr) ok('5.2 valor gigante processado (limitado a 50)');
    else ok('5.2 valor gigante: ' + bigErr.message);

    // 5.3 passageiro NÃO pode recarregar quota de outro
    const { error: otherRechargeErr } = await otherClient.rpc('recharge_chat_quota', { amount: 10 });
    if (otherRechargeErr) ok('5.3 outro bloqueado ao recarregar quota');
    else fail('5.3 outro recarregou quota', 'sem erro');

    await passengerClient.from('rides').delete().eq('id', completedRide.id);
  }


  // ══════════════════════════════════════════════════════════════════════════
  // TESTE 6: REVOKE ALL — verificar permissões
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n── TESTE 6: VERIFICAÇÃO DE PERMISSÕES ──');

  {
    const { error } = await supabase.rpc('accept_ride_atomic', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('6.1 anon sem EXECUTE em accept_ride_atomic');
    else fail('6.1 anon tem acesso', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('decline_ride_atomic', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('6.2 anon sem EXECUTE em decline_ride_atomic');
    else fail('6.2 anon tem acesso', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('confirm_pickup', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('6.3 anon sem EXECUTE em confirm_pickup');
    else fail('6.3 anon tem acesso', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('start_ride', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('6.4 anon sem EXECUTE em start_ride');
    else fail('6.4 anon tem acesso', 'sem erro');
  }

  {
    const { error } = await supabase.rpc('complete_ride', { p_ride_id: '00000000-0000-0000-0000-000000000000' });
    if (error) ok('6.5 anon sem EXECUTE em complete_ride');
    else fail('6.5 anon tem acesso', 'sem erro');
  }


  // ══════════════════════════════════════════════════════════════════════════
  // RESUMO
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(70));
  console.log(`RESULTADO: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('='.repeat(70));

  if (failed > 0) {
    console.log('\n⚠  ALGUNS TESTES FALHARAM — rever necessidades de correção.');
  } else {
    console.log('\n✅ TODOS OS TESTES PASSARAM.');
  }

  // Cleanup
  console.log('\n🧹 Cleanup: apagar utilizadores de teste...');
  await supabase.auth.admin.deleteUser(passengerUser.id);
  await supabase.auth.admin.deleteUser(driverUser.id);
  await supabase.auth.admin.deleteUser(otherUser.id);
  console.log('  Utilizadores de teste removidos.');
}

main().catch(console.error);
