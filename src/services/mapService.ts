// =============================================================================
// ZENITH RIDE v3.2 — mapService.ts
// REFACTOR v3.2:
//   1. searchPlaces: Mapbox Geocoding é FONTE PRIMÁRIA (API real primeiro)
//      Lista estática é apenas fallback offline / sugestões populares
//   2. geocodeAddress: Mapbox primeiro, lista estática como fallback
//   3. getRouteDistance: USA Mapbox Directions API para distância REAL por estrada
//   4. calculateRouteInfo: agora tem versão assíncrona com dados reais
// =============================================================================

import type { LatLng, LocationResult } from '../types';
import { haversineKm as _haversineKm, haversineMeters as _haversineMeters } from '../lib/geo';
import { ANGOLA_LOCATIONS, searchAngolaLocations } from '../data/angolaLocations';

const MAPBOX_TOKEN   = import.meta.env.VITE_MAPBOX_TOKEN   as string | undefined;
const LOCATION_NAME_SEPARATOR = '—';

// Base hiper-detalhada de Angola (Kilamba com quarteirões A-X, Golf 2 com zonas A-D, Talatona, Viana, Cazenga, e 18 províncias)
export const LUANDA_STATIC_LOCATIONS: LocationResult[] = ANGOLA_LOCATIONS;
export const ALL_ANGOLA_LOCATIONS: LocationResult[] = ANGOLA_LOCATIONS;

// Cache de geocoding (evitar chamadas repetidas)
const geocodeCache = new Map<string, LatLng>();

// ─── Helper: distância Haversine (delega para geo.ts centralizado) ───────────
function haversineKm(a: LatLng, b: LatLng): number {
  return _haversineKm(a.lat, a.lng, b.lat, b.lng);
}

function getPrimaryLocationName(name: string): string {
  return name.split(LOCATION_NAME_SEPARATOR)[0]?.trim() || name.trim();
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
  const bestName = getPrimaryLocationName(best.name);
  if (bestDist > 10) return `Angola (perto de ${bestName})`;
  if (bestDist > 5) return `Luanda (perto de ${bestName})`;
  return bestName;
}

// ─── Mapbox Geocoding: pesquisa de texto → lista de locais ───────────────────
// Bbox expandido para cobrir Luanda + Bengo + Ícolo e Bengo
async function mapboxForwardGeocode(query: string, proximity?: LatLng): Promise<LocationResult[]> {
  if (!MAPBOX_TOKEN) return [];

  const encoded = encodeURIComponent(query);
  const proxStr = proximity
    ? `${proximity.lng},${proximity.lat}`
    : '13.2343,-8.8368';

  // Bounds abrangentes de Angola (cobre todas as 18 províncias)
  const bbox = '11.5,-18.0,24.1,-4.5';
  const types = 'poi,address,neighborhood,locality,place';
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?country=AO&language=pt&proximity=${proxStr}&bbox=${bbox}&types=${types}&limit=15&access_token=${MAPBOX_TOKEN}`;
  const results = await _mapboxGeocodeFetch(url);

  return results;
}

// Helper interno — executa fetch e mapeia resposta
async function _mapboxGeocodeFetch(url: string): Promise<LocationResult[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.features ?? []).map((f: any): LocationResult => {
      // Compatibilidade cruzada com Geocoding v5 e Search Box API v1
      const [lng, lat] = f.geometry?.coordinates ?? f.center ?? [0,0];
      const name = f.properties?.name ?? f.text ?? f.place_name?.split(',')[0] ?? 'Local';
      const fullPlace = f.properties?.full_address ?? f.properties?.place_formatted ?? f.place_name ?? f.text ?? 'Angola';
      
      let typeArr = f.place_type ?? [];
      if (typeof typeArr === 'string') typeArr = [typeArr];
      if (f.properties?.feature_type) typeArr.push(f.properties.feature_type);

      // Limpar descrição
      let description = fullPlace;
      if (description.startsWith(name + ', ')) {
        description = description.slice(name.length + 2);
      }
      description = description.replace(/, Angola$/i, '').replace(/Angola,?\s*/gi, '').trim();
      if (!description || description === name) description = 'Luanda';

      return {
        name,
        type: mapboxTypeToLocal(typeArr),
        description,
        coords: { lat, lng },
        isPopular: false,
      };
    });
  } catch (err) {
    console.warn('[mapService._mapboxGeocodeFetch]', err);
    return [];
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

    // 1. Procurar primeiro na base hiper-detalhada de Angola (Quarteirões, Zonas e Bairros com GPS exato)
    const localMatches = searchAngolaLocations(address, 5);
    const exactMatch = localMatches.find(l => 
      l.name.toLowerCase() === cacheKey || 
      cacheKey.includes(l.name.toLowerCase()) ||
      l.name.toLowerCase().includes(cacheKey)
    );
    if (exactMatch) {
      geocodeCache.set(cacheKey, exactMatch.coords);
      return exactMatch.coords;
    }

    // 2. MAPBOX PRIMEIRO para ruas e endereços específicos
    if (MAPBOX_TOKEN) {
      try {
        const results = await mapboxForwardGeocode(address);
        const firstResult = results[0];
        if (firstResult) {
          geocodeCache.set(cacheKey, firstResult.coords);
          return firstResult.coords;
        }
      } catch (err) { console.warn('[mapService] mapbox geocode fallback:', err); }
    }

    // 3. Fallback do primeiro resultado local se houver
    if (localMatches.length > 0 && localMatches[0]?.coords) {
      geocodeCache.set(cacheKey, localMatches[0].coords);
      return localMatches[0].coords;
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

  // ── searchPlaces — REFACTOR v3.2 ──────────────────────────────────────────
  // MAPBOX API é a FONTE PRIMÁRIA. Lista estática é fallback offline.
  async searchPlaces(query: string, userPos?: LatLng): Promise<LocationResult[]> {
    const q = query.toLowerCase().trim();

    // Sem query → sugestões populares locais (rápido, sem API)
    if (q.length < 2) return ANGOLA_LOCATIONS.filter((l) => l.isPopular);

    // 1. Busca na base estruturada de Angola (Quarteirões, Zonas, Bairros e Províncias)
    // Se o utilizador pesquisar "Kilamba", traz TODOS os quarteirões A a X e KK5000 no topo!
    // Se pesquisar "Golf 2", traz TODAS as zonas internas A a D, mercados e paragens!
    const localResults = searchAngolaLocations(query, 35);

    // 2. Mapbox Geocoding para endereços específicos, ruas e POIs em Angola
    let mapboxResults: LocationResult[] = [];
    if (MAPBOX_TOKEN) {
      try {
        mapboxResults = await mapboxForwardGeocode(query, userPos);
      } catch (err) {
        console.warn('[mapService.searchPlaces] Mapbox Geocoding falhou:', err);
      }
    }

    // 3. Combinar resultados:
    // Resultados locais de alta granularidade (quarteirões/sub-zonas) vêm PRIMEIRO.
    // POIs do Mapbox são adicionados sem descartar as sub-zonas locais!
    const combined: LocationResult[] = [...localResults];
    for (const mb of mapboxResults) {
      const mbNameLower = mb.name.toLowerCase().trim();
      const isExactDup = combined.some(c => c.name.toLowerCase().trim() === mbNameLower);
      if (!isExactDup) {
        combined.push(mb);
      }
    }

    return combined.slice(0, 40);
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
