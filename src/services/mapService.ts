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

const MAPBOX_TOKEN   = import.meta.env.VITE_MAPBOX_TOKEN   as string | undefined;

// Coordenadas reais: Luanda + Bengo + Ícolo e Bengo (cache estática para offline / sugestões rápidas)
export const LUANDA_STATIC_LOCATIONS: LocationResult[] = [
  // ═══ LUANDA CENTRO ═══
  { name: 'Mutamba — Baixa de Luanda',         type: 'bairro',    description: 'Centro histórico',         coords: { lat: -8.8160, lng: 13.2300 }, isPopular: true },
  { name: 'Ilha do Cabo — Chicala',            type: 'bairro',    description: 'Zona turística',           coords: { lat: -8.7900, lng: 13.2200 }, isPopular: true },
  { name: 'Maianga',                           type: 'bairro',    description: 'Zona central',             coords: { lat: -8.8320, lng: 13.2180 } },
  { name: 'Ingombotas',                        type: 'bairro',    description: 'Centro de Luanda',         coords: { lat: -8.8100, lng: 13.2350 } },
  { name: 'Golfe — Cidade Alta',               type: 'bairro',    description: 'Zona governamental',       coords: { lat: -8.8220, lng: 13.2300 }, isPopular: true },
  { name: 'Sambizanga',                        type: 'bairro',    description: 'Luanda Norte',             coords: { lat: -8.7960, lng: 13.2480 } },
  { name: 'Rangel',                            type: 'bairro',    description: 'Luanda Este',              coords: { lat: -8.8200, lng: 13.2600 } },
  { name: 'Rocha Pinto',                       type: 'bairro',    description: 'Luanda Norte',             coords: { lat: -8.7850, lng: 13.2700 } },
  { name: 'Cazenga',                           type: 'bairro',    description: 'Zona norte',               coords: { lat: -8.8050, lng: 13.2800 } },
  { name: 'Palanca',                           type: 'bairro',    description: 'Luanda Sul',               coords: { lat: -8.8700, lng: 13.2150 } },
  { name: 'Morro Bento',                       type: 'bairro',    description: 'Luanda Sul',               coords: { lat: -8.8900, lng: 13.2200 } },
  { name: 'Samba',                             type: 'bairro',    description: 'Luanda Centro-Sul',        coords: { lat: -8.8630, lng: 13.2250 } },
  { name: 'Prenda',                            type: 'bairro',    description: 'Zona residencial',         coords: { lat: -8.8450, lng: 13.2400 } },
  { name: 'Neves Bendinha',                    type: 'bairro',    description: 'Luanda',                   coords: { lat: -8.8400, lng: 13.2550 } },
  { name: 'Hoji Ya Henda',                     type: 'bairro',    description: 'Luanda Este',              coords: { lat: -8.8250, lng: 13.2700 } },
  { name: 'Vila Alice',                        type: 'bairro',    description: 'Zona central',             coords: { lat: -8.8280, lng: 13.2280 } },
  { name: 'Alvalade',                          type: 'bairro',    description: 'Zona residencial',         coords: { lat: -8.8380, lng: 13.2300 } },
  { name: 'Kinaxixi',                          type: 'bairro',    description: 'Centro, Luanda',           coords: { lat: -8.8230, lng: 13.2260 } },
  { name: 'Coqueiros',                         type: 'bairro',    description: 'Zona central',             coords: { lat: -8.8180, lng: 13.2400 } },
  { name: 'Terra Nova',                        type: 'bairro',    description: 'Luanda Norte',             coords: { lat: -8.8020, lng: 13.2550 } },
  { name: 'Cassenda',                          type: 'bairro',    description: 'Zona residencial',         coords: { lat: -8.8350, lng: 13.2500 } },
  { name: 'Cruzeiro',                          type: 'bairro',    description: 'Luanda',                   coords: { lat: -8.8500, lng: 13.2350 } },
  // ═══ LUANDA SUL / CENTRALIDADES ═══
  { name: 'Talatona',                          type: 'bairro',    description: 'Zona nobre sul',           coords: { lat: -8.9350, lng: 13.1810 }, isPopular: true },
  { name: 'Kilamba — Quarteirão A',            type: 'bairro',    description: 'Centralidade Kilamba',     coords: { lat: -8.9780, lng: 13.2180 } },
  { name: 'Kilamba — Quarteirão B',            type: 'bairro',    description: 'Centralidade Kilamba',     coords: { lat: -8.9800, lng: 13.2200 } },
  { name: 'Kilamba — Quarteirão C',            type: 'bairro',    description: 'Centralidade Kilamba',     coords: { lat: -8.9820, lng: 13.2220 } },
  { name: 'Benfica',                           type: 'bairro',    description: 'Luanda Sul',               coords: { lat: -8.9200, lng: 13.1900 } },
  { name: 'Camama',                            type: 'bairro',    description: 'Luanda Sul',               coords: { lat: -8.9000, lng: 13.2050 } },
  { name: 'Futungo de Belas',                  type: 'bairro',    description: 'Zona residencial sul',     coords: { lat: -8.9100, lng: 13.1700 } },
  { name: 'Barra do Kwanza',                   type: 'bairro',    description: 'Zona costeira sul',        coords: { lat: -9.0600, lng: 13.1600 } },
  { name: 'Ramiros',                           type: 'bairro',    description: 'Zona residencial',         coords: { lat: -8.9600, lng: 13.1750 } },
  // ═══ VIANA & ZANGO ═══
  { name: 'Viana — Centro',                    type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9050, lng: 13.3300 } },
  { name: 'Viana — Zango 0',                   type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9100, lng: 13.3400 } },
  { name: 'Viana — Zango 1',                   type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9200, lng: 13.3500 } },
  { name: 'Viana — Zango 2',                   type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9300, lng: 13.3600 } },
  { name: 'Viana — Zango 3',                   type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9350, lng: 13.3650 } },
  { name: 'Viana — Zango 4',                   type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9400, lng: 13.3700 } },
  { name: 'Viana — Zango 5',                   type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.9500, lng: 13.3800 } },
  { name: 'Viana — Estalagem',                 type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.8950, lng: 13.3200 } },
  { name: 'Viana — Capalanga',                 type: 'bairro',    description: 'Viana, Luanda',            coords: { lat: -8.8800, lng: 13.3100 } },
  // ═══ CACUACO ═══
  { name: 'Cacuaco — Centro',                  type: 'bairro',    description: 'Cacuaco, Luanda',          coords: { lat: -8.7500, lng: 13.3600 } },
  { name: 'Cacuaco — Kikolo',                  type: 'bairro',    description: 'Cacuaco Norte',            coords: { lat: -8.7300, lng: 13.3500 } },
  { name: 'Cacuaco — Funda',                   type: 'bairro',    description: 'Cacuaco',                  coords: { lat: -8.7100, lng: 13.3800 } },
  // ═══ BENGO ═══
  { name: 'Caxito — Centro',                   type: 'bairro',    description: 'Capital do Bengo',         coords: { lat: -8.5780, lng: 13.6570 } },
  { name: 'Catete',                            type: 'bairro',    description: 'Bengo',                    coords: { lat: -8.7300, lng: 13.7200 } },
  { name: 'Dande',                             type: 'bairro',    description: 'Bengo',                    coords: { lat: -8.4450, lng: 13.6900 } },
  { name: 'Ambriz',                            type: 'bairro',    description: 'Bengo, zona costeira',     coords: { lat: -7.8620, lng: 13.1250 } },
  { name: 'Quiçama — Parque Nacional',         type: 'monumento', description: 'Parque Nacional',          coords: { lat: -9.2000, lng: 13.4500 } },
  // ═══ ÍCOLO E BENGO ═══
  { name: 'Ícolo e Bengo — Centro',            type: 'bairro',    description: 'Ícolo e Bengo',            coords: { lat: -8.8300, lng: 13.7500 } },
  { name: 'Bom Jesus',                         type: 'bairro',    description: 'Ícolo e Bengo',            coords: { lat: -8.8100, lng: 13.7800 } },
  // ═══ AEROPORTOS & TRANSPORTES ═══
  { name: 'Aeroporto 4 de Fevereiro',          type: 'monumento', description: 'Aeroporto Internacional',  coords: { lat: -8.8584, lng: 13.2312 }, isPopular: true },
  { name: 'Novo Aeroporto de Luanda (NAIL)',   type: 'monumento', description: 'Bom Jesus, Ícolo',        coords: { lat: -8.8050, lng: 13.7600 } },
  { name: 'Porto de Luanda',                   type: 'monumento', description: 'Porto marítimo',           coords: { lat: -8.7950, lng: 13.2350 } },
  // ═══ HOSPITAIS ═══
  { name: 'Hospital Américo Boavida',          type: 'hospital',  description: 'Hospital público',         coords: { lat: -8.8270, lng: 13.2350 } },
  { name: 'Hospital Josina Machel',            type: 'hospital',  description: 'Hospital central',         coords: { lat: -8.8180, lng: 13.2380 } },
  { name: 'Hospital Militar',                  type: 'hospital',  description: 'Forças Armadas',           coords: { lat: -8.8400, lng: 13.2180 } },
  { name: 'Clínica Sagrada Esperança',         type: 'hospital',  description: 'Clínica privada',          coords: { lat: -8.8500, lng: 13.2280 } },
  { name: 'Clínica Girassol',                  type: 'hospital',  description: 'Clínica privada',          coords: { lat: -8.9100, lng: 13.1900 } },
  { name: 'Hospital Pediátrico David Bernardino', type: 'hospital', description: 'Hospital infantil',      coords: { lat: -8.8330, lng: 13.2450 } },
  // ═══ ESCOLAS & UNIVERSIDADES ═══
  { name: 'Universidade Agostinho Neto',        type: 'escola',   description: 'Universidade pública',     coords: { lat: -8.8350, lng: 13.2350 } },
  { name: 'Universidade Lusíada',               type: 'escola',   description: 'Universidade privada',     coords: { lat: -8.8500, lng: 13.2250 } },
  { name: 'Universidade Católica de Angola',    type: 'escola',   description: 'UCAN',                     coords: { lat: -8.8950, lng: 13.1850 } },
  { name: 'Universidade Metodista de Angola',   type: 'escola',   description: 'UMA',                      coords: { lat: -8.8480, lng: 13.2380 } },
  { name: 'Colégio Pitágoras',                  type: 'escola',   description: 'Escola privada',           coords: { lat: -8.9150, lng: 13.1880 } },
  { name: 'Escola Portuguesa de Luanda',        type: 'escola',   description: 'Escola internacional',     coords: { lat: -8.9280, lng: 13.1830 } },
  // ═══ RESTAURANTES ═══
  { name: 'Restaurante Pimm\'s',               type: 'restaurante', description: 'Ilha do Cabo',           coords: { lat: -8.7930, lng: 13.2230 } },
  { name: 'Restaurante Cais de Quatro',        type: 'restaurante', description: 'Marginal',               coords: { lat: -8.8050, lng: 13.2300 } },
  { name: 'KFC Belas Shopping',                type: 'restaurante', description: 'Belas Shopping',         coords: { lat: -8.9285, lng: 13.1955 } },
  { name: 'Restaurante Kongulo',               type: 'restaurante', description: 'Morro Bento',            coords: { lat: -8.8880, lng: 13.2180 } },
  // ═══ HOTÉIS & HOSPEDARIAS ═══
  { name: 'Hotel EPIC Sana',                   type: 'servico',   description: 'Hotel 5 estrelas',         coords: { lat: -8.9380, lng: 13.1820 }, isPopular: true },
  { name: 'Hotel Presidente',                  type: 'servico',   description: 'Hotel central',            coords: { lat: -8.8180, lng: 13.2350 } },
  { name: 'Hotel Trópico',                     type: 'servico',   description: 'Hotel Marginal',           coords: { lat: -8.8050, lng: 13.2380 } },
  { name: 'IU Hotel — Talatona',               type: 'servico',   description: 'Hotel',                    coords: { lat: -8.9350, lng: 13.1800 } },
  { name: 'IU Hotel — Viana',                  type: 'servico',   description: 'Hotel',                    coords: { lat: -8.9000, lng: 13.3350 } },
  // ═══ CENTROS COMERCIAIS ═══
  { name: 'Belas Shopping',                    type: 'servico',   description: 'Centro comercial',         coords: { lat: -8.9280, lng: 13.1950 }, isPopular: true },
  { name: 'Xyami Shopping',                    type: 'servico',   description: 'Centro comercial',         coords: { lat: -8.9300, lng: 13.1870 } },
  { name: 'Shoprite Viana',                    type: 'servico',   description: 'Supermercado',             coords: { lat: -8.9080, lng: 13.3450 } },
  { name: 'Shoprite Talatona',                 type: 'servico',   description: 'Supermercado',             coords: { lat: -8.9350, lng: 13.1850 } },
  { name: 'Kero Kilamba',                      type: 'servico',   description: 'Supermercado',             coords: { lat: -8.9800, lng: 13.2190 } },
  { name: 'Kero Talatona',                     type: 'servico',   description: 'Supermercado',             coords: { lat: -8.9330, lng: 13.1840 } },
  // ═══ MARCOS & MONUMENTOS ═══
  { name: 'Fortaleza de São Miguel',           type: 'monumento', description: 'Monumento histórico',      coords: { lat: -8.8130, lng: 13.2370 } },
  { name: 'Mausoléu Agostinho Neto',          type: 'monumento', description: 'Memorial',                 coords: { lat: -8.8250, lng: 13.2200 } },
  { name: 'Estádio 11 de Novembro',           type: 'monumento', description: 'Estádio nacional',         coords: { lat: -8.8680, lng: 13.2350 } },
  { name: 'Marginal de Luanda',               type: 'rua',       description: 'Avenida costeira',         coords: { lat: -8.8100, lng: 13.2350 } },
  { name: 'Samba — Nó da Samba',              type: 'rua',       description: 'Via de acesso principal',   coords: { lat: -8.8630, lng: 13.2250 } },
  { name: 'Praia do Mussulo',                 type: 'monumento', description: 'Praia turística',          coords: { lat: -8.8900, lng: 13.1400 } },
  { name: 'Miradouro da Lua',                 type: 'monumento', description: 'Atracção turística',       coords: { lat: -9.1350, lng: 13.0800 } },
];

// Cache de geocoding (evitar chamadas repetidas)
const geocodeCache = new Map<string, LatLng>();

// ─── Helper: distância Haversine (delega para geo.ts centralizado) ───────────
function haversineKm(a: LatLng, b: LatLng): number {
  return _haversineKm(a.lat, a.lng, b.lat, b.lng);
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
  if (bestDist > 10) return `Angola (perto de ${best.name.split('—')[0].trim()})`;
  if (bestDist > 5) return `Luanda (perto de ${best.name.split('—')[0].trim()})`;
  return best.name.split('—')[0].trim();
}

// ─── Mapbox Geocoding: pesquisa de texto → lista de locais ───────────────────
// Bbox expandido para cobrir Luanda + Bengo + Ícolo e Bengo
async function mapboxForwardGeocode(query: string, proximity?: LatLng): Promise<LocationResult[]> {
  if (!MAPBOX_TOKEN) return [];

  const encoded = encodeURIComponent(query);
  const proxStr = proximity
    ? `${proximity.lng},${proximity.lat}`
    : '13.2343,-8.8368';

  // Usar Geocoding API v5 especificando 'poi' explícito para trazer Escolas, Hotéis, etc e limitando o bbox a Luanda/Bengo
  const bbox = '12.8,-9.5,14.3,-7.5';
  const types = 'poi,address,neighborhood,locality,place';
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?country=AO&language=pt-PT&proximity=${proxStr}&bbox=${bbox}&types=${types}&limit=15&access_token=${MAPBOX_TOKEN}`;
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
  } catch {
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

    // 1. MAPBOX PRIMEIRO (fonte primária — dados reais)
    if (MAPBOX_TOKEN) {
      try {
        const results = await mapboxForwardGeocode(address);
        if (results.length > 0) {
          geocodeCache.set(cacheKey, results[0].coords);
          return results[0].coords;
        }
      } catch { /* fallthrough to static */ }
    }

    // 2. Lista estática (fallback offline)
    const local = LUANDA_STATIC_LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(cacheKey) || cacheKey.includes(l.name.toLowerCase().split('—')[0].trim())
    );
    if (local) { geocodeCache.set(cacheKey, local.coords); return local.coords; }

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
    if (q.length < 2) return LUANDA_STATIC_LOCATIONS.filter((l) => l.isPopular);

    // 1. MAPBOX GEOCODING API — FONTE PRIMÁRIA (resultados reais)
    let mapboxResults: LocationResult[] = [];
    if (MAPBOX_TOKEN) {
      try {
        mapboxResults = await mapboxForwardGeocode(query, userPos);
      } catch (err) {
        console.warn('[mapService.searchPlaces] Mapbox Geocoding falhou:', err);
      }
    }

    // 2. Se a API retornou resultados reais, acrescentar matches locais em baixo como complemento
    if (mapboxResults.length > 0) {
      // Filtrar locais estáticos que coincidem com a query mas NÃO duplicam resultados Mapbox
      const localExtras = LUANDA_STATIC_LOCATIONS.filter((l) => {
        const matches = l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q);
        if (!matches) return false;
        // Verificar se já existe um resultado Mapbox com nome similar
        const isDuplicate = mapboxResults.some(r =>
          r.name.toLowerCase().includes(l.name.toLowerCase().split('—')[0].trim().substring(0, 8)) ||
          l.name.toLowerCase().includes(r.name.toLowerCase().substring(0, 8))
        );
        return !isDuplicate;
      });

      return [...mapboxResults, ...localExtras].slice(0, 12);
    }

    // 3. FALLBACK OFFLINE: se a API falhou ou não retornou nada → lista estática
    const localResults = LUANDA_STATIC_LOCATIONS.filter((l) =>
      l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)
    );

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
    const MIN_MS   = 5000; // 5 segundos mínimo entre updates
    const MIN_M    = 10;   // 10 metros — sensível a trânsito lento de Luanda

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
