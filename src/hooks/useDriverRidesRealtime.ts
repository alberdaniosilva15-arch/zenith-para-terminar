// =============================================================================
// ZENITH RIDE v3.3 — src/hooks/useDriverRidesRealtime.ts
//
// Tempo real do cockpit do motorista (extraído de DriverHome.tsx — SRP):
//   1. Subscrição Realtime a `driver_notifications` (resolve broadcast perdido)
//   2. Leitura de notificações pendentes na BD quando o motorista reconecta
//   3. Subscrições de fallback `subscribeToAvailableRides` +
//      `subscribeToDriverAssignments` (com filtro geográfico H3)
//   4. Alarm chime + vibração háptica na recepção de nova corrida
//   5. Timers de expiração/auto-mark-as-read das notificações
//
// Contrato público inalterado face ao comportamento anterior de DriverHome.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { rideService } from '../services/rideService';
import { latLngToCell, gridDisk } from 'h3-js';
import { RideStatus } from '../types';
import type { DbRide, LatLng } from '../types';

// Payload de notificação persistido em driver_notifications
export interface NotifPayload {
  ride_id:              string;
  passenger_id?:         string;
  passenger_name?:       string;
  passenger_avatar_url?: string | null;
  passenger_rating?:     number;
  origin_address:       string;
  origin_lat?:          number;
  origin_lng?:          number;
  dest_address:         string;
  dest_lat?:            number;
  dest_lng?:            number;
  price_kz:             number;
  distance_km:          number | null;
  duration_min?:        number;
}

// ── Som e vibração háptica ao receber nova corrida ───────────────────────────
export const playRideChime = () => {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // Ignora silenciosamente se o contexto de áudio estiver bloqueado
  }
};

// Constrói um DbRide apresentável ao motorista a partir do payload persistido,
// preferindo sempre o registo real da BD quando disponível (BUG 5 FIX).
function buildFallbackRide(
  realRide: DbRide | null,
  np: NotifPayload,
  rideId: string,
  createdAt: string | null | undefined,
): DbRide {
  const passName = np?.passenger_name ?? (realRide as any)?.passenger_name ?? 'Passageiro Zenith';
  const passAvatar = np?.passenger_avatar_url ?? (realRide as any)?.passenger_avatar_url ?? null;
  const passRating = np?.passenger_rating ?? (realRide as any)?.passenger_rating ?? 5.0;

  return {
    ...(realRide ?? {
      id:               rideId,
      origin_address:   np.origin_address ?? '—',
      dest_address:     np.dest_address   ?? '—',
      price_kz:         np.price_kz       ?? 0,
      distance_km:      np.distance_km    ?? null,
      status:           RideStatus.SEARCHING,
      driver_id:        null,
      driver_confirmed: false,
      passenger_id:     np.passenger_id   ?? '',
      origin_lat:       np.origin_lat     ?? 0,
      origin_lng:       np.origin_lng     ?? 0,
      dest_lat:         np.dest_lat       ?? 0,
      dest_lng:         np.dest_lng       ?? 0,
      surge_multiplier: 1,
      created_at:       createdAt ?? new Date().toISOString(),
      accepted_at:      null,
      pickup_at:        null,
      started_at:       null,
      completed_at:     null,
      cancelled_at:     null,
      cancel_reason:    null,
    }),
    passenger_name:       passName,
    passenger_avatar_url: passAvatar,
    passenger_rating:     passRating,
  } as unknown as DbRide;
}

interface UseDriverRidesRealtimeArgs {
  driverId: string;
  isOnline: boolean;
  /** Coordenadas actuais do motorista — usadas para o filtro geográfico H3. */
  driverCoords: LatLng | null;
  /** Ref sempre actualizada com as coordenadas (evita re-subscrições). */
  driverCoordsRef: React.MutableRefObject<LatLng | null>;
  /** IDs de corridas que o motorista já ignorou/recusou. */
  ignoredRidesRef: React.MutableRefObject<Set<string>>;
}

export function useDriverRidesRealtime({
  driverId,
  isOnline,
  driverCoords,
  driverCoordsRef,
  ignoredRidesRef,
}: UseDriverRidesRealtimeArgs) {
  const [incomingRide, setIncomingRide] = useState<DbRide | null>(null);
  const [isAuctionRide, setIsAuctionRide] = useState(false);
  const [pendingNotifCount, setPendingNotifCount] = useState(0);

  const unsubRef1 = useRef<(() => void) | null>(null); // subscribeToAvailableRides
  const unsubRef2 = useRef<(() => void) | null>(null); // subscribeToDriverAssignments
  const unsubRef3 = useRef<ReturnType<typeof supabase.channel> | null>(null); // driver_notifications

  // ✅ BUG #7 CORRIGIDO: timers para auto-mark notifications como lidas
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);

  // Apresenta a corrida apenas se for diferente da que já está no ecrã.
  const presentIncomingRide = useCallback((candidate: DbRide) => {
    setIncomingRide(prev => {
      if (!prev || prev.id !== candidate.id) {
        setIsAuctionRide(false);
        playRideChime();
        return candidate;
      }
      return prev;
    });
  }, []);

  // ── Ler notificações pendentes (BD) ao reconectar ─────────────────────────
  const loadPendingNotifications = useCallback(async () => {
    try {
      const { data: notifs } = await supabase
        .from('driver_notifications')
        .select('id, ride_id, payload, created_at')
        .eq('driver_id', driverId)
        .is('read_at', null)
        .eq('type', 'new_ride')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!notifs || notifs.length === 0) return;

      setPendingNotifCount(notifs.length);
      const latest = notifs[0];
      if (!latest) return;
      const payload = latest.payload as NotifPayload;
      const rideId  = payload.ride_id ?? latest.ride_id;

      // BUG 5 FIX: buscar ride real da BD
      let realRide: DbRide | null = null;
      try {
        const { data } = await supabase.from('rides').select('*').eq('id', rideId).single();
        if (data) realRide = data as DbRide;
      } catch (err) { console.warn('[useDriverRidesRealtime] Falha ao obter ETA/distância fallback:', err); }

      // Se a corrida existe na BD mas já não está em 'searching', descartar e marcar como lida
      if (realRide && realRide.status !== RideStatus.SEARCHING) {
        await supabase
          .from('driver_notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('driver_id', driverId)
          .is('read_at', null)
          .eq('type', 'new_ride');
        return;
      }

      presentIncomingRide(buildFallbackRide(realRide, payload, rideId, latest.created_at));

      await supabase
        .from('driver_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('driver_id', driverId)
        .is('read_at', null)
        .eq('type', 'new_ride');
    } catch (err) {
      console.warn('[useDriverRidesRealtime.loadPendingNotifications]', err);
    }
  }, [driverId, presentIncomingRide]);

  // ── Subscrição Realtime a driver_notifications ────────────────────────────
  const subscribeToNotifications = useCallback(() => {
    if (unsubRef3.current) {
      supabase.removeChannel(unsubRef3.current);
      unsubRef3.current = null;
    }

    unsubRef3.current = supabase
      .channel(`driver-notifs:${driverId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'driver_notifications',
        filter: `driver_id=eq.${driverId}`,
      }, async (payload) => {
        const notif = payload.new as {
          id: string;
          ride_id: string;
          type: string;
          payload: NotifPayload;
          created_at: string;
        };

        if (notif.type !== 'new_ride') return;

        // BUG 5 FIX: buscar o ride real da BD em vez de usar fakeRide com coords 0,0
        const rideId = notif.payload?.ride_id ?? notif.ride_id;
        let realRide: DbRide | null = null;

        try {
          const { data } = await supabase
            .from('rides')
            .select('*')
            .eq('id', rideId)
            .single();
          if (data) realRide = data as DbRide;
        } catch (err) { console.warn('[useDriverRidesRealtime] Falha na auto-aceitação:', err); }

        // Se a corrida já não está em 'searching', não apresentar ao motorista
        if (realRide && realRide.status !== RideStatus.SEARCHING) {
          return;
        }

        presentIncomingRide(buildFallbackRide(realRide, notif.payload, rideId, notif.created_at));

        setPendingNotifCount(c => c + 1);

        // Marcar como lida após 5 segundos
        const timer = setTimeout(async () => {
          timersRef.current.delete(notif.id);
          if (!mountedRef.current) return;
          try {
            await supabase
              .from('driver_notifications')
              .update({ read_at: new Date().toISOString() })
              .eq('id', notif.id);
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn('[useDriverRidesRealtime] Falha ao marcar notificação como lida:', notif.id, err);
            }
          }
        }, 5000);

        timersRef.current.set(notif.id, timer);
      })
      .subscribe((status) => {
        console.log('[DriverHome] driver_notifications canal:', status);
      });
  }, [driverId, presentIncomingRide]);

  // Effect único de lifecycle e unmount
  // ✅ BUG #7 CORRIGIDO: cleanup completo de todos os timers
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Limpar TODOS os timers de notificações pendentes
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
      if (unsubRef1.current) { unsubRef1.current(); unsubRef1.current = null; }
      if (unsubRef2.current) { unsubRef2.current(); unsubRef2.current = null; }
      if (unsubRef3.current) { supabase.removeChannel(unsubRef3.current); unsubRef3.current = null; }
    };
  }, [driverId]);

  // Effect dependente do estado online (limpeza ao ficar offline)
  useEffect(() => {
    if (!isOnline) {
      if (unsubRef1.current) { unsubRef1.current(); unsubRef1.current = null; }
      if (unsubRef2.current) { unsubRef2.current(); unsubRef2.current = null; }
      if (unsubRef3.current) { supabase.removeChannel(unsubRef3.current); unsubRef3.current = null; }
    }
  }, [isOnline]);

  // ── Arranque das subscrições ao ficar online ──────────────────────────────
  const startSubscriptions = useCallback(async () => {
    // Carregar notificações pendentes da BD (se estava offline)
    await loadPendingNotifications();

    // Subscrição 1: corridas em "searching" (fallback manual)
    const rides = await rideService.getAvailableRides();
    if (rides.length > 0) {
      const firstRide = rides.find(r => !ignoredRidesRef.current.has(r.id));
      if (firstRide) {
        presentIncomingRide(firstRide);
      }
    }

    // 2. Subscreve a novas corridas com filtro H3 geográfico
    // Calcula H3 cells da vizinhança do motorista (~5km radius)
    const myH3Cells = driverCoordsRef.current
      ? gridDisk(latLngToCell(driverCoordsRef.current.lat, driverCoordsRef.current.lng, 9), 5)
      : undefined;
    unsubRef1.current = rideService.subscribeToAvailableRides(
      (r) => {
        if (ignoredRidesRef.current.has(r.id)) return;
        presentIncomingRide(r);
      },
      (id) => {
        setIncomingRide(prev => prev?.id === id ? null : prev);
      },
      myH3Cells,
    );

    // Subscrição 2: passageiro escolheu-me directamente (leilão)
    unsubRef2.current = rideService.subscribeToDriverAssignments(driverId, (r) => {
      if (r.status === RideStatus.ACCEPTED && !r.driver_confirmed) {
        setIncomingRide(prev => {
          if (!prev) { setIsAuctionRide(true); return r; }
          return prev;
        });
      }
    });

    // Subscrição 3: driver_notifications
    subscribeToNotifications();
  }, [driverId, loadPendingNotifications, subscribeToNotifications, presentIncomingRide, driverCoordsRef, ignoredRidesRef]);

  void driverCoords; // mantido na API para telemetria/futuras filtragens

  // ── Handlers expostos ao cockpit ──────────────────────────────────────────
  const clearIncomingRide = useCallback(() => {
    setIncomingRide(null);
    setPendingNotifCount(0);
  }, []);

  const ignoreIncomingRide = useCallback(() => {
    setIncomingRide(prev => {
      if (prev?.id) ignoredRidesRef.current.add(prev.id);
      return null;
    });
    setPendingNotifCount(0);
  }, [ignoredRidesRef]);

  const ignoreRideById = useCallback((rideId: string) => {
    ignoredRidesRef.current.add(rideId);
    setIncomingRide(null);
  }, [ignoredRidesRef]);

  return {
    incomingRide,
    setIncomingRide,
    isAuctionRide,
    pendingNotifCount,
    startSubscriptions,
    clearIncomingRide,
    ignoreIncomingRide,
    ignoreRideById,
  };
}
