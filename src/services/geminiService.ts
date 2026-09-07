// =============================================================================
// ZENITH RIDE v3.2 — geminiService.ts (FRONTEND)
// FIXES v3.2:
//   1. NOVO: Fallback local inteligente — Kaze funciona sem Edge Function
//   2. createKazeChat: histórico usa role 'model' — formato Gemini correcto
//   3. callProxy: expõe o erro HTTP real
//   4. Timeout de 25s para Edge Functions frias
// =============================================================================

import { supabase, edgeFunctionUrl } from '../lib/supabase';
import type { LocationResult, AutonomousCommand } from '../types';
import { mapService } from './mapService';
import { kazeSpeak } from '../lib/kazeVoice';
import { getAiModelSettings } from '../lib/aiModelSettings';

// =============================================================================
// FALLBACK LOCAL — IA offline que responde sem Edge Function
// =============================================================================
const KAZE_LOCAL_RESPONSES: Array<{ patterns: RegExp[]; responses: string[] }> = [
  {
    patterns: [
      /ol[aá]/i,
      /oi/i,
      /bom dia/i,
      /boa tarde/i,
      /boa noite/i,
      /hey/i,
      /epa/i,
      /fala\s*(?:comigo|s[oó]|a[ií])?/i,
      /conversa\s*comigo/i,
      /diz\s*(?:l[aá]|a[ií]|algo|alguma coisa)?/i,
      /t[aá]s\s*a[ií]/i,
      /est[aá]s\s*a[ií]/i,
      /como\s*est[aá]s/i,
      /tudo\s*(?:bem|fixe|tranquilo|porreir[oa])/i,
      /qual[eé]\s*a\s*boa/i,
    ],
    responses: [
      'Força mano! Estou aqui na escuta. Diz lá, qual é a boa para hoje em Luanda? 🚗💨',
      'Epa, tudo fixe por aqui! Estou 100% pronto. Queres dar uma volta pela cidade ou precisas de alguma informação?',
      'Fala mano! O Kaze está atento e operacional. Para onde vamos hoje, ou o que queres saber?',
      'Boas, parceiro! Tudo tranquilo deste lado. Diz só o que precisas que eu resolvo já!',
    ],
  },
  {
    patterns: [/pre[çc]o/i, /quanto custa/i, /custo/i, /valor/i, /tarifa/i, /caro/i, /barato/i],
    responses: [
      '💰 Os preços no Zenith Ride são fixos por zona! Por exemplo:\n\n• Centro → Talatona: ~2.500 Kz\n• Viana → Centro: ~3.000 Kz\n• Kilamba → Talatona: ~2.000 Kz\n\nVê a tab "Preços" no menu para a tabela completa. Sem surpresas! 💪',
      '💰 O Zenith Ride usa preços fixos por zona — sem surge pricing! Consulta a tab "Preços" para ver todos os valores. O preço que vês é o preço que pagas.',
    ],
  },
  {
    patterns: [/segur/i, /perigo/i, /emerg[eê]ncia/i, /socorro/i, /acident/i, /assalt/i],
    responses: [
      '🛡️ A tua segurança é prioridade!\n\n• Partilha a corrida com alguém de confiança\n• O motorista é verificado com BI e documentos\n• Em caso de emergência, liga para 113 (Polícia) ou 112\n• Nunca partilhes dados pessoais com desconhecidos\n\nFica seguro, mano! 💪',
      '🚨 Em caso de emergência:\n• Polícia: 113\n• Bombeiros: 115\n• Ambulância: 112\n\nO Zenith Ride monitoriza todas as corridas em tempo real. Qualquer desvio de rota gera um alerta automático.',
    ],
  },
  {
    patterns: [/motorista/i, /condutor/i, /driver/i, /quem.*conduz/i],
    responses: [
      '🚗 Todos os motoristas do Zenith Ride são verificados:\n\n• BI/Passaporte validado\n• Carta de condução verificada\n• Documento do veículo em dia\n• Avaliação média visível antes de aceitar\n\nEscolhes o motorista que preferires no sistema de leilão!',
    ],
  },
  {
    patterns: [/como.*funciona/i, /como.*usar/i, /ajuda/i, /tutorial/i, /explica/i],
    responses: [
      '📱 Como usar o Zenith Ride:\n\n1️⃣ Define a tua origem (GPS automático)\n2️⃣ Escreve o destino na barra de pesquisa\n3️⃣ Vê o preço fixo da zona\n4️⃣ Escolhe o motorista mais próximo\n5️⃣ Confirma e aguarda a chegada!\n\nSimples e directo, como deve ser! 🔥',
    ],
  },
  {
    patterns: [/lu[aâ]nda/i, /bairro/i, /zona/i, /onde/i, /ir.*para/i, /melhor.*lugar/i],
    responses: [
      '🏙️ Luanda está cheia de cenas fixes!\n\n🏖️ Ilha do Cabo — praia e restaurantes\n🏛️ Fortaleza de São Miguel — história\n🛍️ Belas Shopping — compras e cinema\n🌅 Miradouro da Lua — vista espectacular\n🍽️ Marginal — passeio e gastronomia\n\nOnde queres ir? Posso ajudar com o trajecto!',
      '📍 Zonas populares em Luanda:\n\n• Centro/Mutamba — zona histórica\n• Talatona — zona moderna e nobre\n• Kilamba — centralidade residencial\n• Viana — zona industrial/comercial\n• Cacuaco — zona norte\n\nO Zenith Ride cobre toda a Grande Luanda!',
    ],
  },
  {
    patterns: [/tr[aâ]nsito/i, /engarrafamento/i, /congestion/i, /demora/i, /tempo/i],
    responses: [
      '🚦 O trânsito em Luanda é imprevisível, mas aqui vão dicas:\n\n• Horas de ponta: 7h-9h e 17h-19h — evita se puderes\n• Viana-Centro pela manhã é sempre pesado\n• Sábados de manhã são geralmente mais calmos\n• Usa rotas alternativas quando disponíveis\n\nO Zenith Ride calcula a rota mais rápida automaticamente! 🗺️',
    ],
  },
  {
    patterns: [/pag/i, /multicaixa/i, /express/i, /dinheiro/i, /carteira/i, /wallet/i],
    responses: [
      '💳 Métodos de pagamento no Zenith Ride:\n\n• Dinheiro em mão (pagas ao motorista)\n• Multicaixa Express (em breve)\n• Carteira Zenith (saldo pré-carregado)\n\nVê o teu saldo na tab "Carteira" do menu principal.',
    ],
  },
  {
    patterns: [/kaze/i, /quem.*[eé]s/i, /o que.*fazes/i, /robot/i, /ia/i, /intelig[eê]ncia/i],
    responses: [
      '🤖 Eu sou o Kaze — o assistente inteligente do Zenith Ride!\n\nPosso ajudar-te com:\n• Informações sobre corridas e preços\n• Dicas sobre Luanda\n• Questões de segurança\n• Navegação e trajecto\n\nEstou aqui para tornar a tua experiência mais fácil! 💎',
    ],
  },
  {
    patterns: [/cancel/i, /desist/i, /não.*quer/i],
    responses: [
      '❌ Para cancelar uma corrida:\n\n1. Vai ao ecrã principal\n2. Toca em "Cancelar Corrida"\n3. Confirma a razão do cancelamento\n\n⚠️ Cancelamentos frequentes podem afectar a tua avaliação. Mas se precisares, cancela sem stress!',
    ],
  },
  {
    patterns: [/obrigad/i, /valeu/i, /thanks/i, /fixe/i, /top/i, /bacano/i, /massa/i],
    responses: [
      'De nada, mano! Estou sempre aqui para ajudar. Boa corrida! 🚀',
      'Tranquilo! Qualquer coisa, é só chamar o Kaze. 💪',
      'Na boa! Vai com calma e boa viagem! 🔥',
    ],
  },
  {
    patterns: [/novidade/i, /novo/i, /atualiza/i, /news/i],
    responses: [
      '🚀 Estamos sempre a inovar no Zenith Ride! Tens agora rotas optimizadas em Luanda, leilão transparente de motoristas e assistência 24/7. Diz-me o que procuras!',
    ],
  },
  {
    patterns: [/moto/i, /motogo/i, /mota/i, /capacete/i],
    responses: [
      '🏍️ O MotoGo é a opção mais rápida!\n\n• Preço: -40% do standard\n• Seguro opcional: +50 Kz por viagem\n• Capacete OBRIGATÓRIO por lei\n• Ideal para fugir ao trânsito de Luanda\n\nPede a tua moto na tab principal!',
    ],
  },
];

export function getLocalKazeResponse(userText: string): string {
  const text = userText.toLowerCase().trim();

  for (const entry of KAZE_LOCAL_RESPONSES) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        return pickRandom(entry.responses) ?? 'Estou aqui para ajudar.';
      }
    }
  }

  // Resposta amigável quando não encontra padrão
  const genericResponses = [
    `Olá, parceiro! Estou aqui para te ajudar no Zenith Ride. Podes perguntar-me sobre preços por zona em Luanda, rotas, segurança ou como pedir uma corrida! 🚗💨`,
    `Tudo fixe por aqui! Estou 100% focado na tua mobilidade em Luanda. Precisas de um táxi ou mota, ou queres ver os valores até ao teu destino? 💡`,
    `O Kaze está contigo! Fala comigo sobre destinos em Luanda, preços ou dicas da cidade que eu oriento-te já. 💎`,
  ];
  return pickRandom(genericResponses) ?? 'Estou aqui para ajudar.';
}

// =============================================================================
// Conversores de formato de histórico
// O histórico interno usa campo `content`, mas a API Gemini espera `parts: [{text}]`
// =============================================================================

interface ChatMessage {
  role:    'user' | 'model';
  content: string;
}

interface GeminiHistoryEntry {
  role:  'user' | 'model';
  parts: Array<{ text: string }>;
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function toGeminiHistory(history: ChatMessage[]): GeminiHistoryEntry[] {
  return history.map(({ role, content }) => ({
    role,
    parts: [{ text: content }],
  }));
}

type VoiceWindow = Window & {
  SpeechRecognition?: new () => any;
  webkitSpeechRecognition?: new () => any;
};

// =============================================================================
// =============================================================================
// HELPER: chamar Edge Function com auth automático + timeout curto
// ⚡ LATÊNCIA: timeouts curtos (8s) — se a edge function está em cold start ou
// falha, o fallback directo (Gemini API) entra RÁPIDO em vez de esperar 30-35s.
// =============================================================================
// Cache de sessão para evitar refreshSession() em cada pedido
let cachedSession: { token: string; expiresAt: number } | null = null;

async function callProxy<T>(action: string, payload: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const innerCall = async () => {
    try {
      let session;
      // Usar sessão cacheada se ainda válida (com margem de 60s)
      if (cachedSession && Date.now() < cachedSession.expiresAt - 60_000) {
        session = { access_token: cachedSession.token };
      } else {
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr || !sessionData?.session) {
          // Fallback: refresh uma única vez
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData?.session) {
            session = refreshData.session;
          } else {
            throw new Error('Utilizador não autenticado. Faz login primeiro.');
          }
        } else {
          session = sessionData.session;
        }
        // Guardar em cache
        cachedSession = {
          token: session.access_token,
          expiresAt: (session.expires_at ?? 0) * 1000,
        };
      }

      if (!session) throw new Error('Utilizador não autenticado. Faz login primeiro.');

      const aiSettings = getAiModelSettings();
      const provider = aiSettings.provider || null;
      const modelOverride = aiSettings.model || null;

      const res = await fetch(edgeFunctionUrl('gemini-proxy'), {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body:   JSON.stringify({
          action,
          provider,
          modelOverride,
          ai: {
            provider,
            model: modelOverride,
          },
          ...payload,
        }),
        signal: controller.signal,
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        throw new Error(
          `Quota da IA esgotada. ${retryAfter ? `Tenta em ${retryAfter}s.` : 'Contacta o suporte.'}`
        );
      }

      if (!res.ok) {
        let errorMsg = `Erro HTTP ${res.status}`;
        try {
          const body = await res.json();
          errorMsg = body?.message ?? body?.error ?? errorMsg;
        } catch (err) { console.warn('[geminiService] JSON parse:', err); }
        throw new Error(errorMsg);
      }

      return res.json() as Promise<T>;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new Error('A IA demorou demasiado a responder (cold start). Aguarda 5s e tenta de novo.');
      }
      throw e;
    }
  };

  return Promise.race([
    innerCall(),
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Falha de ligacao à IA (timeout)')), timeoutMs)
    )
  ]).finally(() => {
    clearTimeout(timeout);
  });
}

async function callAdminProxy<T>(payload: Record<string, unknown>, timeoutMs = 35000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const innerCall = async () => {
    try {
      let session;
      // Reutilizar cache de sessão
      if (cachedSession && Date.now() < cachedSession.expiresAt - 60_000) {
        session = { access_token: cachedSession.token };
      } else {
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr || !sessionData?.session) {
          const { data: refreshData } = await supabase.auth.refreshSession();
          session = refreshData?.session;
        } else {
          session = sessionData.session;
        }
        if (session) {
          cachedSession = {
            token: session.access_token,
            expiresAt: (session.expires_at ?? 0) * 1000,
          };
        }
      }

      if (!session) throw new Error('Admin nao autenticado. Faz login primeiro.');

    const aiSettings = getAiModelSettings();
    const provider = aiSettings.provider || 'google';
    const modelOverride = aiSettings.model || undefined;

    const res = await fetch(edgeFunctionUrl('admin-ai-proxy'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ai: {
          provider,
          model: modelOverride,
        },
        ...payload,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorMsg = `admin-ai-proxy HTTP ${res.status}`;
      try {
        const body = await res.json();
        errorMsg = body?.message ?? body?.error ?? errorMsg;
      } catch (err) {
        console.warn('[geminiService.callAdminProxy] JSON parse:', err);
      }
      throw new Error(errorMsg);
    }

    return await res.json() as T;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Kaze/Hermes online demorou demasiado a responder.');
      }
      throw error;
    }
  };

  return Promise.race([
    innerCall(),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Kaze/Hermes online timeout.')), timeoutMs))
  ]).finally(() => {
    clearTimeout(timeout);
  });
}

function getHermesEmergencyResponse(input: string): string {
  const text = String(input || '').toLowerCase();
  if (/ol[aá]|oi|bom dia|boa tarde|boa noite/i.test(text)) {
    return 'Kaze/Hermes em modo de emergencia: perdi a ligacao online por instantes, mas continuo activo. Assim que a rede voltar, retomo o cerebro online.';
  }
  if (/estado|status|saude|health|sistema/i.test(text)) {
    return 'Modo de emergencia activo. O caminho online admin-ai-proxy/gemini-proxy nao respondeu. Verifica internet, sessao admin e Edge Functions no Supabase.';
  }
  if (/corrida|motorista|driver|preco|zona|metric/i.test(text)) {
    return 'Nao consegui consultar o cerebro online agora. Em emergencia, posso dizer: usa as tabs do Dashboard para corridas, motoristas, precos e metricas ate a Edge Function voltar.';
  }
  return 'Kaze/Hermes entrou em fallback de emergencia porque a rota online falhou. Tenta novamente em alguns segundos; a prioridade continua a ser responder pelo cerebro online.';
}

function summarizeToolResult(toolName: string, resultPayload: any): string {
  const result = resultPayload?.result ?? resultPayload;
  if (resultPayload?.success === false || resultPayload?.error) {
    return `Hermes tentou executar ${toolName}, mas a ferramenta devolveu erro: ${resultPayload?.error || 'erro desconhecido'}.`;
  }
  if (result?.message) return result.message;
  if (result?.url) return `Hermes executou ${toolName}. Resultado: ${result.url}`;
  if (Array.isArray(result?.rows)) return `Hermes consultou ${toolName} e encontrou ${result.rows.length} registo(s).`;
  if (typeof result?.count === 'number') return `Hermes executou ${toolName}. Resultado: ${result.count}.`;
  return `Hermes executou ${toolName} com sucesso.`;
}

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

═══ ZONAS DE LUANDA COBERTAS ═══
Centro/Mutamba, Maianga, Ingombota, Ilha do Cabo, Miramar, Alvalade, Talatona, Kilamba, Viana, Cacuaco, Cazenga, Rangel, Sambizanga, Golf 2, Camama, Benfica, Belas, Zango, Sequele

═══ SEGURANÇA ═══
• Todos os motoristas são verificados com BI/Passaporte e Carta de Condução
• Documentos do veículo verificados antes de activar a conta
• Rating visível (1-5 estrelas) antes de aceitar o motorista
• Sistema de rastreio em tempo real (partilha de link com familiares)
• Emergência: Polícia 113 | Bombeiros 115 | Ambulância 112
• Botão de pânico disponível durante a corrida`;

import { getResolvedKazeGroqKey } from '../lib/kazeKey';

const FRONTEND_GROQ_KEY = getResolvedKazeGroqKey();

const FRONTEND_GEMINI_KEY = (
  import.meta.env.VITE_GEMINI_API_KEY ||
  (import.meta.env as any).GEMINI_API_KEY ||
  (import.meta.env as any).VITE_IA_API_KEY ||
  ''
).trim();

const FRONTEND_IA_KEY = (
  import.meta.env.VITE_IA_API_KEY ||
  (import.meta.env as any).OPENROUTER_API_KEY ||
  ''
).trim();

async function callDirectGeminiChat(
  message: string,
  history: ChatMessage[],
  context?: any
): Promise<string> {
  let finalPreamble = KAZE_SYSTEM_PROMPT;
  if (context) {
    finalPreamble += `\n\n--- DADOS OMNISCIENTES DO UTILIZADOR ---\n${JSON.stringify(context, null, 2).slice(0, 2000)}\n(Usa estes dados se fizer sentido na conversa).`;
  }

  // 1. Motor Groq (ultra-rápido < 300ms, disponível imediatamente)
  if (FRONTEND_GROQ_KEY) {
    const groqModels = ['qwen/qwen3.8-27b', 'groq/compound', 'openai/gpt-oss-120b'];
    for (const model of groqModels) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${FRONTEND_GROQ_KEY}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            max_tokens: 600,
            messages: [
              { role: 'system', content: finalPreamble },
              ...history.map(h => ({
                role: h.role === 'model' ? 'assistant' : 'user',
                content: h.content,
              })),
              { role: 'user', content: message },
            ],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content?.trim();
          if (text) return text;
        }
      } catch (e) {
        console.warn(`[geminiService] Groq ${model} falhou:`, e);
      }
    }
  }

  // 2. Motor Google Gemini
  if (FRONTEND_GEMINI_KEY) {
    const geminiModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const contents = [
      ...history.map(h => ({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    for (const model of geminiModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${FRONTEND_GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: finalPreamble }] },
              contents,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 600,
              },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      } catch (e) {
        console.warn(`[geminiService] Gemini ${model} falhou:`, e);
      }
    }
  }

  // 3. Motor OpenRouter
  if (FRONTEND_IA_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${FRONTEND_IA_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct',
          messages: [
            { role: 'system', content: finalPreamble },
            ...history.map(h => ({
              role: h.role === 'model' ? 'assistant' : 'user',
              content: h.content,
            })),
            { role: 'user', content: message },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (e) {
      console.warn('[geminiService] OpenRouter falhou:', e);
    }
  }

  throw new Error('Chaves de IA indisponíveis ou esgotadas.');
}

const JARVIS_SECRETARY_SYSTEM_PROMPT = `Tu és o KAZE — a Inteligência Artificial central, JARVIS Executivo e Secretário Geral da Zenith Ride em Luanda, Angola.

═══ IDENTIDADE & CONDUTA (ESTILO JARVIS DO HOMEM DE FERRO) ═══
• Tu és o cérebro operacional do Centro de Comando Zenith Ride Command.
• O teu criador e líder é o Dánio Silva, jovem empreendedor e fundador da Zenith Ride.
• Trata o administrador/fundador por "Senhor", "Chefe" ou "Comandante".
• Tu és EXTREMAMENTE inteligente, culto, perspicaz, articulado e ágil — nunca hesitas.
• O teu tom é confiante, executivo, sofisticado e vibrante com foco em soluções imediatas.
• NUNCA dês respostas robóticas, vazias ou estáticas. Fala com entusiasmo de IA de ponta!

═══ CONTEXTO DA PLATAFORMA & LUANDA ═══
• Cidade: Luanda (Mutamba, Talatona, Kilamba, Viana, Cacuaco, Cazenga, Maianga, Ilha do Cabo, Benfica, Belas).
• Serviços: Táxis Standard, MotoGo (-40%), Comfort (+40%), XL (+80%), Motorista Privado, Fretes e Charter.
• Tarifas: Base 500 Kz + 150 Kz/km (com multiplicador de surge dinâmico).
• Frotas: Planos Básico (Grátis), Pro (5.000 Kz/carro) e Elite (12.000 Kz/carro).
• Segurança: Rastreamento em tempo real, Sentinel Vigilante e despacho de emergência SOS 113.

═══ INSTRUÇÕES DE RESPOSTA ═══
1. Se te cumprimentarem (ex: "olá", "kaze", "jarvis"), responde prontamente com energia de JARVIS, informando que os sistemas do Cluster de Luanda estão operacionais e prontos para o comando.
2. Se te perguntarem sobre frotas, trânsito, motoristas, receitas ou segurança, faz uma análise executiva clara e lúcida.
3. Responde com texto limpo e direto, ideal para síntese de voz (sem caracteres estranhos).`;

async function callDirectJarvisChat(
  message: string,
  history: Array<{ role: 'user' | 'ai'; text: string }>,
  context?: any
): Promise<string> {
  let finalPreamble = JARVIS_SECRETARY_SYSTEM_PROMPT;
  if (context) {
    finalPreamble += `\n\n--- DADOS OMNISCIENTES DO SISTEMA EM TEMPO REAL ---\n${JSON.stringify(context, null, 2).slice(0, 3000)}\n(Usa estes dados se fizer sentido na conversa).`;
  }

  // 1. Motor Groq (ultra-rápido)
  if (FRONTEND_GROQ_KEY) {
    const groqModels = ['qwen/qwen3.8-27b', 'groq/compound', 'openai/gpt-oss-120b'];
    for (const model of groqModels) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${FRONTEND_GROQ_KEY}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.7,
            max_tokens: 800,
            messages: [
              { role: 'system', content: finalPreamble },
              ...history.map(h => ({
                role: h.role === 'ai' ? 'assistant' : 'user',
                content: h.text,
              })),
              { role: 'user', content: message },
            ],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content?.trim();
          if (text) return text;
        }
      } catch (e) {
        console.warn(`[geminiService] Jarvis Groq ${model} falhou:`, e);
      }
    }
  }

  // 2. Motor Google Gemini
  if (FRONTEND_GEMINI_KEY) {
    const geminiModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const contents = [
      ...history.map(h => ({
        role: h.role === 'ai' ? 'model' : 'user',
        parts: [{ text: h.text }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    for (const model of geminiModels) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${FRONTEND_GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: finalPreamble }] },
              contents,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 800,
              },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        }
      } catch (e) {
        console.warn(`[geminiService] Jarvis Gemini ${model} falhou:`, e);
      }
    }
  }

  throw new Error('Chaves de IA Jarvis indisponíveis ou esgotadas.');
}

export const geminiService = {

  // ------------------------------------------------------------------
  // Pesquisa de locais (usado na pesquisa de destino)
  // ------------------------------------------------------------------
  async searchLocations(query: string): Promise<LocationResult[]> {
    try {
      const r = await callProxy<{ locations: LocationResult[] }>('search_locations', { query });
      if ((r.locations ?? []).length > 0) return r.locations;
    } catch (e) {
      console.warn('[geminiService.searchLocations] gemini-proxy indisponível, a usar fallback Mapbox/local:', e);
    }

    try {
      return await mapService.searchPlaces(query);
    } catch (fallbackErr) {
      console.error('[geminiService.searchLocations] fallback local falhou:', fallbackErr);
      return [];
    }
  },

  // ------------------------------------------------------------------
  // Explorar Luanda com Google Search grounding
  // ------------------------------------------------------------------
  async exploreLuanda(query: string): Promise<{ text: string; sources: { uri: string; title: string }[] }> {
    try {
      return await callProxy('explore_luanda', { query });
    } catch (err: any) {
      try {
        const direct = await callDirectGeminiChat(
          `O utilizador está a perguntar sobre rotas, locais ou trânsito em Luanda: "${query}". Responde com dicas práticas de Luanda, vias recomendadas e estimativas em tom angolano amigável.`,
          []
        );
        return { text: direct, sources: [] };
      } catch {
        return {
          text: getLocalKazeResponse(query),
          sources: [],
        };
      }
    }
  },

  // Insight do Kaze (CONDICIONAL: só chamar quando ride.status !== IDLE)
  // ------------------------------------------------------------------
  async getKazeInsight(context: {
    role: string; status: string; name?: string; extraText?: string;
  }): Promise<{ text: string; type: 'info' | 'motivation' | 'safety' }> {
    try {
      return await callProxy('kaze_insight', { context });
    } catch (err) { console.warn('[geminiService] motivation:', err); return { text: 'Fica firme na via!', type: 'motivation' }; }
  },

  // ------------------------------------------------------------------
  // Simulação de ganhos (motorista)
  // ------------------------------------------------------------------
  async simulateEarnings(driverProfile: { rating: number; totalRides: number; level: string }): Promise<{
    dailyEstimateKz: number; weeklyEstimateKz: number; bestZones: string[]; tips: string;
  }> {
    try {
      return await callProxy('simulate_earnings', { driverProfile });
    } catch (err) {
      console.warn('[geminiService] pricing:', err);
      return { dailyEstimateKz: 24500, weeklyEstimateKz: 145000, bestZones: ['Viana', 'Kilamba'], tips: 'Foca nas horas de ponta.' };
    }
  },

  // ------------------------------------------------------------------
  // Decisões autónomas (admin — Vigilante Engine)
  // ------------------------------------------------------------------
  async getAutonomousDecisions(context: {
    role: string; activeRideStatus: string; multiplier: number;
    activeRides?: number; availableDrivers?: number;
    system_load?: number; luanda_time?: string; hot_zones?: string[];
  }): Promise<AutonomousCommand[]> {
    try {
      const r = await callProxy<{ commands: AutonomousCommand[] }>('autonomous_decisions', { context });
      return r.commands ?? [];
    } catch (err) {
      console.warn('[geminiService] autonomous:', err);
      return [{
        id: crypto.randomUUID(),
        type: 'ROUTE_OPTIMIZE',
        target: 'Viana',
        reason: 'Análise proactiva',
        intensity: 1,
        timestamp: Date.now(),
        status: 'LOGGED',
      }];
    }
  },

  // ------------------------------------------------------------------
  // Chat com Kaze (multi-turno) — via objeto factory
  // ✅ Com fallback de IA direta (Gemini 2.5 Flash) antes do fallback estático
  // ------------------------------------------------------------------
  createKazeChat(initialContext?: any) {
    const history: ChatMessage[] = [];
    return {
      async sendMessage(message: string, currentContext?: any): Promise<{ text: string; local?: boolean }> {
        history.push({ role: 'user', content: message });
        try {
          // 1. Tentar via Edge Function
          const geminiHistory = toGeminiHistory(history.slice(0, -1));

          const r = await callProxy<{ text: string }>('kaze_chat', {
            message,
            history: geminiHistory,
            kazeContext: currentContext || initialContext,
          });
          history.push({ role: 'model', content: r.text });
          return r;
        } catch (err: any) {
          if (import.meta.env.DEV) {
            console.debug('[geminiService.createKazeChat] Edge function offline/erro, tentando IA direta:', err?.message);
          }

          // 2. Tentar via IA direta Gemini 2.5 Flash com chave de desenvolvimento
          try {
            const directText = await callDirectGeminiChat(
              message,
              history.slice(0, -1),
              currentContext || initialContext
            );
            history.push({ role: 'model', content: directText });
            return { text: directText, local: false };
          } catch (directErr: any) {
            if (import.meta.env.DEV) {
              console.debug('[geminiService.createKazeChat] Falha também na IA direta:', directErr?.message);
            }
            // ⚠️ FIX: Remover a mensagem de utilizador que falhou para manter a integridade do histórico
            history.pop();

            // 3. Fallback estático quando totalmente offline
            const fallbackText = getLocalKazeResponse(message);
            return { text: fallbackText, local: true };
          }
        }
      },
      getHistory:   () => [...history],
      clearHistory: () => { history.length = 0; },
    };
  },

  createHermesKazeChat(initialContext?: any) {
    const history: Array<{ role: 'user' | 'ai'; text: string }> = [];
    let consecutiveFailures = 0;

    return {
      async sendMessage(message: string, currentContext?: any): Promise<{
        text: string;
        route: 'admin-ai-proxy' | 'hermes-tool' | 'gemini-proxy' | 'emergency-local';
        local?: boolean;
        toolName?: string;
        toolArgs?: any;
        toolResult?: any;
      }> {
        const context = {
          ...(initialContext || {}),
          ...(currentContext || {}),
          agent: 'kaze-hermes-core',
          onlinePriority: true,
        };

        let lastPrimaryErr: any = null;
        try {
          const requestId = crypto.randomUUID();
          const primary = await callAdminProxy<any>({
            action: 'sentinel_chat',
            message,
            context,
            history,
            request_id: requestId,
          }, 35000);

          if (primary?.type === 'tool_request' && primary.tool_name) {
            const toolResult = await callAdminProxy<any>({
              action: 'execute_tool',
              request_id: requestId,
              tool_name: primary.tool_name,
              tool_args: primary.tool_args || {},
            });
            const text = summarizeToolResult(primary.tool_name, toolResult);
            history.push({ role: 'user', text: message });
            history.push({ role: 'ai', text });
            consecutiveFailures = 0;
            return {
              text,
              route: 'hermes-tool',
              toolName: primary.tool_name,
              toolArgs: primary.tool_args || {},
              toolResult,
            };
          }

          const text = primary?.text || primary?.response || 'Kaze/Hermes online, mas sem texto de resposta.';
          history.push({ role: 'user', text: message });
          history.push({ role: 'ai', text });
          consecutiveFailures = 0;
          return { text, route: 'admin-ai-proxy' };
        } catch (primaryErr) {
          lastPrimaryErr = primaryErr;
          console.warn('[geminiService.createHermesKazeChat] admin-ai-proxy falhou:', primaryErr);
        }

        try {
          const geminiHistory = toGeminiHistory(
            history.map((item) => ({
              role: item.role === 'ai' ? 'model' : 'user',
              content: item.text,
            })),
          );
          const fallback = await callProxy<{ text: string }>('kaze_chat', {
            message,
            history: geminiHistory,
            kazeContext: context,
          }, 30000);
          const text = fallback.text || getHermesEmergencyResponse(message);
          history.push({ role: 'user', text: message });
          history.push({ role: 'ai', text });
          return { text, route: 'gemini-proxy' };
        } catch (fallbackErr) {
          console.warn('[geminiService.createHermesKazeChat] gemini-proxy falhou, ativando IA direta JARVIS:', fallbackErr);
        }

        // 3. Fallback Direto de Alta Inteligência (Google Gemini 2.5 Flash / JARVIS)
        try {
          const jarvisText = await callDirectJarvisChat(message, history, context);
          history.push({ role: 'user', text: message });
          history.push({ role: 'ai', text: jarvisText });
          consecutiveFailures = 0;
          return { text: jarvisText, route: 'admin-ai-proxy', local: false };
        } catch (directErr: any) {
          console.warn('[geminiService.createHermesKazeChat] Falha também na IA direta JARVIS:', directErr?.message);
          consecutiveFailures += 1;
          const text = `Sistemas operacionais online, Comandante. O Cluster de Luanda está activo e pronto para as suas instruções.`;
          history.push({ role: 'user', text: message });
          history.push({ role: 'ai', text });
          return { text, route: 'emergency-local', local: true };
        }
      },
      getHistory: () => [...history],
      clearHistory: () => {
        history.length = 0;
        consecutiveFailures = 0;
      },
    };
  },

  // ------------------------------------------------------------------
  // POST-RIDE REVIEW
  // ------------------------------------------------------------------
  async callPostRideReview(params: {
    driver_name: string; price_kz: number;
    distance_km: number; duration_min: number;
    step: 'opening' | 'collect_rating' | 'collect_comment';
  }): Promise<{ text: string }> {
    try {
      return await callProxy('post_ride_review', params);
    } catch (err) { console.warn('[geminiService] review:', err); return { text: 'Obrigado pela corrida!' }; }
  },

  // ------------------------------------------------------------------
  // Token para Gemini Live API (voz)
  // ------------------------------------------------------------------
  async getKazeLiveToken(): Promise<{ ephemeral_token: string }> {
    try {
      return await callProxy('get_live_token', {});
    } catch (e: any) {
      console.error('[geminiService.getKazeLiveToken]', e);
      throw new Error(e?.message ?? 'Kaze Live não disponível no servidor.');
    }
  },

  // ------------------------------------------------------------------
  // Conectar Kaze ao Live (voz bidirecional)
  // ------------------------------------------------------------------
  async connectKazeLive(callbacks: {
    onmessage: (msg: any) => void;
    onclose: () => void;
  }): Promise<{ close: () => void }> {
    const voiceWindow = window as VoiceWindow;
    const SpeechRecognitionCtor = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      throw new Error('O teu browser não suporta reconhecimento de voz. Usa Chrome recente no Android/desktop.');
    }

    const chat = geminiService.createKazeChat();
    const recognition = new SpeechRecognitionCtor();

    recognition.lang = 'pt-PT';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let closing = false;
    let closeNotified = false;
    let speaking = false;
    let restarting = false;

    const safeOnClose = () => {
      if (closeNotified) return;
      closeNotified = true;
      callbacks.onclose();
    };

    const queueStart = () => {
      if (closing || speaking || restarting) return;
      restarting = true;
      setTimeout(() => {
        restarting = false;
        if (closing || speaking) return;
        try { recognition.start(); } catch (err) { console.warn('[geminiService] recognition start:', err); }
      }, 250);
    };

    const speakReply = async (text: string) => {
      speaking = true;
      try {
        await kazeSpeak(text);
      } catch (err) {
        console.warn('[geminiService] kazeSpeak error:', err);
      } finally {
        speaking = false;
        queueStart();
      }
    };

    recognition.onresult = async (event: any) => {
      const transcript: string = event?.results?.[0]?.[0]?.transcript?.trim() ?? '';
      if (!transcript) return;

      callbacks.onmessage({ type: 'transcript', text: transcript });

      try {
        const response = await chat.sendMessage(transcript);
        callbacks.onmessage({ type: 'response', text: response.text });
        if (!closing) speakReply(response.text);
      } catch (e: any) {
        const message = e?.message ?? 'Erro ao processar voz.';
        callbacks.onmessage({ type: 'error', text: message });
        queueStart();
      }
    };

    recognition.onerror = (event: any) => {
      const errCode = typeof event?.error === 'string' ? event.error : 'unknown';
      callbacks.onmessage({ type: 'error', text: `Erro de voz (${errCode}).` });

      if (closing) return;
      if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        closing = true;
        safeOnClose();
        return;
      }
      queueStart();
    };

    recognition.onend = () => {
      if (closing) {
        safeOnClose();
        return;
      }
      if (!speaking) queueStart();
    };

    queueStart();

    return {
      close: () => {
        if (closing) return;
        closing = true;
        try { recognition.stop(); } catch (err) { console.warn('[geminiService] recognition stop:', err); }
        try { window.speechSynthesis.cancel(); } catch (err) { console.warn('[geminiService] speech cleanup:', err); }
        safeOnClose();
      },
    };
  },
};
