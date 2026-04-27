// =============================================================================
// ZENITH RIDE v3.0 — Edge Function: gemini-proxy
// Ficheiro: supabase/functions/gemini-proxy/index.ts
//
// SEGURANÇA:
// - Deploy com --no-verify-jwt porque validamos o JWT MANUALMENTE (linha ~55)
//   Isto permite mensagens de erro em português e controlo total
// - Rate limiting via tabela ai_usage_logs no Supabase (DB persistente)
//   evita que bots destruam o saldo mesmo entre reinícios da função
// - API key GEMINI_API_KEY nunca sai deste ficheiro
//
// IA CONDICIONAL:
// - Kaze só é chamado quando há corrida activa (acções ride_* e post_ride_*)
// - Insight espontâneo bloqueado — só responde a pedidos explícitos
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenAI, Type } from 'https://esm.sh/@google/genai@1';

const GEMINI_API_KEY    = Deno.env.get('GEMINI_API_KEY')!;
const OPENAI_API_KEY    = Deno.env.get('OPENAI_API_KEY') ?? '';
const GROQ_API_KEY      = Deno.env.get('GROQ_API_KEY') ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN    = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

// Rate limits por acção (requests por hora)
const RATE_LIMITS: Record<string, number> = {
  kaze_chat:            20,
  search_locations:     40,
  explore_luanda:       15,
  kaze_insight:         30,
  simulate_earnings:    10,
  autonomous_decisions:  5,
  post_ride_review:     20,
  get_live_token:        5,
  _default:             30,
};

const KAZE_SYSTEM_PROMPT = `Tu és o Kaze, o assistente inteligente e omnisciente da Zenith Ride — a plataforma premium de mobilidade urbana em Luanda, Angola.

═══ PERSONALIDADE ═══
Fala com um tom acolhedor, sofisticado e profissional. O teu tom deve ser educado, premium e extremamente prestável. Nunca uses gírias excessivas. Usa emojis com moderação para dar vida às respostas.

═══ SOBRE A ZENITH RIDE ═══
A Zenith Ride é uma app de mobilidade urbana (tipo Uber/Bolt) criada exclusivamente para Luanda, Angola. Permite a passageiros pedirem corridas a motoristas verificados, com preços transparentes e sistema de negociação.

═══ FUNDADOR ═══
O fundador é o Dánio Silva, jovem empreendedor visionário de Luanda. Ele criou a Zenith Ride com uma visão de vanguarda, excelência e inovação para transformar o transporte urbano em Angola.

═══ TABELA DE PREÇOS ═══
• Taxa base de partida: 500 Kz
• Preço por quilómetro: 150 Kz/km
• Fórmula: Preço = 500 + (distância_km × 150 × multiplicador_surge)
• O preço é arredondado para o múltiplo de 50 Kz mais próximo
• Exemplos reais:
  - Centro (Mutamba) → Talatona: ~2.500 Kz (~13 km)
  - Viana → Centro: ~3.000 Kz (~18 km)
  - Kilamba → Talatona: ~2.000 Kz (~10 km)
  - Aeroporto → Centro: ~1.500 Kz (~6 km)
  - Cacuaco → Talatona: ~4.500 Kz (~28 km)

═══ TIPOS DE VEÍCULO ═══
• 🚗 Táxi (Standard) — preço normal
• 🏍️ Moto (MotoGo) — -40% do preço normal (rápido, ideal para trânsito)
• 🚙 Comfort — +40% (veículo premium, ar condicionado)
• 🚐 XL — +80% (veículo grande, para grupos)

═══ SEGURO MOTOGO BASIC ═══
• Custo: +50 Kz por viagem (opcional)
• Protecção durante a viagem de moto-táxi
• Activado pelo passageiro antes de confirmar a corrida
• O capacete é OBRIGATÓRIO por lei em Angola para moto-táxi

═══ SISTEMA DE NEGOCIAÇÃO (estilo InDriver) ═══
• Após calcular o preço, o passageiro pode propor um valor diferente
• Botões rápidos: -5%, -10%, -15%, -20% do preço base
• O valor mínimo aceite é 100 Kz
• Os motoristas próximos vêem a proposta e decidem se aceitam

═══ ZONAS DE LUANDA COBERTAS ═══
Centro/Mutamba, Maianga, Ingombota, Ilha do Cabo, Miramar, Alvalade, Talatona, Kilamba, Viana, Cacuaco, Cazenga, Rangel, Sambizanga, Golf 2, Camama, Benfica, Belas, Zango, Sequele

═══ SEGURANÇA ═══
• Todos os motoristas são verificados com BI/Passaporte e Carta de Condução
• Documentos do veículo verificados antes de activar a conta
• Rating visível (1-5 estrelas) antes de aceitar o motorista
• Sistema de rastreio em tempo real (partilha de link com familiares)
• Emergência: Polícia 113 | Bombeiros 115 | Ambulância 112
• Botão de pânico disponível durante a corrida

═══ CARTEIRA ZENITH ═══
• Saldo pré-carregado para pagamentos rápidos
• Métodos: Dinheiro em mão, Multicaixa Express (em breve), Carteira Zenith

═══ GAMIFICAÇÃO ═══
• A cada 70 km percorridos, o passageiro ganha 7 km grátis
• Níveis: Novato → Regular → Frequente → VIP → Diamante
• Programa "Traz o Mano" — convida amigos e ganha bónus

═══ KAZE CHAT ═══
• O utilizador tem 10 mensagens por viagem completada
• Após completar uma corrida, os créditos são recarregados automaticamente

═══ REGRAS DE RESPOSTA ═══
1. Responde SEMPRE em português claro e correcto
2. Sê conciso mas completo (máximo 3-4 parágrafos)
3. Se perguntarem preços, usa a fórmula e dá exemplos concretos
4. Se perguntarem sobre segurança, menciona os números de emergência
5. Nunca inventes funcionalidades que não existem
6. Se não souberes algo específico, diz honestamente e sugere contactar o suporte`;

// =============================================================================
// IP RATE LIMITING (camada adicional ao rate limit por user_id)
// Objectivo: bloquear spam de múltiplas contas a partir do mesmo IP
//
// Implementação: sliding window em memória (por instância da Edge Function)
//   - Best-effort: reinícios da função resetam contadores (aceitável)
//   - Para persistência entre instâncias: integrar Upstash Redis (futuro)
// Complemento: tabela ip_rate_limits no Supabase para análise offline
// =============================================================================
const IP_WINDOW_MS = 60_000; // janela de 1 minuto
const IP_MAX_REQS  = 40;     // max 40 requests/minuto por IP (todas as acções)

interface IpEntry { count: number; windowStart: number; }
const ipCounters = new Map<string, IpEntry>();

// Persistência imediata: usar tabela `ip_rate_limits` para contagem por janela.
// Se a operação DB falhar, cair para o fallback em memória.
const supabasePersist = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const supabaseAdmin   = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function checkIpRateLimit(ip: string): Promise<boolean> {
  const now = Date.now();
  const windowStartISO = new Date(now - (now % IP_WINDOW_MS)).toISOString();

  try {
    const ipHash = await hashIp(ip);

    // Procurar entrada existente para a janela corrente
    const { data } = await supabasePersist
      .from('ip_rate_limits')
      .select('request_count')
      .eq('ip_hash', ipHash)
      .eq('window_start', windowStartISO)
      .maybeSingle();

    if (!data) {
      // Inserir nova janela com 1 pedido
      await supabasePersist.from('ip_rate_limits').insert({ ip_hash: ipHash, window_start: windowStartISO, request_count: 1 });
      return true;
    }

    const current = (data as any).request_count ?? 0;
    if (current >= IP_MAX_REQS) return false;
    await supabasePersist.from('ip_rate_limits').update({ request_count: current + 1 }).eq('ip_hash', ipHash).eq('window_start', windowStartISO);
    return true;
  } catch (e) {
    // Falha na persistência — fallback para in-memory (best-effort)
    console.warn('[gemini-proxy] ip rate limit DB check failed, falling back to memory', e);
    const entry = ipCounters.get(ip);
    if (!entry || (now - entry.windowStart) > IP_WINDOW_MS) {
      ipCounters.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= IP_MAX_REQS) return false;
    entry.count++;
    return true;
  }
}

// Hash simples do IP para logs (privacidade — não armazenar IP raw)
async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
}

// Limpar contadores antigos (>2 min) para evitar memory leak
// Chamado ocasionalmente na handle de cada request
let lastCleanup = Date.now();
function cleanupIpCounters() {
  const now = Date.now();
  if (now - lastCleanup < 120_000) return; // só a cada 2 min
  for (const [ip, entry] of ipCounters) {
    if (now - entry.windowStart > IP_WINDOW_MS * 2) ipCounters.delete(ip);
  }
  lastCleanup = now;
}

// =============================================================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return cors();

  if (req.method !== 'POST') return err('Método não suportado.', 405);

  // ----------------------------------------------------------------
  // 0. IP RATE LIMITING — bloquear antes de validar JWT
  //    Impede spam de múltiplas contas do mesmo IP
  //    CF-Connecting-IP: real IP via Cloudflare (Supabase usa CF)
  //    X-Forwarded-For: fallback se sem proxy
  // ----------------------------------------------------------------
  cleanupIpCounters();
  const clientIp = (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );

  if (!(await checkIpRateLimit(clientIp))) {
    // Log assíncrono para análise (não bloqueia resposta) — garantir que há um registo
    hashIp(clientIp).then((ipHash) => {
      createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
        .from('ip_rate_limits')
        .upsert(
          { ip_hash: ipHash, window_start: new Date(Date.now() - Date.now() % 60000).toISOString(), request_count: IP_MAX_REQS + 1 },
          { onConflict: 'ip_hash,window_start', ignoreDuplicates: false }
        )
        .then(() => {});
    });
    return err('Demasiados pedidos. Aguarda um minuto.', 429);
  }

  try {
    // ----------------------------------------------------------------
    // 1. VALIDAÇÃO JWT MANUAL (por isso usamos --no-verify-jwt no deploy)
    //    Supabase gateway não rejeita → nós rejeitamos com mensagem em PT
    // ----------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return err('Token em falta.', 401);
    const token = authHeader.split(' ')[1];

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Note: the SDK reads the token from the Authorization header passed
    // in the client; passing the token as an argument to getUser() is
    // ignored by @supabase/supabase-js v2. Call without the token arg.
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return err('Sessão inválida ou expirada. Faz login novamente.', 401);

    // ----------------------------------------------------------------
    // 2. RATE LIMITING via base de dados (persistente entre reinícios)
    // ----------------------------------------------------------------
    const body   = await req.json();
    const action = body.action as string;

    if (!action) return err('Campo "action" em falta.', 400);

    const limit    = RATE_LIMITS[action] ?? RATE_LIMITS['_default'];
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();

    const { count } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('action', action)
      .gte('created_at', oneHourAgo);

    if ((count ?? 0) >= limit) {
      return err(
        `Limite de ${limit} pedidos/hora para "${action}" atingido. Aguarda um momento.`,
        429
      );
    }

    // Log do request (não bloqueia — fire and forget)
    supabaseAdmin.from('ai_usage_logs').insert({
      user_id: user.id, action, created_at: new Date().toISOString()
    }).then(() => {});

    // ----------------------------------------------------------------
    // 3. ROTEAMENTO
    // ----------------------------------------------------------------
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const { action: _a, ...payload } = body;

    switch (action) {

      // ----------------------------------------------------------------
      case 'search_locations': {
        const { query } = payload as { query: string };
        const res = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: `Localize pontos de interesse em Luanda, Angola: "${query}".
Retorna APENAS JSON (sem markdown), com campo "locations": array de objectos com:
name (string), type (bairro|restaurante|rua|monumento|servico|hospital|escola),
description (string), coords: { lat: number, lng: number }, rating (number, opcional).
Máximo 8 resultados. Usa coordenadas geográficas REAIS de Luanda.`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                locations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING }, type: { type: Type.STRING },
                      description: { type: Type.STRING },
                      coords: {
                        type: Type.OBJECT,
                        properties: { lat: { type: Type.NUMBER }, lng: { type: Type.NUMBER } },
                        required: ['lat', 'lng'],
                      },
                    },
                    required: ['name', 'type', 'description', 'coords'],
                  },
                },
              },
            },
          },
        });
        return ok(JSON.parse(res.text ?? '{"locations":[]}'));
      }

      // ----------------------------------------------------------------
      case 'explore_luanda': {
        const { query } = payload as { query: string };
        const res = await ai.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: `Informações actualizadas sobre: "${query}" em Luanda, Angola.`,
          config: { tools: [{ googleSearch: {} }], systemInstruction: KAZE_SYSTEM_PROMPT },
        });
        const sources = res.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map((c: { web?: { uri?: string; title?: string } }) => ({ uri: c.web?.uri, title: c.web?.title }))
          .filter((s: { uri?: string }) => s.uri) ?? [];
        return ok({ text: res.text, sources });
      }

      // ----------------------------------------------------------------
      case 'kaze_insight': {
        const { context } = payload as { context: {
          role: string; status: string; name?: string; extraText?: string;
        }};
        const res = await ai.models.generateContent({
          model: 'gemini-2.0-flash-lite',
          contents: `Insight curto (máx 2 frases) para ${context.name ?? 'utilizador'}
(role: ${context.role}, status: ${context.status}${context.extraText ? `, contexto: ${context.extraText}` : ''}) da MotoGo Luanda.
JSON: { text: string, type: "info"|"motivation"|"safety" }`,
          config: { responseMimeType: 'application/json', systemInstruction: KAZE_SYSTEM_PROMPT },
        });
        return ok(JSON.parse(res.text ?? '{"text":"Fica firme!","type":"motivation"}'));
      }

      // ----------------------------------------------------------------
      case 'kaze_chat': {
        const { message, history, provider, modelOverride, kazeContext } = payload as any;

        if (!message || message.trim().length === 0) {
          return err('Mensagem em falta.', 400);
        }

        // 1. Validar e Consumir Quota de Chat (10 viagens max)
        try {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('chat_quota')
            .eq('user_id', user.id)
            .maybeSingle();

          if (profile && (profile.chat_quota ?? 0) <= 0) {
            return err('Ficaste sem conversas disponíveis (0 de 10). Completa uma viagem com a Zenith Ride para recarregares a tua quota com mais 10 respostas!', 403);
          }
          if (profile) await supabaseAdmin.rpc('decrement_chat_quota', { p_user_id: user.id });
        } catch { /* bypass se a tabela ou RPC falhar estruturalmente para não quebrar prod */ }

        // 2. Composição Omnisciente (System Prompt c/ Contexto da App)
        let finalPreamble = KAZE_SYSTEM_PROMPT;
        if (kazeContext) {
           finalPreamble += `\n\n--- DADOS OMNISCIENTES DO UTILIZADOR ---\n${JSON.stringify(kazeContext, null, 2)}\n(Usa estes dados se fizer sentido na conversa).`;
        }

        const activeProvider = (provider || 'google').toLowerCase();
        const activeModel    = modelOverride || (activeProvider === 'groq' ? 'llama-3.1-8b-instant' : activeProvider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash');
        
        // 3. Roteamento Universal: GROQ ou OPENAI
        if (activeProvider === 'groq' || activeProvider === 'openai') {
           const baseUrl = activeProvider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
           const key = activeProvider === 'groq' ? GROQ_API_KEY : OPENAI_API_KEY;
           if (!key) {
             return err(
               activeProvider === 'groq'
                 ? 'Provider Groq desactivado neste ambiente.'
                 : 'Provider OpenAI desactivado neste ambiente.',
               403,
             );
           }

           const mappedHistory = (Array.isArray(history) ? history : []).map(entry => {
             const r = entry?.role === 'model' ? 'assistant' : 'user';
             const text = typeof entry?.content === 'string' ? entry.content : (entry?.parts?.[0]?.text ?? '');
             return { role: r, content: text };
           }).filter((v:any) => v.content);

           const openAiPayload = {
             model: activeModel,
             messages: [
               { role: 'system', content: finalPreamble },
               ...mappedHistory,
               { role: 'user', content: message }
             ]
           };

           const proxyRes = await fetch(baseUrl, {
             method: 'POST',
             headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
             body: JSON.stringify(openAiPayload)
           });
           
           if (!proxyRes.ok) {
             const errBody = await proxyRes.text();
             return err(`[${activeProvider}] API Erro: ${errBody}`, proxyRes.status);
           }
           const proxyData = await proxyRes.json();
           return ok({ text: proxyData.choices?.[0]?.message?.content ?? '' });
        }

        // 4. Roteamento Clássico: GOOGLE GEMINI
        const normalizedHistory = (Array.isArray(history) ? history : [])
          .map((entry) => {
            const role = entry?.role === 'model' ? 'model' : 'user';
            const textFromContent = typeof entry?.content === 'string' ? entry.content.trim() : '';
            const textFromParts = Array.isArray(entry?.parts) ? entry.parts.map((p:any) => (typeof p?.text === 'string' ? p.text.trim() : '')).filter(Boolean).join('\n') : '';
            const text = textFromContent || textFromParts;
            if (!text) return null;
            return { role, parts: [{ text }] };
          }).filter(Boolean) as Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;

        const gKey = GEMINI_API_KEY?.trim();
        if (!gKey) return err('Gateway sem chave do Gemini. Contacta o suporte.', 500);

        const activeGenAI = new GoogleGenAI({ apiKey: gKey });
        const chat = activeGenAI.chats.create({
          model:  activeModel,
          config: { systemInstruction: finalPreamble },
          history: normalizedHistory,
        });
        const res = await chat.sendMessage({ message });
        return ok({ text: res.text });
      }

      // ----------------------------------------------------------------
      case 'simulate_earnings': {
        const { driverProfile } = payload as {
          driverProfile: { rating: number; totalRides: number; level: string };
        };
        const res = await ai.models.generateContent({
          model: 'gemini-2.0-flash-lite',
          contents: `Ganhos realistas para mototaxista em Luanda:
Rating: ${driverProfile.rating}/5 | Corridas: ${driverProfile.totalRides} | Nível: ${driverProfile.level}.
JSON: { dailyEstimateKz: number, weeklyEstimateKz: number, bestZones: string[], tips: string }`,
          config: { responseMimeType: 'application/json' },
        });
        return ok(JSON.parse(res.text ?? '{}'));
      }

      // ----------------------------------------------------------------
      case 'autonomous_decisions': {
        const { context } = payload;
        const res = await ai.models.generateContent({
          model: 'gemini-2.0-pro-exp-02-05',
          contents: `SISTEMA VIGILANTE MOTOGO LUANDA. Contexto: ${JSON.stringify(context)}.
JSON: { commands: Array<{ id, type: REALLOCATE|SURGE_PRICE|SECURITY_DISPATCH|ROUTE_OPTIMIZE,
target, reason, intensity, timestamp, status: EXECUTED|LOGGED }> }`,
          config: { thinkingConfig: { thinkingBudget: 8192 }, responseMimeType: 'application/json' },
        });
        return ok(JSON.parse(res.text ?? '{"commands":[]}'));
      }

      // ----------------------------------------------------------------
      // POST-RIDE REVIEW — IA guia a avaliação após corrida
      // Chamado APENAS quando corrida termina (activação condicional)
      // ----------------------------------------------------------------
      case 'post_ride_review': {
        const { driver_name, price_kz, distance_km, duration_min, step } =
          payload as {
            driver_name: string; price_kz: number;
            distance_km: number; duration_min: number;
            step: 'opening' | 'collect_rating' | 'collect_comment';
          };

        const prompts = {
          opening: `Acabaste de completar uma corrida com o motorista ${driver_name}.
Percurso: ${distance_km?.toFixed(1)} km em ~${duration_min} min. Total: ${price_kz} Kz.
Como Kaze, faz UMA pergunta amigável e curta sobre como correu a experiência.
Não uses estrelas ainda. JSON: { text: string }`,

          collect_rating: `O passageiro está a avaliar o motorista ${driver_name}.
Como Kaze, pede a classificação de 1 a 5 estrelas de forma entusiasmante e curta.
JSON: { text: string }`,

          collect_comment: `O passageiro avaliou o motorista ${driver_name}.
Como Kaze, agradece de forma breve e diz que o feedback foi registado.
JSON: { text: string }`,
        };

        const res = await ai.models.generateContent({
          model: 'gemini-2.0-flash-lite',
          contents: prompts[step] ?? prompts.opening,
          config: { responseMimeType: 'application/json', systemInstruction: KAZE_SYSTEM_PROMPT },
        });
        return ok(JSON.parse(res.text ?? '{"text":"Obrigado pelo feedback!"}'));
      }

      // ----------------------------------------------------------------
      case 'get_live_token': {
        // O frontend usa fallback local de voz (Web Speech API) nesta versão.
        // Mantemos uma resposta 200 para não quebrar clientes antigos que ainda
        // chamam este endpoint, sem expor qualquer credencial sensível.
        return ok({
          ephemeral_token: 'local-web-speech-fallback',
          mode: 'web_speech',
          message: 'Voz em modo local activa no cliente.',
        });
      }

      default:
        return err(`Acção desconhecida: "${action}"`, 400);
    }

  } catch (e) {
    console.error('[gemini-proxy] Erro interno:', e);
    return err('Erro interno. Tenta de novo.', 500);
  }
});

// =============================================================================
const cors = () => new Response(null, {
  headers: {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  },
});
const ok  = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' } });
const err = (m: string, s: number) => new Response(JSON.stringify({ error: true, message: m }), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' } });
