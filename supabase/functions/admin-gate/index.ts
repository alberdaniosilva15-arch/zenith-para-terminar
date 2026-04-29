import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyCors,
  corsForbidden,
  resolveCorsHeaders,
} from '../_shared/cors.ts';

const ATTEMPT_LIMIT = 5;
const WINDOW_SECONDS = 300;
const CORS_OPTIONS = {
  methods: 'POST, OPTIONS',
};

function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Headers | null,
): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return applyCors(response, corsHeaders);
}

async function getAttemptCount(
  supabase: ReturnType<typeof getAdminClient>,
  ip: string,
) {
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();

  const { count, error } = await supabase
    .from('admin_gate_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', windowStart);

  if (error) {
    console.error('[admin-gate] Erro ao contar tentativas:', error.message);
    return 0;
  }

  return count ?? 0;
}

async function recordAttempt(
  supabase: ReturnType<typeof getAdminClient>,
  ip: string,
  userAgent: string,
) {
  await supabase.from('admin_gate_attempts').insert({
    ip,
    user_agent: userAgent,
  });
}

function timingSafeSecretCompare(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const providedBytes = encoder.encode(provided);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(providedBytes.length, expectedBytes.length, 1);

  const providedPadded = new Uint8Array(length);
  const expectedPadded = new Uint8Array(length);
  providedPadded.set(providedBytes);
  expectedPadded.set(expectedBytes);

  return (
    timingSafeEqual(providedPadded, expectedPadded) &&
    providedBytes.length === expectedBytes.length
  );
}

serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req, CORS_OPTIONS);
  if (req.headers.get('Origin') && !corsHeaders) {
    return corsForbidden();
  }

  if (req.method === 'OPTIONS') {
    return applyCors(new Response(null, { status: 204 }), corsHeaders);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  const ip =
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown';

  const userAgent = req.headers.get('user-agent') ?? 'unknown';
  const supabase = getAdminClient();
  const attempts = await getAttemptCount(supabase, ip);

  if (attempts >= ATTEMPT_LIMIT) {
    console.warn(`[admin-gate] Rate limit atingido para IP: ${ip}`);
    return jsonResponse(
      {
        error: 'Demasiadas tentativas. Aguarda 5 minutos.',
        retry_after: WINDOW_SECONDS,
      },
      429,
      corsHeaders,
    );
  }

  let body: { masterKey?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Body invalido' }, 400, corsHeaders);
  }

  const { masterKey, userId } = body;
  if (!masterKey || !userId) {
    return jsonResponse(
      { error: 'masterKey e userId sao obrigatorios' },
      400,
      corsHeaders,
    );
  }

  const validKey = Deno.env.get('ZENITH_MASTER_KEY');
  if (!validKey) {
    console.error('[admin-gate] ZENITH_MASTER_KEY nao definida.');
    return jsonResponse(
      { error: 'Configuracao do servidor incompleta' },
      500,
      corsHeaders,
    );
  }

  const isValid = timingSafeSecretCompare(masterKey, validKey);
  if (!isValid) {
    await recordAttempt(supabase, ip, userAgent);
    console.warn(`[admin-gate] Chave invalida - IP: ${ip}`);
    return jsonResponse(
      {
        error: 'Chave mestra invalida',
        attempts_remaining: ATTEMPT_LIMIT - (attempts + 1),
      },
      403,
      corsHeaders,
    );
  }

  const { error: rpcError } = await supabase.rpc('promote_user_to_admin', {
    target_user_id: userId,
  });

  if (rpcError) {
    console.error('[admin-gate] Erro RPC:', rpcError.message);
    return jsonResponse(
      { error: 'Falha ao promover utilizador' },
      500,
      corsHeaders,
    );
  }

  return jsonResponse(
    { success: true, message: 'Utilizador promovido com sucesso' },
    200,
    corsHeaders,
  );
});
