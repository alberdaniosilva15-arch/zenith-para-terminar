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
  requestRide:     (pickup: string, pickupCoords: LatLng, dest: string, destCoords: LatLng) => Promise<void>;
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
  const { dbUser, role } = useAuth();

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
  // Ref para guardar distância e duração da corrida activa (para PostRideReview)
  const rideDetailsRef = useRef<{ distanceKm: number | null; durationMin: number | null }>({
    distanceKm:  null,
    durationMin: null,
  });

  // ── Carregar corrida activa ao iniciar sessão ────────────────────────────
  useEffect(() => {
    if (!dbUser?.id) return;
    (async () => {
      const active = await rideService.getActiveRide(dbUser.id);
      if (active) {
        applyDbRide(active);
        subscribeToRide(active.id, active.driver_id ?? undefined);
      }
    })();

    return () => {
      unsubRef.current?.();
      driverLocUnsub.current?.();
    };
  }, [dbUser?.id]);

  // ── Detectar transição para COMPLETED → activar review ──────────────────
  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = ride.status;
    if (prev !== RideStatus.COMPLETED && curr === RideStatus.COMPLETED && ride.rideId && ride.driverId) {
      setTimeout(() => {
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
    }
    prevStatusRef.current = curr;
  }, [ride.status]);

  // ── applyDbRide ──────────────────────────────────────────────────────────
  const applyDbRide = useCallback((r: DbRide & { driver_name?: string; passenger_name?: string }) => {
    rideDetailsRef.current = {
      distanceKm:  r.distance_km  ?? null,
      durationMin: r.duration_min ?? null,
    };
    setRide({
      status:          r.status as RideStatus,
      rideId:          r.id,
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
  const subscribeToRide = useCallback((rideId: string, driverId?: string) => {
    unsubRef.current?.();
    driverLocUnsub.current?.();
    driverLocUnsub.current = null;

    unsubRef.current = rideService.subscribeToRide(rideId, (updated) => {
      setRide({
        status:          updated.status as RideStatus,
        rideId:          updated.id,
        pickup:          updated.origin_address,
        destination:     updated.dest_address,
        pickupCoords:    { lat: updated.origin_lat, lng: updated.origin_lng },
        destCoords:      { lat: updated.dest_lat,   lng: updated.dest_lng },
        surgeMultiplier: updated.surge_multiplier,
        priceKz:         updated.price_kz,
        driverId:        updated.driver_id ?? undefined,
        driverConfirmed: updated.driver_confirmed,
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
        setTimeout(() => {
          if (updated.status !== RideStatus.COMPLETED) resetRide();
          unsubRef.current?.();
        }, updated.status === RideStatus.COMPLETED ? 5000 : 2000);
      }
    });

    // Subscrever GPS imediatamente se já há motorista
    if (driverId && !driverLocUnsub.current) {
      driverLocUnsub.current = rideService.subscribeToDriverLocation(
        driverId,
        (coords) => setRide({ carLocation: coords })
      );
    }
  }, [setRide, resetRide]);

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
    pickup: string, pickupCoords: LatLng, dest: string, destCoords: LatLng
  ) => {
    if (!dbUser?.id) { setError({ code: 'not_auth', message: 'Precisas de fazer login.' }); return; }

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
  }, [dbUser?.id, auction.selectedDriver, subscribeToRide, applyDbRide, resetAuction, showToast]);

  // ── cancelRide ────────────────────────────────────────────────────────────
  const cancelRide = useCallback(async (reason?: string) => {
    if (!dbUser?.id || !ride.rideId) return;
    setLoading(true);
    try {
      const err = await rideService.cancelRide(ride.rideId, dbUser.id, reason);
      if (err) { showToast(err.message, 'error'); return; }
      driverLocUnsub.current?.(); driverLocUnsub.current = null;
      resetRide();
      resetAuction();
      unsubRef.current?.();
      showToast('Corrida cancelada.', 'info');
    } finally {
      setLoading(false);
    }
  }, [dbUser?.id, ride.rideId, resetRide, resetAuction, showToast]);

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
      resetRide();
      unsubRef.current?.();
    } catch {
      showToast('Erro ao recusar corrida.', 'error');
    }
  }, [dbUser?.id, resetRide, showToast]);

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
      resetRide();
      showToast('Avaliação enviada. Obrigado!', 'success');
    } catch {
      showToast('Erro ao enviar avaliação.', 'error');
    }
  }, [dbUser?.id, postRide, resetPostRide, resetRide, showToast]);

  const dismissPostRide = useCallback(() => {
    resetPostRide();
    resetRide();
  }, [resetPostRide, resetRide]);

  return {
    ride, auction, postRide, loading, error,
    startAuction, selectDriver, cancelAuction,
    requestRide, cancelRide, acceptRide, confirmRide, declineRide, advanceStatus,
    submitReview, dismissPostRide,
    clearError: () => setError(null),
  };
}
