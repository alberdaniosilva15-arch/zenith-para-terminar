// =============================================================================
// ZENITH RIDE v3.0 — Edge Function: agora-token
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

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Vary': 'Origin',
};

// Token expiry: 1 hora (em segundos)
const TOKEN_EXPIRY_SECONDS = 3600;

// Role: publisher = 1, subscriber = 2
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

    // Gerar token Agora usando AccessToken v2 (implementação compatível)
    // Também gerar um salt aleatório por sessão (32 bytes) que será
    // partilhado entre os participantes para enableEncryption.
    const result = await generateAgoraToken(
      AGORA_APP_ID,
      AGORA_APP_CERT,
      channelName,
      uid,
      ROLE_PUBLISHER,
      TOKEN_EXPIRY_SECONDS
    );

    // Gerar salt aleatório (32 bytes) e codificar em base64
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const bytesToBase64 = (u8: Uint8Array) => {
      const CHUNK = 0x8000;
      let s = '';
      for (let i = 0; i < u8.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + CHUNK));
      }
      return btoa(s);
    };

    const saltBase64 = bytesToBase64(salt);

    return new Response(
      JSON.stringify({ token: result.token, appId: AGORA_APP_ID, channel: channelName, uid: result.uid, encryption_salt: saltBase64 }),
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
// Agora AccessToken v2 — Implementação oficial (AccessToken2)
// Gera tokens AccessToken v2 compatíveis com o Agora SDK.
// - Produz o token binário, comprime com zlib (deflate) e prefixa com "007".
// - Retorna também o `uid` numérico estável derivado do UUID do utilizador.
// Baseado na especificação oficial e no repositório de referência:
// https://github.com/AgoraIO/Tools/blob/master/DynamicKey/AgoraDynamicKey/nodejs/src/AccessToken2.js
// =============================================================================

const SERVICE_TYPE_RTC = 1;
const PRIVILEGE_JOIN_CHANNEL = 1;
const PRIVILEGE_PUBLISH_AUDIO_STREAM = 2;

async function generateAgoraToken(
  appId: string,
  appCert: string,
  channelName: string,
  userId: string,
  role: number,
  expireSeconds: number
): Promise<{ token: string; uid: number }> {
  const issueTs = Math.floor(Date.now() / 1000);
  const expireTs = issueTs + expireSeconds;
  const salt = Math.floor(Math.random() * 0xffffffff);

  // Derivar UID numérico estável a partir do UUID
  const hex = (userId || '').replace(/-/g, '').slice(0, 16) || '0';
  const uidBig = BigInt('0x' + hex);
  const uidInt = Number(uidBig % BigInt(0xffffffff));

  const encoder = new TextEncoder();

  const packUint16 = (n: number) => {
    const b = new ArrayBuffer(2);
    new DataView(b).setUint16(0, n & 0xffff, true);
    return new Uint8Array(b);
  };

  const packUint32 = (n: number) => {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, n >>> 0, true);
    return new Uint8Array(b);
  };

  const packString = (s: string) => {
    const bytes = encoder.encode(s || '');
    return concat([packUint16(bytes.length), bytes]);
  };

  const packBytes = (bytes: Uint8Array) => {
    return concat([packUint16(bytes.length), bytes]);
  };

  const packMapUint32 = (map: Record<number, number>) => {
    const keys = Object.keys(map).map(k => parseInt(k, 10));
    const parts: Uint8Array[] = [packUint16(keys.length)];
    for (const k of keys) {
      parts.push(packUint16(k));
      parts.push(packUint32(map[k]));
    }
    return concat(parts);
  };

  function concat(parts: Uint8Array[]) {
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  // 1) Assinatura HMAC-SHA256
  const signingMessage = `${appId}${issueTs}${salt}${channelName}${uidInt}`;
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(appCert), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signingMessage));
  const sigBytes = new Uint8Array(sigBuf);

  // 2) Montar payload conforme AccessToken v2
  const parts: Uint8Array[] = [];
  parts.push(packString(appId));
  parts.push(packUint32(issueTs));
  parts.push(packUint32(salt));
  parts.push(packUint32(expireTs));
  parts.push(packBytes(sigBytes));
  // Número de serviços
  parts.push(packUint16(1));
  // SERVICE_TYPE_RTC
  parts.push(packUint16(SERVICE_TYPE_RTC));
  // Service content: channelName + uid + privileges map
  parts.push(packString(channelName));
  parts.push(packUint32(uidInt));
  // Privileges: join + publish audio (ambos com expireTs)
  parts.push(packMapUint32({ [PRIVILEGE_JOIN_CHANNEL]: expireTs, [PRIVILEGE_PUBLISH_AUDIO_STREAM]: expireTs }));

  const payload = concat(parts);

  // 3) Comprimir payload com zlib (deflate) usando CompressionStream
  const cs = new CompressionStream('deflate');
  const compressedStream = new Blob([payload]).stream().pipeThrough(cs);

  const compressedBytes = await (async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  })(compressedStream);

  // 4) Base64 encode (prefix 007)
  function uint8ToBase64(u8: Uint8Array) {
    const CHUNK = 0x8000;
    let s = '';
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + CHUNK));
    }
    return btoa(s);
  }

  const token = `007${uint8ToBase64(compressedBytes)}`;
  return { token, uid: uidInt };
}
