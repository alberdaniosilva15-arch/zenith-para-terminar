// =============================================================================
// ZENITH RIDE v3.1 — mapService.ts
// FIXES v3.1:
//   1. searchPlaces: usa Mapbox Geocoding API em vez de Google Places
//      (Google Places falha silenciosamente — token Mapbox já está no .env)
//   2. geocodeAddress: usa Mapbox Geocoding como fallback primário
//   3. reverseGeocode: usa Mapbox Geocoding quando há token
//   4. calculateDistance: exportado (usado em PassengerHome para mostrar km)
// =============================================================================

import type { LatLng, LocationResult } from '../types';

const MAPBOX_TOKEN   = import.meta.env.VITE_MAPBOX_TOKEN   as string | undefined;

// Coordenadas reais dos bairros de Luanda (cache estática para offline / resultados rápidos)
export const LUANDA_STATIC_LOCATIONS: LocationResult[] = [
  { name: 'Mutamba — Baixa de Luanda',         type: 'bairro',    description: 'Centro histórico',     coords: { lat: -8.8160, lng: 13.2300 }, isPopular: true },
  { name: 'Ilha do Cabo — Chicala',            type: 'bairro',    description: 'Zona turística',       coords: { lat: -8.7900, lng: 13.2200 }, isPopular: true },
  { name: 'Kilamba — Quarteirão A',            type: 'bairro',    description: 'Centralidade Kilamba', coords: { lat: -8.9780, lng: 13.2180 } },
  { name: 'Kilamba — Quarteirão B',            type: 'bairro',    description: 'Centralidade Kilamba', coords: { lat: -8.9800, lng: 13.2200 } },
  { name: 'Kilamba — Quarteirão C',            type: 'bairro',    description: 'Centralidade Kilamba', coords: { lat: -8.9820, lng: 13.2220 } },
  { name: 'Talatona — Condomínio Dolce Vita',  type: 'bairro',    description: 'Zona nobre sul',       coords: { lat: -8.9350, lng: 13.1810 }, isPopular: true },
  { name: 'Viana — Zango 0',                   type: 'bairro',    description: 'Viana, Luanda',        coords: { lat: -8.9100, lng: 13.3400 } },
  { name: 'Viana — Zango 1',                   type: 'bairro',    description: 'Viana, Luanda',        coords: { lat: -8.9200, lng: 13.3500 } },
  { name: 'Viana — Zango 4',                   type: 'bairro',    description: 'Viana, Luanda',        coords: { lat: -8.9400, lng: 13.3700 } },
  { name: 'Samba — Nó da Samba',               type: 'rua',       description: 'Via de acesso principal', coords: { lat: -8.8630, lng: 13.2250 } },
  { name: 'Cazenga',                           type: 'bairro',    description: 'Zona norte',           coords: { lat: -8.8050, lng: 13.2800 } },
  { name: 'Cacuaco — Sequele',                 type: 'bairro',    description: 'Zona norte exterior',  coords: { lat: -8.7500, lng: 13.3600 } },
  { name: 'Morro Bento',                       type: 'bairro',    description: 'Luanda Sul',           coords: { lat: -8.8900, lng: 13.2200 } },
  { name: 'Benfica',                           type: 'bairro',    description: 'Luanda Sul',           coords: { lat: -8.9200, lng: 13.1900 } },
  { name: 'Camama',                            type: 'bairro',    description: 'Luanda Sul',           coords: { lat: -8.9000, lng: 13.2050 } },
  { name: 'Aeroporto Internacional de Luanda', type: 'monumento', description: '4 de Fevereiro',       coords: { lat: -8.8584, lng: 13.2312 }, isPopular: true },
  { name: 'Hospital Américo Boavida',          type: 'hospital',  description: 'Hospital público',     coords: { lat: -8.8270, lng: 13.2350 } },
  { name: 'Shoprite Viana',                    type: 'servico',   description: 'Supermercado',         coords: { lat: -8.9080, lng: 13.3450 } },
  { name: 'Belas Shopping',                    type: 'servico',   description: 'Centro comercial',     coords: { lat: -8.9280, lng: 13.1950 }, isPopular: true },
  { name: 'Maianga',                           type: 'bairro',    description: 'Zona central',         coords: { lat: -8.8320, lng: 13.2180 } },
  { name: 'Rangel',                            type: 'bairro',    description: 'Luanda Este',          coords: { lat: -8.8200, lng: 13.2600 } },
  { name: 'Rocha Pinto',                       type: 'bairro',    description: 'Luanda Norte',         coords: { lat: -8.7850, lng: 13.2700 } },
  { name: 'Palanca',                           type: 'bairro',    description: 'Luanda Sul',           coords: { lat: -8.8700, lng: 13.2150 } },
  { name: 'Ingombotas',                        type: 'bairro',    description: 'Centro de Luanda',     coords: { lat: -8.8100, lng: 13.2350 } },
  { name: 'Golfe — Cidade Alta',               type: 'bairro',    description: 'Zona governamental',   coords: { lat: -8.8220, lng: 13.2300 }, isPopular: true },
  { name: 'Sambizanga',                        type: 'bairro',    description: 'Luanda Norte',         coords: { lat: -8.7960, lng: 13.2480 } },
];

// Cache de geocoding (evitar chamadas repetidas)
const geocodeCache = new Map<string, LatLng>();

// ─── Helper: distância Haversine ─────────────────────────────────────────────
function haversineKm(a: LatLng, b: LatLng): number {
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

// ─── Encontrar bairro mais próximo das coordenadas ────────────────────────────
function nearestNeighbourhood(coords: LatLng): string {
  let best: LocationResult | null = null;
  let bestDist = Infinity;
  for (const loc of LUANDA_STATIC_LOCATIONS) {
    const d = haversineKm(coords, loc.coords);
    if (d < bestDist) { bestDist = d; best = loc; }
  }
  if (!best) return 'Luanda';
  if (bestDist > 5) return `Luanda (perto de ${best.name.split('—')[0].trim()})`;
  return best.name.split('—')[0].trim();
}

// ─── Mapbox Geocoding: pesquisa de texto → lista de locais ───────────────────
async function mapboxForwardGeocode(query: string): Promise<LocationResult[]> {
  if (!MAPBOX_TOKEN) return [];
  try {
    const encoded = encodeURIComponent(query);
    // proximity=-8.8368,13.2343 = centro de Luanda (prioriza resultados próximos)
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?country=AO&language=pt&proximity=13.2343,-8.8368&limit=6&access_token=${MAPBOX_TOKEN}`;
    const res  = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.features ?? []).map((f: any): LocationResult => {
      const [lng, lat] = f.center;
      const name = f.text ?? f.place_name?.split(',')[0] ?? 'Local';
      const description = f.place_name ?? f.text ?? 'Angola';
      return {
        name,
        type: mapboxTypeToLocal(f.place_type),
        description: description.replace(/, Angola$/i, '').replace(/Angola,?\s*/gi, '').trim(),
        coords: { lat, lng },
        isPopular: false,
      };
    });
  } catch (err) {
    console.warn('[mapService.mapboxForwardGeocode]', err);
    return [];
  }
}

// ─── Mapbox Reverse Geocoding: coordenadas → endereço ───────────────────────
async function mapboxReverseGeocode(coords: LatLng): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.lng},${coords.lat}.json?types=neighborhood,locality,place&language=pt&access_token=${MAPBOX_TOKEN}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    return feature.text ?? feature.place_name?.split(',')[0] ?? null;
  } catch {
    return null;
  }
}

function mapboxTypeToLocal(types: string[]): LocationResult['type'] {
  if (types.includes('poi')) return 'servico';
  if (types.includes('neighborhood') || types.includes('locality')) return 'bairro';
  if (types.includes('address')) return 'rua';
  return 'bairro';
}

// =============================================================================
// SERVIÇO DE MAPAS
// =============================================================================
export const mapService = {

  // ── geocodeAddress ──────────────────────────────────────────────────────────
  async geocodeAddress(address: string): Promise<LatLng | null> {
    const cacheKey = address.toLowerCase().trim();
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

    // 1. Lista estática (mais rápido)
    const local = LUANDA_STATIC_LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(cacheKey) || cacheKey.includes(l.name.toLowerCase().split('—')[0].trim())
    );
    if (local) { geocodeCache.set(cacheKey, local.coords); return local.coords; }

    // 2. Mapbox Geocoding (token sempre presente)
    if (MAPBOX_TOKEN) {
      try {
        const results = await mapboxForwardGeocode(`${address} Luanda`);
        if (results.length > 0) {
          geocodeCache.set(cacheKey, results[0].coords);
          return results[0].coords;
        }
      } catch { /* fallthrough */ }
    }

    return null;
  },

  // ── reverseGeocode ──────────────────────────────────────────────────────────
  async reverseGeocode(coords: LatLng): Promise<string> {
    // 1. Tentar Mapbox Reverse Geocoding (mais preciso, token sempre presente)
    if (MAPBOX_TOKEN) {
      const name = await mapboxReverseGeocode(coords);
      if (name) return name;
    }

    // 2. Fallback: bairro mais próximo da lista estática
    return nearestNeighbourhood(coords);
  },

  // ── calculateDistance — Haversine (exportado para uso em UI) ───────────────
  calculateDistance(origin: LatLng, dest: LatLng): number {
    return haversineKm(origin, dest);
  },

  // ── calculateRouteInfo — estima duração baseada na distância ───────────────
  calculateRouteInfo(origin: LatLng, dest: LatLng): { distanceKm: number; durationMin: number } {
    const distanceKm  = haversineKm(origin, dest);
    // Velocidade média em Luanda: ~25 km/h no trânsito
    const durationMin = Math.ceil((distanceKm / 25) * 60);
    return { distanceKm, durationMin };
  },

  // ── searchPlaces ─────────────────────────────────────────────────────────────
  // FIX v3.1: usa Mapbox Geocoding em vez de Google Places (que falha silenciosamente)
  async searchPlaces(query: string): Promise<LocationResult[]> {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return LUANDA_STATIC_LOCATIONS.filter((l) => l.isPopular);

    // Filtro na lista estática
    const localResults = LUANDA_STATIC_LOCATIONS.filter((l) =>
      l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
    );

    // Expansão Kilamba (fallback dinâmico, mas damos preferência ao Mapbox real)
    if (q.includes('kilamba') && q.length < 8) {
      const letters = 'ABCDEFGH'.split('');
      const kilambaBlocks: LocationResult[] = letters.map((letter, i) => ({
        name:        `Kilamba — Quarteirão ${letter}`,
        type:        'bairro' as const,
        description: `Centralidade do Kilamba, Sector ${Math.floor(i / 2) + 1}`,
        coords:      { lat: -8.978 + i * 0.001, lng: 13.218 + i * 0.001 },
        isPopular:   i < 3,
      }));
      localResults.push(...kilambaBlocks.filter(b => b.name.toLowerCase().includes(q) || 'kilamba'.includes(q)));
    }

    // FIX v3.1: Mapbox Geocoding API sempre chamada se houver token (removemos o bloqueio de localResults >= 5)
    if (MAPBOX_TOKEN) {
      try {
        const remoteResults = await mapboxForwardGeocode(`${query} Luanda Angola`);
        // Remover duplicados: não mostrar resultado Mapbox se já existe na lista local com nome idêntico
        const deduplicated = remoteResults.filter(r =>
          !localResults.some(l => l.name.toLowerCase().includes(r.name.toLowerCase().substring(0, 10)))
        );
        return [...localResults, ...deduplicated].slice(0, 15);
      } catch (err) {
        console.warn('[mapService.searchPlaces] Mapbox Geocoding falhou:', err);
      }
    }

    return localResults.slice(0, 10);
  },

  // ── getCurrentPosition ───────────────────────────────────────────────────
  getCurrentPosition(): Promise<LatLng> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('O teu browser não suporta GPS. Tenta no Chrome ou Firefox.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          const msgs: Record<number, string> = {
            1: 'Permissão de localização negada. Vá às definições do browser → Permissões → Localização → Permitir para este site.',
            2: 'GPS indisponível. Verifica se o GPS do telemóvel está activo.',
            3: 'GPS demorou demasiado. Verifica a tua ligação e tenta de novo.',
          };
          reject(new Error(msgs[err.code] ?? 'GPS falhou.'));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  },

  // ── watchPosition (c/ Throttle + Retry automático) ────────────────────────
  watchPosition(onUpdate: (coords: LatLng, heading?: number) => void): () => void {
    if (!navigator.geolocation) {
      console.warn('[mapService.watchPosition] Geolocalização não disponível.');
      return () => {};
    }

    let lastTime   = 0;
    let lastLat    = 0;
    let lastLng    = 0;
    let retryCount = 0;
    let watchId: number;
    const MIN_MS   = 5000; // 5 segundos mínimo entre updates
    const MIN_M    = 10;   // 10 metros — sensível a trânsito lento de Luanda

    const haversineM = (la1: number, lo1: number, la2: number, lo2: number) => {
      const R    = 6371000;
      const dLat = (la2 - la1) * Math.PI / 180;
      const dLng = (lo2 - lo1) * Math.PI / 180;
      const a    = Math.sin(dLat/2)**2 +
                   Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLng/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const startWatch = () => {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          const now = Date.now();
          retryCount = 0;

          // Validar bounds de Angola
          if (lat < -18 || lat > -4.5 || lng < 11.5 || lng > 24.1) {
            console.warn('[GPS] Coordenadas fora de Angola:', { lat, lng });
            return;
          }

          if (now - lastTime < MIN_MS) return;
          if (lastLat !== 0 && haversineM(lastLat, lastLng, lat, lng) < MIN_M) return;

          lastTime = now; lastLat = lat; lastLng = lng;
          onUpdate({ lat, lng }, pos.coords.heading ?? undefined);
        },
        (err) => {
          console.warn('[mapService.watchPosition]', err.message);
          if (retryCount < 3) {
            retryCount++;
            setTimeout(() => {
              navigator.geolocation.clearWatch(watchId);
              startWatch();
            }, 3000);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
      );
    };

    startWatch();
    return () => navigator.geolocation.clearWatch(watchId);
  },
};
