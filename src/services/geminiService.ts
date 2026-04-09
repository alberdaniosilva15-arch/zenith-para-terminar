// =============================================================================
// ZENITH RIDE v3.0 — geminiService.ts (FRONTEND)
// ✅ CORREÇÃO 3 APLICADA: timeout de 8s via AbortController no callProxy
// Todas as chamadas passam pela Edge Function gemini-proxy
// A API key NUNCA está no frontend
// =============================================================================

import { supabase, edgeFunctionUrl } from '../lib/supabase';
import type { LocationResult, AutonomousCommand } from '../types';

// =============================================================================
// HELPER: chamar Edge Function com auth automático + timeout de 8s
// =============================================================================
async function callProxy<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Utilizador não autenticado.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

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
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message ?? `Erro ${res.status}`);
    }

    return res.json() as Promise<T>;

  } catch (e: any) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      throw new Error('A IA demorou muito a responder. Tenta de novo.');
    }
    throw e;
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
    } catch {
      return { text: 'Mano, a rede está a dar mambo. Tenta de novo!', sources: [] };
    }
  },

  // ------------------------------------------------------------------
  // Insight do Kaze (CONDICIONAL: só chamar quando ride.status !== IDLE)
  // ------------------------------------------------------------------
  async getKazeInsight(context: { role: string; status: string; name?: string }): Promise<{ text: string; type: 'info' | 'motivation' | 'safety' }> {
    try {
      return await callProxy('kaze_insight', { context });
    } catch { return { text: 'Fica firme na via, mano!', type: 'motivation' }; }
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
  // Chat com Kaze (multi-turno)
  // Só criar quando há corrida activa
  // ------------------------------------------------------------------
  createKazeChat() {
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    return {
      async sendMessage(message: string): Promise<{ text: string }> {
        history.push({ role: 'user', content: message });
        try {
          const r = await callProxy<{ text: string }>('kaze_chat', { message, history: history.slice(-10) });
          history.push({ role: 'assistant', content: r.text });
          return r;
        } catch { return { text: 'Mano, tive um problema técnico. Tenta de novo.' }; }
      },
      getHistory: () => [...history],
      clearHistory: () => { history.length = 0; },
    };
  },

  // ------------------------------------------------------------------
  // POST-RIDE REVIEW — IA condicional, só activa após corrida
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
      // O token ephemeral é usado pelo frontend para conectar directamente ao Gemini Live
      console.log('[KazeLive] Token obtido, usar SDK Gemini Live com este token');
      // TODO: integrar SDK Gemini Live aqui para abrir o canal de voz.
      return { close: () => callbacks.onclose() };
    } catch (e) {
      console.error('[geminiService.connectKazeLive] falha:', e);
      throw e;
    }
  },
};
