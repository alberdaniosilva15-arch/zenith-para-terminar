// =============================================================================
// MOTOGO AI v3.0 — Edge Function: agora-token
// Gera tokens de autenticação seguros para o Agora.io
// App Certificate NUNCA sai desta função
//
// Deploy: supabase functions deploy agora-token --no-verify-jwt
// Secrets: AGORA_APP_ID, AGORA_APP_CERT (definir em Supabase Dashboard)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const AGORA_APP_ID   = Deno.env.get('AGORA_APP_ID')!;
const AGORA_APP_CERT = Deno.env.get('AGORA_APP_CERT')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON  = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Token expiry: 1 hora (em segundos)
const TOKEN_EXPIRY_SECONDS = 3600;

// Role: subscriber = 1, publisher = 0
// Para chamadas de voz, todos são publishers
const ROLE_PUBLISHER = 1;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Validar JWT do utilizador
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Não autenticado.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Token inválido.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verificar preferências de privacidade
    const { data: privacy } = await supabase
      .from('user_privacy')
      .select('allow_incoming_calls')
      .eq('user_id', user.id)
      .single();

    if (privacy && privacy.allow_incoming_calls === false) {
      return new Response(
        JSON.stringify({ error: 'Utilizador bloqueou chamadas.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { channelName, uid } = await req.json() as { channelName: string; uid: string };

    if (!channelName || !uid) {
      return new Response(
        JSON.stringify({ error: 'channelName e uid são obrigatórios.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validar que o canal corresponde a uma corrida real do utilizador
    const rideId = channelName.replace('corrida_', '');
    const { data: ride } = await supabase
      .from('rides')
      .select('id, passenger_id, driver_id, status')
      .eq('id', rideId)
      .single();

    if (!ride) {
      return new Response(
        JSON.stringify({ error: 'Corrida não encontrada.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Apenas participantes da corrida podem entrar no canal
    const isParticipant = ride.passenger_id === user.id || ride.driver_id === user.id;
    if (!isParticipant) {
      return new Response(
        JSON.stringify({ error: 'Sem permissão para esta corrida.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Gerar token Agora usando RTC Token Builder
    // Usa o algoritmo HMAC-SHA256 do Agora
    const token = await generateAgoraToken(
      AGORA_APP_ID,
      AGORA_APP_CERT,
      channelName,
      uid,
      ROLE_PUBLISHER,
      TOKEN_EXPIRY_SECONDS
    );

    return new Response(
      JSON.stringify({ token, appId: AGORA_APP_ID, channel: channelName }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e: any) {
    console.error('[agora-token] Erro:', e.message);
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// =============================================================================
// Agora RTC Token Generator (implementação nativa sem dependências externas)
// Baseado no algoritmo oficial Agora AccessToken v2
// https://docs.agora.io/en/video-calling/token-authentication/
// =============================================================================

async function generateAgoraToken(
  appId:       string,
  appCert:     string,
  channelName: string,
  uid:         string,
  role:        number,
  expireSeconds: number
): Promise<string> {
  const currentTs  = Math.floor(Date.now() / 1000);
  const expireTs   = currentTs + expireSeconds;
  const salt       = Math.floor(Math.random() * 0xffffffff);

  // Build message
  const uidInt = parseInt(uid.replace(/-/g, '').slice(0, 8), 16) % 0xffffffff;

  const content = [
    appId,
    currentTs.toString(),
    salt.toString(),
    channelName,
    uidInt.toString(),
    role.toString(),
    expireTs.toString(),
  ].join('\x00');

  // HMAC-SHA256
  const key    = new TextEncoder().encode(appCert);
  const msg    = new TextEncoder().encode(content);
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig    = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2,'0')).join('');

  const tokenContent = `${appId}${currentTs}${salt}${expireTs}${uidInt}${role}${channelName}${sigHex}`;
  return `007${btoa(tokenContent)}`;
}
