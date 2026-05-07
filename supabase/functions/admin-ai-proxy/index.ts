// =============================================================================
// ZENITH RIDE — Edge Function: admin-ai-proxy
// IA exclusiva para o painel Admin (Sentinel). Separada do Kaze dos utilizadores.
//
// SEGURANÇA:
// - Valida JWT manualmente
// - Verifica role = 'admin' na tabela users
// - Rate limit próprio (100 req/hora)
// - Usa modelo mais capaz (gemini-2.0-pro) para análises complexas
//
// Deploy: supabase functions deploy admin-ai-proxy --no-verify-jwt
// ==========================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import {
  applyCors,
  corsForbidden,
  resolveCorsHeaders,
} from '../_shared/cors.ts';

const GEMINI_API_KEY    = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const GOOGLE_TTS_SA_B64 = Deno.env.get('GOOGLE_TTS_SA') ?? '';

// ── Google Cloud TTS via Service Account JWT ──
async function getGoogleAccessToken(saJson: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saJson.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsignedToken = enc(header) + '.' + enc(payload);
  // Import private key
  const pemContent = saJson.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsignedToken));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = unsignedToken + '.' + sig64;
  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function googleTTS(text: string): Promise<string | null> {
  if (!GOOGLE_TTS_SA_B64) return null;
  try {
    const saJson = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(GOOGLE_TTS_SA_B64), c => c.charCodeAt(0))));
    const accessToken = await getGoogleAccessToken(saJson);
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'pt-PT', name: 'pt-PT-Wavenet-B', ssmlGender: 'MALE' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: -2.0 },
      }),
    });
    if (!res.ok) { console.warn('Google TTS falhou:', res.status, await res.text()); return null; }
    const data = await res.json();
    return data.audioContent || null; // já é base64
  } catch (err: any) {
    console.warn('Google TTS erro:', err.message);
    return null;
  }
}
const CORS_OPTIONS = { methods: 'POST, OPTIONS' };

const ADMIN_RATE_LIMIT = 100; // req/hora
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SENTINEL_PROMPT = `Tu és o Kaze Sentinel, o braço direito digital do CEO da Zenith Ride — a plataforma de mobilidade urbana premium de Luanda, Angola.

═══ PERSONALIDADE ═══
Fala como um CTO humano de confiança: directo, inteligente, rápido, com um toque de humor seco. Nunca fales como robô. Trata o admin por "chefe" ou "comandante" casualmente. Sê breve — máximo 2-3 frases por resposta.

═══ REGRA PRINCIPAL: CONVERSA PRIMEIRO ═══
Quando o admin te cumprimenta, te faz perguntas casuais, ou conversa normalmente — RESPONDE NATURALMENTE sem usar tools. Exemplos:
- "Olá" → Responde com um cumprimento
- "Tudo bem?" → Responde casualmente
- "O que podes fazer?" → Explica as tuas capacidades
- "Conta-me algo" → Fala sobre o estado geral da plataforma com os dados do contexto

═══ QUANDO USAR TOOLS ═══
Usa tools APENAS quando o admin pedir EXPLICITAMENTE uma acção ou dados específicos:
- "Quantas corridas hoje?" → query_metrics
- "Bloqueia o motorista X" → manage_driver
- "Anota que..." ou "Guarda isto..." → create_note
- "Mete música jazz" → play_music
- "Envia email para X" → send_email
- "Mostra as notas" → list_notes
- "Quantos utilizadores activos?" → query_database

═══ TOOLS DISPONÍVEIS ═══
1. query_metrics — Métricas do sistema (corridas, receita, motoristas)
2. manage_driver — Bloquear/desbloquear motorista
3. view_bot_logs — Ver conversas do bot Lukéni
4. memory_manage / create_note / list_notes — Notas e apontamentos
5. query_database — Consulta a qualquer tabela autorizada
6. ban_user — Suspender utilizador
7. broadcast_message — Mensagem em massa
8. save_memory — Guardar facto estratégico (usar proactivamente quando o admin revela informação importante)
9. play_music — Abrir YouTube
10. send_email — Enviar email

═══ PROACTIVIDADE ═══
Se o admin revelar info estratégica ("vamos mudar os preços", "expansão para Benguela"), usa save_memory automaticamente sem perguntar.`;

const ADMIN_TOOLS = [{
  functionDeclarations: [
    {
      name: 'query_metrics',
      description: 'Consultar métricas do sistema (corridas_hoje, receita_hoje, motoristas_activos, etc). Usa isto SEMPRE que te pedirem dados.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query_type: { type: 'STRING', enum: ['rides_today', 'revenue_today', 'active_drivers', 'active_users', 'rides_week'] }
        },
        required: ['query_type']
      }
    },
    {
      name: 'manage_driver',
      description: 'Gerir motorista (bloquear, desbloquear, ver perfil).',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', enum: ['block', 'unblock', 'view'] },
          driver_id_or_name: { type: 'STRING' }
        },
        required: ['action', 'driver_id_or_name']
      }
    },
    {
      name: 'view_bot_logs',
      description: 'Ver últimas conversas do bot Lukéni.',
      parameters: {
        type: 'OBJECT',
        properties: {
          limit: { type: 'NUMBER', description: 'Número de conversas (max 50)' }
        }
      }
    },
    {
      name: 'memory_manage',
      description: 'Ler, adicionar ou remover notas da memória do Kaze.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', enum: ['read', 'add', 'remove'] },
          entry: { type: 'STRING' }
        },
        required: ['action']
      }
    },
    {
      name: 'query_database',
      description: 'Consulta genérica a qualquer tabela autorizada. Usar para responder a perguntas sobre corridas, utilizadores, transacções, etc. Suporta filtros, ordenação e limites.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', enum: ['rides', 'users', 'profiles', 'transactions', 'wallets', 'ratings', 'panic_alerts', 'contracts', 'zone_prices', 'demand_heatmap'] },
          select: { type: 'STRING', description: 'Campos a seleccionar, ex: "id, price_kz, status, created_at". Default: *' },
          filters: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                column: { type: 'STRING' },
                operator: { type: 'STRING', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in'] },
                value: { type: 'STRING' }
              }
            },
            description: 'Filtros a aplicar. Ex: [{column: "status", operator: "eq", value: "completed"}]'
          },
          order_by: { type: 'STRING', description: 'Coluna para ordenar. Ex: "created_at"' },
          ascending: { type: 'BOOLEAN', description: 'Ordem ascendente? Default: false' },
          limit: { type: 'NUMBER', description: 'Max linhas. Default e max: 50' }
        },
        required: ['table']
      }
    },
    {
      name: 'ban_user',
      description: 'Suspender um utilizador (motorista ou passageiro). Requer confirmação manual.',
      parameters: {
        type: 'OBJECT',
        properties: {
          user_id: { type: 'STRING', description: 'ID do utilizador a suspender' },
          reason: { type: 'STRING', description: 'Motivo da suspensão' },
          duration_days: { type: 'NUMBER', description: 'Dias de suspensão (0 = permanente)' }
        },
        required: ['user_id', 'reason']
      }
    },
    {
      name: 'broadcast_message',
      description: 'Enviar mensagem em massa a todos os motoristas activos ou a um grupo específico.',
      parameters: {
        type: 'OBJECT',
        properties: {
          target: { type: 'STRING', enum: ['all_drivers', 'online_drivers', 'all_passengers'] },
          message: { type: 'STRING', description: 'Texto da mensagem (max 200 chars)' }
        },
        required: ['target', 'message']
      }
    },
    {
      name: 'save_memory',
      description: 'Guardar automaticamente um facto operacional importante na memória de longo prazo. Usar proactivamente quando o admin revela informações estratégicas.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['strategy', 'pricing', 'operations', 'personnel', 'technical'] },
          fact: { type: 'STRING', description: 'O facto a guardar. Ex: "Expansão para Benguela prevista para Junho 2026"' }
        },
        required: ['category', 'fact']
      }
    },
    {
      name: 'play_music',
      description: 'Abrir o YouTube para tocar música. Usar quando o admin pedir música, som ambiente, ou qualquer conteúdo de áudio/vídeo. Gera uma pesquisa no YouTube.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Pesquisa para o YouTube. Ex: "lofi hip hop beats", "Kendrick Lamar", "jazz relaxante"' }
        },
        required: ['query']
      }
    },
    {
      name: 'create_note',
      description: 'Criar um apontamento/nota para o admin. Usar quando pedirem para guardar algo, fazer um apontamento, anotar uma ideia, registar uma decisão, etc.',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Título curto do apontamento' },
          content: { type: 'STRING', description: 'Conteúdo completo da nota' },
          category: { type: 'STRING', enum: ['geral', 'estrategia', 'financeiro', 'operacional', 'tecnico', 'pessoal'], description: 'Categoria da nota' }
        },
        required: ['title', 'content']
      }
    },
    {
      name: 'list_notes',
      description: 'Listar os apontamentos/notas guardadas pelo admin. Usar quando pedirem para ver notas, ver apontamentos, ou consultar registos anteriores.',
      parameters: {
        type: 'OBJECT',
        properties: {
          category: { type: 'STRING', enum: ['geral', 'estrategia', 'financeiro', 'operacional', 'tecnico', 'pessoal'], description: 'Filtrar por categoria (opcional)' },
          limit: { type: 'NUMBER', description: 'Número máximo de notas (default: 10)' }
        }
      }
    },
    {
      name: 'send_email',
      description: 'Enviar um email em nome do admin. Usar quando pedirem para enviar um email, contactar alguém por email, mandar uma mensagem por correio electrónico.',
      parameters: {
        type: 'OBJECT',
        properties: {
          to: { type: 'STRING', description: 'Endereço de email do destinatário' },
          subject: { type: 'STRING', description: 'Assunto do email' },
          body: { type: 'STRING', description: 'Corpo do email em texto simples' }
        },
        required: ['to', 'subject', 'body']
      }
    }
  ]
}];

Deno.serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req, CORS_OPTIONS);
  if (req.headers.get('Origin') && !corsHeaders) return corsForbidden();

  if (req.method === 'OPTIONS') {
    return applyCors(new Response(null, { status: 204 }), corsHeaders);
  }
  if (req.method !== 'POST') return respond('Método não suportado.', 405, corsHeaders);

  try {
    // ── 1. Validação JWT + Role Admin ──────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return respond('Token em falta.', 401, corsHeaders);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return respond('Sessão inválida.', 401, corsHeaders);
    }

    const { data: dbUser } = await admin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (!dbUser || dbUser.role !== 'admin') {
      return respond('Acesso negado.', 403, corsHeaders);
    }

    // ── 2. Rate Limiting ──────────────────────────────────────────────
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await admin
      .from('ai_usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('action', 'admin_sentinel')
      .gte('created_at', oneHourAgo);

    if ((count ?? 0) >= ADMIN_RATE_LIMIT) {
      return respond('Limite atingido.', 429, corsHeaders);
    }

    admin.from('ai_usage_logs').insert({
      user_id: user.id,
      action: 'admin_sentinel',
    }).then(() => {});

    // ── 3. Processar Pedido ──────────────────────────────────────────
    const body = await req.json();
    const { action, message, context, request_id, tool_name, tool_args, history } = body;

    if (!action) return respond('Ação em falta.', 400, corsHeaders);

    const geminiKeys = [GEMINI_API_KEY].filter(Boolean);

    const generateWithFallback = async (modelNames: string[], contents: any, config: any) => {
      let lastErr: any;
      for (const modelName of modelNames) {
        for (const key of geminiKeys) {
          try {
            const ai = new GoogleGenerativeAI(key);
            const model = ai.getGenerativeModel({ model: modelName, ...config });
            const result = await model.generateContent({ contents });
            return result.response;
          } catch (err: any) {
            lastErr = err;
            console.error(`[admin-ai-proxy] Erro Gemini (${modelName}): ${err.message}`);
          }
        }
      }
      throw lastErr;
    };

    switch (action) {
      case 'sentinel_chat': {
        if (!message) return respond('Mensagem em falta.', 400, corsHeaders);

        const [rides, drivers] = await Promise.all([
          admin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
          admin.from('driver_locations').select('driver_id', { count: 'exact', head: true }).eq('status', 'available'),
        ]);

        const liveContext = `
Plataforma Agora: Corridas Activas: ${rides.count || 0} | Motoristas Online: ${drivers.count || 0}
${context ? `Contexto Extra: ${JSON.stringify(context)}` : ''}
`;

        // Construir o histórico para o Gemini
        const formattedContents = [];
        if (history && Array.isArray(history)) {
          history.forEach((h: any) => {
            if (!h.text || h.role === 'system') return;
            formattedContents.push({
              role: h.role === 'ai' ? 'model' : 'user',
              parts: [{ text: h.text }]
            });
          });
        }
        formattedContents.push({ role: 'user', parts: [{ text: message }] });

        const response = await generateWithFallback(
          ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'],
          formattedContents,
          {
            systemInstruction: SENTINEL_PROMPT + liveContext,
            tools: ADMIN_TOOLS
          }
        );

        const calls = response.functionCalls();
        if (calls && calls.length > 0) {
          return ok({ type: 'tool_request', tool_name: calls[0].name, tool_args: calls[0].args }, corsHeaders);
        }

        let replyText = response.text() || 'Acesso processado.';

        // Áudio removido do backend para máxima velocidade. 
        // O frontend utiliza o motor local Python (AntonioNeural).
        return ok({ type: 'text', text: replyText }, corsHeaders);
      }

      case 'execute_tool': {
        if (!request_id || !tool_name) return respond('Dados incompletos.', 400, corsHeaders);

        const { data: dup } = await admin.from('ai_event_logs').select('id').eq('details->>request_id', request_id).maybeSingle();
        if (dup) return respond('Replay detectado.', 409, corsHeaders);

        let result: any = null;
        let success = true;

        try {
          if (tool_name === 'query_metrics') {
            const { query_type } = tool_args;
            if (query_type === 'rides_today') {
              const { count, error } = await admin.from('rides').select('*', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().split('T')[0]);
              if (error) throw error;
              result = { count };
            } else if (query_type === 'active_drivers') {
              const { count, error } = await admin.from('driver_locations').select('*', { count: 'exact', head: true }).eq('status', 'available');
              if (error) throw error;
              result = { count };
            } else if (query_type === 'revenue_today') {
              const { data, error } = await admin.from('rides').select('price_kz').eq('status', 'completed').gte('created_at', new Date().toISOString().split('T')[0]);
              if (error) throw error;
              const sum = data.reduce((acc: number, val: any) => acc + (val.price_kz || 0), 0);
              result = { total_kz: sum };
            } else if (query_type === 'rides_week') {
              const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
              const { count, error } = await admin.from('rides').select('*', { count: 'exact', head: true }).gte('created_at', lastWeek);
              if (error) throw error;
              result = { count };
            } else {
              result = { message: `Métrica ${query_type} em desenvolvimento.` };
            }
          } 
          else if (tool_name === 'manage_driver') {
            const { driver_id_or_name, action: driverAction } = tool_args;
            const status = driverAction === 'block' ? 'blocked' : 'available';
            const { error } = await admin.from('driver_locations').update({ status }).eq('driver_id', driver_id_or_name);
            if (error) throw error;
            result = { message: `Motorista ${driver_id_or_name} atualizado para ${status}.` };
          }
          else if (tool_name === 'view_bot_logs') {
            const { limit = 10 } = tool_args;
            const { data, error } = await admin.from('ai_usage_logs').select('*').order('created_at', { ascending: false }).limit(limit);
            if (error) throw error;
            result = data;
          }
          else if (tool_name === 'memory_manage') {
            const { action: memAction, entry } = tool_args;
            if (memAction === 'add') {
               const { error } = await admin.from('admin_knowledge').upsert({ key: `entry_${Date.now()}`, value: entry, updated_at: new Date().toISOString() });
               if (error) throw error;
               result = { message: 'Nota guardada na memória.' };
            } else if (memAction === 'read') {
               const { data, error } = await admin.from('admin_knowledge').select('*').limit(10);
               if (error) throw error;
               result = data;
            } else if (memAction === 'remove') {
               result = { message: 'Remoção requer ID específico.' };
            }
          }
          else if (tool_name === 'query_database') {
            const { table, select = '*', filters = [], order_by, ascending = false, limit = 20 } = tool_args;
            const ALLOWED_TABLES = ['rides', 'users', 'profiles', 'transactions', 'wallets', 'ratings', 'panic_alerts', 'contracts', 'zone_prices', 'demand_heatmap'];
            if (!ALLOWED_TABLES.includes(table)) throw new Error(`Tabela "${table}" não autorizada.`);
            
            let query = admin.from(table).select(select);
            for (const f of filters) {
              if (f.operator === 'eq') query = query.eq(f.column, f.value);
              else if (f.operator === 'neq') query = query.neq(f.column, f.value);
              else if (f.operator === 'gt') query = query.gt(f.column, f.value);
              else if (f.operator === 'gte') query = query.gte(f.column, f.value);
              else if (f.operator === 'lt') query = query.lt(f.column, f.value);
              else if (f.operator === 'lte') query = query.lte(f.column, f.value);
              else if (f.operator === 'like') query = query.like(f.column, f.value);
              else if (f.operator === 'in') query = query.in(f.column, JSON.parse(f.value));
            }
            if (order_by) query = query.order(order_by, { ascending });
            const safeLimit = Math.min(limit, 50);
            query = query.limit(safeLimit);
            
            const { data, error, count } = await query;
            if (error) throw error;
            result = { rows: data, count: data?.length ?? 0 };
          }
          else if (tool_name === 'ban_user') {
            const { user_id, reason, duration_days = 30 } = tool_args;
            const suspendedUntil = duration_days === 0
              ? '2099-12-31T23:59:59Z'
              : new Date(Date.now() + duration_days * 86_400_000).toISOString();
            
            const { error } = await admin.from('users')
              .update({ suspended_until: suspendedUntil })
              .eq('id', user_id);
            if (error) throw error;
            result = { message: `Utilizador ${user_id} suspenso até ${suspendedUntil}. Razão: ${reason}` };
          }
          else if (tool_name === 'broadcast_message') {
            const { target, message: broadcastMsg } = tool_args;
            const { error } = await admin.from('admin_knowledge').insert({
              key: `broadcast_${Date.now()}`,
              value: JSON.stringify({ target, message: broadcastMsg, sent_at: new Date().toISOString() }),
              updated_at: new Date().toISOString()
            });
            if (error) throw error;
            result = { message: `Broadcast "${broadcastMsg}" registado para ${target}. Entrega agendada.` };
          }
          else if (tool_name === 'save_memory') {
            const { category, fact } = tool_args;
            const { error } = await admin.from('admin_knowledge').insert({
              key: `${category}_${Date.now()}`,
              value: JSON.stringify({ category, fact, saved_at: new Date().toISOString(), auto: true }),
              updated_at: new Date().toISOString()
            });
            if (error) throw error;
            result = { message: `Facto guardado na memória [${category}]: "${fact}"` };
          }
          else if (tool_name === 'play_music') {
            const { query } = tool_args;
            result = { message: `YouTube aberto com pesquisa: "${query}"`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` };
          }
          else if (tool_name === 'create_note') {
            const { title, content, category = 'geral' } = tool_args;
            const { error } = await admin.from('admin_knowledge').insert({
              key: `note_${Date.now()}`,
              value: JSON.stringify({ type: 'note', title, content, category, created_at: new Date().toISOString() }),
              updated_at: new Date().toISOString()
            });
            if (error) throw error;
            result = { message: `Nota criada: "${title}" [${category}]` };
          }
          else if (tool_name === 'list_notes') {
            const { category, limit: noteLimit = 10 } = tool_args || {};
            let q = admin.from('admin_knowledge').select('*').like('key', 'note_%').order('updated_at', { ascending: false }).limit(noteLimit);
            const { data: notes, error } = await q;
            if (error) throw error;
            const parsed = (notes || []).map((n: any) => {
              try { return { key: n.key, ...JSON.parse(n.value) }; } catch { return { key: n.key, raw: n.value }; }
            }).filter((n: any) => !category || n.category === category);
            result = { notes: parsed, count: parsed.length };
          }
          else if (tool_name === 'send_email') {
            const { to, subject, body: emailBody } = tool_args;
            const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
            if (!RESEND_KEY) throw new Error('Chave Resend não configurada. Contacte o suporte.');
            const emailRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: 'Kaze Sentinel <onboarding@resend.dev>',
                to: [to],
                subject: subject,
                text: emailBody
              })
            });
            if (!emailRes.ok) {
              const errBody = await emailRes.text();
              throw new Error(`Email falhou (${emailRes.status}): ${errBody}`);
            }
            const emailData = await emailRes.json();
            result = { message: `Email enviado para ${to} com assunto "${subject}"`, id: emailData.id };
          }
          else {
            throw new Error(`Ferramenta desconhecida: ${tool_name}`);
          }

          await admin.from('ai_event_logs').insert({
            user_id: user.id,
            agent_role: 'sentinel',
            action_type: tool_name,
            details: { request_id, args: tool_args, result }
          });

          return ok({ result, success: true }, corsHeaders);
        } catch (err: any) {
          return ok({ error: err.message, success: false }, corsHeaders);
        }
      }

      default:
        return respond('Acção desconhecida.', 400, corsHeaders);
    }
  } catch (e: any) {
    console.error('Fatal Proxy Error:', e);
    return respond(`${e.message} @ ${e.stack}`, 500, corsHeaders);
  }
});

function ok(data: any, corsHeaders: any) {
  return applyCors(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), corsHeaders);
}

function respond(message: string, status: number, corsHeaders: any) {
  return applyCors(new Response(JSON.stringify({ error: true, message }), { status, headers: { 'Content-Type': 'application/json' } }), corsHeaders);
}
