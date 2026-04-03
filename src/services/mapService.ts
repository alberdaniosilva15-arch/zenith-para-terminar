// =============================================================================
// MOTOGO AI v2.0 — mapService.ts
// ANTES: coordenadas {x,y} mock, nada de real
// DEPOIS: Google Maps Geocoding API + cache inteligente + offline fallback
//
// NOTA: A chave da Google Maps é PÚBLICA (restrita por domínio no Google Cloud)
// Ao contrário da Gemini API, a Maps JS API pode ficar no frontend
// desde que esteja restrita no Google Cloud Console
// =============================================================================

import type { LatLng, LocationResult } from '../types';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// Coordenadas reais dos bairros de Luanda (cache estática para offline)
export const LUANDA_STATIC_LOCATIONS: LocationResult[] = [
  { name: 'Mutamba — Baixa de Luanda',         type: 'bairro',     description: 'Centro histórico',     coords: { lat: -8.8160, lng: 13.2300 }, isPopular: true },
  { name: 'Ilha do Cabo — Chicala',            type: 'bairro',     description: 'Zona turística',       coords: { lat: -8.7900, lng: 13.2200 }, isPopular: true },
  { name: 'Kilamba — Quarteirão A',            type: 'bairro',     description: 'Centralidade Kilamba', coords: { lat: -8.9780, lng: 13.2180 } },
  { name: 'Kilamba — Quarteirão B',            type: 'bairro',     description: 'Centralidade Kilamba', coords: { lat: -8.9800, lng: 13.2200 } },
  { name: 'Kilamba — Quarteirão C',            type: 'bairro',     description: 'Centralidade Kilamba', coords: { lat: -8.9820, lng: 13.2220 } },
  { name: 'Talatona — Condomínio Dolce Vita',  type: 'bairro',     description: 'Zona nobre sul',       coords: { lat: -8.9350, lng: 13.1810 }, isPopular: true },
  { name: 'Viana — Zango 0',                  type: 'bairro',     description: 'Viana, Luanda',        coords: { lat: -8.9100, lng: 13.3400 } },
  { name: 'Viana — Zango 1',                  type: 'bairro',     description: 'Viana, Luanda',        coords: { lat: -8.9200, lng: 13.3500 } },
  { name: 'Viana — Zango 4',                  type: 'bairro',     description: 'Viana, Luanda',        coords: { lat: -8.9400, lng: 13.3700 } },
  { name: 'Samba — Nó da Samba',              type: 'rua',        description: 'Via de acesso principal', coords: { lat: -8.8630, lng: 13.2250 } },
  { name: 'Cazenga',                          type: 'bairro',     description: 'Zona norte',           coords: { lat: -8.8050, lng: 13.2800 } },
  { name: 'Cacuaco — Sequele',                type: 'bairro',     description: 'Zona norte exterior',  coords: { lat: -8.7500, lng: 13.3600 } },
  { name: 'Morro Bento',                      type: 'bairro',     description: 'Luanda Sul',           coords: { lat: -8.8900, lng: 13.2200 } },
  { name: 'Benfica',                          type: 'bairro',     description: 'Luanda Sul',           coords: { lat: -8.9200, lng: 13.1900 } },
  { name: 'Aeroporto Internacional de Luanda', type: 'monumento',  description: '4 de Fevereiro',       coords: { lat: -8.8584, lng: 13.2312 }, isPopular: true },
  { name: 'Hospital Américo Boavida',         type: 'hospital',   description: 'Hospital público',     coords: { lat: -8.8270, lng: 13.2350 } },
  { name: 'Shoprite Viana',                   type: 'servico',    description: 'Supermercado',         coords: { lat: -8.9080, lng: 13.3450 } },
  { name: 'Belas Shopping',                   type: 'servico',    description: 'Centro comercial',     coords: { lat: -8.9280, lng: 13.1950 }, isPopular: true },
];

// Cache de geocoding (evitar chamadas repetidas)
const geocodeCache = new Map<string, LatLng>();

// =============================================================================
// SERVIÇO DE MAPAS
// =============================================================================

export const mapService = {

  // ------------------------------------------------------------------
  // geocodeAddress
  // Converte texto de endereço em lat/lng real
  // Fallback para busca local se API não disponível
  // ------------------------------------------------------------------
  async geocodeAddress(address: string): Promise<LatLng | null> {
    const cacheKey = address.toLowerCase().trim();

    // 1. Verificar cache
    if (geocodeCache.has(cacheKey)) {
      return geocodeCache.get(cacheKey)!;
    }

    // 2. Verificar base local estática
    const local = LUANDA_STATIC_LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(cacheKey) || cacheKey.includes(l.name.toLowerCase())
    );
    if (local) {
      geocodeCache.set(cacheKey, local.coords);
      return local.coords;
    }

    // 3. Google Maps Geocoding API
    if (!MAPS_API_KEY) {
      console.warn('[mapService.geocodeAddress] VITE_GOOGLE_MAPS_KEY não definida. A usar fallback.');
      return null;
    }

    try {
      const query = encodeURIComponent(`${address}, Luanda, Angola`);
      const url   = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${MAPS_API_KEY}&region=ao&language=pt`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (data.status !== 'OK' || !data.results?.length) {
        console.warn('[mapService.geocodeAddress] Sem resultados para:', address, data.status);
        return null;
      }

      const { lat, lng } = data.results[0].geometry.location;
      const coords: LatLng = { lat, lng };

      geocodeCache.set(cacheKey, coords);
      return coords;

    } catch (err) {
      console.error('[mapService.geocodeAddress] Erro:', err);
      return null;
    }
  },

  // ------------------------------------------------------------------
  // reverseGeocode
  // Converte lat/lng em endereço legível
  // ------------------------------------------------------------------
  async reverseGeocode(coords: LatLng): Promise<string> {
    if (!MAPS_API_KEY) {
      return `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.lat},${coords.lng}&key=${MAPS_API_KEY}&language=pt`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      if (data.status !== 'OK' || !data.results?.length) {
        return `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      }

      // Preferir endereço de nível bairro/rua
      const result =
        data.results.find((r: { types: string[] }) => r.types.includes('route'))
        ?? data.results.find((r: { types: string[] }) => r.types.includes('neighborhood'))
        ?? data.results[0];

      return result.formatted_address ?? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;

    } catch (err) {
      console.error('[mapService.reverseGeocode] Erro:', err);
      return `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }
  },

  // ------------------------------------------------------------------
  // calculateDistance
  // Distância real entre dois pontos em km (Haversine)
  // Nota: a distância de rota real é calculada na Edge Function
  // ------------------------------------------------------------------
  calculateDistance(origin: LatLng, dest: LatLng): number {
    const R = 6371;
    const dLat = ((dest.lat - origin.lat) * Math.PI) / 180;
    const dLng = ((dest.lng - origin.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((origin.lat * Math.PI) / 180) *
      Math.cos((dest.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  // ------------------------------------------------------------------
  // searchPlaces
  // Pesquisa textual combinada: base local + Google Places
  // Usado no PassengerHome para sugestões de destino
  // ------------------------------------------------------------------
  async searchPlaces(query: string): Promise<LocationResult[]> {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return LUANDA_STATIC_LOCATIONS.filter((l) => l.isPopular);

    // Resultados locais imediatos (sem delay)
    const localResults = LUANDA_STATIC_LOCATIONS.filter((l) =>
      l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
    );

    // Kilamba: gerar quarteirões A-H (evitar offsets inventados que produzem
    // coordenadas absurdas). Usar passos pequenos e limitar a quarteirões reais.
    if (q.includes('kilamba')) {
      const letters = 'ABCDEFGH'.split('');
      const kilambaBlocks: LocationResult[] = letters.map((letter, i) => ({
        name:        `Kilamba — Quarteirão ${letter}`,
        type:        'bairro' as const,
        description: `Centralidade do Kilamba, Sector ${Math.floor(i / 2) + 1}`,
        coords:      {
          lat: -8.978 + i * 0.001, // passos pequenos (~110m)
          lng: 13.218 + i * 0.001,
        },
      }));
      const filtered = kilambaBlocks.filter((b) => b.name.toLowerCase().includes(q));
      return filtered.length ? filtered : kilambaBlocks.slice(0, 8);
    }

    // Se não há API key, retornar apenas resultados locais
    if (!MAPS_API_KEY || localResults.length >= 5) return localResults;

    // Google Places Autocomplete para complementar
    try {
      const encoded = encodeURIComponent(`${query} Luanda Angola`);
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encoded}&key=${MAPS_API_KEY}&components=country:ao&language=pt&types=geocode`;

      const response = await fetch(url);
      if (!response.ok) return localResults;

      const data = await response.json();
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

      // Merge: locais primeiro (mais rápidos), depois Google
      return [...localResults, ...remoteResults].slice(0, 10);

    } catch (err) {
      console.error('[mapService.searchPlaces] Erro Google Places:', err);
      return localResults;
    }
  },

  // ------------------------------------------------------------------
  // getCurrentPosition
  // Obter posição actual do dispositivo (GPS)
  // ------------------------------------------------------------------
  getCurrentPosition(): Promise<LatLng> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalização não suportada neste dispositivo.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          console.error('[mapService.getCurrentPosition]', err);
          // Fallback para centro de Luanda
          resolve({ lat: -8.8368, lng: 13.2343 });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  },

  // ------------------------------------------------------------------
  // watchPosition
  // Tracking contínuo (para motorista em corrida)
  // ------------------------------------------------------------------
  watchPosition(
    onUpdate: (coords: LatLng, heading?: number) => void
  ): () => void {
    if (!navigator.geolocation) {
      console.warn('[mapService.watchPosition] Geolocalização não disponível.');
      return () => {};
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => onUpdate(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        pos.coords.heading ?? undefined
      ),
      (err) => console.error('[mapService.watchPosition]', err),
      { enableHighAccuracy: true, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  },
};
