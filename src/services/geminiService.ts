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

// =============================================================================
// FALLBACK LOCAL — IA offline que responde sem Edge Function
// =============================================================================
const KAZE_LOCAL_RESPONSES: Array<{ patterns: RegExp[]; responses: string[] }> = [
  {
    patterns: [/ol[aá]/i, /oi/i, /bom dia/i, /boa tarde/i, /boa noite/i, /hey/i, /epa/i],
    responses: [
      'Olá mano! Sou o Kaze, o teu assistente aqui no Zenith Ride. Como posso ajudar?',
      'Epa, tudo fixe? O Kaze está aqui para te ajudar com a tua corrida em Luanda!',
      'Boas! Diz-me o que precisas — estou pronto para te ajudar! 🚗',
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
    patterns: [/obrigad/i, /valeu/i, /fixe/i, /top/i, /bacano/i, /massa/i],
    responses: [
      'De nada, mano! Estou sempre aqui para ajudar. Boa corrida! 🚀',
      'Tranquilo! Qualquer coisa, é só chamar o Kaze. 💪',
      'Na boa! Vai com calma e boa viagem! 🔥',
    ],
  },
];

function getLocalKazeResponse(userText: string): string {
  const text = userText.toLowerCase().trim();

  for (const entry of KAZE_LOCAL_RESPONSES) {
    for (const pattern of entry.patterns) {
      if (pattern.test(text)) {
        const responses = entry.responses;
        return responses[Math.floor(Math.random() * responses.length)];
      }
    }
  }

  // Resposta genérica quando não encontra padrão
  const genericResponses = [
    `Boa pergunta! Neste momento estou em modo local (sem ligação ao servidor de IA). Posso ajudar-te com:\n\n• Preços das corridas\n• Segurança\n• Como funciona o app\n• Dicas sobre Luanda\n• Trânsito\n\nPergunta-me sobre qualquer um destes temas! 🤖`,
    `Mano, estou a funcionar em modo offline agora. Mas posso ajudar com informações sobre corridas, preços, zonas de Luanda e segurança. Pergunta algo específico! 💡`,
    `O Kaze está em modo local — a ligação ao servidor de IA não está disponível agora. Mas ainda posso ajudar! Tenta perguntar sobre preços, zonas, segurança ou como usar o app. 🚗`,
  ];
  return genericResponses[Math.floor(Math.random() * genericResponses.length)];
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
// HELPER: chamar Edge Function com auth automático + timeout aumentado
// =============================================================================
async function callProxy<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Utilizador não autenticado. Faz login primeiro.');

    const provider = localStorage.getItem('zenith_ia_provider');
    const modelOverride = localStorage.getItem('zenith_ia_model');
    // SEGURANÇA: Chave API NUNCA é guardada no browser — é gerida exclusivamente
    // pela Edge Function via variáveis de ambiente no Supabase Dashboard.

    const res = await fetch(edgeFunctionUrl('gemini-proxy'), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body:   JSON.stringify({ action, provider, modelOverride, ...payload }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      let errorMsg = `Erro HTTP ${res.status}`;
      try {
        const body = await res.json();
        errorMsg = body?.message ?? body?.error ?? errorMsg;
      } catch { /* ignorar se body não é JSON */ }
      throw new Error(errorMsg);
    }

    return res.json() as Promise<T>;

  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new Error('A IA demorou demasiado a responder (cold start). Aguarda 5s e tenta de novo.');
    }
    throw e;
  }
}

// =============================================================================
// ✅ BUG #11 CORRIGIDO: Classe GeminiChatService ao nível do módulo (não dentro de geminiService)
// =============================================================================
export class GeminiChatService {
  private history: ChatMessage[] = [];

  async sendMessage(userText: string, authToken: string): Promise<string> {
    this.history.push({ role: 'user', content: userText });

    // Converter histórico para formato Gemini ANTES de enviar (excluindo a mensagem actual)
    const geminiHistory = toGeminiHistory(this.history.slice(0, -1));

    const response = await fetch(edgeFunctionUrl('gemini-proxy'), {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        action:  'kaze_chat',
        message: userText,
        history: geminiHistory,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Erro desconhecido');
      throw new Error(`[GeminiService] Edge Function erro ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    const modelText: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.text ?? '';

    if (!modelText) {
      throw new Error('[GeminiService] Resposta vazia do modelo.');
    }

    this.history.push({ role: 'model', content: modelText });
    this.trimHistory(20);

    return modelText;
  }

  clearHistory(): void {
    this.history = [];
  }

  private trimHistory(maxMessages: number): void {
    if (this.history.length > maxMessages) {
      this.history = this.history.slice(-maxMessages);
    }
  }
}

// =============================================================================
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
      console.warn('[geminiService.exploreLuanda] Edge function indisponível. Usando fallback local.');
      return {
        text: getLocalKazeResponse(query),
        sources: [],
      };
    }
  },

  // Insight do Kaze (CONDICIONAL: só chamar quando ride.status !== IDLE)
  // ------------------------------------------------------------------
  async getKazeInsight(context: {
    role: string; status: string; name?: string; extraText?: string;
  }): Promise<{ text: string; type: 'info' | 'motivation' | 'safety' }> {
    try {
      return await callProxy('kaze_insight', { context });
    } catch { return { text: 'Fica firme na via!', type: 'motivation' }; }
  },

  // ------------------------------------------------------------------
  // Simulação de ganhos (motorista)
  // ------------------------------------------------------------------
  async simulateEarnings(driverProfile: { rating: number; totalRides: number; level: string }): Promise<{
    dailyEstimateKz: number; weeklyEstimateKz: number; bestZones: string[]; tips: string;
  }> {
    try {
      return await callProxy('simulate_earnings', { driverProfile });
    } catch {
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
    } catch {
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
  // ✅ BUG #11 CORRIGIDO: converter histórico para formato Gemini antes de enviar
  // ------------------------------------------------------------------
  createKazeChat(initialContext?: any) {
    const history: ChatMessage[] = [];
    return {
      async sendMessage(message: string, currentContext?: any): Promise<{ text: string }> {
        history.push({ role: 'user', content: message });
        try {
          // Converter para formato Gemini [{role, parts:[{text}]}]
          const geminiHistory = toGeminiHistory(history.slice(0, -1));

          const r = await callProxy<{ text: string }>('kaze_chat', {
            message,
            history: geminiHistory,
            kazeContext: currentContext || initialContext,
          });
          history.push({ role: 'model', content: r.text });
          return r;
        } catch (err: any) {
          console.warn('[geminiService.createKazeChat] Edge function indisponível. Usando fallback local.');
          
          // ⚠️ FIX: Remover a mensagem de utilizador que falhou para não quebrar a ordem user-model-user-model do Gemini
          history.pop();

          const fallbackText = getLocalKazeResponse(message);
          return { text: fallbackText };
        }
      },
      getHistory:   () => [...history],
      clearHistory: () => { history.length = 0; },
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
    } catch { return { text: 'Obrigado pela corrida!' }; }
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
        try { recognition.start(); } catch { /* evitar crash se já estiver activo */ }
      }, 250);
    };

    const speakReply = (text: string) => {
      if (!('speechSynthesis' in window)) {
        queueStart();
        return;
      }

      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'pt-PT';
      utter.rate = 1;
      utter.pitch = 1;

      speaking = true;
      utter.onend = () => {
        speaking = false;
        queueStart();
      };
      utter.onerror = () => {
        speaking = false;
        queueStart();
      };

      window.speechSynthesis.speak(utter);
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
        try { recognition.stop(); } catch { /* ignore */ }
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
        safeOnClose();
      },
    };
  },
};
