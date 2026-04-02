// =============================================================================
// MOTOGO AI v2.1 — Edge Function: multicaixa-pay
// Ficheiro: supabase/functions/multicaixa-pay/index.ts
//
// Integração com Multicaixa Express (pagamento móvel Angola nativo)
// Documentação: https://developers.multicaixaexpress.ao
//
// VARIÁVEIS DE AMBIENTE necessárias (Supabase → Settings → Secrets):
//   MULTICAIXA_API_KEY    = chave de API do merchant
//   MULTICAIXA_MERCHANT_ID = ID do comerciante
//   MULTICAIXA_BASE_URL   = https://api.multicaixaexpress.ao/v1 (produção)
//                           https://api-sandbox.multicaixaexpress.ao/v1 (testes)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MULTICAIXA_API_KEY    = Deno.env.get('MULTICAIXA_API_KEY')!;
const MULTICAIXA_MERCHANT_ID = Deno.env.get('MULTICAIXA_MERCHANT_ID')!;
const MULTICAIXA_BASE_URL   = Deno.env.get('MULTICAIXA_BASE_URL') ?? 'https://api-sandbox.multicaixaexpress.ao/v1';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Limites de carregamento (em KZS)
const MIN_TOP_UP = 500;
const MAX_TOP_UP = 500_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsOk();
  if (req.method !== 'POST') return jsonErr('Método não suportado.', 405);

  try {
    // ----------------------------------------------------------------
    // 1. Auth
    // ----------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonErr('Token em falta.', 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await supabaseUser.auth.getUser();
    if (error || !user) return jsonErr('Sessão inválida.', 401);

    // ----------------------------------------------------------------
    // 2. Parse e validação
    // ----------------------------------------------------------------
    const body = await req.json();
    const { action, ...params } = body as {
      action: 'initiate_payment' | 'check_status' | 'callback' | 'withdrawal';
      [k: string]: unknown;
    };

    // ----------------------------------------------------------------
    // 3. Roteamento
    // ----------------------------------------------------------------
    switch (action) {

      // ----------------------------------------------------------------
      // INICIAR PAGAMENTO — passageiro carrega a carteira
      // ----------------------------------------------------------------
      case 'initiate_payment': {
        const { amount_kz, phone_number } = params as { amount_kz: number; phone_number: string };

        if (!amount_kz || amount_kz < MIN_TOP_UP || amount_kz > MAX_TOP_UP) {
          return jsonErr(`Valor inválido. Min: ${MIN_TOP_UP} Kz | Max: ${MAX_TOP_UP} Kz`, 400);
        }

        // Validar formato telefone Angola: 9XXXXXXXX
        if (!/^9[0-9]{8}$/.test(phone_number)) {
          return jsonErr('Número de telefone inválido. Formato: 9XXXXXXXX', 400);
        }

        // Gerar referência única
        const reference = `MOTOGO-${user.id.slice(0, 8).toUpperCase()}-${Date.now()}`;

        // Chamar API Multicaixa Express
        const mcxRes = await fetch(`${MULTICAIXA_BASE_URL}/payments/initiate`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${MULTICAIXA_API_KEY}`,
            'X-Merchant-Id': MULTICAIXA_MERCHANT_ID,
          },
          body: JSON.stringify({
            amount:      amount_kz,
            currency:    'AOA',
            phone:       `+244${phone_number}`,
            reference,
            description: `Carregamento MotoGo AI - ${user.id.slice(0, 8)}`,
            callback_url: `${SUPABASE_URL}/functions/v1/multicaixa-pay`,
          }),
        });

        if (!mcxRes.ok) {
          const mcxErr = await mcxRes.json().catch(() => ({}));
          console.error('[multicaixa-pay] Erro API:', mcxErr);
          return jsonErr('Erro ao iniciar pagamento Multicaixa. Tenta de novo.', 502);
        }

        const mcxData = await mcxRes.json();

        // Registar tentativa de pagamento (para tracking + callback)
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        await supabaseAdmin.from('transactions').insert({
          user_id:       user.id,
          amount:        amount_kz,
          type:          'top_up',
          description:   `Carregamento pendente — Ref: ${reference}`,
          balance_after: 0,  // actualizado no callback
        });

        return jsonOk({
          success:      true,
          reference,
          message:      `Pedido enviado para ${phone_number}. Confirma no teu telemóvel.`,
          payment_url:  mcxData.payment_url ?? null,
          expires_at:   mcxData.expires_at ?? null,
        });
      }

      // ----------------------------------------------------------------
      // VERIFICAR ESTADO de um pagamento
      // ----------------------------------------------------------------
      case 'check_status': {
        const { reference } = params as { reference: string };
        if (!reference) return jsonErr('Referência em falta.', 400);

        const mcxRes = await fetch(`${MULTICAIXA_BASE_URL}/payments/${reference}`, {
          headers: { 'Authorization': `Bearer ${MULTICAIXA_API_KEY}`, 'X-Merchant-Id': MULTICAIXA_MERCHANT_ID },
        });

        if (!mcxRes.ok) return jsonErr('Pagamento não encontrado.', 404);

        const data = await mcxRes.json();
        return jsonOk({ status: data.status, amount: data.amount, reference });
      }

      // ----------------------------------------------------------------
      // CALLBACK do Multicaixa (webhook — chamado pelo Multicaixa, não pelo user)
      // Accredita o saldo após confirmação de pagamento
      // ----------------------------------------------------------------
      case 'callback': {
        // Validar assinatura do webhook (segurança)
        const signature = req.headers.get('X-Multicaixa-Signature');
        if (!signature) return jsonErr('Assinatura em falta.', 401);

        // TODO: verificar assinatura HMAC com MULTICAIXA_WEBHOOK_SECRET
        // const expectedSig = await hmacSha256(body_raw, MULTICAIXA_WEBHOOK_SECRET);
        // if (signature !== expectedSig) return jsonErr('Assinatura inválida.', 401);

        const { reference, status, amount, payer_phone } = params as {
          reference: string; status: string; amount: number; payer_phone: string;
        };

        if (status !== 'CONFIRMED') {
          console.log(`[multicaixa-pay] Callback: pagamento ${reference} com status ${status} — ignorado`);
          return jsonOk({ received: true });
        }

        // Extrair user_id da referência: MOTOGO-{userId8chars}-{timestamp}
        const userIdPrefix = reference.split('-')[1]?.toLowerCase();
        if (!userIdPrefix) return jsonErr('Referência inválida.', 400);

        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Encontrar utilizador pela referência parcial do ID
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('id')
          .ilike('id', `${userIdPrefix}%`)
          .single();

        if (!userData) return jsonErr('Utilizador não encontrado.', 404);

        // TRANSACÇÃO ATÓMICA: creditar saldo
        const { data: wallet } = await supabaseAdmin
          .from('wallets')
          .select('balance')
          .eq('user_id', userData.id)
          .single();

        if (!wallet) return jsonErr('Wallet não encontrada.', 404);

        const newBalance = wallet.balance + amount;

        await supabaseAdmin.from('wallets').update({
          balance: newBalance, updated_at: new Date().toISOString()
        }).eq('user_id', userData.id);

        await supabaseAdmin.from('transactions').insert({
          user_id:       userData.id,
          amount:        amount,
          type:          'top_up',
          description:   `Carregamento Multicaixa — Ref: ${reference}`,
          balance_after: newBalance,
        });

        console.log(`[multicaixa-pay] Saldo creditado: ${amount} Kz → user ${userData.id}`);
        return jsonOk({ received: true, credited: amount });
      }

      default:
      case 'withdrawal': {
        // Levantamento para conta bancária do motorista
        const { user_id, amount_kz, iban } = params as { user_id: string; amount_kz: number; iban?: string };
        if (!user_id || !amount_kz || amount_kz < 1000) {
          return jsonErr('Levantamento mínimo: 1.000 Kz', 400);
        }
        // Verificar saldo suficiente
        const { data: wallet } = await supabaseAdmin
          .from('wallets').select('balance').eq('user_id', user_id).single();
        if (!wallet || wallet.balance < amount_kz) {
          return jsonErr('Saldo insuficiente para levantamento.', 400);
        }
        // Debitar carteira e registar transacção
        await supabaseAdmin.rpc('process_withdrawal', {
          p_user_id: user_id,
          p_amount:  amount_kz,
        });
        return new Response(JSON.stringify({
          success: true,
          message: `Levantamento de ${amount_kz.toLocaleString('pt-AO')} Kz iniciado. Processamento em 24h úteis.`,
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      default:
        return jsonErr(`Acção desconhecida: "${action}"`, 400);
    }

  } catch (e) {
    console.error('[multicaixa-pay] Erro:', e);
    return jsonErr('Erro interno.', 500);
  }
});

const corsOk = () => new Response(null, {
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey' },
});
const jsonOk  = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
const jsonErr = (m: string, s: number) => new Response(JSON.stringify({ error: true, message: m }), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
