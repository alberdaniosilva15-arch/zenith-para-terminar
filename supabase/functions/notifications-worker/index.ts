// =============================================================================
// ZENITH RIDE — notifications-worker
//
// Consome a fila `public.notifications_outbox` e entrega as notificações.
//
// ── Porque é que isto existe ─────────────────────────────────────────────────
//
// A migração 20260924220000 criou a tabela e um trigger que enfileira uma linha
// sempre que uma corrida passa a `accepted`. Mas nada consumia a fila: as linhas
// acumulavam-se e a notificação continuava a sair pelo caminho antigo — um
// `fetch` do TELEMÓVEL DO MOTORISTA (`notifyPassengerRideAccepted`). Se o
// motorista perdesse rede no instante do aceite, o passageiro nunca sabia.
//
// ── Como funciona ────────────────────────────────────────────────────────────
//
// É um DESPACHANTE, não um segundo emissor. A composição da mensagem (nome do
// motorista, contacto, avaliação, preço) vive no `whatsapp-webhook`, na acção
// `passenger_ride_accepted`. Duplicá-la aqui era criar duas fontes de verdade
// para o mesmo texto — e a segunda a ficar desactualizada.
//
// ── Dois caminhos, uma mensagem só ───────────────────────────────────────────
//
// O caminho principal NÃO foi removido: o telemóvel do motorista continua a
// chamar a acção directamente, e entrega em segundos. Este worker é a REDE DE
// SEGURANÇA por baixo dele.
//
//   • caminho do motorista → envia e fecha a linha (`status = 'sent'`)
//   • worker (cron)        → só apanha linhas que ficaram `pending`
//
// Para os dois não se cruzarem, o worker respeita uma carência (CARENCIA_MS):
// nunca toca numa linha com menos de 30 segundos. Se o motorista entregou, a
// linha já está fechada quando o worker olha; se perdeu rede, a linha continua
// `pending` e o worker entrega-a. Sem a carência, o cron podia chegar primeiro
// e o passageiro recebia a mensagem duas vezes.
//
// Autenticação: cabeçalho `x-cron-secret`, o mesmo padrão dos outros jobs do
// projecto (ver a migração 20260917120100). FAIL-CLOSED — sem nenhum dos
// segredos de cron configurado, a função recusa tudo.
//
// Invocação: job de cron a cada minuto (migração 20260925130000).
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Segredo do cron ──────────────────────────────────────────────────────────
//
// ⚠️ ARMADILHA JÁ PAGA (2026-09-25) — ler só o `CRON_SECRET` NÃO chega.
//
// O Vault guarda o valor do cron sob o nome `cron_secret`, mas esse valor é o
// do `SOS_CRON_SECRET` — não o do `CRON_SECRET`. Os dois existem no projecto com
// valores DIFERENTES. A primeira versão deste worker lia apenas o
// `CRON_SECRET`: o cron batia-lhe a cada minuto e levava 401 sempre, para
// sempre, em silêncio. A fila nunca andaria.
//
// Provado por digest, sem revelar o segredo: o sha256 do valor guardado no
// Vault é igual ao digest do `SOS_CRON_SECRET` (e diferente do `CRON_SECRET`).
// O digest exacto NÃO fica escrito aqui — o repositório é público, e publicar a
// impressão de um segredo vivo dá a qualquer um uma forma de o confirmar por
// tentativa.
//
// Aceitam-se os dois candidatos, como faz o `sos-escalation` (`segredoValido`).
const SEGREDOS_ACEITES = [
  Deno.env.get('SOS_CRON_SECRET') ?? '',
  Deno.env.get('CRON_SECRET') ?? '',
].filter((s) => s.length > 0);

/** Quantas linhas tratar por invocação. O cron corre a cada minuto. */
const LOTE = 25;

/** Espaçamento do recuo exponencial: 1 min, 2, 4, 8… com tecto de 30 min. */
const RECUO_BASE_MS = 60_000;
const RECUO_MAX_MS = 30 * 60_000;

/**
 * Carência antes de o worker tocar numa linha recém-criada.
 *
 * O caminho principal continua a ser o do telemóvel do motorista
 * (`notifyPassengerRideAccepted`), que entrega em segundos e fecha a linha. O
 * worker é a REDE DE SEGURANÇA: só deve apanhar o que ficou para trás.
 *
 * Sem esta carência, o cron (a cada minuto) podia chegar primeiro e o
 * passageiro recebia a mensagem DUAS vezes — uma pelo worker, outra pelo
 * telemóvel do motorista. Trinta segundos é folgado: a entrega do motorista ou
 * acontece em segundos ou não acontece.
 *
 * Só trava a PRIMEIRA tentativa: numa retentativa o `created_at` já é antigo,
 * e o espaçamento continua a ser governado por `next_retry_at`.
 */
const CARENCIA_MS = 30_000;

const CABECALHOS_JSON = { 'Content-Type': 'application/json' };

/**
 * Comparação de segredos em tempo constante. Um `===` sai no primeiro byte
 * diferente e o tempo dessa saída revela quantos bytes foram acertados.
 */
function compararSegredo(recebido: string, esperado: string): boolean {
  if (!esperado) return false;
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diferenca |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diferenca === 0;
}

/** Bate com algum dos candidatos? Sem candidatos, `false` (fail-closed). */
function segredoValido(recebido: string): boolean {
  if (!recebido) return false;
  return SEGREDOS_ACEITES.some((s) => compararSegredo(recebido, s));
}

type Resultado =
  | { ok: true }
  | { ok: false; motivo: string; definitivo?: boolean };

/**
 * Entrega uma linha da fila.
 *
 * `definitivo: true` significa "não vale a pena tentar outra vez" — por exemplo
 * uma corrida que já não existe, ou um `kind` que este worker não conhece.
 * Nesses casos a linha vai para `failed` sem gastar as tentativas todas.
 */
async function entregar(
  db: SupabaseClient,
  linha: { id: string; ride_id: string | null; kind: string },
  segredoRecebido: string,
): Promise<Resultado> {
  if (!linha.ride_id) {
    return { ok: false, motivo: 'linha sem ride_id', definitivo: true };
  }

  switch (linha.kind) {
    case 'ride_accepted_passenger': {
      // Repassa o MESMO segredo que recebeu do cron. Assim o webhook aceita-o
      // sem ter de saber qual dos candidatos é que está configurado.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-webhook`, {
        method: 'POST',
        headers: { ...CABECALHOS_JSON, 'x-cron-secret': segredoRecebido },
        body: JSON.stringify({
          action: 'passenger_ride_accepted',
          ride_id: linha.ride_id,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        const detalhe = await res.text().catch(() => '');
        return { ok: false, motivo: `whatsapp-webhook HTTP ${res.status}: ${detalhe.slice(0, 300)}` };
      }

      const corpo = await res.json().catch(() => ({})) as {
        success?: boolean;
        notified?: boolean;
        reason?: string;
      };

      // O webhook responde 200 mesmo quando não enviou nada (passageiro sem
      // telefone, por exemplo). Tratar isso como sucesso era mentir na fila.
      if (corpo.success === false) {
        const semTelefone = corpo.reason === 'passageiro_sem_telefone';
        return {
          ok: false,
          motivo: `whatsapp-webhook: ${corpo.reason ?? 'sem sucesso'}`,
          definitivo: semTelefone,
        };
      }
      return { ok: true };
    }

    default:
      return { ok: false, motivo: `kind desconhecido: ${linha.kind}`, definitivo: true };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CABECALHOS_JSON });
  }

  // FAIL-CLOSED. Sem nenhum segredo configurado não se atende ninguém.
  if (SEGREDOS_ACEITES.length === 0) {
    console.error(
      '[notifications-worker] Nem SOS_CRON_SECRET nem CRON_SECRET definidos — a recusar.',
    );
    return new Response(JSON.stringify({ error: 'Servico mal configurado.' }), {
      status: 500,
      headers: CABECALHOS_JSON,
    });
  }
  const segredoRecebido = req.headers.get('x-cron-secret') ?? '';
  if (!segredoValido(segredoRecebido)) {
    console.warn('[notifications-worker] Pedido recusado: segredo de cron invalido.');
    return new Response(JSON.stringify({ error: 'Nao autorizado.' }), {
      status: 401,
      headers: CABECALHOS_JSON,
    });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Recuperar linhas presas ────────────────────────────────────────────────
  //
  // Se uma invocação morrer a meio (timeout, deploy, erro do runtime), a linha
  // que ela reclamou fica em 'processing' para sempre — e como só se lê
  // 'pending', nunca mais é tentada. Sem esta limpeza, a fila apodrecia em
  // silêncio: exactamente o problema que este worker veio resolver.
  //
  // Cinco minutos é folgado: uma linha é entregue em segundos.
  const limitePresas = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: presas } = await db
    .from('notifications_outbox')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'processing')
    .lt('updated_at', limitePresas)
    .select('id');

  if (presas && presas.length > 0) {
    console.warn(`[notifications-worker] ${presas.length} linha(s) presa(s) em processing devolvida(s) a pending.`);
  }

  const agora = new Date();
  const limiteCarencia = new Date(agora.getTime() - CARENCIA_MS).toISOString();

  const { data: fila, error: erroFila } = await db
    .from('notifications_outbox')
    .select('id, ride_id, kind')
    .eq('status', 'pending')
    .lte('next_retry_at', agora.toISOString())
    .lt('created_at', limiteCarencia)
    .order('next_retry_at', { ascending: true })
    .limit(LOTE);

  if (erroFila) {
    console.error('[notifications-worker] Falha a ler a fila:', erroFila.message);
    return new Response(JSON.stringify({ error: erroFila.message }), {
      status: 500,
      headers: CABECALHOS_JSON,
    });
  }

  let enviados = 0;
  let falhados = 0;
  let adiados = 0;

  for (const linha of fila ?? []) {
    // Claim atómico: só ganha quem conseguir passar a linha de 'pending' para
    // 'processing'. Se duas invocações do cron se sobrepuserem, uma delas não
    // encontra a linha e segue em frente — sem enviar duas vezes.
    const { data: reclamada } = await db
      .from('notifications_outbox')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', linha.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (!reclamada) continue;

    const { data: estado } = await db
      .from('notifications_outbox')
      .select('attempts, max_attempts')
      .eq('id', linha.id)
      .maybeSingle();

    const tentativas = (estado?.attempts ?? 0) + 1;
    const maxTentativas = estado?.max_attempts ?? 5;

    let resultado: Resultado;
    try {
      resultado = await entregar(db, linha, segredoRecebido);
    } catch (err) {
      resultado = { ok: false, motivo: err instanceof Error ? err.message : String(err) };
    }

    if (resultado.ok) {
      enviados += 1;
      await db.from('notifications_outbox').update({
        status: 'sent',
        attempts: tentativas,
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', linha.id);
      continue;
    }

    // Falhou. Decidir entre desistir e tentar outra vez.
    const esgotou = tentativas >= maxTentativas;
    const desistir = resultado.definitivo === true || esgotou;

    // Recuo exponencial: 1 min, 2, 4, 8… com tecto de 30 min.
    const esperaMs = Math.min(RECUO_BASE_MS * 2 ** (tentativas - 1), RECUO_MAX_MS);

    await db.from('notifications_outbox').update({
      status: desistir ? 'failed' : 'pending',
      attempts: tentativas,
      last_error: resultado.motivo.slice(0, 1000),
      next_retry_at: new Date(Date.now() + esperaMs).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', linha.id);

    if (desistir) {
      falhados += 1;
      console.error(
        `[notifications-worker] Desisti da linha ${linha.id} (${linha.kind}) apos ${tentativas} tentativa(s): ${resultado.motivo}`,
      );
    } else {
      adiados += 1;
      console.warn(
        `[notifications-worker] Linha ${linha.id} (${linha.kind}) adiada ${Math.round(esperaMs / 1000)}s — tentativa ${tentativas}/${maxTentativas}: ${resultado.motivo}`,
      );
    }
  }

  const resumo = { enviados, falhados, adiados, lidas: fila?.length ?? 0 };
  console.log('[notifications-worker]', JSON.stringify(resumo));
  return new Response(JSON.stringify(resumo), { status: 200, headers: CABECALHOS_JSON });
});
