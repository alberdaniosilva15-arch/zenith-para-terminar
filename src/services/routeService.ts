// src/services/routeService.ts
// ══════════════════════════════════════════════════════
// ZENITH RIDE — Google Routes API v2
// Responsabilidade: calcular distância e duração REAIS
// por estrada (não em linha recta) entre dois pontos.
//
// REGRA DE USO: chamar UMA vez por pedido de corrida,
// nunca em loops nem em onChange de inputs.
// ══════════════════════════════════════════════════════

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
  durationMin:          number;  // duração com trânsito actual (TRAFFIC_AWARE)
  durationMinNoTraffic: number;  // duração sem trânsito (para comparação)
  polyline:             string;  // polyline codificada para desenhar no mapa
  trafficFactor:        number;  // ratio duração_com / duração_sem (>1.3 = trânsito intenso)
}

// Cache simples — evita chamadas duplicadas acidentais
let lastCallKey    = '';
let lastCallResult: RouteResult | null = null;

export const routeService = {

  /**
   * Calcular rota real entre dois pontos via Google Routes API v2.
   * Usa TRAFFIC_AWARE para obter duração com trânsito actual de Luanda.
   *
   * IMPORTANTE: duration vem como string "342s" — fazemos parseInt correctamente.
   */
  async getRoute(origin: RouteLatLng, dest: RouteLatLng): Promise<RouteResult> {
    // Cache simples: se origem e destino são os mesmos da última chamada, reutilizar
    const callKey = `${origin.lat},${origin.lng}→${dest.lat},${dest.lng}`;
    if (callKey === lastCallKey && lastCallResult) {
      return lastCallResult;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
    if (!apiKey) throw new Error('[routeService] Chave Google Maps não configurada no ficheiro .env.');

    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Goog-Api-Key':   apiKey,
          // FieldMask: pedir apenas os campos necessários (reduz custo da API)
          'X-Goog-FieldMask': [
            'routes.distanceMeters',
            'routes.duration',
            'routes.staticDuration',
            'routes.polyline.encodedPolyline',
          ].join(','),
        },
        body: JSON.stringify({
          origin: {
            location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
          },
          destination: {
            location: { latLng: { latitude: dest.lat, longitude: dest.lng } },
          },
          travelMode:        'DRIVE',
          routingPreference: 'TRAFFIC_AWARE', // duração real com trânsito de Luanda
          languageCode:      'pt-PT',
          units:             'METRIC',
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.warn('[routeService] Erro da API Google Routes (Fallback activado):', err);
      // FALLBACK SE A API FALHAR: Distância recta e sem polyline, em vez de atirar erro
      const dist = haversineKm(origin, dest);
      const fakeDuration = Math.ceil((dist / 30) * 60); // 30km/h
      return {
        distanceKm: dist,
        durationMin: fakeDuration,
        durationMinNoTraffic: fakeDuration * 0.8,
        polyline: '', // Linha reta será desenhada por bounds, Map3D lida com polyline vazia mantendo points
        trafficFactor: 1.2
      };
    }

    const data  = await response.json();
    const route = data.routes?.[0];

    if (!route) {
      const dist = haversineKm(origin, dest);
      const fakeDuration = Math.ceil((dist / 30) * 60);
      return { distanceKm: dist, durationMin: fakeDuration, durationMinNoTraffic: fakeDuration * 0.8, polyline: '', trafficFactor: 1.2 };
    }

    // ── Parse correcto da duração ──────────────────────────────────────────
    // A Routes API devolve duração como string "342s" (com "s" no fim).
    // NUNCA dividir a string directamente — sempre parseInt primeiro.
    const parseDurationSec = (d: string | number): number => {
      if (typeof d === 'number') return d;
      return parseInt(d.replace('s', ''), 10) || 0;
    };

    const durationSec       = parseDurationSec(route.duration);
    const staticDurationSec = parseDurationSec(route.staticDuration ?? route.duration);

    const result: RouteResult = {
      distanceKm:           route.distanceMeters / 1000,
      durationMin:          durationSec / 60,
      durationMinNoTraffic: staticDurationSec / 60,
      polyline:             route.polyline?.encodedPolyline ?? '',
      // Ratio de trânsito: 1.0 = sem trânsito, 1.5 = 50% mais lento
      trafficFactor:        durationSec / Math.max(staticDurationSec, 1),
    };

    // Guardar em cache simples
    lastCallKey    = callKey;
    lastCallResult = result;

    return result;
  },

  /**
   * Limpar cache — chamar quando o utilizador muda de destino
   */
  clearCache() {
    lastCallKey    = '';
    lastCallResult = null;
  },
};
