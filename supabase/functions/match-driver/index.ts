// =============================================================================
// ZENITH RIDE v3.1 — Edge Function: match-driver
//
// H3: usa latLngToCell + gridDisk (h3-js via esm.sh) para substituir
//     find_nearby_drivers (PostGIS ST_DWithin) por find_drivers_h3 (índice).
//
// DISPATCH: insere notificação com notif_status='pending' + expires_at=+15s
//           para o job pg_cron processar timeouts.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { latLngToCell, gridDisk } from 'https://esm.sh/h3-js@4';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN    = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

// Resoluções H3 (devem ser idênticas às do frontend)
const H3_RES_DRIVER = 9; // ~150m
const H3_RES_ZONE   = 7; // ~5km

// Zenith Ride - Configurações
const LUANDA_SPEED_M_PER_MIN = 250;  // 15 km/h em Luanda
const DRIVER_COOLDOWN_S = 30;         // Cooldown entre notificações

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
    // ── Autenticação ────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonError('Não autenticado.', 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return jsonError('Token inválido.', 401);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── Rate limiting simples por user_id ───────────────────────────────────
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
      user_id: user.id, action: 'match_driver', tokens_used: 0,
    }).then(() => {}).catch(() => {});

    const { ride_id } = await req.json() as { ride_id: string };
    if (!ride_id) return jsonError('ride_id em falta.', 400);

    // ── Buscar a corrida ────────────────────────────────────────────────────
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

    // ── H3: calcular hexágonos de vizinhança a partir da origem ────────────
    // k=2 (~19 hexs ≈ 600m), k=4 (~61 hexs ≈ 1.2km), k=7 (~127 hexs ≈ 2km)
    const centerHex  = latLngToCell(ride.origin_lat, ride.origin_lng, H3_RES_DRIVER);
    let drivers: MatchedDriver[] = [];

    for (const k of [2, 4, 7]) {
      const hexes = gridDisk(centerHex, k);

      const { data: h3Drivers, error: h3Err } = await supabaseAdmin.rpc(
        'find_drivers_h3',
        { p_h3_indexes: hexes, p_limit: 8, p_cooldown_s: DRIVER_COOLDOWN_S }
      );

      if (h3Err) {
        console.warn(`[match-driver] find_drivers_h3 error (k=${k}):`, h3Err.message);
        continue;
      }

      if (h3Drivers && h3Drivers.length > 0) {
        drivers = (h3Drivers as RawDriver[]).map(d => ({
          driver_id:           d.driver_id,
          driver_name:         d.driver_name,
          rating:              typeof d.rating === 'number' ? d.rating : 5.0,
          distance_m:          Math.round(d.distance_m),
          eta_min:             Math.ceil(d.distance_m / LUANDA_SPEED_M_PER_MIN),
          acceptance_rate:     d.acceptance_rate     ?? 0.85,
          cancel_rate:         d.cancel_rate         ?? 0.05,
          avg_response_time_s: d.avg_response_time_s ?? 8.0,
          _score:              computeScore(d),
        }));
        console.log(`[match-driver] ${drivers.length} motoristas em k=${k}`);
        break;
      }

      console.log(`[match-driver] 0 motoristas em k=${k} — expandindo`);
    }

    // ── Fallback PostGIS se H3 não encontrou nada ──────────────────────────
    if (drivers.length === 0) {
      console.warn('[match-driver] H3 sem resultado — fallback PostGIS 7km');

      const { data: pgDrivers, error: pgErr } = await supabaseAdmin.rpc(
        'find_nearby_drivers',
        { p_lat: ride.origin_lat, p_lng: ride.origin_lng, p_radius_km: 7.0, p_limit: 8 }
      );

      if (pgErr) {
        console.error('[match-driver] PostGIS fallback error:', pgErr);
        return jsonOk({ matched: false, message: 'Nenhum motorista disponível.', drivers: [] });
      }

      if (!pgDrivers || pgDrivers.length === 0) {
        return jsonOk({ matched: false, message: 'Nenhum motorista disponível na tua zona. Tenta em breve.', drivers: [] });
      }

      drivers = (pgDrivers as RawDriver[]).map(d => ({
        driver_id:           d.driver_id,
        driver_name:         d.driver_name,
        rating:              d.rating ?? 5,
        distance_m:          Math.round(d.distance_m),
        eta_min:             Math.ceil(d.distance_m / LUANDA_SPEED_M_PER_MIN),
        acceptance_rate:     0.85,
        cancel_rate:         0.05,
        avg_response_time_s: 8.0,
        _score:              computeScore(d),
      }));
    }

    // ── Ordenar por score ───────────────────────────────────────────────────
    drivers.sort((a, b) => a._score - b._score);

    const matchedDrivers = drivers.map(d => ({
      driver_id:   d.driver_id,
      driver_name: d.driver_name,
      rating:      d.rating,
      distance_m:  d.distance_m,
      eta_min:     d.eta_min,
    }));

    // ── Notificar top-3 motoristas com notif_status e expires_at ──────────
    const notificationPayload = {
      ride_id:        ride.id,
      origin_address: ride.origin_address,
      dest_address:   ride.dest_address,
      price_kz:       ride.price_kz,
      distance_km:    ride.distance_km,
      // H3 do ponto de origem para o motorista poder visualizar no mapa
      origin_h3:      latLngToCell(ride.origin_lat, ride.origin_lng, H3_RES_ZONE),
    };

    const topDrivers = matchedDrivers.slice(0, 3);
    const expiresAt  = new Date(Date.now() + 15_000).toISOString(); // 15 segundos

    await Promise.all(topDrivers.map(async (driver, i) => {
      try {
        const { error: notifErr } = await supabaseAdmin
          .from('driver_notifications')
          .insert({
            driver_id:    driver.driver_id,
            ride_id:      ride.id,
            type:         'new_ride',
            payload:      notificationPayload,
            notif_status: 'pending',
            expires_at:   expiresAt,
            attempt_num:  i + 1,
          });

        if (notifErr) {
          // Fallback broadcast se a tabela tiver problema
          console.warn(`[match-driver] INSERT notif falhou para ${driver.driver_id}:`, notifErr.message);
          try {
            await supabaseAdmin
              .channel(`driver:${driver.driver_id}`)
              .send({ type: 'broadcast', event: 'new_ride_nearby', payload: notificationPayload });
          } catch (e) {
            console.warn(`[match-driver] broadcast fallback falhou:`, e);
          }
        } else {
          console.log(`[match-driver] Notificação persistida para driver ${driver.driver_id} (attempt ${i + 1})`);
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

// Score v2 - menor = melhor motorista
function computeScore(d: RawDriver): number {
  const rating     = d.rating              ?? 5.0;
  const acceptance = d.acceptance_rate     ?? 0.85;
  const cancel     = d.cancel_rate         ?? 0.05;
  const response   = d.avg_response_time_s ?? 8.0;

  return (d.distance_m        * 0.40)
       + ((5 - rating)        * 400  * 0.20)
       + ((1 - acceptance)    * 1000 * 0.20)
       + (cancel              * 2000 * 0.15)
       + (response            * 8    * 0.05);
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface RawDriver {
  driver_id:            string;
  driver_name:          string;
  rating:               number;
  distance_m:           number;
  heading?:             number | null;
  acceptance_rate?:     number;
  cancel_rate?:         number;
  avg_response_time_s?: number;
}

interface MatchedDriver {
  driver_id:   string;
  driver_name: string;
  rating:      number;
  distance_m:  number;
  eta_min:     number;
  _score:      number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type':               'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Vary': 'Origin',
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: true, message }), {
    status,
    headers: {
      'Content-Type':               'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Vary': 'Origin',
    },
  });
}
