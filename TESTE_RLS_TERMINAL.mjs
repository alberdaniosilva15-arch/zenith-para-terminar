import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERRO: Faltam VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY. Podes passá-las diretamente como env vars ou tentar correr 'node --env-file=.env TESTE_RLS_TERMINAL.mjs'");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("\n======================================================================");
  console.log(" 🛑 TESTE DE SEGURANÇA AGRESSIVO: ATAQUE ANÓNIMO (SEM LOGIN)");
  console.log("======================================================================\n");
  console.log("-> A usar a chave PÚBLICA (VITE_SUPABASE_ANON_KEY) para aceder à BD.");
  console.log("-> Como anónimo devia receber erro imediatamente num sistema bem configurado.\n");
  await sleep(1500);

  // 1. SELECT DRIVER LOCATIONS - Verificar Fuga de GPS
  console.log("1️⃣ Tentar ROUBAR localizações de motoristas (Fuga de Dados GPS)...");
  const { data: dLocs, error: eLocs } = await supabase.from('driver_locations').select('driver_id, location, status, updated_at').limit(3);

  if (eLocs) {
    console.log(`✅ SUCESSO DE SEGURANÇA: O supabase bloqueou o acesso! Detalhe: [${eLocs.code}]: ${eLocs.message}`);
  } else if (dLocs && dLocs.length > 0) {
    console.log(`🚨 VAZAMENTO CRÍTICO DETECTADO! Consegui ler a localização GPS de ${dLocs.length} motorista(s)!`);
    console.table(dLocs.map(d => ({ DriverID: (d.driver_id || '').substring(0,6)+'...', Status: d.status, LocationObj: JSON.stringify(d.location) })));
  } else {
    console.log("⚠️ Leitura permitida, mas a tabela está vazia. Não temos 100% certeza de segurança.");
  }
  console.log("----------------------------------------------------------------------\n");
  await sleep(1500);

  // 2. SELECT RIDES - Verificar Fuga de Faturação
  console.log("2️⃣ Tentar ROUBAR o histórico de corridas e facturação...");
  const { data: dRides, error: eRides } = await supabase.from('rides').select('id, passenger_id, driver_id, status, price_kz').limit(3);

  if (eRides) {
    console.log(`✅ SUCESSO DE SEGURANÇA: O supabase bloqueou o acesso! Detalhe: [${eRides.code}]: ${eRides.message}`);
  } else if (dRides && dRides.length > 0) {
    console.log(`🚨 VAZAMENTO CRÍTICO DETECTADO! Consegui ler os detalhes de volume/facturação de ${dRides.length} corrida(s)!`);
    console.table(dRides.map(r => ({ RideID: (r.id || '').substring(0,6)+'...', Pax: (r.passenger_id || '').substring(0,4), Driver: (r.driver_id || '').substring(0,4), Status: r.status, KZ: r.price_kz })));
  } else {
    console.log("⚠️ Leitura permitida, mas a tabela está vazia.");
  }
  console.log("----------------------------------------------------------------------\n");
  await sleep(1500);

  // 3. DELETE DRIVER LOCATIONS - Ataque destrutivo de disponibilidade
  console.log("3️⃣ Ataque Sabotagem: Tentar APAGAR a localização de um motorista existente...");
  
  if (dLocs && dLocs.length > 0) {
    const targetDriver = dLocs[0].driver_id;
    console.log(`   -> Alvo fixado no ID: ${targetDriver}`);
    
    const { error: eDel } = await supabase.from('driver_locations').delete().eq('driver_id', targetDriver);
    
    if (eDel) {
      console.log(`✅ SUCESSO DE SEGURANÇA: Ação de deleção bloqueada! Detalhe: [${eDel.code}]: ${eDel.message}`);
    } else {
      console.log(`🚨 BRECHA DE SEGURANÇA MÁXIMA: Consegui apagar a localização do motorista sem estar logado!!`);
      
      // Tentamos restaurar para não estragar a BD de teste
      console.log(`   -> A restaurar registo automaticamente para manter o ambiente de teste limpo...`);
      await supabase.from('driver_locations').insert({
        driver_id: targetDriver,
        location: dLocs[0].location,
        status: dLocs[0].status
      });
    }
  } else {
    console.log("   -> Ignorado: Não há alvos disponíveis para testar deleção.");
  }
  console.log("\n======================================================================");
  console.log("👉 CONCLUSÃO: Se viste mensagens VERMELHAS de '🚨 VAZAMENTO CRÍTICO', os dados dos teus motoristas e facturação estão expostos a toda a internet via anon_key.");
}

runTests().catch(console.error);
