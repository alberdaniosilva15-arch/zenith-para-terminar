// =============================================================================
// MOTOGO AI v2.0 — Edge Function: match-driver
// Ficheiro: supabase/functions/match-driver/index.ts
//
// Algoritmo de matching motorista/passageiro:
// Score = (distância * 0.7) + ((5 - rating) * 500 * 0.3)
// Favorece motoristas próximos E com bom rating
// Usa função PostGIS do schema (find_nearby_drivers)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN    = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' },
    });
  }

  try {
    // Autenticação do passageiro
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Não autenticado.', 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return jsonError('Token inválido.', 401);

    // ── Rate limiting simples por user_id ──────────────────────────────────────
    const supabaseRateLimit = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const rlWindow = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();

    const { data: rlRow } = await supabaseRateLimit
      .from('ai_usage_logs')
      .select('request_count')
      .eq('user_id', user.id)
      .eq('action', 'match_driver')
      .gte('created_at', rlWindow)
      .maybeSingle();

    if (rlRow && rlRow.request_count >= 10) {
      return jsonError('Demasiados pedidos de matching. Aguarda 1 minuto.', 429);
    }

    supabaseRateLimit.from('ai_usage_logs').insert({
      user_id: user.id,
      action: 'match_driver',
      tokens_used: 0,
    }).then(() => {}).catch(() => {});
    // ── Fim rate limiting ───────────────────────────────────────────────────────

    const { ride_id } = await req.json() as { ride_id: string };
    if (!ride_id) return jsonError('ride_id em falta.', 400);

    // Usar service role para ler dados sem RLS (matching é operação de sistema)
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ------------------------------------------------------------------
    // 1. Buscar a corrida
    // ------------------------------------------------------------------
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from('rides')
      .select('*')
      .eq('id', ride_id)
      .eq('passenger_id', user.id)
      .eq('status', 'searching')
      .single();

    if (rideErr || !ride) {
      return jsonError('Corrida não encontrada ou já aceite.', 404);
    }

    // ------------------------------------------------------------------
    // 2. Encontrar motoristas próximos via PostGIS
    // ------------------------------------------------------------------
    const { data: drivers, error: driversErr } = await supabaseAdmin.rpc(
      'find_nearby_drivers',
      {
        p_lat:       ride.origin_lat,
        p_lng:       ride.origin_lng,
        p_radius_km: 8.0,   // raio de 8km — adequado para Luanda
        p_limit:     5,
      }
    );

    if (driversErr) {
      console.error('[match-driver] Erro ao buscar motoristas:', driversErr);
      return jsonError('Erro ao procurar motoristas.', 500);
    }

    if (!drivers || drivers.length === 0) {
      return jsonOk({
        matched:  false,
        message:  'Nenhum motorista disponível na tua zona. Tenta em breve.',
        drivers:  [],
      });
    }

    // ------------------------------------------------------------------
    // 3. Retornar lista de motoristas (o passageiro pode ver quem está próximo)
    // A aceitação real é feita pelo motorista (acceptRide no rideService)
    // ------------------------------------------------------------------
    const matchedDrivers = drivers.map((d: {
      driver_id: string;
      driver_name: string;
      rating: number;
      distance_m: number;
      heading: number | null;
    }) => ({
      driver_id:    d.driver_id,
      driver_name:  d.driver_name,
      rating:       d.rating,
      distance_m:   Math.round(d.distance_m),
      eta_min:      Math.round(d.distance_m / 1000 / 25 * 60),  // ~25km/h média Luanda
    }));

    // ------------------------------------------------------------------
    // 4. Opcional: notificar motoristas automaticamente via broadcast Supabase
    // Use o `supabaseAdmin` já existente (service role) em vez de criar
    // um novo cliente. Note que broadcasts não garantem entrega sem
    // subscrições ativas no cliente — o frontend deve verificar subscrição.
    // Enviar em paralelo e registar falhas para análise.
    await Promise.all(matchedDrivers.slice(0, 3).map(async (driver) => {
      try {
        await supabaseAdmin
          .channel(`driver:${driver.driver_id}`)
          .send({
            type:    'broadcast',
            event:   'new_ride_nearby',
            payload: {
              ride_id:        ride.id,
              origin_address: ride.origin_address,
              dest_address:   ride.dest_address,
              price_kz:       ride.price_kz,
              distance_km:    ride.distance_km,
            },
          });
      } catch (sendErr) {
        console.warn(`[match-driver] broadcast falhou para ${driver.driver_id}:`, sendErr);
      }
    }));

    return jsonOk({
      matched: true,
      count:   matchedDrivers.length,
      drivers: matchedDrivers,
    });

  } catch (err) {
    console.error('[match-driver] Erro inesperado:', err);
    return jsonError('Erro interno.', 500);
  }
});

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: true, message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' },
  });
}
