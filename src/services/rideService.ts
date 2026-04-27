// =============================================================================
// ZENITH RIDE v3.1 — rideService.ts
//
// FIXES aplicados:
// ✅ FIX 2: driverDeclineRide usa RPC atómica (sem race condition)
// ✅ FIX 3: _fallbackFindDrivers usa Haversine para distâncias reais
// ✅ FIX 4: updateDriverLocation com throttle 3s + filtro delta H3
// ✅ FIX 5: subscribeToAvailableRides com filtro H3 opcional
//
// H3 INTEGRATION:
// ✅ H3-1: updateDriverLocation envia h3_index_res9 + h3_index_res7
// ✅ H3-2: getDriversForAuction tenta find_drivers_h3 antes de PostGIS
// ✅ H3-3: getDriversH3 — novo método público com expansão dinâmica
// =============================================================================

import { latLngToCell, gridDisk } from 'h3-js';
import { haversineMeters } from '../lib/geo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, edgeFunctionUrl } from '../lib/supabase';
import type {
  DbRide, AuctionDriver, NearbyDriver,
  PriceEstimate, AppError, LatLng,
} from '../types';
import { RideStatus } from '../types';

// ─── Resoluções H3 ──────────────────────────────────────────────────────────
// Res 9 ≈ 150 m  → matching de motoristas individuais
// Res 7 ≈ 5 km   → zonas de demanda, surge, cache
const H3_RES_DRIVER = 9;
const H3_RES_ZONE   = 7;

// ─── Geo Parser (robusto — mantido intacto) ─────────────────────────────────
export function parseSupabasePoint(val: unknown): LatLng | null {
  if (!val) return null;

  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
      return { lng: Number(obj.coordinates[0]), lat: Number(obj.coordinates[1]) };
    }
  }

  if (typeof val !== 'string') return null;

  if (val.startsWith('POINT')) {
    const match = val.match(/POINT\(([^ ]+)\s+([^ ]+)\)/);
    if (match) return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  }

  try {
    const hex     = val.replace(/\s/g, '');
    if (hex.length >= 42) {
      const hasSrid = hex.length >= 50;
      const xOffset = hasSrid ? 18 : 10;
      const lngBytes = new Uint8Array(8);
      for (let i = 0; i < 8; i++) lngBytes[i] = parseInt(hex.slice(xOffset + i * 2, xOffset + i * 2 + 2), 16);
      const lng = new DataView(lngBytes.buffer).getFloat64(0, true);
      const latBytes = new Uint8Array(8);
      for (let i = 0; i < 8; i++) latBytes[i] = parseInt(hex.slice(xOffset + 16 + i * 2, xOffset + 16 + i * 2 + 2), 16);
      const lat = new DataView(latBytes.buffer).getFloat64(0, true);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  } catch (e) {
    console.warn('[rideService.parseSupabasePoint] WKB parse error:', e);
  }

  return null;
}

// haversineMeters importada de '../lib/geo' — eliminada duplicação

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface CreateRideInput {
  passenger_id:        string;
  origin_address:      string;
  origin_lat:          number;
  origin_lng:          number;
  dest_address:        string;
  dest_lat:            number;
  dest_lng:            number;
  selected_driver_id?: string;
  proposed_price?:     number;
  distance_km?:        number;
  duration_min?:       number;
  vehicle_type?:       'standard' | 'moto' | 'comfort' | 'xl';
  traffic_factor?:     number;
}

interface RideUpdateResult { data: DbRide | null; error: AppError | null; }

// ─── Rate limiter (por userId, 5 req / 60s) ──────────────────────────────────
const rideRateTracker = new Map<string, number[]>();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkRideRateLimit(userId: string): boolean {
  const now        = Date.now();
  const timestamps = (rideRateTracker.get(userId) ?? []).filter(ts => now - ts < 60_000);
  if (timestamps.length >= 5) return false;
  rideRateTracker.set(userId, [...timestamps, now]);
  return true;
}

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function isEliteDriver(level: string | undefined, zenithScore: number): boolean {
  return level === 'Diamante' && zenithScore >= 800;
}

// ─── Classe Principal ────────────────────────────────────────────────────────
class RideService {
  private rideChannel:       RealtimeChannel | null = null;
  private availableChannel:  RealtimeChannel | null = null;
  private assignmentChannel: RealtimeChannel | null = null;
  private locationChannel:   RealtimeChannel | null = null;

  // FIX 4: Throttle de GPS — evita flood ao Supabase
  // Chave: driverId → { lastSentAt, lastH3 }
  private locationThrottle = new Map<string, {
    lastSentAt: number;
    lastH3:     string;
    lastLat:    number;
    lastLng:    number;
  }>();
  private readonly GPS_THROTTLE_MS   = 3_000; // 3 segundos mínimo entre updates
  private readonly GPS_MIN_DELTA_M   = 15;    // só envia se andou > 15m (evita drift)

  // ── H3: getDriversH3 (método principal com expansão dinâmica) ────────────
  // Usa h3-js no cliente para calcular os hexágonos de vizinhança e passa
  // a lista ao RPC find_drivers_h3 — query de índice puro, sem PostGIS scan.
  //
  // k=2 ≈ 19 hexs ≈ 600m  → primeira tentativa (zona densa tipo Ingombota)
  // k=4 ≈ 61 hexs ≈ 1.2km → segunda tentativa
  // k=7 ≈ 127 hexs ≈ 2km  → última tentativa (zona periférica tipo Viana)
  async getDriversH3(pickupCoords: LatLng): Promise<AuctionDriver[]> {
    const centerHex = latLngToCell(pickupCoords.lat, pickupCoords.lng, H3_RES_DRIVER);
    const expansions = [2, 4, 7];

    for (const k of expansions) {
      try {
        const hexes = gridDisk(centerHex, k);

        const { data, error } = await supabase.rpc('find_drivers_h3', {
          p_h3_indexes: hexes,
          p_limit: 8,
        });

        if (error) {
          console.warn(`[rideService.getDriversH3] RPC error (k=${k}):`, error.message);
          continue;
        }

        if (!data || (data as unknown[]).length === 0) {
          console.log(`[rideService.getDriversH3] 0 motoristas em k=${k} — expandindo`);
          continue;
        }

        const rows = data as Array<{
          driver_id: string; driver_name: string; rating: number;
          distance_m: number; avatar_url?: string | null;
          total_rides?: number; level?: string; heading?: number | null;
          zenith_score?: number;
          motogo_score?: number;
        }>;

        const scored = rows.map(row => {
          const rating      = typeof row.rating === 'number' ? row.rating : 5.0;
          const distScore   = row.distance_m * 0.48;
          const ratingScore = (5 - rating) * 500 * 0.24;
          const zenithScore = row.zenith_score ?? row.motogo_score ?? 500;
          const zenithPenalty = (1000 - zenithScore) * 0.08;
          const elite = isEliteDriver(row.level, zenithScore);
          return {
            driver_id:    row.driver_id,
            driver_name:  row.driver_name,
            avatar_url:   row.avatar_url ?? null,
            rating,
            total_rides:  row.total_rides ?? 0,
            level:        (row.level ?? 'Novato') as AuctionDriver['level'],
            distance_m:   row.distance_m,
            eta_min:      Math.ceil(row.distance_m / 400),
            heading:      row.heading ?? null,
            zenith_score: zenithScore,
            is_elite:     elite,
            _score:       distScore + ratingScore + zenithPenalty + (elite ? -90 : 0),
          };
        });

        scored.sort((a, b) => a._score - b._score);
        const drivers: AuctionDriver[] = scored.map(({ _score: _, ...d }) => d);

        console.log(`[rideService.getDriversH3] ${drivers.length} motoristas em k=${k}`);
        return drivers;

      } catch (err) {
        console.error(`[rideService.getDriversH3] Excepção k=${k}:`, err);
      }
    }

    // H3 não encontrou nada → fallback PostGIS
    console.warn('[rideService.getDriversH3] Sem resultado H3, usando PostGIS fallback');
    return this.getDriversForAuction(pickupCoords, 7);
  }

  // ── getDriversForAuction — tenta H3 primeiro, depois PostGIS ─────────────
  async getDriversForAuction(pickupCoords: LatLng, radiusKm = 7.0): Promise<AuctionDriver[]> {
    // Tentar H3 primeiro (só se radiusKm for o default — chamada directa)
    if (radiusKm === 7.0) {
      try {
        const h3Drivers = await this.getDriversH3(pickupCoords);
        if (h3Drivers.length > 0) return h3Drivers;
      } catch (e) {
        console.warn('[rideService.getDriversForAuction] H3 falhou, usando PostGIS:', e);
      }
    }

    // PostGIS fallback com expansão de raio
    const radiiToTry = radiusKm !== 7.0 ? [radiusKm] : [5, 7, 12];

    for (const radius of radiiToTry) {
      try {
        const { data, error } = await supabase.rpc('find_drivers_for_auction', {
          p_lat:       pickupCoords.lat,
          p_lng:       pickupCoords.lng,
          p_radius_km: radius,
          p_limit:     8,
        });

        if (error) {
          console.error('[rideService.getDriversForAuction] RPC error:', error.message);
          if (radius === radiiToTry[radiiToTry.length - 1]) return this._fallbackFindDrivers(pickupCoords);
          continue;
        }

        if (!data || (data as unknown[]).length === 0) {
          if (radius === radiiToTry[radiiToTry.length - 1]) break;
          continue;
        }

        const rawDrivers = data as Array<{
          driver_id: string; driver_name: string; rating: number; distance_m: number;
          avatar_url?: string | null; total_rides?: number; level?: string;
          eta_min?: number; heading?: number | null; zenith_score?: number; motogo_score?: number;
        }>;

        const scored = rawDrivers.map(row => {
          const rating      = typeof row.rating === 'number' ? row.rating : 5.0;
          const distScore   = row.distance_m * 0.48;
          const ratingScore = (5 - rating) * 500 * 0.24;
          const zenithScore = row.zenith_score ?? row.motogo_score ?? 500;
          const zenithPenalty = (1000 - zenithScore) * 0.08;
          const elite = isEliteDriver(row.level, zenithScore);
          return {
            driver_id:    row.driver_id,
            driver_name:  row.driver_name,
            avatar_url:   row.avatar_url ?? null,
            rating,
            total_rides:  row.total_rides ?? 0,
            level:        (row.level ?? 'Novato') as AuctionDriver['level'],
            distance_m:   row.distance_m,
            eta_min:      row.eta_min ?? Math.ceil(row.distance_m / 400),
            heading:      row.heading ?? null,
            zenith_score: zenithScore,
            is_elite:     elite,
            _score:       distScore + ratingScore + zenithPenalty + (elite ? -90 : 0),
          };
        });

        scored.sort((a, b) => a._score - b._score);
        const drivers: AuctionDriver[] = scored.map(({ _score: _, ...d }) => d);
        console.log(`[rideService.getDriversForAuction] ${drivers.length} motoristas em ${radius}km`);
        return drivers;

      } catch (err) {
        console.error(`[rideService.getDriversForAuction] Excepção raio ${radius}:`, err);
        if (radius === radiiToTry[radiiToTry.length - 1]) return [];
      }
    }

    return this._fallbackFindDrivers(pickupCoords);
  }

  // ── FIX 3: _fallbackFindDrivers com Haversine (distâncias reais) ──────────
  private async _fallbackFindDrivers(pickupCoords: LatLng): Promise<AuctionDriver[]> {
    try {
      const { data: locations } = await supabase
        .from('driver_locations')
        .select('driver_id, heading, status, location, updated_at')
        .eq('status', 'available')
        .order('updated_at', { ascending: false })
        .limit(50);

      if (!locations || locations.length === 0) return [];

      const driverIds = locations.map((d: { driver_id: string }) => d.driver_id);
      const { data: activeRides } = await supabase
        .from('rides')
        .select('driver_id')
        .in('driver_id', driverIds)
        .in('status', [RideStatus.ACCEPTED, RideStatus.PICKING_UP, RideStatus.IN_PROGRESS]);

      const busyDriverIds = new Set(
        (activeRides ?? [])
          .map((ride: { driver_id: string | null }) => ride.driver_id)
          .filter((driverId): driverId is string => !!driverId),
      );

      const availableLocations = locations.filter(
        (loc: { driver_id: string }) => !busyDriverIds.has(loc.driver_id),
      );
      if (availableLocations.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name, avatar_url, rating, total_rides, level')
        .in('user_id', availableLocations.map((d: { driver_id: string }) => d.driver_id));

      return (profiles ?? []).map((p: {
        user_id: string; name: string; avatar_url: string | null;
        rating: number; total_rides: number; level: string;
      }) => {
        const loc = availableLocations.find((l: { driver_id: string }) => l.driver_id === p.user_id);

        // FIX 3: calcular distância real se tiver coordenadas
        let distance_m = 3000; // fallback quando sem coords
        if (loc?.location) {
          const coords = parseSupabasePoint(loc.location);
          if (coords) distance_m = haversineMeters(pickupCoords.lat, pickupCoords.lng, coords.lat, coords.lng);
        }

        return {
          driver_id:    p.user_id,
          driver_name:  p.name,
          avatar_url:   p.avatar_url,
          rating:       p.rating ?? 5,
          total_rides:  p.total_rides ?? 0,
          level:        (p.level ?? 'Novato') as AuctionDriver['level'],
          distance_m:   Math.round(distance_m),
          eta_min:      Math.ceil(distance_m / 400),
          heading:      loc?.heading ?? null,
          zenith_score: 500,
          is_elite:     false,
        };
      }).sort((a, b) => a.distance_m - b.distance_m);

    } catch (err) {
      console.warn('[rideService._fallbackFindDrivers] Falha total no fallback:', err);
      return [];
    }
  }

  // ── createRide ─────────────────────────────────────────────────────────────
  async createRide(input: CreateRideInput): Promise<RideUpdateResult> {
    if (!checkRideRateLimit(input.passenger_id)) {
      return { data: null, error: { code: 'rate_limit', message: 'Demasiados pedidos de corrida. Aguarda 1 minuto.' } };
    }
    if (!input.passenger_id) return { data: null, error: { code: 'validation', message: 'ID de passageiro em falta.' } };
    if (!input.origin_address || !input.dest_address) return { data: null, error: { code: 'validation', message: 'Origem ou destino em falta.' } };
    if (input.origin_lat == null || input.origin_lng == null || input.dest_lat == null || input.dest_lng == null) {
      return { data: null, error: { code: 'validation', message: 'Coordenadas inválidas.' } };
    }
    if (input.selected_driver_id && !isUuid(input.selected_driver_id)) {
      return { data: null, error: { code: 'validation', message: 'ID de motorista inválido.' } };
    }

    try {
      // v3.5 PERFORMANCE FIX: Se o frontend já calculou distância/duração/preço,
      // usa-os directamente em vez de chamar a Edge Function (que demora 5-8s).
      // O preço já foi validado pelo RPC calculate_fare_engine_pro no PassengerHome.
      let distance_km  = input.distance_km;
      let duration_min = input.duration_min;
      let price_kz     = input.proposed_price;
      let surge        = 1.0;

      if (!distance_km || !price_kz) {
        // Fallback local ultra-rápido (Haversine) — sem rede
        const fallback = this._localPriceEstimate(
          { lat: input.origin_lat, lng: input.origin_lng },
          { lat: input.dest_lat,   lng: input.dest_lng }
        );
        distance_km  = distance_km  ?? fallback.distance_km;
        duration_min = duration_min ?? fallback.duration_min;
        price_kz     = price_kz     ?? fallback.price_kz;
        surge        = fallback.surge_multiplier;
      }

      if (input.selected_driver_id) {
        const { data, error } = await supabase.rpc('create_selected_ride_atomic', {
          p_passenger_id: input.passenger_id,
          p_driver_id: input.selected_driver_id,
          p_origin_address: input.origin_address,
          p_origin_lat: input.origin_lat,
          p_origin_lng: input.origin_lng,
          p_dest_address: input.dest_address,
          p_dest_lat: input.dest_lat,
          p_dest_lng: input.dest_lng,
          p_distance_km: distance_km,
          p_duration_min: duration_min,
          p_surge_multiplier: surge,
          p_price_kz: price_kz,
          p_vehicle_type: input.vehicle_type ?? 'standard',
          p_traffic_factor: input.traffic_factor ?? 1.0,
        });

        if (error || !data) {
          console.error('[rideService.createRide:selected_driver]', error);
          const reason = error?.message?.trim?.() ?? '';
          const messageByReason: Record<string, string> = {
            driver_not_available: 'O motorista escolhido já não está disponível.',
            driver_active_ride: 'O motorista escolhido ficou ocupado noutra corrida.',
            not_allowed: 'Sessão inválida para criar a corrida.',
          };
          return {
            data: null,
            error: {
              code: error?.code ?? 'selected_driver_create_failed',
              message: messageByReason[reason] ?? 'Não foi possível reservar o motorista escolhido.',
            },
          };
        }

        console.log('[rideService.createRide] Corrida criada atomicamente:', (data as DbRide).id);
        return { data: data as DbRide, error: null };
      }

      const { data, error } = await supabase.from('rides').insert({
        passenger_id:     input.passenger_id,
        origin_address:   input.origin_address,
        origin_lat:       input.origin_lat,
        origin_lng:       input.origin_lng,
        dest_address:     input.dest_address,
        dest_lat:         input.dest_lat,
        dest_lng:         input.dest_lng,
        distance_km,
        duration_min,
        surge_multiplier: surge,
        price_kz,
        driver_id:        null,
        status:           RideStatus.SEARCHING,
        accepted_at:      null,
        driver_confirmed: false,
        vehicle_type:     input.vehicle_type ?? 'standard',
        traffic_factor:   input.traffic_factor ?? 1.0,
      }).select().single();

      if (error) {
        console.error('[rideService.createRide]', error);
        return { data: null, error: { code: error.code, message: 'Não foi possível criar a corrida.' } };
      }

      console.log('[rideService.createRide] Corrida criada:', (data as DbRide).id);
      void this.triggerDriverWhatsAppFallback((data as DbRide).id);
      return { data: data as DbRide, error: null };
    } catch (err) {
      console.error('[rideService.createRide] Excepção:', err);
      return { data: null, error: { code: 'unknown', message: 'Erro inesperado ao criar corrida.' } };
    }
  }

  private async triggerDriverWhatsAppFallback(rideId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const response = await fetch(edgeFunctionUrl('whatsapp-webhook'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'driver_fallback_for_ride',
          ride_id: rideId,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn('[rideService.triggerDriverWhatsAppFallback] Falhou:', response.status, body);
      }
    } catch (error) {
      console.warn('[rideService.triggerDriverWhatsAppFallback] Excepção:', error);
    }
  }

  // ── driverConfirmRide ──────────────────────────────────────────────────────
  private async notifyPassengerRideAccepted(rideId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        return;
      }

      const response = await fetch(edgeFunctionUrl('whatsapp-webhook'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'passenger_ride_accepted',
          ride_id: rideId,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.warn('[rideService.notifyPassengerRideAccepted] Falhou:', response.status, body);
      }
    } catch (error) {
      console.warn('[rideService.notifyPassengerRideAccepted] Excepcao:', error);
    }
  }

  async driverConfirmRide(rideId: string, driverId: string): Promise<RideUpdateResult> {
    try {
      const { data, error } = await supabase.from('rides')
        .update({
          driver_confirmed: true,
          status:    RideStatus.PICKING_UP,
          pickup_at: new Date().toISOString(),
        })
        .eq('id', rideId)
        .eq('driver_id', driverId)
        .eq('driver_confirmed', false)
        .select().single();

      if (error) return { data: null, error: { code: error.code, message: 'Erro ao confirmar corrida.' } };
      return { data: data as DbRide, error: null };
    } catch {
      return { data: null, error: { code: 'unknown', message: 'Erro ao confirmar.' } };
    }
  }

  // ── FIX 2: driverDeclineRide — RPC atómica (sem race condition) ────────────
  // Antes: UPDATE directo sem verificar se outro driver já aceitou entretanto.
  // Agora: RPC decline_ride_atomic com FOR UPDATE NOWAIT.
  async driverDeclineRide(rideId: string, driverId: string): Promise<AppError | null> {
    try {
      const { data, error } = await supabase.rpc('decline_ride_atomic', {
        p_ride_id:   rideId,
        p_driver_id: driverId,
      });

      if (error) {
        console.error('[rideService.driverDeclineRide] RPC error:', error.message);
        return { code: error.code, message: 'Erro ao recusar corrida.' };
      }

      const result = data as { success: boolean; reason?: string } | null;
      if (!result?.success) {
        const reason = result?.reason ?? 'unknown';
        const msgs: Record<string, string> = {
          not_your_ride:      'Esta corrida não te está atribuída.',
          ride_not_declinable: 'A corrida já não pode ser recusada neste estado.',
          concurrent_update:  'Conflito de actualização — tenta de novo.',
        };
        return { code: reason, message: msgs[reason] ?? 'Não foi possível recusar.' };
      }

      return null;
    } catch (err) {
      console.error('[rideService.driverDeclineRide] Excepção:', err);
      return { code: 'unknown', message: 'Erro ao recusar corrida.' };
    }
  }

  // ── acceptRide (atómico — mantido) ────────────────────────────────────────
  async acceptRide(rideId: string, driverId: string): Promise<RideUpdateResult> {
    try {
      const { data, error } = await supabase.rpc('accept_ride_atomic', {
        p_ride_id:   rideId,
        p_driver_id: driverId,
      });

      if (error) {
        console.error(`[SUPER DEBUG SUPABASE] Erro RPC: ${error.message} (Code: ${error.code})`);
        return { data: null, error: { code: error.code, message: `Erro DB: ${error.message}` } };
      }

      if (!data || !data.success) {
        const reason = data?.reason ?? 'unknown';
        const messages: Record<string, string> = {
          ride_not_found:       'Corrida não encontrada',
          ride_not_searching:   'Esta corrida já foi aceite',
          already_accepted:     'Corrida já aceite',
          driver_not_available: 'O teu estado não permite aceitar corridas agora',
          race_condition_lost:  'Outro motorista aceitou primeiro. Tenta outra corrida!',
        };
        return { data: null, error: { code: reason, message: messages[reason] ?? 'Não foi possível aceitar a corrida' } };
      }

      // CORRIDA ACEITE ATOMICAMENTE! Agora atualizar no frontend.
      let rideData: DbRide | null = null;
      let rideError: { code?: string; message?: string } | null = null;
      // Retentar a leitura da corrida até 3 vezes (delay para eventuais réplicas)
      for (let i = 0; i < 3; i++) {
        const res = await supabase.from('rides')
          .select('*').eq('id', rideId).eq('status', RideStatus.ACCEPTED).single();
        if (!res.error && res.data) {
          rideData = res.data;
          rideError = null;
          break;
        }
        rideError = res.error;
        await new Promise(r => setTimeout(r, 500));
      }

      if (rideError || !rideData) return { data: null, error: { code: rideError?.code || 'read_fail', message: 'Corrida aceite, mas erro ao ler dados.' } };
      void this.notifyPassengerRideAccepted(rideId);
      return { data: rideData as DbRide, error: null };
    } catch (err) {
      console.error('[rideService.acceptRide] Excepção:', err);
      return { data: null, error: { code: 'unknown', message: 'Erro crítico ao aceitar corrida.' } };
    }
  }

  // ── updateRideStatus ───────────────────────────────────────────────────────
  async updateRideStatus(rideId: string, status: RideStatus, actorId: string): Promise<RideUpdateResult> {
    const driverOnlyStates = [RideStatus.PICKING_UP, RideStatus.IN_PROGRESS, RideStatus.COMPLETED];
    const tsField: Partial<Record<RideStatus, string>> = {
      [RideStatus.PICKING_UP]:  'pickup_at',
      [RideStatus.IN_PROGRESS]: 'started_at',
      [RideStatus.COMPLETED]:   'completed_at',
      [RideStatus.CANCELLED]:   'cancelled_at',
    };

    const payload: Record<string, unknown> = { status };
    const f = tsField[status];
    if (f) payload[f] = new Date().toISOString();

    try {
      if (!isUuid(actorId)) {
        return { data: null, error: { code: 'invalid_actor', message: 'Sessão inválida para actualizar a corrida.' } };
      }

      let query = supabase.from('rides').update(payload).eq('id', rideId);
      if (driverOnlyStates.includes(status)) {
        query = query.eq('driver_id', actorId);
      } else {
        query = query.or(`driver_id.eq.${actorId},passenger_id.eq.${actorId}`);
      }

      const { data, error } = await query.select().single();
      if (error) return { data: null, error: { code: error.code, message: 'Erro ao actualizar estado da corrida.' } };

      const updatedRide = data as DbRide;

      if (status === RideStatus.IN_PROGRESS && updatedRide.driver_id) {
        await supabase.from('driver_locations')
          .update({
            status: 'busy',
            online_minutes_idle: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('driver_id', updatedRide.driver_id);

        if (updatedRide.passenger_id === actorId) {
          try {
            const { data: passengerProfile } = await supabase
              .from('profiles')
              .select('emergency_contact_phone')
              .eq('user_id', updatedRide.passenger_id)
              .maybeSingle();

            if (passengerProfile?.emergency_contact_phone) {
              await this.autoShareLiveTrackingOnRideStart({
                rideId: updatedRide.id,
                ownerUserId: updatedRide.passenger_id,
                emergencyPhone: passengerProfile.emergency_contact_phone,
              });
            }
          } catch (shareError) {
            console.warn('[rideService.updateRideStatus] Partilha live automatica falhou:', shareError);
          }
        }
      }

      if (status === RideStatus.COMPLETED || status === RideStatus.CANCELLED) {
        const updated = updatedRide ?? null;
        if (updated?.driver_id) {
          await supabase.from('driver_locations')
            .update({ status: 'available', online_minutes_idle: 0, updated_at: new Date().toISOString() })
            .eq('driver_id', updated.driver_id);
        }
        if (status === RideStatus.COMPLETED && updated?.passenger_id) {
          const distKm = (updated as unknown as { route_distance_km?: number }).route_distance_km ?? updated.distance_km ?? 0;
          if (distKm > 0) this._updateKmPerk(updated.passenger_id, distKm).catch(console.error);
          
          // Recarregar os 10 créditos do Kaze
          try { await supabase.rpc('recharge_chat_quota', { p_user_id: updated.passenger_id, amount: 10 }); } catch (e) { console.error('[recharge_chat_quota]', e); }
        }
      }

      return { data: updatedRide, error: null };
    } catch (err) {
      console.error('[rideService.updateRideStatus] Excepção:', err);
      return { data: null, error: { code: 'unknown', message: 'Erro ao actualizar corrida.' } };
    }
  }

  // ── Gamificação (mantida) ──────────────────────────────────────────────────
  private async _updateKmPerk(userId: string, rideDistanceKm: number) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('km_total, km_to_next_perk, free_km_available')
      .eq('user_id', userId).single();
    if (!profile) return;
    const newTotal  = (profile.km_total ?? 0)  + rideDistanceKm;
    const newToNext = (profile.km_to_next_perk ?? 70) - rideDistanceKm;
    if (newToNext <= 0) {
      await supabase.from('profiles').update({
        km_total: newTotal, km_to_next_perk: 70,
        free_km_available: (profile.free_km_available ?? 0) + 7,
      }).eq('user_id', userId);
    } else {
      await supabase.from('profiles').update({ km_total: newTotal, km_to_next_perk: newToNext }).eq('user_id', userId);
    }
  }

  // ── cancelRide ─────────────────────────────────────────────────────────────
  async ensureRideTrackingShare(
    rideId: string,
    ownerUserId: string,
    baseUrl?: string,
  ): Promise<{ publicToken: string; shareLink: string } | null> {
    try {
      const { data: existing } = await supabase
        .from('ride_tracking_shares')
        .select('public_token, expires_at')
        .eq('ride_id', rideId)
        .eq('owner_user_id', ownerUserId)
        .eq('status', 'active')
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      const origin = baseUrl ?? window.location.origin;
      const existingToken = existing?.[0]?.public_token;

      if (existingToken) {
        return {
          publicToken: existingToken,
          shareLink: `${origin}/track/${existingToken}`,
        };
      }

      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('ride_tracking_shares')
        .insert({
          ride_id: rideId,
          owner_user_id: ownerUserId,
          status: 'active',
          expires_at: expiresAt,
        })
        .select('public_token')
        .single();

      if (error || !data?.public_token) {
        throw error ?? new Error('Falha ao gerar token publico.');
      }

      return {
        publicToken: data.public_token,
        shareLink: `${origin}/track/${data.public_token}`,
      };
    } catch (error) {
      console.warn('[rideService.ensureRideTrackingShare] Falha:', error);
      return null;
    }
  }

  async autoShareLiveTrackingOnRideStart(params: {
    rideId: string;
    ownerUserId: string;
    emergencyPhone: string;
    driverName?: string;
    pickup?: string;
    destination?: string;
  }): Promise<boolean> {
    const share = await this.ensureRideTrackingShare(params.rideId, params.ownerUserId);
    if (!share) {
      return false;
    }

    const digits = params.emergencyPhone.replace(/\D/g, '');
    const phone = digits.startsWith('244') ? digits : `244${digits}`;
    const driverLine = params.driverName ? `🚗 Motorista: ${params.driverName}\n` : '';
    const routeLine = params.pickup && params.destination
      ? `📍 ${params.pickup} -> ${params.destination}\n`
      : '';

    const message = encodeURIComponent(
      `🛡️ Zenith Ride - Corrida iniciada\n\n` +
      `${driverLine}${routeLine}` +
      `Segue a viagem ao vivo aqui:\n${share.shareLink}\n\n` +
      `_Link activo por 4 horas._`,
    );

    window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
    return true;
  }

  async cancelRide(rideId: string, userId: string, reason?: string): Promise<AppError | null> {
    try {
      if (!isUuid(userId)) {
        return { code: 'invalid_actor', message: 'Sessão inválida para cancelar a corrida.' };
      }
      const { data, error } = await supabase.rpc('cancel_ride_safe', {
        p_ride_id: rideId,
        p_user_id: userId,
        p_reason: reason ?? 'Cancelado pelo utilizador',
      });

      if (error) {
        console.error('[rideService.cancelRide] RPC error:', error);
        return { code: error.code ?? 'cancel_rpc_failed', message: 'Não foi possível cancelar a corrida agora.' };
      }

      const result = (data as Array<{ success: boolean; message: string }>)?.[0];
      if (result?.success) return null;
      return { code: 'cancel_denied', message: result?.message ?? 'Não foi possível cancelar.' };
    } catch (err) {
      console.error('[rideService.cancelRide] Excepção:', err);
      return { code: 'unknown', message: 'Erro ao cancelar corrida.' };
    }
  }

  // ── submitRating ───────────────────────────────────────────────────────────
  async submitRating(input: { ride_id: string; from_user: string; to_user: string; score: number; comment?: string }): Promise<AppError | null> {
    try {
      const { error } = await supabase.from('ratings').insert(input);
      if (error) return { code: error.code, message: 'Erro ao submeter avaliação.' };
      return null;
    } catch { return { code: 'unknown', message: 'Erro ao submeter avaliação.' }; }
  }

  // ── getActiveRide ──────────────────────────────────────────────────────────
  async getActiveRide(userId: string): Promise<(DbRide & { driver_name?: string; passenger_name?: string }) | null> {
    try {
      const { data, error } = await supabase.rpc('get_active_ride', { p_user_id: userId });
      if (error) { console.error('[rideService.getActiveRide]', error); return null; }
      if (!data) return null;
      return data as DbRide & { driver_name?: string; passenger_name?: string };
    } catch (err) {
      console.error('[rideService.getActiveRide] Excepção:', err);
      return null;
    }
  }

  // ── getAvailableRides ──────────────────────────────────────────────────────
  async getAvailableRides(): Promise<DbRide[]> {
    try {
      const { data, error } = await supabase.from('rides')
        .select('*').eq('status', RideStatus.SEARCHING).is('driver_id', null)
        .order('created_at', { ascending: false });
      if (error) { console.error('[rideService.getAvailableRides]', error); return []; }
      return (data ?? []) as DbRide[];
    } catch { return []; }
  }

  // ── getRideHistory ─────────────────────────────────────────────────────────
  async getRideHistory(userId: string, page = 0, pageSize = 20): Promise<{ rides: DbRide[]; total: number }> {
    try {
      if (!isUuid(userId)) return { rides: [], total: 0 };
      const from = page * pageSize;
      const { data, error, count } = await supabase.from('rides')
        .select('*', { count: 'exact' })
        .or(`passenger_id.eq.${userId},driver_id.eq.${userId}`)
        .in('status', [RideStatus.COMPLETED, RideStatus.CANCELLED])
        .order('created_at', { ascending: false }).range(from, from + pageSize - 1);
      if (error) { console.error('[rideService.getRideHistory]', error); return { rides: [], total: 0 }; }
      return { rides: (data ?? []) as DbRide[], total: count ?? 0 };
    } catch { return { rides: [], total: 0 }; }
  }

  // ── getDemandHeatmap ───────────────────────────────────────────────────────
  async getDemandHeatmap(): Promise<{ h3_index: string; demand_count: number; supply_count: number }[]> {
    try {
      const windowStart = new Date();
      windowStart.setMinutes(0, 0, 0); // Truncate to hour
      const { data, error } = await supabase
        .from('demand_heatmap')
        .select('h3_index, demand_count, supply_count')
        .gte('window_start', windowStart.toISOString());
      
      if (error) {
        console.error('[rideService.getDemandHeatmap]', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error('[rideService.getDemandHeatmap] Excepção:', err);
      return [];
    }
  }

  // =========================================================================
  // REALTIME
  // =========================================================================

  // ── subscribeToRide ────────────────────────────────────────────────────────
  subscribeToRide(rideId: string, onUpdate: (ride: DbRide) => void): () => void {
    if (this.rideChannel) { supabase.removeChannel(this.rideChannel); this.rideChannel = null; }
    this.rideChannel = supabase.channel(`ride:${rideId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, (p) => {
        // Tratar evento DELETE — corrida eliminada da BD (ex: cleanup automático)
        if (p.eventType === 'DELETE' && p.old) {
          onUpdate({ ...(p.old as DbRide), status: RideStatus.CANCELLED });
          return;
        }
        if (p.new) onUpdate(p.new as DbRide);
      })
      .subscribe();
    return () => { if (this.rideChannel) { supabase.removeChannel(this.rideChannel); this.rideChannel = null; } };
  }

  // ── FIX 5: subscribeToAvailableRides com filtro H3 opcional ──────────────
  // driverH3Cells: resultado de gridDisk(motorista_hex, k) calculado no cliente.
  // Se não for passado, comportamento anterior (sem filtro geo).
  subscribeToAvailableRides(
    onNew:  (r: DbRide) => void,
    onGone: (id: string) => void,
    driverH3Cells?: string[],
  ): () => void {
    if (this.availableChannel) { supabase.removeChannel(this.availableChannel); this.availableChannel = null; }

    // Pré-calcular Set para lookup O(1)
    const h3Set = driverH3Cells && driverH3Cells.length > 0
      ? new Set(driverH3Cells)
      : null;

    this.availableChannel = supabase.channel('available-rides-v3')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, (p) => {
        const r = p.new as DbRide;
        if (r.status !== RideStatus.SEARCHING || r.driver_id) return;

        // FIX 5: Filtro H3 — só notificar se a origem estiver na vizinhança
        if (h3Set) {
          const rideHex = latLngToCell(r.origin_lat, r.origin_lng, H3_RES_DRIVER);
          if (!h3Set.has(rideHex)) {
            console.log('[rideService.subscribeToAvailableRides] Corrida fora da zona H3 — ignorando');
            return;
          }
        }

        console.log('[rideService.subscribeToAvailableRides] Nova corrida na zona:', r.id);
        onNew(r);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (p) => {
        const r = p.new as DbRide;
        if (r.status !== RideStatus.SEARCHING || r.driver_id) onGone(r.id);
      })
      .subscribe();

    return () => { if (this.availableChannel) { supabase.removeChannel(this.availableChannel); this.availableChannel = null; } };
  }

  // ── subscribeToDriverAssignments ───────────────────────────────────────────
  subscribeToDriverAssignments(driverId: string, onAssigned: (ride: DbRide) => void): () => void {
    if (this.assignmentChannel) { supabase.removeChannel(this.assignmentChannel); this.assignmentChannel = null; }
    this.assignmentChannel = supabase.channel(`driver-assignments-v3:${driverId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverId}` }, (p) => {
        const r = p.new as DbRide;
        if (r.status === RideStatus.ACCEPTED && !r.driver_confirmed) onAssigned(r);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverId}` }, (p) => {
        const r = p.new as DbRide;
        if (r.status === RideStatus.ACCEPTED && !r.driver_confirmed) onAssigned(r);
      })
      .subscribe();
    return () => { if (this.assignmentChannel) { supabase.removeChannel(this.assignmentChannel); this.assignmentChannel = null; } };
  }

  // ── subscribeToDriverLocation ──────────────────────────────────────────────
  subscribeToDriverLocation(driverId: string, onUpdate: (coords: LatLng) => void): () => void {
    if (this.locationChannel) { supabase.removeChannel(this.locationChannel); this.locationChannel = null; }
    this.locationChannel = supabase.channel(`driver-location-v3:${driverId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        let coords: LatLng | null = null;
        if (row.location) coords = parseSupabasePoint(row.location);
        if (!coords && typeof row.lat === 'number' && typeof row.lng === 'number') {
          coords = { lat: row.lat as number, lng: row.lng as number };
        }
        if (coords) onUpdate(coords);
      })
      .subscribe();
    return () => { if (this.locationChannel) { supabase.removeChannel(this.locationChannel); this.locationChannel = null; } };
  }

  // ── FIX 4 + H3-1: updateDriverLocation com throttle e H3 index ────────────
  // Throttle duplo:
  //   a) tempo mínimo de 3 segundos entre envios
  //   b) só envia se o motorista mudou de hexágono H3 (evita updates desnecessários
  //      quando está parado ou andou < 15m)
  async updateDriverLocation(driverId: string, coords: LatLng, heading?: number): Promise<void> {
    const now      = Date.now();
    const newH3    = latLngToCell(coords.lat, coords.lng, H3_RES_DRIVER);
    const lastState = this.locationThrottle.get(driverId);

    // Verificar throttle por tempo
    if (lastState) {
      const elapsed = now - lastState.lastSentAt;
      if (elapsed < this.GPS_THROTTLE_MS) return; // Ainda não passaram 3s
    }

    if (lastState) {
      const hexChanged = newH3 !== lastState.lastH3;
      const distMoved = haversineMeters(
        lastState.lastLat, lastState.lastLng,
        coords.lat, coords.lng
      );
      
      // Threshold 20m: ignora GPS drift dentro do mesmo hex
      if (!hexChanged && distMoved < 20 && (now - lastState.lastSentAt) < this.GPS_THROTTLE_MS * 3) {
        return;
      }
    }

    // Actualizar throttle state
    this.locationThrottle.set(driverId, {
      lastSentAt: now,
      lastH3:     newH3,
      lastLat:    coords.lat,
      lastLng:    coords.lng,
    });

    const h3_res7 = latLngToCell(coords.lat, coords.lng, H3_RES_ZONE);

    const payload = {
      location:         `POINT(${coords.lng} ${coords.lat})`,
      h3_index_res9:    newH3,    // H3-1: índice para matching rápido
      h3_index_res7:    h3_res7,  // H3-1: índice para zonas de demanda
      heading:          heading ?? null,
      updated_at:       new Date().toISOString(),
    };

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data, error } = await supabase
          .from('driver_locations').update(payload).eq('driver_id', driverId).select('driver_id');

        if (error) {
          console.warn(`[rideService.updateDriverLocation] Tentativa ${attempt + 1} falhou:`, error.message);
          if (attempt === MAX_RETRIES) return;
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        if (!data || (Array.isArray(data) && data.length === 0)) {
          const { error: insErr } = await supabase.from('driver_locations').insert({
            driver_id: driverId, ...payload, status: 'available',
          });
          if (insErr) console.warn('[rideService.updateDriverLocation] Insert falhou:', insErr.message);
        }

        return;
      } catch (err) {
        console.warn(`[rideService.updateDriverLocation] Excepção tentativa ${attempt + 1}:`, err);
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  // ── setDriverStatus ────────────────────────────────────────────────────────
  async setDriverStatus(
    driverId: string,
    status: 'available' | 'offline' | 'busy' | 'on_trip',
    coords?: { lat: number; lng: number }
  ): Promise<boolean> {
    const updateData: Record<string, unknown> = {
      driver_id: driverId, status, updated_at: new Date().toISOString(),
    };
    if (coords != null && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
      updateData.location = `POINT(${coords.lng} ${coords.lat})`;
      updateData.h3_index_res9 = latLngToCell(coords.lat, coords.lng, H3_RES_DRIVER);
      updateData.h3_index_res7 = latLngToCell(coords.lat, coords.lng, H3_RES_ZONE);
    }
    const { error } = await supabase.from('driver_locations').upsert(updateData, { onConflict: 'driver_id' });
    if (error) {
      console.error('[rideService.setDriverStatus]', error);
      return false;
    }
    return true;
  }

  // ── findNearbyDrivers (mantida para compatibilidade) ───────────────────────
  async findNearbyDrivers(coords: LatLng, radiusKm = 5): Promise<NearbyDriver[]> {
    try {
      const { data, error } = await supabase.rpc('find_nearby_drivers', {
        p_lat: coords.lat, p_lng: coords.lng, p_radius_km: radiusKm, p_limit: 10,
      });
      if (error) { console.error('[rideService.findNearbyDrivers]', error); return []; }
      return (data ?? []) as NearbyDriver[];
    } catch { return []; }
  }

  // ── getPriceEstimate ───────────────────────────────────────────────────────
  async getPriceEstimate(origin: LatLng, dest: LatLng): Promise<PriceEstimate | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(edgeFunctionUrl('calculate-price'), {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ origin, dest }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return this._localPriceEstimate(origin, dest);
      return res.json();
    } catch {
      return this._localPriceEstimate(origin, dest);
    }
  }

  private _localPriceEstimate(origin: LatLng, dest: LatLng): PriceEstimate {
    const distanceKm  = Math.max(0.5, haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng) / 1000);
    const durationMin = Math.ceil((distanceKm / 25) * 60);
    const base_kz     = 150;
    const per_km_kz   = Math.ceil(distanceKm * 200);
    const total_kz    = Math.ceil(base_kz + per_km_kz);
    return {
      price_kz: total_kz, distance_km: Math.round(distanceKm * 10) / 10,
      duration_min: durationMin, surge_multiplier: 1.0, traffic_level: 'low',
      breakdown: { base_kz, per_km_kz, surge_kz: 0, total_kz },
    };
  }

  // ── Geocoding cache ────────────────────────────────────────────────────────
  async getCachedGeocode(query: string): Promise<LatLng | null> {
    try {
      const { data } = await supabase.from('geocoding_cache')
        .select('lat, lng').eq('query_text', query.toLowerCase().trim()).single();
      if (!data) return null;
      supabase.rpc('increment_geocode_hit', { q: query.toLowerCase().trim() }).then(() => {});
      return { lat: data.lat, lng: data.lng };
    } catch { return null; }
  }

  async cacheGeocode(query: string, coords: LatLng, fullAddress?: string): Promise<void> {
    try {
      await supabase.from('geocoding_cache').upsert({
        query_text: query.toLowerCase().trim(), lat: coords.lat, lng: coords.lng,
        full_address: fullAddress ?? null, source: 'google',
      });
    } catch { /* não crítico */ }
  }

  async initiateTopUp(amountKz: number, phone: string): Promise<{ success: boolean; message: string; reference?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(edgeFunctionUrl('multicaixa-pay'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'initiate_payment', amount_kz: amountKz, phone_number: phone }),
      });
      return res.json();
    } catch { return { success: false, message: 'Erro de rede.' }; }
  }
}

export const rideService = new RideService();

// ── Route deviation detection (mantida) ───────────────────────────────────────
export async function checkRouteDeviation(
  rideId: string, currentCoords: LatLng, destCoords: LatLng, maxDeviationKm = 2
): Promise<{ deviated: boolean; deviationKm: number }> {
  const deviationKm = haversineMeters(currentCoords.lat, currentCoords.lng, destCoords.lat, destCoords.lng) / 1000;
  if (deviationKm > maxDeviationKm) {
    try {
      await supabase.from('route_deviation_alerts').insert({
        ride_id: rideId, deviation_km: deviationKm,
        lat: currentCoords.lat, lng: currentCoords.lng,
        alerted_at: new Date().toISOString(),
      });
    } catch { /* não bloquear corrida */ }
  }
  return { deviated: deviationKm > maxDeviationKm, deviationKm };
}
