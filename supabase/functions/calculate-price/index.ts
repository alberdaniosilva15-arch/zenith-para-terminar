// =============================================================================
// MOTOGO v3.0 — Edge Function: calculate-price (ACTUALIZADA)
// Ficheiro: supabase/functions/calculate-price/index.ts
//
// NOVO: Antes de calcular dinamicamente, verifica se existe preço fixo por zona.
// Se existir, retorna esse preço (mais previsível para o utilizador).
// Mantém compatibilidade total com a versão anterior (mesma interface).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ─── Configuração de preços dinâmicos (fallback) ─────────────────────────────
const PRICING = {
  BASE_KZ:   500,
  PER_KM_KZ: 250,
  PER_MIN_KZ: 30,
  MINIMUM_KZ: 800,
  SPEED_KMH: { low: 35, medium: 20, high: 10 },
};

const SURGE_HOURS = [
  { start: 7,  end: 9,  multiplier: 1.5 },
  { start: 12, end: 14, multiplier: 1.2 },
  { start: 17, end: 20, multiplier: 1.8 },
  { start: 22, end: 24, multiplier: 1.3 },
];

// Mapa de zona (espelho do frontend — mantido aqui para Edge Function)
const ZONE_MAP: Record<string, string> = {
  'viana': 'Viana', 'petrangol': 'Viana', 'cacuaco': 'Viana',
  'kilamba': 'Kilamba', 'zango': 'Kilamba', 'kilamba kiaxi': 'Kilamba',
  'talatona': 'Talatona', 'camama': 'Talatona', 'belas': 'Talatona', 'golf': 'Talatona',
  'centro': 'Centro', 'ilha': 'Centro', 'ingombota': 'Centro', 'mutamba': 'Centro',
  'miramar': 'Miramar', 'alvalade': 'Miramar',
  'maianga': 'Maianga', 'cazenga': 'Cazenga', 'rangel': 'Rangel',
  'samba': 'Samba', 'benfica': 'Benfica', 'luanda norte': 'Luanda Norte',
};

function detectZone(address: string): string | null {
  const lower = address.toLowerCase();
  for (const [kw, zone] of Object.entries(ZONE_MAP)) {
    if (lower.includes(kw)) return zone;
  }
  return null;
}

// =============================================================================
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsOk();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Não autenticado.', 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return jsonError('Token inválido.', 401);

    const body = await req.json() as {
      origin:          { lat: number; lng: number };
      dest:            { lat: number; lng: number };
      origin_address?: string;
      dest_address?:   string;
    };

    const { origin, dest, origin_address, dest_address } = body;

    if (!origin?.lat || !origin?.lng || !dest?.lat || !dest?.lng) {
      return jsonError('Coordenadas inválidas.', 400);
    }

    // ── 1. Verificar preço fixo por zona ───────────────────────────────────
    if (origin_address && dest_address) {
      const originZone = detectZone(origin_address);
      const destZone   = detectZone(dest_address);

      if (originZone && destZone && originZone !== destZone) {
        // Usa service role para ler zone_prices
        const adminSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // Tenta direcção directa
        const { data: zp } = await adminSupabase
          .from('zone_prices')
          .select('price_kz, distance_km')
          .eq('active', true)
          .or(`and(origin_zone.eq.${originZone},dest_zone.eq.${destZone}),and(origin_zone.eq.${destZone},dest_zone.eq.${originZone})`)
          .limit(1)
          .maybeSingle();

        if (zp) {
          const distKm   = zp.distance_km ?? haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
          const hourUTC1 = (new Date().getUTCHours() + 1) % 24;

          return jsonOk({
            price_kz:         zp.price_kz,
            distance_km:      Math.round(distKm * 100) / 100,
            duration_min:     Math.round((distKm / PRICING.SPEED_KMH.medium) * 60),
            surge_multiplier: 1.0,                // sem surge nos preços fixos
            traffic_level:    getTrafficLevel(hourUTC1),
            is_zone_price:    true,               // flag para o frontend mostrar "Preço Fixo"
            origin_zone:      originZone,
            dest_zone:        destZone,
            breakdown: {
              base_kz:   zp.price_kz,
              per_km_kz: 0,
              surge_kz:  0,
              total_kz:  zp.price_kz,
            },
          });
        }
      }
    }

    // ── 2. Fallback: cálculo dinâmico (trajectos sem preço fixo) ──────────
    const distanceKm     = haversineKm(origin.lat, origin.lng, dest.lat, dest.lng);
    const hourUTC1       = (new Date().getUTCHours() + 1) % 24;
    const trafficLevel   = getTrafficLevel(hourUTC1);
    const speedKmh       = PRICING.SPEED_KMH[trafficLevel];
    const durationMin    = Math.round((distanceKm / speedKmh) * 60);
    const surgeMultiplier = getSurgeMultiplier(hourUTC1);

    const baseKz   = PRICING.BASE_KZ;
    const perKmKz  = distanceKm * PRICING.PER_KM_KZ;
    const subtotal = baseKz + perKmKz;
    const surgeKz  = subtotal * (surgeMultiplier - 1);
    const totalKz  = Math.max(
      Math.round((subtotal + surgeKz) * 100) / 100,
      PRICING.MINIMUM_KZ
    );

    return jsonOk({
      price_kz:         totalKz,
      distance_km:      Math.round(distanceKm * 100) / 100,
      duration_min:     durationMin,
      surge_multiplier: surgeMultiplier,
      traffic_level:    trafficLevel,
      is_zone_price:    false,
      breakdown: {
        base_kz:   baseKz,
        per_km_kz: Math.round(perKmKz),
        surge_kz:  Math.round(surgeKz),
        total_kz:  totalKz,
      },
    });

  } catch (err) {
    console.error('[calculate-price] Erro:', err);
    return jsonError('Erro ao calcular preço.', 500);
  }
});

// ─── Algoritmos ──────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function toRad(d: number) { return d * Math.PI / 180; }
function getTrafficLevel(h: number): 'low'|'medium'|'high' {
  if ((h>=7&&h<=9)||(h>=17&&h<=20)) return 'high';
  if ((h>=12&&h<=14)||(h>=6&&h<=22)) return 'medium';
  return 'low';
}
function getSurgeMultiplier(h: number): number {
  for (const s of SURGE_HOURS) if (h>=s.start&&h<s.end) return s.multiplier;
  return 1.0;
}
function corsOk(): Response {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' } });
}
function jsonOk(d: unknown): Response {
  return new Response(JSON.stringify(d), { status:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });
}
function jsonError(m: string, s: number): Response {
  return new Response(JSON.stringify({error:true,message:m}), { status:s, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });
}
