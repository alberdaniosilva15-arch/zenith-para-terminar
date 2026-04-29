import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyCors,
  corsForbidden,
  resolveCorsHeaders,
} from '../_shared/cors.ts';

const MULTICAIXA_API_KEY = Deno.env.get('MULTICAIXA_API_KEY')!;
const MULTICAIXA_MERCHANT_ID = Deno.env.get('MULTICAIXA_MERCHANT_ID')!;
const MULTICAIXA_BASE_URL =
  Deno.env.get('MULTICAIXA_BASE_URL') ??
  'https://api-sandbox.multicaixaexpress.ao/v1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MIN_TOP_UP = 500;
const MAX_TOP_UP = 500_000;
const CORS_OPTIONS = {
  methods: 'POST, OPTIONS',
};

type Action = 'initiate_payment' | 'check_status' | 'callback' | 'withdrawal';

type AuthenticatedUser = {
  id: string;
};

type PendingPaymentRow = {
  reference: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  phone_number: string | null;
};

function jsonOk(
  body: Record<string, unknown>,
  corsHeaders: Headers | null,
): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return applyCors(response, corsHeaders);
}

function jsonErr(
  message: string,
  status: number,
  corsHeaders: Headers | null,
): Response {
  const response = new Response(
    JSON.stringify({
      error: true,
      message,
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  return applyCors(response, corsHeaders);
}

function createSupabaseAdmin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

async function authenticateUser(
  authHeader: string | null,
): Promise<AuthenticatedUser | null> {
  if (!authHeader) {
    return null;
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabaseUser.auth.getUser();

  if (error || !user) {
    return null;
  }

  return { id: user.id };
}

function generateReference(): string {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return `ZENITH-MCX-${Date.now()}-${suffix}`;
}

function normalizePendingPaymentStatus(
  status: string | null | undefined,
): PendingPaymentRow['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'CONFIRMED':
    case 'SUCCESS':
      return 'confirmed';
    case 'FAILED':
    case 'REJECTED':
    case 'EXPIRED':
      return 'failed';
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

async function verifyWebhookSignature(
  bodyText: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const signatureBytes = new Uint8Array(
    signature.match(/[\da-f]{2}/gi)?.map((part) => parseInt(part, 16)) ?? [],
  );

  if (signatureBytes.length === 0) {
    return false;
  }

  return crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(bodyText));
}

Deno.serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req, CORS_OPTIONS);
  if (req.headers.get('Origin') && !corsHeaders) {
    return corsForbidden();
  }

  if (req.method === 'OPTIONS') {
    return applyCors(new Response(null, { status: 204 }), corsHeaders);
  }

  if (req.method !== 'POST') {
    return jsonErr('Metodo nao suportado.', 405, corsHeaders);
  }

  try {
    const bodyText = await req.text();
    const parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    const signature = req.headers.get('X-Multicaixa-Signature');
    const parsedAction =
      typeof parsedBody.action === 'string' ? (parsedBody.action as Action) : null;
    const action = parsedAction ?? (signature ? 'callback' : null);

    if (!action) {
      return jsonErr('Accao em falta.', 400, corsHeaders);
    }

    const params =
      parsedAction === null
        ? parsedBody
        : Object.fromEntries(
            Object.entries(parsedBody).filter(([key]) => key !== 'action'),
          );

    const supabaseAdmin = createSupabaseAdmin();

    switch (action) {
      case 'initiate_payment': {
        const user = await authenticateUser(req.headers.get('Authorization'));
        if (!user) {
          return jsonErr('Sessao invalida.', 401, corsHeaders);
        }

        const { amount_kz, phone_number } = params as {
          amount_kz: number;
          phone_number: string;
        };

        if (!amount_kz || amount_kz < MIN_TOP_UP || amount_kz > MAX_TOP_UP) {
          return jsonErr(
            `Valor invalido. Min: ${MIN_TOP_UP} Kz | Max: ${MAX_TOP_UP} Kz`,
            400,
            corsHeaders,
          );
        }

        if (!/^9[0-9]{8}$/.test(phone_number)) {
          return jsonErr(
            'Numero de telefone invalido. Formato: 9XXXXXXXX',
            400,
            corsHeaders,
          );
        }

        // ── Idempotência: evitar pagamentos duplicados (double-click) ──
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data: existingPayment } = await supabaseAdmin
          .from('pending_payments')
          .select('reference, created_at')
          .eq('user_id', user.id)
          .eq('amount', amount_kz)
          .eq('status', 'pending')
          .gte('created_at', twoMinutesAgo)
          .order('created_at', { ascending: false })
          .limit(1);

        if (existingPayment && existingPayment.length > 0) {
          return jsonOk(
            {
              success: true,
              reference: existingPayment[0].reference,
              message: `Pagamento ja iniciado. Confirma no teu telemovel.`,
              already_initiated: true,
            },
            corsHeaders,
          );
        }

        const reference = generateReference();
        const mcxRes = await fetch(`${MULTICAIXA_BASE_URL}/payments/initiate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MULTICAIXA_API_KEY}`,
            'X-Merchant-Id': MULTICAIXA_MERCHANT_ID,
          },
          body: JSON.stringify({
            amount: amount_kz,
            currency: 'AOA',
            phone: `+244${phone_number}`,
            reference,
            description: `Carregamento Zenith Ride - ${user.id}`,
            callback_url: `${SUPABASE_URL}/functions/v1/multicaixa-pay`,
          }),
        });

        if (!mcxRes.ok) {
          const mcxErr = await mcxRes.json().catch(async () => ({
            raw: await mcxRes.text().catch(() => ''),
          }));
          console.error('[multicaixa-pay] Erro API:', mcxErr);
          return jsonErr(
            'Erro ao iniciar pagamento Multicaixa. Tenta de novo.',
            502,
            corsHeaders,
          );
        }

        const mcxData = await mcxRes.json();
        const { error: pendingError } = await supabaseAdmin
          .from('pending_payments')
          .insert({
            reference,
            user_id: user.id,
            amount: amount_kz,
            phone_number,
            provider: 'multicaixa',
            status: 'pending',
            provider_payload: mcxData,
          });

        if (pendingError) {
          console.error('[multicaixa-pay] Erro ao registar pagamento pendente:', pendingError);
          return jsonErr(
            'Falha ao registar o pagamento pendente. Contacta o suporte.',
            500,
            corsHeaders,
          );
        }

        return jsonOk(
          {
            success: true,
            reference,
            message: `Pedido enviado para ${phone_number}. Confirma no teu telemovel.`,
            payment_url: mcxData.payment_url ?? null,
            expires_at: mcxData.expires_at ?? null,
          },
          corsHeaders,
        );
      }

      case 'check_status': {
        const user = await authenticateUser(req.headers.get('Authorization'));
        if (!user) {
          return jsonErr('Sessao invalida.', 401, corsHeaders);
        }

        const { reference } = params as { reference: string };
        if (!reference || reference.length > 128) {
          return jsonErr('Referencia em falta.', 400, corsHeaders);
        }

        const { data: pendingPayment, error: pendingError } = await supabaseAdmin
          .from('pending_payments')
          .select('reference, amount, status')
          .eq('reference', reference)
          .eq('user_id', user.id)
          .maybeSingle();

        if (pendingError) {
          console.error('[multicaixa-pay] Erro ao consultar pending_payments:', pendingError);
          return jsonErr('Falha ao consultar pagamento.', 500, corsHeaders);
        }

        if (!pendingPayment) {
          return jsonErr('Pagamento nao encontrado.', 404, corsHeaders);
        }

        const mcxRes = await fetch(`${MULTICAIXA_BASE_URL}/payments/${reference}`, {
          headers: {
            Authorization: `Bearer ${MULTICAIXA_API_KEY}`,
            'X-Merchant-Id': MULTICAIXA_MERCHANT_ID,
          },
        });

        if (!mcxRes.ok) {
          return jsonErr('Pagamento nao encontrado.', 404, corsHeaders);
        }

        const data = await mcxRes.json();
        const normalizedStatus = normalizePendingPaymentStatus(data.status);

        if (normalizedStatus !== 'confirmed') {
          await supabaseAdmin
            .from('pending_payments')
            .update({
              status: normalizedStatus,
              provider_payload: data,
            })
            .eq('reference', reference)
            .neq('status', 'confirmed');
        } else {
          await supabaseAdmin
            .from('pending_payments')
            .update({
              provider_payload: data,
            })
            .eq('reference', reference);
        }

        return jsonOk(
          {
            status: data.status,
            amount: data.amount ?? pendingPayment.amount,
            reference,
            local_status: pendingPayment.status,
          },
          corsHeaders,
        );
      }

      case 'callback': {
        if (!signature) {
          return jsonErr('Assinatura em falta.', 401, corsHeaders);
        }

        const webhookSecret =
          Deno.env.get('MULTICAIXA_WEBHOOK_SECRET')?.trim() ?? '';
        if (!webhookSecret) {
          return jsonErr(
            'Webhook indisponivel: MULTICAIXA_WEBHOOK_SECRET em falta.',
            503,
            corsHeaders,
          );
        }

        const isValidSignature = await verifyWebhookSignature(
          bodyText,
          signature,
          webhookSecret,
        );

        if (!isValidSignature) {
          console.error('[multicaixa-pay] Falha na validacao HMAC do webhook.');
          return jsonErr('Assinatura invalida.', 401, corsHeaders);
        }

        const { reference, status, amount, payer_phone } = params as {
          reference: string;
          status: string;
          amount: number;
          payer_phone?: string;
        };
        const normalizedAmount = Number(amount);

        if (!reference || !status || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
          return jsonErr('Payload de callback invalido.', 400, corsHeaders);
        }

        const { data: pendingPayment, error: pendingError } = await supabaseAdmin
          .from('pending_payments')
          .select('reference, user_id, amount, status, phone_number')
          .eq('reference', reference)
          .maybeSingle();

        if (pendingError) {
          console.error('[multicaixa-pay] Erro ao ler pending_payments:', pendingError);
          return jsonErr('Erro ao validar pagamento.', 500, corsHeaders);
        }

        if (!pendingPayment) {
          return jsonErr('Pagamento pendente nao encontrado.', 404, corsHeaders);
        }

        const normalizedStatus = normalizePendingPaymentStatus(status);
        await supabaseAdmin
          .from('pending_payments')
          .update({
            callback_payload: {
              reference,
              status,
              amount: normalizedAmount,
              payer_phone: payer_phone ?? null,
              received_at: new Date().toISOString(),
            },
          })
          .eq('reference', reference);

        if (normalizedStatus !== 'confirmed') {
          await supabaseAdmin
            .from('pending_payments')
            .update({
              status: normalizedStatus,
            })
            .eq('reference', reference)
            .neq('status', 'confirmed');

          console.log(
            `[multicaixa-pay] Callback recebido para ${reference} com status ${status}`,
          );
          return jsonOk(
            {
              received: true,
              status,
            },
            corsHeaders,
          );
        }

        if (normalizedAmount !== Number(pendingPayment.amount)) {
          console.error('[multicaixa-pay] Valor do callback nao confere com pending_payments.', {
            reference,
            expected: pendingPayment.amount,
            received: normalizedAmount,
          });
          return jsonErr('Valor do callback nao confere.', 400, corsHeaders);
        }

        const { data: creditData, error: creditError } = await supabaseAdmin.rpc(
          'credit_wallet_atomic',
          {
            p_user_id: pendingPayment.user_id,
            p_amount: normalizedAmount,
            p_description: `Carregamento Multicaixa - Ref: ${reference}`,
            p_reference: reference,
          },
        );

        if (creditError) {
          console.error('[multicaixa-pay] Erro no credito atomico:', creditError);
          return jsonErr('Falha ao creditar saldo.', 500, corsHeaders);
        }

        const creditRow = Array.isArray(creditData) ? creditData[0] : creditData;
        const credited = Boolean(creditRow?.credited);

        console.log(
          `[multicaixa-pay] Callback processado para ${reference} - credited=${credited}`,
        );

        return jsonOk(
          {
            received: true,
            reference,
            credited: credited ? normalizedAmount : 0,
            already_processed: !credited,
          },
          corsHeaders,
        );
      }

      case 'withdrawal': {
        const user = await authenticateUser(req.headers.get('Authorization'));
        if (!user) {
          return jsonErr('Sessao invalida.', 401, corsHeaders);
        }

        const { amount_kz } = params as { amount_kz: number };
        if (!amount_kz || amount_kz < 1000) {
          return jsonErr('Levantamento minimo: 1.000 Kz', 400, corsHeaders);
        }

        const { data: userRow, error: userError } = await supabaseAdmin
          .from('users')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        if (userError) {
          console.error('[multicaixa-pay] Erro ao validar role do utilizador:', userError);
          return jsonErr('Falha ao validar o utilizador.', 500, corsHeaders);
        }

        if (!userRow || userRow.role !== 'driver') {
          return jsonErr(
            'Apenas motoristas podem solicitar levantamento.',
            403,
            corsHeaders,
          );
        }

        const { data: wallet, error: walletError } = await supabaseAdmin
          .from('wallets')
          .select('balance')
          .eq('user_id', user.id)
          .single();

        if (walletError) {
          console.error('[multicaixa-pay] Erro ao consultar wallet:', walletError);
          return jsonErr('Falha ao consultar saldo.', 500, corsHeaders);
        }

        if (!wallet || wallet.balance < amount_kz) {
          return jsonErr(
            'Saldo insuficiente para levantamento.',
            400,
            corsHeaders,
          );
        }

        const { error: withdrawalError } = await supabaseAdmin.rpc(
          'process_withdrawal',
          {
            p_user_id: user.id,
            p_amount: amount_kz,
          },
        );

        if (withdrawalError) {
          console.error('[multicaixa-pay] Erro ao processar levantamento:', withdrawalError);
          return jsonErr('Falha ao iniciar levantamento.', 500, corsHeaders);
        }

        return jsonOk(
          {
            success: true,
            message: `Levantamento de ${amount_kz.toLocaleString('pt-AO')} Kz iniciado. Processamento em 24h uteis.`,
          },
          corsHeaders,
        );
      }

      default:
        return jsonErr(`Accao desconhecida: "${action}"`, 400, corsHeaders);
    }
  } catch (error) {
    console.error('[multicaixa-pay] Erro:', error);
    return jsonErr('Erro interno.', 500, resolveCorsHeaders(req, CORS_OPTIONS));
  }
});
