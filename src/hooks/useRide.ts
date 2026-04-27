// =============================================================================
// ZENITH RIDE v3.0 — useRide.ts (CORRIGIDO)
// ✅ Integrado com Zustand store (useAppStore)
// ✅ Toast de erro em todas as acções
// ✅ subscribeToRide + subscribeToDriverLocation robustos
// ✅ Cleanup correcto em todos os casos
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { rideService } from '../services/rideService';
import { mapService } from '../services/mapService';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAppStore, INITIAL_RIDE, INITIAL_AUCTION, INITIAL_POST_RIDE } from '../store/useAppStore';
import type { RideState, DbRide, AppError, LatLng, AuctionDriver, AuctionState, PostRideState } from '../types';
import { RideStatus } from '../types';

interface UseRideReturn {
  ride:     RideState;
  auction:  AuctionState;
  postRide: PostRideState;
  loading:  boolean;
  error:    AppError | null;
  startAuction:    (pickupCoords: LatLng) => Promise<void>;
  selectDriver:    (driver: AuctionDriver) => void;
  cancelAuction:   () => void;
  requestRide:     (
    pickup: string,
    pickupCoords: LatLng,
    dest: string,
    destCoords: LatLng,
    proposedPrice?: number,
    distanceKm?: number,
    durationMin?: number,
    vehicleType?: 'standard' | 'moto' | 'comfort' | 'xl'
  ) => Promise<void>;
  cancelRide:      (reason?: string) => Promise<void>;
  acceptRide:      (rideId: string) => Promise<void>;
  confirmRide:     (rideId: string) => Promise<void>;
  declineRide:     (rideId: string) => Promise<void>;
  advanceStatus:   (status: RideStatus) => Promise<void>;
  submitReview:    (score: number, comment?: string) => Promise<void>;
  dismissPostRide: () => void;
  clearError: () => void;
}

export function useRide(): UseRideReturn {
  const { dbUser, role, profile } = useAuth();

  // Zustand store
  const { setRide, resetRide, setAuction, resetAuction, setPostRide, resetPostRide, showToast } = useAppStore();
  const ride     = useAppStore(s => s.ride);
  const auction  = useAppStore(s => s.auction);
  const postRide = useAppStore(s => s.postRide);

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<AppError | null>(null);

  const unsubRef       = useRef<(() => void) | null>(null);
  const driverLocUnsub = useRef<(() => void) | null>(null);
  const prevStatusRef  = useRef<RideStatus>(RideStatus.IDLE);
  const autoSharedRideRef = useRef<string | null>(null);
  // Ref para guardar distância e duração da corrida activa (para PostRideReview)
  const rideDetailsRef = useRef<{ distanceKm: number | null; durationMin: number | null }>({
    distanceKm:  null,
    durationMin: null,
  });
  let applyDbRide: (ride: DbRide & { driver_name?: string; passenger_name?: string }) => void = () => {};
  let subscribeToRide: (rideId: string, driverId?: string) => void = () => {};
  const clearRideDetails = useCallback(() => {
    rideDetailsRef.current = { distanceKm: null, durationMin: null };
  }, []);

  // ── Carregar corrida activa ao iniciar sessão ────────────────────────────
  useEffect(() => {
    if (!dbUser?.id) return;
    (async () => {
      const active = await rideService.getActiveRide(dbUser.id);
      if (active) {
        applyDbRide(active);
        subscribeToRide(active.id, active.driver_id ?? undefined);
      } else {
        clearRideDetails();
        resetRide();
      }
    })();

    return () => {
      unsubRef.current?.();
      driverLocUnsub.current?.();
      clearRideDetails();
    };
  }, [dbUser?.id, clearRideDetails, resetRide]);

  // ── Detectar transição para COMPLETED → activar review ──────────────────
  // ✅ BUG #5 CORRIGIDO: setTimeout com cleanup e guarda de montagem
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = ride.status;

    prevStatusRef.current = curr;

    if (
      prev !== RideStatus.COMPLETED &&
      curr === RideStatus.COMPLETED &&
      ride.rideId &&
      ride.driverId
    ) {
      let isMounted = true;

      const timer = setTimeout(() => {
        if (!isMounted) {
          if (import.meta.env.DEV) {
            console.debug('[useRide] PostRide cancelado — componente desmontado');
          }
          return;
        }

        setPostRide({
          active:       true,
          rideId:       ride.rideId!,
          driverId:     ride.driverId!,
          driverName:   ride.driverName ?? 'o motorista',
          driverRating: ride.driverRating ?? null,
          priceKz:      ride.priceKz ?? null,
          distanceKm:   rideDetailsRef.current.distanceKm,
          durationMin:  rideDetailsRef.current.durationMin,
        });
      }, 2000);

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }
  }, [ride.status, setPostRide, ride.rideId, ride.driverId, ride.driverName, ride.driverRating, ride.priceKz]);

  useEffect(() => {
    const justStarted =
      prevStatusRef.current === RideStatus.IN_PROGRESS &&
      ride.status === RideStatus.IN_PROGRESS;

    if (!ride.rideId || ride.status !== RideStatus.IN_PROGRESS || !dbUser?.id) {
      return;
    }

    if (ride.passengerId !== dbUser.id) {
      return;
    }

    if (!profile?.emergency_contact_phone) {
      return;
    }

    if (autoSharedRideRef.current === ride.rideId && justStarted) {
      return;
    }

    autoSharedRideRef.current = ride.rideId;

    rideService.autoShareLiveTrackingOnRideStart({
      rideId: ride.rideId,
      ownerUserId: dbUser.id,
      emergencyPhone: profile.emergency_contact_phone,
      driverName: ride.driverName,
      pickup: ride.pickup,
      destination: ride.destination,
    }).catch((shareError) => {
      console.warn('[useRide] Falha na partilha live automatica:', shareError);
    });
  }, [
    dbUser?.id,
    profile?.emergency_contact_phone,
    ride.destination,
    ride.driverName,
    ride.passengerId,
    ride.pickup,
    ride.rideId,
    ride.status,
  ]);

  // ── applyDbRide ──────────────────────────────────────────────────────────
  applyDbRide = useCallback((r: DbRide & { driver_name?: string; passenger_name?: string }) => {
    rideDetailsRef.current = {
      distanceKm:  r.distance_km  ?? null,
      durationMin: r.duration_min ?? null,
    };
    setRide({
      status:          r.status as RideStatus,
      rideId:          r.id,
      passengerId:     r.passenger_id,
      pickup:          r.origin_address,
      destination:     r.dest_address,
      pickupCoords:    { lat: r.origin_lat, lng: r.origin_lng },
      destCoords:      { lat: r.dest_lat,   lng: r.dest_lng },
      surgeMultiplier: r.surge_multiplier,
      priceKz:         r.price_kz,
      driverId:        r.driver_id ?? undefined,
      driverConfirmed: r.driver_confirmed,
      driverName:      r.driver_name    ?? undefined,
      passengerName:   r.passenger_name ?? undefined,
    });
  }, [setRide]);

  // ── subscribeToRide ──────────────────────────────────────────────────────
  subscribeToRide = useCallback((rideId: string, driverId?: string) => {
    unsubRef.current?.();
    driverLocUnsub.current?.();
    driverLocUnsub.current = null;

    unsubRef.current = rideService.subscribeToRide(rideId, async (updated) => {
      // BUG 2 FIX: quando motorista é atribuído, buscar o nome do perfil imediatamente
      let resolvedDriverName: string | undefined;
      if (updated.driver_id && !(updated as any).driver_name) {
        try {
          const { data: dp } = await supabase
            .from('profiles')
            .select('name')
            .eq('user_id', updated.driver_id)
            .single();
          resolvedDriverName = dp?.name ?? undefined;
        } catch { /* não crítico */ }
      } else {
        resolvedDriverName = (updated as any).driver_name ?? undefined;
      }

      setRide({
        status:          updated.status as RideStatus,
        rideId:          updated.id,
        passengerId:     updated.passenger_id,
        pickup:          updated.origin_address,
        destination:     updated.dest_address,
        pickupCoords:    { lat: updated.origin_lat, lng: updated.origin_lng },
        destCoords:      { lat: updated.dest_lat,   lng: updated.dest_lng },
        surgeMultiplier: updated.surge_multiplier,
        priceKz:         updated.price_kz,
        driverId:        updated.driver_id ?? undefined,
        driverConfirmed: updated.driver_confirmed,
        ...(resolvedDriverName ? { driverName: resolvedDriverName } : {}),
      });

      // Subscrever localização do motorista quando ele for atribuído
      if (updated.driver_id && !driverLocUnsub.current) {
        driverLocUnsub.current = rideService.subscribeToDriverLocation(
          updated.driver_id,
          (coords) => setRide({ carLocation: coords })
        );
      }

      // Limpar quando termina
      if (updated.status === RideStatus.COMPLETED || updated.status === RideStatus.CANCELLED) {
        driverLocUnsub.current?.();
        driverLocUnsub.current = null;

        if (updated.status === RideStatus.COMPLETED) {
          // Capturar a referência ANTES do timeout para evitar cancelar subscriptions futuras.
          // Se uma nova corrida começar nos próximos 5s, unsubRef.current já foi anulado
          // e o timeout apenas chama a limpeza da corrida terminada.
          const completedUnsub = unsubRef.current;
          unsubRef.current = null;
          setTimeout(() => {
            completedUnsub?.();
          }, 5000);
        } else {
          // Se for cancelado, limpa IMEDIATAMENTE (sem delay/refresh)
          clearRideDetails();
          resetRide();
          unsubRef.current?.();
          unsubRef.current = null;
        }
      }
    });

    // Subscrever GPS imediatamente se já há motorista
    if (driverId && !driverLocUnsub.current) {
      driverLocUnsub.current = rideService.subscribeToDriverLocation(
        driverId,
        (coords) => setRide({ carLocation: coords })
      );
    }
  }, [clearRideDetails, setRide, resetRide]);

  // ── startAuction ─────────────────────────────────────────────────────────
  const startAuction = useCallback(async (pickupCoords: LatLng) => {
    setAuction({ loading: true, drivers: [], selectedDriver: null, error: null });
    try {
      const drivers = await rideService.getDriversForAuction(pickupCoords);
      if (drivers.length === 0) {
        setAuction({ loading: false, drivers: [], selectedDriver: null, error: 'Nenhum motorista disponível na tua zona. Tenta em breve.' });
        return;
      }
      setAuction({ loading: false, drivers, selectedDriver: null, error: null });
      setRide({ status: RideStatus.BROWSING });
    } catch (err) {
      setAuction({ loading: false, drivers: [], selectedDriver: null, error: 'Erro ao buscar motoristas. Verifica a ligação.' });
      showToast('Erro ao buscar motoristas. Verifica a ligação.', 'error');
    }
  }, [setAuction, setRide, showToast]);

  const selectDriver   = useCallback((driver: AuctionDriver) => setAuction({ selectedDriver: driver }), [setAuction]);
  const cancelAuction  = useCallback(() => { resetAuction(); setRide({ status: RideStatus.IDLE }); }, [resetAuction, setRide]);

  // ── requestRide ───────────────────────────────────────────────────────────
  const requestRide = useCallback(async (
    pickup: string, pickupCoords: LatLng, dest: string, destCoords: LatLng,
    proposedPrice?: number, distanceKm?: number, durationMin?: number,
    vehicleType?: 'standard' | 'moto' | 'comfort' | 'xl'
  ) => {
    if (!dbUser?.id) { setError({ code: 'not_auth', message: 'Precisas de fazer login.' }); return; }

    clearRideDetails();
    setLoading(true); setError(null);

    try {
      let rPickup = pickupCoords;
      let rDest   = destCoords;

      // Geocode se não tiver coords válidas
      if (!pickupCoords?.lat) {
        const g = await mapService.geocodeAddress(pickup);
        if (g) rPickup = g;
      }
      if (!destCoords?.lat) {
        const g = await mapService.geocodeAddress(dest);
        if (g) rDest = g;
      }

      const { data, error: e } = await rideService.createRide({
        passenger_id:       dbUser.id,
        origin_address:     pickup,
        origin_lat:         rPickup.lat,
        origin_lng:         rPickup.lng,
        dest_address:       dest,
        dest_lat:           rDest.lat,
        dest_lng:           rDest.lng,
        selected_driver_id: auction.selectedDriver?.driver_id,
        proposed_price:     proposedPrice,
        distance_km:        distanceKm,
        duration_min:       durationMin,
        vehicle_type:       vehicleType ?? 'standard',
      });

      if (e || !data) {
        const msg = e?.message ?? 'Erro ao criar corrida.';
        setError(e ?? { code: 'unknown', message: msg });
        showToast(msg, 'error');
        return;
      }

      resetAuction();
      applyDbRide(data);
      subscribeToRide(data.id, data.driver_id ?? undefined);
      showToast('Corrida criada com sucesso!', 'success');
    } finally {
      setLoading(false);
    }
  }, [dbUser?.id, auction.selectedDriver, subscribeToRide, applyDbRide, resetAuction, showToast, clearRideDetails]);

  // ── cancelRide ────────────────────────────────────────────────────────────
  const cancelRide = useCallback(async (reason?: string) => {
    if (!dbUser?.id || !ride.rideId) return;
    setLoading(true);
    try {
      const err = await rideService.cancelRide(ride.rideId, dbUser.id, reason);
      if (err) { showToast(err.message, 'error'); return; }
      driverLocUnsub.current?.(); driverLocUnsub.current = null;
      unsubRef.current?.(); unsubRef.current = null;
      clearRideDetails();
      resetRide();
      resetAuction();
      showToast('Corrida cancelada.', 'info');
    } finally {
      setLoading(false);
    }
  }, [dbUser?.id, ride.rideId, resetRide, resetAuction, showToast, clearRideDetails]);

  // ── acceptRide ────────────────────────────────────────────────────────────
  const acceptRide = useCallback(async (rideId: string) => {
    if (!dbUser?.id) return;
    setLoading(true);
    try {
      const { data, error: e } = await rideService.acceptRide(rideId, dbUser.id);
      if (e || !data) {
        const msg = e?.message ?? 'Corrida já aceite por outro motorista.';
        setError(e ?? { code: 'accept_fail', message: msg });
        showToast(msg, 'error');
        return;
      }
      applyDbRide(data);
      subscribeToRide(data.id, data.driver_id ?? undefined);
    } finally {
      setLoading(false);
    }
  }, [dbUser?.id, subscribeToRide, applyDbRide, showToast]);

  // ── confirmRide ───────────────────────────────────────────────────────────
  const confirmRide = useCallback(async (rideId: string) => {
    if (!dbUser?.id) return;
    setLoading(true);
    try {
      const { data, error: e } = await rideService.driverConfirmRide(rideId, dbUser.id);
      if (e || !data) {
        showToast(e?.message ?? 'Erro ao confirmar.', 'error');
        return;
      }
      applyDbRide(data);
      subscribeToRide(data.id, data.driver_id ?? undefined);
    } finally {
      setLoading(false);
    }
  }, [dbUser?.id, subscribeToRide, applyDbRide, showToast]);

  // ── declineRide ───────────────────────────────────────────────────────────
  const declineRide = useCallback(async (rideId: string) => {
    if (!dbUser?.id) return;
    try {
      const err = await rideService.driverDeclineRide(rideId, dbUser.id);
      if (err) { showToast(err.message, 'error'); return; }
      driverLocUnsub.current?.(); driverLocUnsub.current = null;
      unsubRef.current?.(); unsubRef.current = null;
      clearRideDetails();
      resetRide();
    } catch {
      showToast('Erro ao recusar corrida.', 'error');
    }
  }, [dbUser?.id, resetRide, showToast, clearRideDetails]);

  // ── advanceStatus ─────────────────────────────────────────────────────────
  const advanceStatus = useCallback(async (status: RideStatus) => {
    if (!dbUser?.id || !ride.rideId) return;
    setLoading(true);
    try {
      const { data, error: e } = await rideService.updateRideStatus(ride.rideId, status, dbUser.id);
      if (e || !data) {
        showToast(e?.message ?? 'Erro ao avançar estado.', 'error');
        return;
      }
      applyDbRide(data);
    } finally {
      setLoading(false);
    }
  }, [dbUser?.id, ride.rideId, applyDbRide, showToast]);

  // ── submitReview ──────────────────────────────────────────────────────────
  const submitReview = useCallback(async (score: number, comment?: string) => {
    if (!dbUser?.id || !postRide.rideId || !postRide.driverId) return;
    try {
      const err = await rideService.submitRating({
        ride_id: postRide.rideId, from_user: dbUser.id, to_user: postRide.driverId, score, comment,
      });
      if (err) { showToast(err.message, 'error'); return; }
      resetPostRide();
      clearRideDetails();
      resetRide();
      showToast('Avaliação enviada. Obrigado!', 'success');
    } catch {
      showToast('Erro ao enviar avaliação.', 'error');
    }
  }, [dbUser?.id, postRide, resetPostRide, resetRide, showToast, clearRideDetails]);

  const dismissPostRide = useCallback(() => {
    resetPostRide();
    clearRideDetails();
    resetRide();
  }, [resetPostRide, resetRide, clearRideDetails]);

  return {
    ride, auction, postRide, loading, error,
    startAuction, selectDriver, cancelAuction,
    requestRide, cancelRide, acceptRide, confirmRide, declineRide, advanceStatus,
    submitReview, dismissPostRide,
    clearError: () => setError(null),
  };
}

// ─────────────────────────────────────────────────────────────
// Hook genérico de safe-timeout (reutilizável no projecto)
// ─────────────────────────────────────────────────────────────
export function useSafeTimeout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const set = useCallback(
    (fn: () => void, delay: number) => {
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fn();
      }, delay);
    },
    [clear],
  );

  useEffect(() => () => clear(), [clear]);

  return { set, clear };
}
