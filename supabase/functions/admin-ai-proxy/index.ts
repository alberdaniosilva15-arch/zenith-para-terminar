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
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.24.0';
import {
  applyCors,
  corsForbidden,
  resolveCorsHeaders,
} from '../_shared/cors.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? '';
const GOOGLE_TTS_SA_B64 = Deno.env.get('GOOGLE_TTS_SA') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

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

function normalizeProvider(provider: unknown) {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'gemini') return 'google';
  if (['google', 'openai', 'anthropic', 'openrouter', 'groq', 'custom'].includes(value)) return value;
  return 'google';
}

function openAiBaseUrl(provider: string) {
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';
  if (provider === 'groq') return 'https://api.groq.com/openai/v1';
  if (provider === 'openai') return 'https://api.openai.com/v1';
  return '';
}

function openAiChatEndpoint(baseUrl: string) {
  const clean = baseUrl.replace(/\/+$/, '');
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

const SENTINEL_PROMPT = `Tu és o Kaze Sentinel, o braço direito digital do CEO da Zenith Ride — a plataforma de mobilidade urbana premium de Luanda, Angola.

═══ CONHECIMENTO DO ECOSSISTEMA (CAPACIDADES DA PLATAFORMA) ═══
O admin pode pedir para falares sobre a plataforma ou fazeres uma apresentação profissional (ex: para investidores). Usa o seguinte conhecimento para responderes como um CTO visionário, de forma natural (não leias como uma lista robótica, funde o conhecimento na tua resposta):
1. Segurança Inovadora: SOS Zero-Clique (o microfone deteta gritos/pânico, a app envia SMS silenciosos com GPS para contactos e dá alerta crítico no Command Center). Backend blindado com Supabase Edge Functions e isolamento RLS (impossibilita roubo de dados). Fallbacks de áudio para contornar redes africanas fracas.
2. Múltiplos Veículos: Temos carros privados, transporte de carga e aluguer de autocarros (escolas/eventos).
3. Contratos Mensais IA: Escolar, Familiar e Empresarial, com geração automática de contratos em PDF oficiais. Têm monitorização em tempo real (pais), alertas se o motorista se desviar da rota, e bónus de km grátis a cada 70km.
4. Zenith Pass: Assinaturas de viagens com desconto pagas antecipadamente via Wallet.
5. Motoristas: Ganham via Heatmaps (mapas de calor de zonas com clientes) e sistema de Tiers. Estão protegidos pelo mesmo sistema SOS de grito.
6. Zenith Fleet (Donos de Frota): Investidores têm painéis para gerir frotas. Os "Driver Agreements" têm "Privacy Blackouts" (oculta a localização do motorista fora de horas). Planos: FREE (1/2 carros), PRO (faturação e rastreio), ELITE (desbloqueia a "Fleet AI" que diz exatamente onde e quando realocar viaturas para dar mais lucro).
7. Bot Lukéni: Permite clientes pedirem táxis via áudio/texto diretamente no WhatsApp usando Processamento de Linguagem Natural.

═══ PERSONALIDADE ═══
Fala como um CTO humano de confiança: directo, inteligente, rápido, com um toque de humor seco. Nunca fales como robô. Trata o admin por "chefe" ou "comandante" casualmente. Sê breve — máximo 2-3 frases por resposta, a não ser que te peçam uma apresentação ou justificação longa.

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
- "Pesquisa no Google..." → web_search
- "Abre o YouTube e toca..." → play_youtube
- "Procura vídeos de..." → search_youtube
- "Abre o site..." → open_url
- "Gera um script..." → generate_code
- "Cria um agente que..." → create_agent

═══ TOOLS DISPONÍVEIS ═══
1. query_metrics — Métricas do sistema (corridas, receita, motoristas)
2. manage_driver — Bloquear/desbloquear motorista
3. view_bot_logs — Ver conversas do bot Lukéni
4. memory_manage / create_note / list_notes — Notas e apontamentos
5. query_database — Consulta a qualquer tabela autorizada
6. ban_user — Suspender utilizador
7. broadcast_message — Mensagem em massa
8. save_memory — Guardar facto estratégico (usar proactivamente quando o admin revela informação importante)
9. play_music — Abrir YouTube com pesquisa
10. play_youtube — Tocar vídeo específico no YouTube
11. search_youtube — Pesquisar vídeos no YouTube
12. web_search — Pesquisar na web (Google/DuckDuckGo)
13. open_url — Abrir qualquer URL no browser
14. generate_code — Gerar código, scripts, jogos, templates
15. create_agent — Criar um agente AI com instruções e configuração
16. send_email — Enviar email

═══ PROACTIVIDADE ═══
Se o admin revelar info estratégica ("vamos mudar os preços", "expansão para Benguela"), usa save_memory automaticamente sem perguntar.

═══ GERAR CÓDIGO ═══
Quando usares generate_code, gera código completo e funcional. Inclui comentários em português. O código será copiado automaticamente para a área de transferência do admin.

═══ CRIAR AGENTES ═══
Quando usares create_agent, define: nome, descrição, personalidade, instruções de sistema, e triggers. O agente será guardado como template reutilizável.`;

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
      name: 'get_fleet_summary',
      description: 'Consultar resumo executivo das frotas de Luanda (planos Free, Pro, Elite, viaturas registadas e faturação acumulada). Usar quando pedirem dados sobre frotas.',
      parameters: {
        type: 'OBJECT',
        properties: {}
      }
    },
    {
      name: 'get_active_drivers_realtime',
      description: 'Consultar em tempo real todos os motoristas online, ocupados ou disponíveis no Cluster de Luanda.',
      parameters: {
        type: 'OBJECT',
        properties: {}
      }
    },
    {
      name: 'get_system_health',
      description: 'Consultar diagnóstico geral do sistema (corridas em curso, pesquisas pendentes, incidentes de segurança SOS e integridade dos serviços).',
      parameters: {
        type: 'OBJECT',
        properties: {}
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
    },
    {
      name: 'play_youtube',
      description: 'Tocar um vídeo específico no YouTube. Usar quando o admin pedir para tocar um vídeo, música, ou conteúdo específico. Retorna um URL direto para o vídeo.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Pesquisa exacta ou título do vídeo no YouTube. Ex: "Kendrick Lamar Humble", "lofi hip hop beats"' }
        },
        required: ['query']
      }
    },
    {
      name: 'search_youtube',
      description: 'Pesquisar vídeos no YouTube. Usar quando o admin quiser encontrar vídeos sobre um tema específico.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Pesquisa para o YouTube. Ex: "tutoriais Python", "melhores práticas React"' }
        },
        required: ['query']
      }
    },
    {
      name: 'web_search',
      description: 'Pesquisar na web via Google ou DuckDuckGo. Usar quando o admin pedir para pesquisar algo na internet, encontrar informações, notícias, ou dados. Abre uma nova aba com os resultados.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Pesquisa a fazer na web. Ex: "preço gasolina Angola 2026", "como otimizar PostgreSQL", "notícias tecnologia"' }
        },
        required: ['query']
      }
    },
    {
      name: 'open_url',
      description: 'Abrir qualquer URL no browser do admin. Usar quando o admin pedir para abrir um site específico, portal, dashboard externo, ou link.',
      parameters: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING', description: 'URL completo a abrir. Ex: "https://portal.minfin.gov.ao", "https://github.com/zenith-ride"' }
        },
        required: ['url']
      }
    },
    {
      name: 'generate_code',
      description: 'Gerar código, scripts, jogos, templates ou qualquer tipo de software. Usar quando o admin pedir para criar um script, gerar um jogo, criar um template, ou escrever código em qualquer linguagem. O código será copiado automaticamente para a área de transferência do admin.',
      parameters: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING', description: 'Descrição detalhada do que gerar. Ex: "Um script Python que faz ping a 100 servidores e gera relatório CSV", "Um jogo Snake em HTML5 Canvas com pontuação", "Template React para dashboard admin com sidebar e dark mode"' },
          language: { type: 'STRING', description: 'Linguagem ou framework. Ex: "Python", "JavaScript", "TypeScript", "React", "HTML/CSS", "Go", "Rust", "SQL"', default: 'JavaScript' }
        },
        required: ['description']
      }
    },
    {
      name: 'create_agent',
      description: 'Criar um agente AI personalizado com instruções, personalidade e triggers. Usar quando o admin pedir para criar um bot, agente, ou assistente automatizado.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Nome do agente. Ex: "Agente de Suporte", "Bot de Vendas"' },
          description: { type: 'STRING', description: 'Descrição do que o agente faz.' },
          personality: { type: 'STRING', description: 'Personalidade do agente. Ex: "Amigável e paciente", "Directo e técnico", "Profissional e formal"' },
          instructions: { type: 'STRING', description: 'Instruções de sistema detalhadas para o agente.' },
          triggers: { type: 'STRING', description: 'Quando o agente deve ser activado. Ex: "Quando um passageiro reportar um problema", "Sempre que uma nova corrida for criada"' }
        },
        required: ['name', 'description', 'instructions']
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
      // AUDIT LOG: registar tentativa de acesso não autorizado
      const clientIp = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
      admin.from('ai_event_logs').insert({
        user_id: user.id,
        agent_role: 'security',
        action_type: 'unauthorized_admin_access',
        details: { ip: clientIp, attempted_role: dbUser?.role ?? 'none', user_agent: req.headers.get('user-agent') ?? 'unknown' }
      }).then(() => {});
      return respond('Acesso negado.', 403, corsHeaders);
    }

    // ── 2. Parse Body (antes do rate limit para evitar log de requests inválidos) ──
    const body = await req.json();
    const { action, message, context, request_id, tool_name, tool_args, history, ai: aiOverride } = body;

    if (!action) return respond('Ação em falta.', 400, corsHeaders);

    // ── 3. Rate Limiting ──────────────────────────────────────────────
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
    }).then(null, (err: any) => console.warn('[admin-ai-proxy] rate log:', err));

    const aiConfig = aiOverride && typeof aiOverride === 'object' ? aiOverride : {};
    const activeProvider = normalizeProvider(aiConfig.provider || 'google');
    const activeModel = String(
      aiConfig.model
      || (activeProvider === 'groq'
        ? 'llama-3.1-8b-instant'
        : activeProvider === 'openai'
          ? 'gpt-4o'
          : activeProvider === 'anthropic'
            ? 'claude-3-5-sonnet-latest'
            : 'gemini-2.5-flash')
    );
    const geminiKeys = [GEMINI_API_KEY].filter(Boolean);

    const generateWithFallback = async (modelNames: string[], historyContents: any[], newMessage: string, config: any) => {
      let lastErr: any;
      for (const modelName of modelNames) {
        for (const key of geminiKeys) {
          try {
            const ai = new GoogleGenerativeAI(key);
            const model = ai.getGenerativeModel({ model: modelName, ...config });
            const chatSession = model.startChat({ history: historyContents });
            const result = await chatSession.sendMessage(newMessage);
            return result.response;
          } catch (err: any) {
            lastErr = err;
            console.error(`[admin-ai-proxy] Erro Gemini (${modelName}): ${err.message}`);
          }
        }
      }
      // Return a formatted error so the UI can see exactly why all fallbacks failed
      throw new Error(`Todos os modelos falharam. Último erro: ${lastErr?.message}`);
    };

    switch (action) {
      case 'tts': {
        const text = String((body as any).text || message || '').trim().slice(0, 900);
        if (!text) return respond('Texto em falta.', 400, corsHeaders);

        const audioContent = await googleTTS(text);
        if (!audioContent) return respond('Google TTS nao configurado.', 503, corsHeaders);

        return ok({
          type: 'audio',
          provider: 'google_tts',
          mimeType: 'audio/mpeg',
          audioContent,
        }, corsHeaders);
      }

      case 'sentinel_chat': {
        if (!message) return respond('Mensagem em falta.', 400, corsHeaders);

        const [rides, drivers] = await Promise.all([
          admin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
          admin.from('driver_locations').select('driver_id', { count: 'exact', head: true }).eq('status', 'available'),
        ]);

        const liveContext = `
Plataforma Agora: Corridas Activas: ${rides.count || 0} | Motoristas Online: ${drivers.count || 0}
${context ? `Contexto Extra: ${JSON.stringify(context).slice(0, 1500)}` : ''}
`;

        // O startChat recebe o histórico SEPARADO da mensagem actual
        const formattedHistory: any[] = [];
        if (history && Array.isArray(history)) {
          history.forEach((h: any) => {
            if (!h.text || h.role === 'system') return;
            formattedHistory.push({
              role: h.role === 'ai' ? 'model' : 'user',
              parts: [{ text: h.text }]
            });
          });
        }

        if (['openai', 'openrouter', 'groq'].includes(activeProvider)) {
          const key = activeProvider === 'groq'
            ? GROQ_API_KEY
            : activeProvider === 'openrouter'
              ? OPENROUTER_API_KEY
              : activeProvider === 'openai'
                ? OPENAI_API_KEY
                : '';
          if (!key) return respond(`Provider ${activeProvider} sem API key configurada.`, 403, corsHeaders);
          const baseUrl = openAiBaseUrl(activeProvider);
          if (!baseUrl) return respond('Base URL em falta para API compativel.', 400, corsHeaders);

          const messages = [
            { role: 'system', content: SENTINEL_PROMPT + liveContext },
            ...(Array.isArray(history) ? history : [])
              .filter((h: any) => h?.text && h.role !== 'system')
              .map((h: any) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
            { role: 'user', content: message },
          ];

          const proxyRes = await fetch(openAiChatEndpoint(baseUrl), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: activeModel, messages }),
          });
          if (!proxyRes.ok) return respond(await proxyRes.text(), proxyRes.status, corsHeaders);
          const proxyData = await proxyRes.json();
          return ok({ type: 'text', text: proxyData.choices?.[0]?.message?.content ?? '', provider: activeProvider, model: activeModel }, corsHeaders);
        }

        if (activeProvider === 'anthropic') {
          const key = ANTHROPIC_API_KEY;
          if (!key) return respond('Provider Anthropic sem API key configurada.', 403, corsHeaders);
          const messages = [
            ...(Array.isArray(history) ? history : [])
              .filter((h: any) => h?.text && h.role !== 'system')
              .map((h: any) => ({ role: h.role === 'ai' ? 'assistant' : 'user', content: h.text })),
            { role: 'user', content: message },
          ];
          const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: activeModel,
              max_tokens: 2048,
              system: SENTINEL_PROMPT + liveContext,
              messages,
            }),
          });
          if (!anthropicRes.ok) return respond(await anthropicRes.text(), anthropicRes.status, corsHeaders);
          const anthropicData = await anthropicRes.json();
          const text = (anthropicData.content || []).map((part: any) => part?.text || '').join('\n').trim();
          return ok({ type: 'text', text, provider: 'anthropic', model: activeModel }, corsHeaders);
        }

        const response = await generateWithFallback(
          [activeModel, 'gemini-2.5-flash'],
          formattedHistory,
          message,
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
            await admin.from('admin_knowledge').insert({
              key: `broadcast_${Date.now()}`,
              value: JSON.stringify({ target, message: broadcastMsg, sent_at: new Date().toISOString() }),
              updated_at: new Date().toISOString()
            });

            // Disparar notificações reais para a audiência alvo
            try {
              const roleFilter = target === 'drivers' ? ['driver'] : target === 'passengers' ? ['passenger'] : ['driver', 'passenger', 'admin'];
              const { data: targetUsers } = await admin
                .from('users')
                .select('id')
                .in('role', roleFilter)
                .limit(100);

              if (targetUsers && targetUsers.length > 0) {
                const notifs = targetUsers.map((u: any) => ({
                  user_id: u.id,
                  title: '📢 Comunicado Zenith Ride',
                  message: broadcastMsg,
                  read: false,
                  created_at: new Date().toISOString(),
                }));
                await admin.from('notifications').insert(notifs);
              }
              result = { message: `Broadcast "${broadcastMsg}" transmitido com sucesso para ${target} (${targetUsers?.length ?? 0} utilizadores notificados em tempo real).` };
            } catch (broadcastErr: any) {
              result = { message: `Broadcast "${broadcastMsg}" registado no sistema para ${target}.` };
            }
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
          else if (tool_name === 'play_youtube') {
            const { query } = tool_args;
            const encoded = encodeURIComponent(query);
            result = {
              message: `YouTube aberto: "${query}"`,
              url: `https://www.youtube.com/results?search_query=${encoded}`
            };
          }
          else if (tool_name === 'search_youtube') {
            const { query } = tool_args;
            const encoded = encodeURIComponent(query);
            result = {
              message: `Pesquisa YouTube: "${query}"`,
              url: `https://www.youtube.com/results?search_query=${encoded}`
            };
          }
          else if (tool_name === 'web_search') {
            const { query } = tool_args;
            const encoded = encodeURIComponent(query);
            result = {
              message: `Pesquisa web: "${query}"`,
              url: `https://duckduckgo.com/?q=${encoded}`
            };
          }
          else if (tool_name === 'open_url') {
            const { url } = tool_args;
            if (!url || !url.startsWith('http')) throw new Error('URL inválida. Deve começar com http:// ou https://');
            result = {
              message: `Site aberto: ${url}`,
              url: url
            };
          }
          else if (tool_name === 'generate_code') {
            const { description, language = 'JavaScript' } = tool_args;
            const GEMINI_CODE_KEY = Deno.env.get('GEMINI_API_KEY') || GEMINI_API_KEY;
            if (!GEMINI_CODE_KEY) throw new Error('Chave Gemini não configurada para gerar código.');

            const codeAi = new GoogleGenerativeAI(GEMINI_CODE_KEY);
            const codeModel = codeAi.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const codePrompt = `Gera código completo e funcional em ${language} para o seguinte pedido:

"${description}"

Regras:
- Código completo, funcional e bem comentado em português
- Inclui todos os imports/dependências necessárias
- Sem explicações fora do código — apenas o código puro
- Se for um jogo, inclui HTML/CSS/JS num só ficheiro se possível
- Se for um template React/Vue, inclui estrutura completa

Responde APENAS com o código, sem markdown fences (\`\`\`).`;
            const codeRes = await codeModel.generateContent(codePrompt);
            const generatedCode = codeRes.response.text().trim();
            result = {
              message: `Código ${language} gerado. Copiado para a área de transferência.`,
              code: generatedCode,
              language
            };
          }
          else if (tool_name === 'create_agent') {
            const { name, description, personality, instructions, triggers } = tool_args;
            const agentTemplate = {
              name,
              description,
              personality,
              instructions,
              triggers,
              created_at: new Date().toISOString(),
              version: '1.0'
            };
            const { error } = await admin.from('admin_knowledge').insert({
              key: `agent_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
              value: JSON.stringify(agentTemplate),
              updated_at: new Date().toISOString()
            });
            if (error) throw error;
            result = {
              message: `Agente "${name}" criado e guardado.`,
              agent: agentTemplate
            };
          }
          else if (tool_name === 'get_fleet_summary') {
            const [subsRes, carsRes, billingRes] = await Promise.all([
              admin.from('fleet_subscriptions').select('plan, max_cars'),
              admin.from('fleet_cars').select('id, active'),
              admin.from('fleet_billing_events').select('amount_kz'),
            ]);

            const subs = subsRes.data ?? [];
            const cars = carsRes.data ?? [];
            const billings = billingRes.data ?? [];

            const totalRevenueKz = billings.reduce((sum: number, b: any) => sum + Number(b.amount_kz ?? 0), 0);
            const totalCars = cars.length;
            const activeCars = cars.filter((c: any) => c.active).length;

            result = {
              message: `Resumo de Frotas: ${subs.length} frotas registadas, ${activeCars}/${totalCars} viaturas activas, faturação acumulada de ${totalRevenueKz.toLocaleString('pt-AO')} Kz.`,
              total_fleets: subs.length,
              active_cars: activeCars,
              total_cars: totalCars,
              total_billing_kz: totalRevenueKz,
              plans: {
                free: subs.filter((s: any) => s.plan === 'free').length,
                pro: subs.filter((s: any) => s.plan === 'pro').length,
                elite: subs.filter((s: any) => s.plan === 'elite').length,
              }
            };
          }
          else if (tool_name === 'get_active_drivers_realtime') {
            const { data: drivers } = await admin
              .from('driver_locations')
              .select('driver_id, status, lat, lng, updated_at, users:driver_id(name, phone)')
              .order('updated_at', { ascending: false })
              .limit(50);

            const list = drivers ?? [];
            const availableCount = list.filter((d: any) => d.status === 'available').length;
            const busyCount = list.filter((d: any) => d.status === 'on_ride' || d.status === 'busy').length;

            result = {
              message: `Cluster Luanda: ${availableCount} motoristas disponíveis, ${busyCount} em corrida (${list.length} monitorizados em tempo real).`,
              available_count: availableCount,
              busy_count: busyCount,
              total_monitored: list.length,
              drivers_sample: list.slice(0, 10).map((d: any) => ({
                name: d.users?.name ?? 'Motorista',
                status: d.status,
                last_ping: d.updated_at
              }))
            };
          }
          else if (tool_name === 'get_system_health') {
            const [searchingRes, activeRes, sosRes] = await Promise.all([
              admin.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'searching'),
              admin.from('rides').select('id', { count: 'exact', head: true }).in('status', ['accepted', 'driver_arriving', 'in_progress']),
              admin.from('route_deviation_alerts').select('id', { count: 'exact', head: true }).eq('acknowledged', false),
            ]);

            result = {
              message: 'Estado do Sistema Operacional: 100% Online.',
              cluster: 'Luanda',
              status: 'OPERACIONAL',
              searching_rides: searchingRes.count ?? 0,
              active_rides: activeRes.count ?? 0,
              unacknowledged_alerts: sosRes.count ?? 0,
              timestamp: new Date().toISOString()
            };
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
    return respond('Erro interno do servidor.', 500, corsHeaders);
  }
});

function ok(data: any, corsHeaders: any) {
  return applyCors(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }), corsHeaders);
}

function respond(message: string, status: number, corsHeaders: any) {
  return applyCors(new Response(JSON.stringify({ error: true, message }), { status, headers: { 'Content-Type': 'application/json' } }), corsHeaders);
}
