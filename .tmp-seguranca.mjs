/**
 * Regressão da migração 20260922120000_seguranca_papeis_e_documentos.sql
 *
 * Duas metades, e a segunda é tão importante como a primeira:
 *
 *   A) Os buracos FECHARAM?
 *      1. Um passageiro sem documentos não se torna motorista.
 *      2. Um passageiro não escreve `approved` no seu próprio documento
 *         (o gatilho tem de o forçar a 'pending').
 *      3. Um passageiro sem frota não se torna dono de frota.
 *      4. Um passageiro sem o papel não cria frota.
 *
 *   B) O caminho LEGÍTIMO continua a funcionar?
 *      5. Submeter documentos grava mesmo 'pending'.
 *      6. Depois de um admin aprovar, `set_my_role_driver` deixa passar.
 *
 * A aprovação (passo 6) é feita pelo CLI do Supabase, entre as duas fases —
 * não há aqui nenhuma chave de admin.
 *
 * Uso:
 *   node .tmp-seguranca.mjs            -> fase A (e guarda a sessão)
 *   node .tmp-seguranca.mjs --pos      -> fase B (depois de o admin aprovar)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const URL = process.env.SB_URL;
const ANON = process.env.SB_ANON;
const SESSAO = '.tmp-seguranca-sessao.json';

if (!URL || !ANON) {
  console.error('Faltam SB_URL / SB_ANON.');
  process.exit(1);
}

const resultados = [];
function registar(nome, ok, detalhe) {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'OK   ' : 'FALHA'} | ${nome} | ${detalhe}`);
}

const H = (token) => ({
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

async function rpc(token, fn, args = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: H(token),
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.text() };
}

async function papelDe(u) {
  const r = await fetch(`${URL}/rest/v1/users?select=role&id=eq.${u.uid}`, { headers: H(u.token) });
  const j = await r.json();
  return Array.isArray(j) && j[0] ? j[0].role : `?${JSON.stringify(j).slice(0, 90)}`;
}

async function signup(etiqueta, sufixo) {
  const email = `seg_${etiqueta}_${sufixo}@exemplo-zenith.test`;
  const password = `Seguranca${sufixo}9`;
  const r = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`signup falhou: ${JSON.stringify(j)}`);
  return { token: j.access_token, uid: j.user.id, email, password };
}

async function faseA() {
  const sufixo = Date.now().toString(36);
  const u = await signup('alvo', sufixo);
  console.log(`conta: ${u.uid}  ${u.email}\n`);

  // 1. Não se torna motorista sem documentos aprovados
  const r1 = await rpc(u.token, 'set_my_role_driver');
  const p1 = await papelDe(u);
  registar(
    'passageiro sem documentos NAO vira motorista',
    p1 === 'passenger' && r1.status >= 400,
    `HTTP ${r1.status} papel=${p1}`,
  );

  // 2. O gatilho força 'pending' mesmo que o cliente peça 'approved'
  const ins = await fetch(`${URL}/rest/v1/driver_documents`, {
    method: 'POST',
    headers: { ...H(u.token), Prefer: 'return=representation' },
    body: JSON.stringify({
      driver_id: u.uid,
      car_brand: 'Toyota',
      car_model: 'Corolla',
      car_plate: `LD-${sufixo.slice(0, 4).toUpperCase()}`,
      car_color: 'Preto',
      status: 'approved', // <- o cliente a tentar aprovar-se a si próprio
    }),
  });
  const insTxt = await ins.text();
  let statusGravado = '?';
  try {
    const j = JSON.parse(insTxt);
    statusGravado = Array.isArray(j) ? j[0]?.status : j?.status;
  } catch { /* fica '?' */ }
  registar(
    'cliente a pedir approved grava pending',
    ins.status === 201 && statusGravado === 'pending',
    `HTTP ${ins.status} status gravado=${statusGravado}`,
  );

  // 2b. E numa actualização também não se promove a si próprio
  const upd = await fetch(
    `${URL}/rest/v1/driver_documents?driver_id=eq.${u.uid}`,
    {
      method: 'PATCH',
      headers: { ...H(u.token), Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'approved' }),
    },
  );
  const updTxt = await upd.text();
  let statusUpd = '?';
  try {
    const j = JSON.parse(updTxt);
    statusUpd = Array.isArray(j) ? j[0]?.status : j?.status;
  } catch { /* fica '?' */ }
  registar(
    'cliente a pedir approved por PATCH continua pending',
    statusUpd === 'pending',
    `HTTP ${upd.status} status=${statusUpd}`,
  );

  // 3. Não se torna dono de frota sem frota
  const r3 = await rpc(u.token, 'set_my_role_fleet_owner');
  const p3 = await papelDe(u);
  registar(
    'passageiro sem frota NAO vira dono de frota',
    p3 === 'passenger' && r3.status >= 400,
    `HTTP ${r3.status} papel=${p3}`,
  );

  // 4. Não cria frota sem o papel
  const r4 = await fetch(`${URL}/rest/v1/fleets`, {
    method: 'POST',
    headers: { ...H(u.token), Prefer: 'return=representation' },
    body: JSON.stringify({ owner_id: u.uid, name: `Frota Pirata ${sufixo}` }),
  });
  const r4Txt = await r4.text();
  registar(
    'passageiro sem papel NAO cria frota',
    r4.status >= 400,
    `HTTP ${r4.status} ${r4Txt.slice(0, 110)}`,
  );

  // 5. O caminho legítimo grava 'pending'
  registar(
    'submeter documentos grava pending (caminho legitimo)',
    statusGravado === 'pending',
    `status=${statusGravado}`,
  );

  writeFileSync(SESSAO, JSON.stringify({ uid: u.uid, email: u.email, token: u.token, password: u.password }, null, 2));
  console.log(`\nsessao guardada em ${SESSAO}`);
  console.log(`\n>>> AGORA APROVA O DOCUMENTO (SQL) e corre: node .tmp-seguranca.mjs --pos`);
  console.log(`uid: ${u.uid}`);
}

async function faseB() {
  const s = JSON.parse(readFileSync(SESSAO, 'utf8'));
  const u = { uid: s.uid, token: s.token };

  const r = await rpc(u.token, 'set_my_role_driver');
  const p = await papelDe(u);
  registar(
    'com documento APROVADO, vira motorista',
    p === 'driver' && r.status < 400,
    `HTTP ${r.status} papel=${p}`,
  );

  const loc = await fetch(`${URL}/rest/v1/driver_locations?select=driver_id&driver_id=eq.${u.uid}`, {
    headers: H(u.token),
  });
  const locTxt = await loc.text();
  registar(
    'virar motorista NAO poe ninguem online',
    locTxt.trim() === '[]',
    `driver_locations=${locTxt.slice(0, 90)}`,
  );

  // ── Um aprovado não se rebaixa nem se re-aprova sozinho ──────────────────
  //
  // Este é o caso que protege PRODUÇÃO enquanto o cliente novo não estiver
  // publicado: o cliente antigo escreve `status: 'approved'` a cada corrida
  // aceite. Se isso rebaixasse o documento, cada corrida desfazia a verificação
  // de um motorista.
  async function patchStatus(novo) {
    const r = await fetch(`${URL}/rest/v1/driver_documents?driver_id=eq.${u.uid}`, {
      method: 'PATCH',
      headers: { ...H(u.token), Prefer: 'return=representation' },
      body: JSON.stringify({ status: novo }),
    });
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      return Array.isArray(j) ? j[0]?.status : j?.status;
    } catch { return `?${t.slice(0, 60)}`; }
  }

  const depoisApproved = await patchStatus('approved');
  registar(
    'ja aprovado, a pedir approved de novo NAO rebaixa',
    depoisApproved === 'approved',
    `status=${depoisApproved}`,
  );

  const depoisRejected = await patchStatus('rejected');
  registar(
    'utilizador comum NAO consegue rejeitar-se',
    depoisRejected === 'approved',
    `status=${depoisRejected}`,
  );

  const depoisPending = await patchStatus('pending');
  registar(
    'utilizador comum PODE pedir revisao (pending)',
    depoisPending === 'pending',
    `status=${depoisPending}`,
  );

  console.log(`\n=== APAGAR ===\n${s.uid}  ${s.email}`);
}

const fase = process.argv.includes('--pos') ? faseB : faseA;
fase()
  .then(() => {
    const ok = resultados.filter((r) => r.ok).length;
    console.log(`\n${ok}/${resultados.length} verificacoes OK`);
    if (ok !== resultados.length) process.exitCode = 1;
  })
  .catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
