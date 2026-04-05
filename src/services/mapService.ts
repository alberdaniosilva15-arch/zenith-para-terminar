// =============================================================================
// ZENITH RIDE v3.0 — mapService.ts
// FIXES:
//   1. reverseGeocode: quando não há API key, encontra o bairro de Luanda
//      mais próximo usando Haversine em vez de mostrar coordenadas
//   2. calculateDistance: exportado (usado em PassengerHome para mostrar km)
//   3. searchPlaces: manter resultados locais + Google Autocomplete
// =============================================================================

import type { LatLng, LocationResult } from '../types';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

// Coordenadas reais dos bairros de Luanda (cache estática para offline)
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

// ─── FIX: Encontrar bairro mais próximo das coordenadas ──────────────────────
function nearestNeighbourhood(coords: LatLng): string {
  let best: LocationResult | null = null;
  let bestDist = Infinity;
  for (const loc of LUANDA_STATIC_LOCATIONS) {
    const d = haversineKm(coords, loc.coords);
    if (d < bestDist) { bestDist = d; best = loc; }
  }
  if (!best) return 'Luanda';
  // Se o bairro mais próximo está a mais de 5 km, combinar com distância
  if (bestDist > 5) return `Luanda (perto de ${best.name.split('—')[0].trim()})`;
  return best.name.split('—')[0].trim();
}

// =============================================================================
// SERVIÇO DE MAPAS
// =============================================================================
export const mapService = {

  // ── geocodeAddress ──────────────────────────────────────────────────────────
  async geocodeAddress(address: string): Promise<LatLng | null> {
    const cacheKey = address.toLowerCase().trim();
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;

    const local = LUANDA_STATIC_LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(cacheKey) || cacheKey.includes(l.name.toLowerCase())
    );
    if (local) { geocodeCache.set(cacheKey, local.coords); return local.coords; }

    if (!MAPS_API_KEY) {
      console.warn('[mapService.geocodeAddress] VITE_GOOGLE_MAPS_KEY não definida. Sem geocoding remoto.');
      return null;
    }

    try {
      const query = encodeURIComponent(`${address}, Luanda, Angola`);
      const url   = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${MAPS_API_KEY}&region=ao&language=pt`;
      const res   = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data  = await res.json();
      if (data.status !== 'OK' || !data.results?.length) return null;
      const { lat, lng } = data.results[0].geometry.location;
      const coords: LatLng = { lat, lng };
      geocodeCache.set(cacheKey, coords);
      return coords;
    } catch (err) {
      console.error('[mapService.geocodeAddress] Erro:', err);
      return null;
    }
  },

  // ── reverseGeocode ──────────────────────────────────────────────────────────
  // FIX: sem API key → encontra bairro mais próximo em vez de mostrar coordenadas
  async reverseGeocode(coords: LatLng): Promise<string> {
    if (!MAPS_API_KEY) {
      // Fallback inteligente: nome do bairro mais próximo
      return nearestNeighbourhood(coords);
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.lat},${coords.lng}&key=${MAPS_API_KEY}&language=pt`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== 'OK' || !data.results?.length) {
        return nearestNeighbourhood(coords);
      }
      const result =
        data.results.find((r: { types: string[] }) => r.types.includes('route'))
        ?? data.results.find((r: { types: string[] }) => r.types.includes('neighborhood'))
        ?? data.results.find((r: { types: string[] }) => r.types.includes('sublocality'))
        ?? data.results[0];

      // Extrair parte útil (sem Angola, Angola)
      const formatted: string = result.formatted_address ?? '';
      const cleaned = formatted.replace(/, Angola$/, '').replace(/Angola,?\s*/g, '').trim();
      return cleaned || nearestNeighbourhood(coords);
    } catch (err) {
      console.error('[mapService.reverseGeocode] Erro:', err);
      return nearestNeighbourhood(coords);
    }
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
  async searchPlaces(query: string): Promise<LocationResult[]> {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return LUANDA_STATIC_LOCATIONS.filter((l) => l.isPopular);

    const localResults = LUANDA_STATIC_LOCATIONS.filter((l) =>
      l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
    );

    if (q.includes('kilamba')) {
      const letters = 'ABCDEFGH'.split('');
      const kilambaBlocks: LocationResult[] = letters.map((letter, i) => ({
        name:        `Kilamba — Quarteirão ${letter}`,
        type:        'bairro' as const,
        description: `Centralidade do Kilamba, Sector ${Math.floor(i / 2) + 1}`,
        coords:      { lat: -8.978 + i * 0.001, lng: 13.218 + i * 0.001 },
        isPopular:   i < 3,
      }));
      const filtered = kilambaBlocks.filter((b) => b.name.toLowerCase().includes(q));
      return filtered.length ? filtered : kilambaBlocks.slice(0, 8);
    }

    if (!MAPS_API_KEY || localResults.length >= 5) return localResults;

    try {
      const encoded = encodeURIComponent(`${query} Luanda Angola`);
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encoded}&key=${MAPS_API_KEY}&components=country:ao&language=pt&types=geocode`;
      const res = await fetch(url);
      if (!res.ok) return localResults;
      const data = await res.json();
      if (data.status !== 'OK') return localResults;

      const remoteResults: LocationResult[] = await Promise.all(
        data.predictions.slice(0, 5).map(async (p: { description: string }) => {
          const coords = await this.geocodeAddress(p.description);
          return {
            name:        p.description.split(',')[0],
            type:        'rua' as const,
            description: p.description,
            coords:      coords ?? { lat: -8.8368, lng: 13.2343 },
          };
        })
      );
      return [...localResults, ...remoteResults].slice(0, 10);
    } catch (err) {
      console.error('[mapService.searchPlaces] Erro Google Places:', err);
      return localResults;
    }
  },

  // ── getCurrentPosition ───────────────────────────────────────────────────────
  getCurrentPosition(): Promise<LatLng> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        console.warn('[mapService] Geolocalização não suportada. A usar centro de Luanda.');
        resolve({ lat: -8.8368, lng: 13.2343 });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          console.warn('[mapService.getCurrentPosition] GPS falhou:', err.message, '— a usar centro de Luanda.');
          resolve({ lat: -8.8368, lng: 13.2343 });
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  },

  // ── watchPosition ────────────────────────────────────────────────────────────
  watchPosition(onUpdate: (coords: LatLng, heading?: number) => void): () => void {
    if (!navigator.geolocation) {
      console.warn('[mapService.watchPosition] Geolocalização não disponível.');
      return () => {};
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => onUpdate(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        pos.coords.heading ?? undefined
      ),
      (err) => console.warn('[mapService.watchPosition]', err.message),
      { enableHighAccuracy: true, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  },
};
