// src/services/routeService.ts
// ══════════════════════════════════════════════════════
// ZENITH RIDE — Mapbox Directions API
// Responsabilidade: calcular distância e duração REAIS
// por estrada (não em linha recta) entre dois pontos.
//
// REGRA DE USO: chamar UMA vez por pedido de corrida,
// nunca em loops nem em onChange de inputs.
// ══════════════════════════════════════════════════════

import { getRoute as getMapboxRoute } from '../lib/mapbox-directions';

export interface RouteLatLng {
  lat: number;
  lng: number;
}

function haversineKm(a: RouteLatLng, b: RouteLatLng): number {
  const R    = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sin2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(sin2), Math.sqrt(1 - sin2));
}

export interface RouteResult {
  distanceKm:           number;  // distância real por estrada
  durationMin:          number;  // duração com trânsito actual
  durationMinNoTraffic: number;  // duração sem trânsito (para comparação)
  polyline:             string;  // polyline codificada para desenhar no mapa (vazio se usar Mapbox e não converter)
  trafficFactor:        number;  // ratio duração_com / duração_sem
}

// Cache simples — evita chamadas duplicadas acidentais
let lastCallKey    = '';
let lastCallResult: RouteResult | null = null;

export const routeService = {

  async getRoute(origin: RouteLatLng, dest: RouteLatLng): Promise<RouteResult> {
    // Cache simples: se origem e destino são os mesmos da última chamada, reutilizar
    const callKey = `${origin.lat},${origin.lng}→${dest.lat},${dest.lng}`;
    if (callKey === lastCallKey && lastCallResult) {
      return lastCallResult;
    }

    try {
      const result = await getMapboxRoute(origin.lng, origin.lat, dest.lng, dest.lat);
      if (!result) {
        // Fallback haversine se a API falhar ou não retornar rota
        const dist = haversineKm(origin, dest);
        const routeRes: RouteResult = { 
          distanceKm: dist, 
          durationMin: Math.ceil(dist / 30 * 60), 
          durationMinNoTraffic: Math.ceil((dist / 30 * 60) * 0.8),
          polyline: '',
          trafficFactor: 1.2
        };
        lastCallKey = callKey;
        lastCallResult = routeRes;
        return routeRes;
      }
      
      const routeRes: RouteResult = {
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
        durationMinNoTraffic: result.durationMin * 0.8,
        polyline: '', // O componente Map3D irá gerir isto adequadamente ou ignorar
        trafficFactor: 1.2,
      };

      lastCallKey = callKey;
      lastCallResult = routeRes;
      return routeRes;
    } catch (err) {
      console.warn('[routeService] Erro da API Mapbox Directions (Fallback activado):', err);
      const dist = haversineKm(origin, dest);
      const routeRes: RouteResult = {
        distanceKm: dist,
        durationMin: Math.ceil(dist / 30 * 60),
        durationMinNoTraffic: Math.ceil((dist / 30 * 60) * 0.8),
        polyline: '',
        trafficFactor: 1.2
      };
      
      lastCallKey = callKey;
      lastCallResult = routeRes;
      return routeRes;
    }
  },

  /**
   * Limpar cache — chamar quando o utilizador muda de destino
   */
  clearCache() {
    lastCallKey    = '';
    lastCallResult = null;
  },
};
