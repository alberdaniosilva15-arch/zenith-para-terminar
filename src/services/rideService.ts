// =============================================================================
// MOTOGO AI v3.0 — rideService.ts (CORRIGIDO FINAL)
// ✅ FIX 1: getDriversForAuction mapeia campos em falta com defaults
// ✅ FIX 2: updateDriverLocation não sobrescreve status do motorista
// ✅ FIX 3: geocoding cache usa supabase.rpc('increment_geocode_hit')
// ✅ FIX 4: cancelRide usa cancel_ride_safe (suporta todos os estados)
// ✅ FIX 5: subscribeToAvailableRides e subscribeToDriverAssignments usam canais separados
// ✅ FIX 6: subscribeToDriverLocation adicionado
// ✅ FIX 7: getActiveRide join a profiles para driverName/passengerName
// ✅ FIX 8: parseSupabasePoint + hexToDouble para WKB do Realtime
// =============================================================================

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, edgeFunctionUrl } from '../lib/supabase';
import type { DbRide, AuctionDriver, NearbyDriver, PriceEstimate, AppError, LatLng } from '../types';
import { RideStatus } from '../types';

function hexToDouble(hex: string): number {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new DataView(bytes.buffer).getFloat64(0, true);
}

function parseSupabasePoint(wkbHex: string | null | undefined): LatLng | null {
  if (!wkbHex || typeof wkbHex !== 'string') return null;
  try {
    const hex = wkbHex.replace(/\s/g, '');
    const hasSrid = hex.length >= 50;
    const xOffset = hasSrid ? 18 : 10;
    const lng = hexToDouble(hex.slice(xOffset, xOffset + 16));
    const lat = hexToDouble(hex.slice(xOffset + 16, xOffset + 32));
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  } catch { return null; }
}

interface CreateRideInput {
  passenger_id:    string;
  origin_address:  string; origin_lat: number; origin_lng: number;
  dest_address:    string; dest_lat:   number; dest_lng:   number;
  selected_driver_id?: string;
}
interface RideUpdateResult { data: DbRide | null; error: AppError | null; }

class RideService {
  private rideChannel:       RealtimeChannel | null = null;
  private availableChannel:  RealtimeChannel | null = null;
  private assignmentChannel: RealtimeChannel | null = null;

  async getDriversForAuction(pickupCoords: LatLng, radiusKm = 8.0): Promise<AuctionDriver[]> {
    const { data, error } = await supabase.rpc('find_drivers_for_auction', {
      p_lat: pickupCoords.lat, p_lng: pickupCoords.lng,
      p_radius_km: radiusKm,  p_limit: 8,
    });
    if (error) { console.error('[rideService.getDriversForAuction]', error); return []; }
    return ((data ?? []) as Array<{
      driver_id: string; driver_name: string; rating: number; distance_m: number;
      avatar_url?: string | null; total_rides?: number; level?: string;
      eta_min?: number; heading?: number | null;
    }>).map(row => ({
      driver_id:   row.driver_id,
      driver_name: row.driver_name,
      avatar_url:  row.avatar_url  ?? null,
      rating:      row.rating,
      total_rides: row.total_rides ?? 0,
      level:       (row.level ?? 'Novato') as AuctionDriver['level'],
      distance_m:  row.distance_m,
      eta_min:     row.eta_min ?? Math.ceil(row.distance_m / 400),
      heading:     row.heading ?? null,
    }));
  }

  async createRide(input: CreateRideInput): Promise<RideUpdateResult> {
    try {
      const estimate = await this.getPriceEstimate(
        { lat: input.origin_lat, lng: input.origin_lng },
        { lat: input.dest_lat,   lng: input.dest_lng }
      );
      if (!estimate) return { data: null, error: { code: 'price_error', message: 'Erro ao calcular preço. Tenta de novo.' } };

      const isAuction = !!input.selected_driver_id;
      const { data, error } = await supabase.from('rides').insert({
        passenger_id: input.passenger_id,
        origin_address: input.origin_address, origin_lat: input.origin_lat, origin_lng: input.origin_lng,
        dest_address: input.dest_address, dest_lat: input.dest_lat, dest_lng: input.dest_lng,
        distance_km: estimate.distance_km, duration_min: estimate.duration_min,
        surge_multiplier: estimate.surge_multiplier, price_kz: estimate.price_kz,
        driver_id: input.selected_driver_id ?? null,
        status: isAuction ? RideStatus.ACCEPTED : RideStatus.SEARCHING,
        accepted_at: isAuction ? new Date().toISOString() : null,
        driver_confirmed: false,
      }).select().single();

      if (error) { console.error('[rideService.createRide]', error); return { data: null, error: { code: error.code, message: 'Erro ao criar corrida.' } }; }
      if (input.selected_driver_id) await supabase.from('driver_locations').update({ status: 'busy' }).eq('driver_id', input.selected_driver_id);
      return { data: data as DbRide, error: null };
    } catch (e) { console.error('[rideService.createRide]', e); return { data: null, error: { code: 'unknown', message: 'Erro inesperado.' } }; }
  }

  async driverConfirmRide(rideId: string, driverId: string): Promise<RideUpdateResult> {
    const { data, error } = await supabase.from('rides')
      .update({ driver_confirmed: true, status: RideStatus.PICKING_UP, pickup_at: new Date().toISOString() })
      .eq('id', rideId).eq('driver_id', driverId).eq('driver_confirmed', false)
      .select().single();
    if (error) return { data: null, error: { code: error.code, message: 'Erro ao confirmar corrida.' } };
    return { data: data as DbRide, error: null };
  }

  async driverDeclineRide(rideId: string, driverId: string): Promise<AppError | null> {
    const { error } = await supabase.from('rides')
      .update({ driver_id: null, status: RideStatus.SEARCHING, accepted_at: null })
      .eq('id', rideId).eq('driver_id', driverId);
    if (error) return { code: error.code, message: 'Erro ao recusar corrida.' };
    await supabase.from('driver_locations').update({ status: 'available' }).eq('driver_id', driverId);
    return null;
  }

  async acceptRide(rideId: string, driverId: string): Promise<RideUpdateResult> {
    const { data, error } = await supabase.from('rides')
      .update({ driver_id: driverId, status: RideStatus.ACCEPTED, accepted_at: new Date().toISOString(), driver_confirmed: true })
      .eq('id', rideId).eq('status', RideStatus.SEARCHING).is('driver_id', null)
      .select().single();
    if (error) return { data: null, error: { code: error.code, message: 'Corrida já aceite por outro motorista.' } };
    await supabase.from('driver_locations').update({ status: 'busy' }).eq('driver_id', driverId);
    return { data: data as DbRide, error: null };
  }

  async updateRideStatus(rideId: string, status: RideStatus, actorId: string): Promise<RideUpdateResult> {
    // States that only the assigned driver may transition
    const driverOnlyStates = [
      RideStatus.PICKING_UP,
      RideStatus.IN_PROGRESS,
      RideStatus.COMPLETED,
    ];

    const tsField: Partial<Record<RideStatus, string>> = {
      [RideStatus.PICKING_UP]: 'pickup_at', [RideStatus.IN_PROGRESS]: 'started_at',
      [RideStatus.COMPLETED]: 'completed_at', [RideStatus.CANCELLED]: 'cancelled_at',
    };

    const payload: Record<string, unknown> = { status };
    const f = tsField[status]; if (f) payload[f] = new Date().toISOString();

    // Base query always restricts to the ride id
    let query = supabase.from('rides').update(payload).eq('id', rideId);

    if (driverOnlyStates.includes(status)) {
      // Only the assigned driver may perform these transitions
      query = query.eq('driver_id', actorId);
    } else {
      // For other transitions (eg. CANCELLED) allow either participant
      query = query.or(`driver_id.eq.${actorId},passenger_id.eq.${actorId}`);
    }

    const { data, error } = await query.select().single();
    if (error) return { data: null, error: { code: error.code, message: 'Erro ao actualizar corrida.' } };

    // If ride finished or cancelled, mark driver as available when applicable
    if (status === RideStatus.COMPLETED || status === RideStatus.CANCELLED) {
      const updated = data as DbRide | null;
      if (updated && updated.driver_id) {
        await supabase.from('driver_locations').update({ status: 'available' }).eq('driver_id', updated.driver_id);
      }
      // Pagamento processado automaticamente pelo trigger DB trg_payment_on_complete
      // Ver: migrations/schema.sql -> trigger_process_payment_on_complete
    }

    return { data: data as DbRide, error: null };
  }

  async cancelRide(rideId: string, userId: string, reason?: string): Promise<AppError | null> {
    const { data, error } = await supabase.rpc('cancel_ride_safe', { p_ride_id: rideId, p_user_id: userId, p_reason: reason ?? 'Cancelado' });
    if (error) { console.error('[rideService.cancelRide]', error); return { code: error.code, message: 'Erro ao cancelar corrida.' }; }
    const result = (data as Array<{ success: boolean; message: string }>)?.[0];
    if (!result?.success) return { code: 'cancel_denied', message: result?.message ?? 'Não foi possível cancelar.' };
    return null;
  }

  async submitRating(input: { ride_id: string; from_user: string; to_user: string; score: number; comment?: string }): Promise<AppError | null> {
    const { error } = await supabase.from('ratings').insert(input);
    if (error) return { code: error.code, message: 'Erro ao submeter avaliação.' };
    return null;
  }

  async getActiveRide(userId: string): Promise<(DbRide & { driver_name?: string; passenger_name?: string }) | null> {
    // Buscar corrida principal, sem depender de nomes de FK específicos
    const { data, error } = await supabase.from('rides')
      .select('*')
      .or(`passenger_id.eq.${userId},driver_id.eq.${userId}`)
      .not('status', 'in', `(${RideStatus.COMPLETED},${RideStatus.CANCELLED})`)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) { console.error('[rideService.getActiveRide]', error); return null; }
    if (!data) return null;

    const rideRow = data as DbRide;

    // Buscar nomes de driver/passenger explicitamente para evitar dependência de
    // nomes de foreign key no schema. Fazer em paralelo para performance.
    const [driverRes, passengerRes] = await Promise.all([
      rideRow.driver_id ? supabase.from('profiles').select('name').eq('user_id', rideRow.driver_id).single() : Promise.resolve({ data: null }),
      rideRow.passenger_id ? supabase.from('profiles').select('name').eq('user_id', rideRow.passenger_id).single() : Promise.resolve({ data: null }),
    ]);

    const driverName = (driverRes as any)?.data?.name ?? undefined;
    const passengerName = (passengerRes as any)?.data?.name ?? undefined;

    return {
      ...(rideRow as DbRide),
      driver_name: driverName,
      passenger_name: passengerName,
    };
  }

  async getAvailableRides(): Promise<DbRide[]> {
    const { data, error } = await supabase.from('rides').select('*')
      .eq('status', RideStatus.SEARCHING).is('driver_id', null).order('created_at', { ascending: false });
    if (error) { console.error('[rideService.getAvailableRides]', error); return []; }
    return (data ?? []) as DbRide[];
  }

  async getRideHistory(userId: string, page = 0, pageSize = 20): Promise<{ rides: DbRide[]; total: number }> {
    const from = page * pageSize;
    const { data, error, count } = await supabase.from('rides').select('*', { count: 'exact' })
      .or(`passenger_id.eq.${userId},driver_id.eq.${userId}`)
      .in('status', [RideStatus.COMPLETED, RideStatus.CANCELLED])
      .order('created_at', { ascending: false }).range(from, from + pageSize - 1);
    if (error) { console.error('[rideService.getRideHistory]', error); return { rides: [], total: 0 }; }
    return { rides: (data ?? []) as DbRide[], total: count ?? 0 };
  }

  // ============================================================
  // REALTIME — canais independentes
  // ============================================================
  subscribeToRide(rideId: string, onUpdate: (ride: DbRide) => void): () => void {
    if (this.rideChannel) { supabase.removeChannel(this.rideChannel); this.rideChannel = null; }
    this.rideChannel = supabase.channel(`ride:${rideId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
        (p) => { if (p.new) onUpdate(p.new as DbRide); })
      .subscribe();
    return () => { if (this.rideChannel) { supabase.removeChannel(this.rideChannel); this.rideChannel = null; } };
  }

  subscribeToAvailableRides(onNew: (r: DbRide) => void, onGone: (id: string) => void): () => void {
    if (this.availableChannel) { supabase.removeChannel(this.availableChannel); this.availableChannel = null; }
    this.availableChannel = supabase.channel('available-rides')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides', filter: `status=eq.${RideStatus.SEARCHING}` }, (p) => onNew(p.new as DbRide))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (p) => { const r = p.new as DbRide; if (r.status !== RideStatus.SEARCHING) onGone(r.id); })
      .subscribe();
    return () => { if (this.availableChannel) { supabase.removeChannel(this.availableChannel); this.availableChannel = null; } };
  }

  subscribeToDriverAssignments(driverId: string, onAssigned: (ride: DbRide) => void): () => void {
    if (this.assignmentChannel) { supabase.removeChannel(this.assignmentChannel); this.assignmentChannel = null; }
    this.assignmentChannel = supabase.channel(`driver-assignments:${driverId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverId}` }, (p) => onAssigned(p.new as DbRide))
      .subscribe();
    return () => { if (this.assignmentChannel) { supabase.removeChannel(this.assignmentChannel); this.assignmentChannel = null; } };
  }

  subscribeToDriverLocation(driverId: string, onUpdate: (coords: LatLng) => void): () => void {
    const channel = supabase.channel(`driver-location:${driverId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` },
        (payload) => { const coords = parseSupabasePoint((payload.new as Record<string, unknown>).location as string); if (coords) onUpdate(coords); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }

  async updateDriverLocation(driverId: string, coords: LatLng, heading?: number): Promise<void> {
    const payload = {
      location: `POINT(${coords.lng} ${coords.lat})`,
      heading: heading ?? null,
      updated_at: new Date().toISOString(),
    };
    try {
      // Primeiro tenta actualizar a linha existente para não sobrescrever `status`.
      const { data, error } = await supabase.from('driver_locations').update(payload).eq('driver_id', driverId).select();
      if (error) { console.error('[rideService.updateDriverLocation] update error', error); return; }
      // Se não existia, inserir com status 'available' para não deixar status NULL.
      if (!data || (Array.isArray(data) && data.length === 0)) {
        const { error: insErr } = await supabase.from('driver_locations').insert({ driver_id: driverId, ...payload, status: 'available' });
        if (insErr) console.error('[rideService.updateDriverLocation] insert error', insErr);
      }
    } catch (e) {
      console.error('[rideService.updateDriverLocation] exception', e);
    }
  }

  async setDriverStatus(driverId: string, status: 'offline' | 'available' | 'busy'): Promise<void> {
    await supabase.from('driver_locations').upsert({ driver_id: driverId, status, updated_at: new Date().toISOString() });
  }

  async getCachedGeocode(query: string): Promise<LatLng | null> {
    const { data } = await supabase.from('geocoding_cache').select('lat, lng').eq('query_text', query.toLowerCase().trim()).single();
    if (!data) return null;
    supabase.rpc('increment_geocode_hit', { q: query.toLowerCase().trim() }).then(() => {});
    return { lat: data.lat, lng: data.lng };
  }

  async cacheGeocode(query: string, coords: LatLng, fullAddress?: string): Promise<void> {
    await supabase.from('geocoding_cache').upsert({ query_text: query.toLowerCase().trim(), lat: coords.lat, lng: coords.lng, full_address: fullAddress ?? null, source: 'google' });
  }

  async getPriceEstimate(origin: LatLng, dest: LatLng): Promise<PriceEstimate | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(edgeFunctionUrl('calculate-price'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ origin, dest }),
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  async findNearbyDrivers(coords: LatLng, radiusKm = 5): Promise<NearbyDriver[]> {
    const { data, error } = await supabase.rpc('find_nearby_drivers', { p_lat: coords.lat, p_lng: coords.lng, p_radius_km: radiusKm, p_limit: 10 });
    if (error) { console.error('[rideService.findNearbyDrivers]', error); return []; }
    return (data ?? []) as NearbyDriver[];
  }

  async initiateTopUp(amountKz: number, phone: string): Promise<{ success: boolean; message: string; reference?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(edgeFunctionUrl('multicaixa-pay'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'initiate_payment', amount_kz: amountKz, phone_number: phone }),
      });
      return res.json();
    } catch { return { success: false, message: 'Erro de rede. Verifica a ligação e tenta de novo.' }; }
  }

  
}

export const rideService = new RideService();

// ── Route deviation detection ─────────────────────────────────────────────────
// Called periodically during IN_PROGRESS rides to check if driver deviated
export async function checkRouteDeviation(
  rideId: string,
  currentCoords: { lat: number; lng: number },
  destCoords: { lat: number; lng: number },
  maxDeviationKm: number = 2
): Promise<{ deviated: boolean; deviationKm: number }> {
  // Haversine distance in km
  const R = 6371;
  const dLat = (destCoords.lat - currentCoords.lat) * Math.PI / 180;
  const dLng = (destCoords.lng - currentCoords.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(currentCoords.lat * Math.PI / 180) * Math.cos(destCoords.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const deviationKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const deviated = deviationKm > maxDeviationKm;
  if (deviated) {
    // Log deviation alert in Supabase
    await supabase.from('route_deviation_alerts').insert({
      ride_id: rideId, deviation_km: deviationKm,
      lat: currentCoords.lat, lng: currentCoords.lng,
      alerted_at: new Date().toISOString(),
    }).then(() => {});
  }
  return { deviated, deviationKm };
}
