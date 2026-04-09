// =============================================================================
// ZENITH RIDE v3.0 — Edge Function: match-driver
// Ficheiro: supabase/functions/match-driver/index.ts
//
// ✅ FIX: Raio uniformizado de 8km → 7km
// ✅ FIX: Substituído channel.send() (broadcast perdido) por INSERT driver_notifications
//         → resolve corridas sem motorista silenciosas quando driver está offline
// Algoritmo de matching:
//   Score = (distância * 0.5) + ((5 - rating) * 500 * 0.3) + (consistência * 0.2)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN    = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
      },
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

    // ── Rate limiting simples por user_id ─────────────────────────────────────
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const rlWindow = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();

    const { data: rlRow } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('request_count')
      .eq('user_id', user.id)
      .eq('action', 'match_driver')
      .gte('created_at', rlWindow)
      .maybeSingle();

    if (rlRow && rlRow.request_count >= 10) {
      return jsonError('Demasiados pedidos de matching. Aguarda 1 minuto.', 429);
    }

    supabaseAdmin.from('ai_usage_logs').insert({
      user_id: user.id,
      action: 'match_driver',
      tokens_used: 0,
    }).then(() => {}).catch(() => {});
    // ── Fim rate limiting ─────────────────────────────────────────────────────

    const { ride_id } = await req.json() as { ride_id: string };
    if (!ride_id) return jsonError('ride_id em falta.', 400);

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
    //    Raio: 7km (uniformizado — era 8km)
    // ------------------------------------------------------------------
    const { data: drivers, error: driversErr } = await supabaseAdmin.rpc(
      'find_nearby_drivers',
      {
        p_lat:       ride.origin_lat,
        p_lng:       ride.origin_lng,
        p_radius_km: 7.0,   // ✅ Uniformizado para 7km
        p_limit:     8,
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
    // 3. Calcular score de matching e ordenar
    //    Score = (distância_m * 0.5) + ((5-rating) * 500 * 0.3) + 20 (consistência neutra)
    //    Motoristas com menor score aparecem primeiro
    // ------------------------------------------------------------------
    type RawDriver = {
      driver_id:   string;
      driver_name: string;
      rating:      number;
      distance_m:  number;
      heading:     number | null;
    };

    const scoredDrivers = (drivers as RawDriver[])
      .map(d => ({
        ...d,
        eta_min:     Math.round(d.distance_m / 1000 / 25 * 60),
        _score:      (d.distance_m * 0.5) + ((5 - d.rating) * 500 * 0.3) + 20,
      }))
      .sort((a, b) => a._score - b._score);

    const matchedDrivers = scoredDrivers.map(d => ({
      driver_id:   d.driver_id,
      driver_name: d.driver_name,
      rating:      d.rating,
      distance_m:  Math.round(d.distance_m),
      eta_min:     d.eta_min,
    }));

    // ------------------------------------------------------------------
    // 4. ✅ CORRIGIDO: INSERT em driver_notifications em vez de broadcast
    //    O broadcast perdia-se quando o motorista estava offline.
    //    Agora persiste em BD — mesmo que o motorista reconecte mais tarde.
    // ------------------------------------------------------------------
    const notificationPayload = {
      ride_id:        ride.id,
      origin_address: ride.origin_address,
      dest_address:   ride.dest_address,
      price_kz:       ride.price_kz,
      distance_km:    ride.distance_km,
    };

    const topDrivers = matchedDrivers.slice(0, 3);

    await Promise.all(topDrivers.map(async (driver) => {
      try {
        const { error: notifErr } = await supabaseAdmin
          .from('driver_notifications')
          .insert({
            driver_id: driver.driver_id,
            ride_id:   ride.id,
            type:      'new_ride',
            payload:   notificationPayload,
          });

        if (notifErr) {
          // Se a tabela ainda não existir, tentar broadcast como fallback
          console.warn(`[match-driver] INSERT driver_notifications falhou para ${driver.driver_id}:`, notifErr.message);
          // Fallback: broadcast (pode perder-se se offline)
          try {
            await supabaseAdmin
              .channel(`driver:${driver.driver_id}`)
              .send({
                type:    'broadcast',
                event:   'new_ride_nearby',
                payload: notificationPayload,
              });
          } catch (broadcastErr) {
            console.warn(`[match-driver] broadcast fallback também falhou:`, broadcastErr);
          }
        } else {
          console.log(`[match-driver] Notificação persistida para driver ${driver.driver_id}`);
        }
      } catch (err) {
        console.warn(`[match-driver] Erro ao notificar ${driver.driver_id}:`, err);
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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Vary': 'Origin',
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: true, message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Vary': 'Origin',
    },
  });
}
