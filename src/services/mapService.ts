// =============================================================================
// ZENITH RIDE v3.3 — mapService.ts
// REFACTOR v3.3:
//   1. Search Box API (/suggest + /retrieve com session_token) como fonte Mapbox
//   2. Base local de Angola carregada via import() dinâmico sob demanda
//   3. Deduplicação no suggest por nome/tipo (sem dependência de coords prematuras)
//   4. Resiliência a AbortError sem apagar resultados
// =============================================================================

import type { LatLng, LocationResult } from '../types';
import { haversineKm as _haversineKm, haversineMeters as _haversineMeters } from '../lib/geo';
import { searchAngolaLocationsLazy } from './angolaLocationsService';
import { POPULAR_LOCATIONS } from '../data/popularLocations';

const MAPBOX_TOKEN = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPBOX_TOKEN) as string | undefined;
const LOCATION_NAME_SEPARATOR = '—';

export const LUANDA_STATIC_LOCATIONS: LocationResult[] = POPULAR_LOCATIONS;
export const ALL_ANGOLA_LOCATIONS: LocationResult[] = POPULAR_LOCATIONS;

// Cache de geocoding de endereços permanentes
const geocodeCache = new Map<string, LatLng>();

// ─── Gestão de session_token do Mapbox Search Box API ────────────────────────
let currentSessionToken: string = generateSessionToken();

function generateSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateSessionToken(): string {
  if (!currentSessionToken) {
    currentSessionToken = generateSessionToken();
  }
  return currentSessionToken;
}

export function resetSessionToken(): string {
  currentSessionToken = generateSessionToken();
  return currentSessionToken;
}

// ─── Helper: distância Haversine (delega para geo.ts centralizado) ───────────
function haversineKm(a: LatLng, b: LatLng): number {
  return _haversineKm(a.lat, a.lng, b.lat, b.lng);
}

function getPrimaryLocationName(name: string): string {
  return name.split(LOCATION_NAME_SEPARATOR)[0]?.trim() || name.trim();
}

function normalizeLocationText(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// ─── Encontrar bairro mais próximo das coordenadas ────────────────────────────
function nearestNeighbourhood(coords: LatLng): string {
  let best: LocationResult | null = null;
  let bestDist = Infinity;
  for (const loc of POPULAR_LOCATIONS) {
    const d = haversineKm(coords, loc.coords);
    if (d < bestDist) { bestDist = d; best = loc; }
  }
  if (!best) return 'Luanda';
  const bestName = getPrimaryLocationName(best.name);
  if (bestDist > 10) return `Angola (perto de ${bestName})`;
  if (bestDist > 5) return `Luanda (perto de ${bestName})`;
  return bestName;
}

// ─── Mapbox Search Box API: /suggest com limit=10 e session_token ─────────────
async function mapboxSearchBoxSuggest(
  query: string,
  userPos?: LatLng,
  signal?: AbortSignal
): Promise<LocationResult[]> {
  if (!MAPBOX_TOKEN) return [];

  const token = getOrCreateSessionToken();
  const encoded = encodeURIComponent(query.trim());
  const proxStr = userPos
    ? `${userPos.lng},${userPos.lat}`
    : '13.2343,-8.8390';
  const bbox = '11.5,-18.0,24.1,-4.5';
  const types = 'poi,address,neighborhood,locality,street';

  const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encoded}&session_token=${token}&access_token=${MAPBOX_TOKEN}&language=pt&country=AO&proximity=${proxStr}&bbox=${bbox}&types=${types}&limit=10`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    const suggestions = data.suggestions || [];

    return suggestions.map((s: any): LocationResult => {
      const name = s.name || s.place_formatted?.split(',')[0] || 'Local';
      let description = s.place_formatted || s.full_address || 'Angola';
      if (description.startsWith(name + ', ')) {
        description = description.slice(name.length + 2);
      }
      description = description.replace(/, Angola$/i, '').replace(/Angola,?\s*/gi, '').trim();
      if (!description || description === name) description = 'Luanda';

      return {
        name,
        type: mapboxTypeToLocal([s.feature_type || 'poi']),
        description,
        coords: userPos ?? { lat: -8.8390, lng: 13.2343 },
        mapboxId: s.mapbox_id,
        isPopular: false,
      };
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw err;
    }
    console.warn('[mapService.mapboxSearchBoxSuggest]', err);
    return [];
  }
}

// ─── Mapbox Search Box API: /retrieve para obter coordenadas exatas ──────────
async function mapboxSearchBoxRetrieve(mapboxId: string): Promise<LatLng | null> {
  if (!MAPBOX_TOKEN || !mapboxId) return null;
  const token = getOrCreateSessionToken();
  const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}?session_token=${token}&access_token=${MAPBOX_TOKEN}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const [lng, lat] = coords;
      resetSessionToken();
      return { lat, lng };
    }
    return null;
  } catch (err) {
    console.warn('[mapService.mapboxSearchBoxRetrieve]', err);
    return null;
  }
}

// ─── Mapbox Reverse Geocoding: coordenadas → endereço ───────────────────────
async function mapboxReverseGeocode(coords: LatLng): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    // Incluir todos os tipos para encontrar o melhor nome possível
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.lng},${coords.lat}.json?types=address,neighborhood,locality,place,poi,district&language=pt&access_token=${MAPBOX_TOKEN}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features : [];
    if (features.length === 0) return null;

    const ranked = [...features].sort((a: any, b: any) =>
      reverseTypeRank(a?.place_type) - reverseTypeRank(b?.place_type)
    );

    const best = ranked[0];
    const label = best?.text ?? best?.place_name?.split(',')[0] ?? null;
    if (label && label.toLowerCase() !== 'luanda') return label;

    // Se o "best" vier genérico (ex: "Luanda"), tenta extrair um contexto mais local.
    const localCtx = (best?.context ?? []).find((c: any) =>
      typeof c?.id === 'string' &&
      (c.id.startsWith('neighborhood') || c.id.startsWith('locality'))
    );

    if (typeof localCtx?.text === 'string' && localCtx.text.trim().length > 0) {
      return localCtx.text.trim();
    }

    return label;
  } catch (err) {
    console.warn('[mapService] reverse geocode:', err);
    return null;
  }
}

function reverseTypeRank(types: unknown): number {
  const arr = Array.isArray(types) ? types : [];
  if (arr.includes('address')) return 0;
  if (arr.includes('neighborhood')) return 1;
  if (arr.includes('locality')) return 2;
  if (arr.includes('place')) return 3;
  return 9;
}

function mapboxTypeToLocal(types: string[]): LocationResult['type'] {
  if (types.includes('poi') || types.includes('poi.landmark')) return 'servico';
  if (types.includes('neighborhood') || types.includes('locality') || types.includes('district')) return 'bairro';
  if (types.includes('address')) return 'rua';
  if (types.includes('place') || types.includes('region')) return 'monumento';
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

    // 1. Procurar primeiro na base de Angola sob demanda
    try {
      const localMatches = await searchAngolaLocationsLazy(address, 5);
      const exactMatch = localMatches.find(l => 
        l.name.toLowerCase() === cacheKey || 
        cacheKey.includes(l.name.toLowerCase()) ||
        l.name.toLowerCase().includes(cacheKey)
      );
      if (exactMatch) {
        geocodeCache.set(cacheKey, exactMatch.coords);
        return exactMatch.coords;
      }
      if (localMatches.length > 0 && localMatches[0]?.coords) {
        geocodeCache.set(cacheKey, localMatches[0].coords);
        return localMatches[0].coords;
      }
    } catch (err) {
      console.warn('[mapService.geocodeAddress] busca local falhou:', err);
    }

    // 2. Mapbox Search Box como fallback
    if (MAPBOX_TOKEN) {
      try {
        const results = await mapboxSearchBoxSuggest(address);
        const first = results[0];
        if (first?.mapboxId) {
          const coords = await mapboxSearchBoxRetrieve(first.mapboxId);
          if (coords) {
            geocodeCache.set(cacheKey, coords);
            return coords;
          }
        }
      } catch (err) {
        console.warn('[mapService.geocodeAddress] Search Box fallback falhou:', err);
      }
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

  // ── calculateDistance — Haversine (exportado para uso rápido em UI) ────────
  calculateDistance(origin: LatLng, dest: LatLng): number {
    return haversineKm(origin, dest);
  },

  // ── calculateRouteInfo — estimativa rápida (Haversine) ────────────────────
  // Usado apenas como placeholder antes da rota real chegar
  calculateRouteInfo(origin: LatLng, dest: LatLng): { distanceKm: number; durationMin: number } {
    const distanceKm  = haversineKm(origin, dest);
    const durationMin = Math.ceil((distanceKm / 25) * 60);
    return { distanceKm, durationMin };
  },

  // ── getRouteDistance — ROTA REAL via Mapbox Directions API ─────────────────
  // Retorna distância real por estrada + duração com trânsito
  async getRouteDistance(origin: LatLng, dest: LatLng): Promise<{
    distanceKm: number;
    durationMin: number;
    geometry: GeoJSON.LineString | null;
  }> {
    if (!MAPBOX_TOKEN) {
      // Sem token → fallback Haversine
      const d = haversineKm(origin, dest);
      return { distanceKm: d, durationMin: Math.ceil((d / 25) * 60), geometry: null };
    }

    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Directions ${res.status}`);
      const data = await res.json();

      if (!data.routes || data.routes.length === 0) {
        throw new Error('Nenhuma rota encontrada');
      }

      const route = data.routes[0];
      return {
        distanceKm:  Math.round(route.distance / 100) / 10,   // metros → km (1 decimal)
        durationMin: Math.ceil(route.duration / 60),           // segundos → minutos
        geometry:    route.geometry as GeoJSON.LineString,
      };
    } catch (err) {
      console.warn('[mapService.getRouteDistance] Fallback Haversine:', err);
      const d = haversineKm(origin, dest);
      return { distanceKm: d, durationMin: Math.ceil((d / 25) * 60), geometry: null };
    }
  },

  // ── searchPlaces — REFACTOR v3.3 (Search Box API + Base Local Lazy) ────────
  async searchPlaces(query: string, userPos?: LatLng, signal?: AbortSignal): Promise<LocationResult[]> {
    const q = query.toLowerCase().trim();

    // Sem query -> sugestões populares locais instantâneas (sem rede)
    if (q.length < 2) {
      return POPULAR_LOCATIONS.slice(0, 10);
    }

    // 1. Busca local lazy e Search Box API concorrentemente
    const localPromise = searchAngolaLocationsLazy(query, 35).catch((err) => {
      console.warn('[mapService.searchPlaces] busca local falhou:', err);
      return [];
    });

    const mapboxPromise = mapboxSearchBoxSuggest(query, userPos, signal).catch((err: any) => {
      if (err.name === 'AbortError') throw err;
      return [];
    });

    const [localResults, mapboxResults] = await Promise.all([localPromise, mapboxPromise]);

    if (signal?.aborted) {
      const abortErr = new Error('Busca cancelada');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    // 2. Separar bairros/quarteirões locais (boost) vs POIs locais (fallback)
    const localBairros = localResults.filter(
      (l) => l.type === 'bairro' || l.name.toLowerCase().includes('quarteir') || l.name.toLowerCase().includes('bloco')
    );
    const localPOIs = localResults.filter(
      (l) => l.type !== 'bairro' && !l.name.toLowerCase().includes('quarteir') && !l.name.toLowerCase().includes('bloco')
    );

    // 3. Deduplicar por nome normalizado e tipo (sugestões Search Box não têm coords)
    const combined: LocationResult[] = [...localBairros];
    const seenNames = new Set<string>();

    for (const c of combined) {
      seenNames.add(normalizeLocationText(c.name));
    }

    for (const mb of mapboxResults) {
      const mbNorm = normalizeLocationText(mb.name);
      if (mbNorm && !seenNames.has(mbNorm)) {
        seenNames.add(mbNorm);
        combined.push(mb);
      }
    }

    // 4. POIs locais entram como complemento essencial (garantia de 100% de cobertura de POIs angolanos)
    for (const loc of localPOIs) {
      const locNorm = normalizeLocationText(loc.name);
      if (locNorm && !seenNames.has(locNorm)) {
        seenNames.add(locNorm);
        combined.push(loc);
      }
    }

    return combined.slice(0, 35);
  },

  // ── retrievePlace — Mapbox Search Box /retrieve ─────────────────────────────
  async retrievePlace(mapboxId: string): Promise<LatLng | null> {
    return mapboxSearchBoxRetrieve(mapboxId);
  },

  // ── resetSession — Gera novo session_token para próxima busca ──────────────
  resetSession(): void {
    resetSessionToken();
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
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
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
    let watchId: number | undefined;
    const MIN_MS   = 3000; // 3 segundos mínimo entre updates (throttle)
    const MIN_M    = 15;   // 15 metros de distância mínima para enviar (otimização de DB)

    const haversineM = (la1: number, lo1: number, la2: number, lo2: number) =>
      _haversineMeters(la1, lo1, la2, lo2);

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
              if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
              startWatch();
            }, 3000);
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
      );
    };

    startWatch();
    return () => { if (watchId !== undefined) navigator.geolocation.clearWatch(watchId); };
  },
};
