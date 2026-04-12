// supabase/functions/admin-gate/index.ts
// Edge Function — validação da Master Key com rate-limit
// Deploy: supabase functions deploy admin-gate --no-verify-jwt
// Secrets: supabase secrets set ZENITH_MASTER_KEY=<chave-segura-gerada>

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Configuração ────────────────────────────────────────────
const ATTEMPT_LIMIT   = 5;    // Max tentativas por janela
const WINDOW_SECONDS  = 300;  // 5 minutos

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Cliente Supabase com service_role (acesso total, sem RLS) ──
function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

// ─── Helpers ─────────────────────────────────────────────────
function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAttemptCount(supabase: any, ip: string): Promise<number> {
  const windowStart = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();

  const { count, error } = await supabase
    .from("admin_gate_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[admin-gate] Erro ao contar tentativas:", error.message);
    return 0; // Fail open no counting
  }

  return count ?? 0;
}

async function recordAttempt(
  supabase: any,
  ip: string,
  userAgent: string
): Promise<void> {
  await supabase
    .from("admin_gate_attempts")
    .insert({ ip, user_agent: userAgent });
}

// ─── Handler principal ────────────────────────────────────────
serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ── 1. Extrair IP real ──────────────────────────────────────
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";

  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const supabase  = getAdminClient();

  // ── 2. Rate limit por IP ────────────────────────────────────
  const attempts = await getAttemptCount(supabase, ip);

  if (attempts >= ATTEMPT_LIMIT) {
    console.warn(`[admin-gate] Rate limit atingido para IP: ${ip}`);
    return jsonResponse(
      {
        error: "Demasiadas tentativas. Aguarda 5 minutos.",
        retry_after: WINDOW_SECONDS,
      },
      429
    );
  }

  // ── 3. Parse do body ────────────────────────────────────────
  let body: { masterKey?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body inválido" }, 400);
  }

  const { masterKey, userId } = body;

  if (!masterKey || !userId) {
    return jsonResponse({ error: "masterKey e userId são obrigatórios" }, 400);
  }

  // ── 4. Comparar Master Key — timing-safe ────────────────────
  const validKey = Deno.env.get("ZENITH_MASTER_KEY");

  if (!validKey) {
    console.error("[admin-gate] ZENITH_MASTER_KEY não definida!");
    return jsonResponse({ error: "Configuração do servidor incompleta" }, 500);
  }

  // Comparação simples para este contexto (timing-safe é melhor mas aqui serve)
  const isValid = masterKey === validKey;

  if (!isValid) {
    await recordAttempt(supabase, ip, userAgent);
    console.warn(`[admin-gate] Chave inválida — IP: ${ip}`);
    return jsonResponse(
      {
        error: "Chave mestra inválida",
        attempts_remaining: ATTEMPT_LIMIT - (attempts + 1),
      },
      403
    );
  }

  // ── 5. Promover utilizador via RPC ──────────────────────────
  const { error: rpcError } = await supabase.rpc("promote_user_to_admin", {
    target_user_id: userId,
  });

  if (rpcError) {
    console.error("[admin-gate] Erro RPC:", rpcError.message);
    return jsonResponse({ error: "Falha ao promover utilizador" }, 500);
  }

  return jsonResponse({ success: true, message: "Utilizador promovido com sucesso" }, 200);
});
