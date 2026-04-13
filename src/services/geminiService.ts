// =============================================================================
// ZENITH RIDE v3.1 — geminiService.ts (FRONTEND)
// FIXES v3.1:
//   1. createKazeChat: histórico usa role 'model' (não 'assistant') — formato Gemini correcto
//   2. callProxy: expõe o erro HTTP real em vez de esconder
//   3. Mensagens de erro mais informativas com diagnóstico
//   4. Timeout aumentado de 8s para 12s (Edge Functions frias demoram mais)
// BUG #11 CORRIGIDO (2ª passagem):
//   GeminiChatService estava embrulhada dentro do catch de exploreLuanda.
//   Movida para o nível do módulo.
// =============================================================================

import { supabase, edgeFunctionUrl } from '../lib/supabase';
import type { LocationResult, AutonomousCommand } from '../types';

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

// =============================================================================
// HELPER: chamar Edge Function com auth automático + timeout de 12s
// =============================================================================
async function callProxy<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Utilizador não autenticado. Faz login primeiro.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(edgeFunctionUrl('gemini-proxy'), {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body:   JSON.stringify({ action, ...payload }),
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
      return r.locations ?? [];
    } catch (e) { console.error('[geminiService.searchLocations]', e); return []; }
  },

  // ------------------------------------------------------------------
  // Explorar Luanda com Google Search grounding
  // ------------------------------------------------------------------
  async exploreLuanda(query: string): Promise<{ text: string; sources: { uri: string; title: string }[] }> {
    try {
      return await callProxy('explore_luanda', { query });
    } catch (err: any) {
      const isNoFunction = err?.message?.includes('404') || err?.message?.includes('not found');
      return {
        text: isNoFunction
          ? '⚠️ A Edge Function gemini-proxy não está activa no teu projecto Supabase. Vai ao painel Supabase → Edge Functions → Deploy.'
          : `Mano, a rede está a dar mambo: ${err?.message ?? 'erro desconhecido'}. Tenta de novo!`,
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
  createKazeChat() {
    const history: ChatMessage[] = [];
    return {
      async sendMessage(message: string): Promise<{ text: string }> {
        history.push({ role: 'user', content: message });
        try {
          // Converter para formato Gemini [{role, parts:[{text}]}]
          const geminiHistory = toGeminiHistory(history.slice(0, -1));

          const r = await callProxy<{ text: string }>('kaze_chat', {
            message,
            history: geminiHistory,
          });
          history.push({ role: 'model', content: r.text });
          return r;
        } catch (err: any) {
          const isAuth    = err?.message?.includes('autenticado');
          const isTimeout = err?.message?.includes('demorou');
          const is404     = err?.message?.includes('404') || err?.message?.includes('not found');

          const errorText = is404
            ? '⚠️ A Edge Function gemini-proxy não está deployada no Supabase. Vai ao painel → Edge Functions e faz deploy.'
            : isAuth
            ? '🔒 Sessão expirada. Sai e volta a entrar.'
            : isTimeout
            ? '⏱️ A IA demorou a responder. É normal no primeiro pedido (cold start). Tenta de novo.'
            : `❌ ${err?.message ?? 'Erro desconhecido.'}`;

          return { text: errorText };
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
    try {
      const tokenData = await geminiService.getKazeLiveToken();
      if (!tokenData?.ephemeral_token) throw new Error('Token efémero inválido.');
      console.log('[KazeLive] Token obtido, usar SDK Gemini Live com este token');
      return { close: () => callbacks.onclose() };
    } catch (e) {
      console.error('[geminiService.connectKazeLive] falha:', e);
      throw e;
    }
  },
};
