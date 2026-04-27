// =============================================================================
// ZENITH RIDE v3.0 — src/services/zonePrice.ts
// Preços fixos por zona — a arma secreta contra o surge pricing percebido
//
// Estratégia de negócio:
//   - Passageiro vê preço ANTES de pedir → confiança
//   - Motorista sabe exactamente quanto vai ganhar → satisfação
//   - Zenith cobra 15% de comissão fixa → previsível para os 3
//
// Integração:
//   import { zonePriceService } from './services/zonePrice';
//   const price = zonePriceService.lookupPrice('Viana', 'Talatona');
// =============================================================================

import { supabase } from '../lib/supabase';
import type { ZonePrice } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// MAPA DE ZONAS DE LUANDA
// Bairros → Zona canónica (para lookup de preços)
// ─────────────────────────────────────────────────────────────────────────────
export const LUANDA_ZONE_MAP: Record<string, string> = {
  // Viana
  'Viana':                    'Viana',
  'Petrangol':                'Viana',
  'Cacuaco':                  'Viana',
  'Km 30':                    'Viana',
  'Catete':                   'Viana',

  // Kilamba
  'Kilamba':                  'Kilamba',
  'Kilamba Kiaxi':            'Kilamba',
  'Zango':                    'Kilamba',
  'Zango 1':                  'Kilamba',
  'Zango 2':                  'Kilamba',

  // Talatona
  'Talatona':                 'Talatona',
  'Benfica Sul':              'Talatona',
  'Camama':                   'Talatona',
  'Golf':                     'Talatona',
  'Belas':                    'Talatona',
  'Belas Shopping':           'Talatona',

  // Centro / Ilha / Miramar
  'Centro':                   'Centro',
  'Ilha de Luanda':           'Centro',
  'Ilha':                     'Centro',
  'Ingombota':                'Centro',
  'Mutamba':                  'Centro',
  'Largo do Kinaxixi':        'Centro',
  'Praia do Bispo':           'Centro',

  // Miramar
  'Miramar':                  'Miramar',
  'Alvalade':                 'Miramar',
  'Maianga':                  'Maianga',
  'Patrice Lumumba':          'Maianga',

  // Cazenga
  'Cazenga':                  'Cazenga',
  'Palanca':                  'Cazenga',
  'Vila Alice':               'Cazenga',
  'Rocha Pinto':              'Cazenga',

  // Rangel
  'Rangel':                   'Rangel',
  'Hoji ya Henda':            'Rangel',
  'Golfe':                    'Rangel',

  // Samba
  'Samba':                    'Samba',
  'Golf 2':                   'Samba',
  'Camanga':                  'Samba',

  // Benfica
  'Benfica':                  'Benfica',
  'Cacuaco Norte':            'Benfica',

  // Luanda Norte
  'Luanda Norte':             'Luanda Norte',
  'Viana Norte':              'Luanda Norte',
  'Sequele':                  'Luanda Norte',
};

// Cores das zonas para visualização no mapa de preços
export const ZONE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'Centro':       { bg: 'bg-primary/10', text: 'text-primary',     label: 'Central' },
  'Maianga':      { bg: 'bg-primary/10', text: 'text-primary/80',   label: 'Central' },
  'Miramar':      { bg: 'bg-primary/10', text: 'text-primary/80',   label: 'Central' },
  'Cazenga':      { bg: 'bg-primary/10', text: 'text-primary/70',   label: 'Próximo' },
  'Rangel':       { bg: 'bg-primary/10', text: 'text-primary/70',   label: 'Próximo' },
  'Samba':        { bg: 'bg-primary/10', text: 'text-primary/80',   label: 'Médio' },
  'Benfica':      { bg: 'bg-primary/10', text: 'text-primary/80',   label: 'Médio' },
  'Talatona':     { bg: 'bg-primary/10', text: 'text-primary',      label: 'Médio' },
  'Kilamba':      { bg: 'bg-orange-50',  text: 'text-orange-700',   label: 'Longo' },
  'Viana':        { bg: 'bg-red-50',     text: 'text-red-700',      label: 'Longo' },
  'Luanda Norte': { bg: 'bg-red-50',     text: 'text-red-700',      label: 'Longo' },
};

// Cache em memória com TTL de 5 minutos (evitar hits repetidos ao Supabase)
interface PriceCacheEntry { value: ZonePrice | null; expiresAt: number; }
const priceCache     = new Map<string, PriceCacheEntry>();
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

class ZonePriceService {

  // ─────────────────────────────────────────────────────────────────────────
  // Detecta a zona canónica a partir de um endereço/nome de local
  // ─────────────────────────────────────────────────────────────────────────
  detectZone(address: string): string | null {
    const normalized = address.toLowerCase();

    // Busca directa — procurar por palavras-chave mais específicas primeiro
    const entries = Object.entries(LUANDA_ZONE_MAP).slice().sort((a, b) => b[0].length - a[0].length);
    for (const [keyword, zone] of entries) {
      if (normalized.includes(keyword.toLowerCase())) {
        return zone;
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lookup de preço fixo por par de zonas (com cache)
  // ─────────────────────────────────────────────────────────────────────────
  async getZonePrice(originAddress: string, destAddress: string): Promise<ZonePrice | null> {
    const originZone = this.detectZone(originAddress);
    const destZone   = this.detectZone(destAddress);

    if (!originZone || !destZone || originZone === destZone) return null;

    const cacheKey = `${originZone}→${destZone}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    // Tenta a direcção directa
    const { data } = await supabase
      .from('zone_prices')
      .select('origin_zone, dest_zone, price_kz, distance_km')
      .eq('origin_zone', originZone)
      .eq('dest_zone', destZone)
      .eq('active', true)
      .single();

    if (data) {
      const result = data as ZonePrice;
      priceCache.set(cacheKey, { value: result, expiresAt: Date.now() + PRICE_CACHE_TTL });
      return result;
    }

    // Tenta a direcção inversa (o preço é simétrico)
    const { data: reverse } = await supabase
      .from('zone_prices')
      .select('origin_zone, dest_zone, price_kz, distance_km')
      .eq('origin_zone', destZone)
      .eq('dest_zone', originZone)
      .eq('active', true)
      .single();

    if (reverse) {
      const result: ZonePrice = {
        origin_zone: originZone,
        dest_zone:   destZone,
        price_kz:    (reverse as ZonePrice).price_kz,
        distance_km: (reverse as ZonePrice).distance_km,
      };
      priceCache.set(cacheKey, { value: result, expiresAt: Date.now() + PRICE_CACHE_TTL });
      return result;
    }

    priceCache.set(cacheKey, { value: null, expiresAt: Date.now() + PRICE_CACHE_TTL });
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Carrega todos os preços para o mapa de zonas (usada na tab "Preços")
  // ─────────────────────────────────────────────────────────────────────────
  async getAllPrices(): Promise<ZonePrice[]> {
    const { data } = await supabase
      .from('zone_prices')
      .select('origin_zone, dest_zone, price_kz, distance_km')
      .eq('active', true)
      .order('origin_zone');

    return (data ?? []) as ZonePrice[];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Limpa cache (usar quando admin actualiza preços)
  // ─────────────────────────────────────────────────────────────────────────
  clearCache() { priceCache.clear(); }

  getZoneColor(zone: string) {
    return ZONE_COLORS[zone] ?? { bg: 'bg-surface-container-low', text: 'text-on-surface-variant', label: 'Zona' };
  }
}

export const zonePriceService = new ZonePriceService();

// ─────────────────────────────────────────────────────────────────────────────
// MULTIPLICADORES DE VEÍCULO
// ─────────────────────────────────────────────────────────────────────────────
export type VehicleType = 'standard' | 'moto' | 'comfort' | 'xl';

const VEHICLE_MULTIPLIER: Record<VehicleType, number> = {
  standard: 1.0,
  moto:     0.40,  // 40% do preço normal
  comfort:  1.40,
  xl:       1.80,
};

export function applyVehicleMultiplier(basePriceKz: number, type: VehicleType): number {
  return Math.round(basePriceKz * VEHICLE_MULTIPLIER[type]);
}

export const MOTO_SAFETY_WARNING =
  `Por favor, certifica-te de que:\n\n` +
  `• Tens capacete disponível (obrigatório por lei)\n` +
  `• A zona de partida e chegada é segura\n` +
  `• Evita distâncias superiores a 20 km por razões de segurança\n\n` +
  `A Zenith recomenda o uso de moto-táxi apenas em percursos urbanos conhecidos.`;
