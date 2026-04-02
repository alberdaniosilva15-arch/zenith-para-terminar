// =============================================================================
// MOTOGO AI v3.0 — useRide.ts (CORRIGIDO FINAL)
// ✅ FIX 1: applyDbRide popula driverName e passengerName
// ✅ FIX 2: driverLocUnsub ref adicionado — subscreve posição GPS do motorista
// ✅ FIX 3: cleanup correcto no useEffect (cancela ambos os canais)
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { rideService } from '../services/rideService';
import { mapService } from '../services/mapService';
import { useAuth } from '../contexts/AuthContext';
import type { RideState, DbRide, AppError, LatLng, AuctionDriver, AuctionState, PostRideState } from '../types';
import { RideStatus } from '../types';

const INITIAL_RIDE: RideState = { status: RideStatus.IDLE, surgeMultiplier: 1.0 };
const INITIAL_AUCTION: AuctionState = { loading: false, drivers: [], selectedDriver: null, error: null };
const INITIAL_POST_RIDE: PostRideState = { active: false, rideId: null, driverId: null, driverName: null, driverRating: null, priceKz: null };

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
  const [auction,  setAuction]  = useState<AuctionState>(INITIAL_AUCTION);
  const [postRide, setPostRide] = useState<PostRideState>(INITIAL_POST_RIDE);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<AppError | null>(null);

  const unsubRef       = useRef<(() => void) | null>(null);
  // ✅ FIX 2: ref para subscrição GPS do motorista
  const driverLocUnsub = useRef<(() => void) | null>(null);
  const prevStatusRef  = useRef<RideStatus>(RideStatus.IDLE);

  // ── v3.0: Persistência offline (localStorage) ────────────────────────────
  // Se a rede cair a meio de uma corrida, o estado não perde-se
  const RIDE_STORAGE_KEY = 'motogo_ride_state_v3';

  const [ride, setRide] = useState<RideState>(() => {
    try {
      const saved = localStorage.getItem(RIDE_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as RideState;
        // Só restaura se não for IDLE (IDLE não precisa de persistência)
        if (parsed.status !== RideStatus.IDLE) return parsed;
      }
    } catch { /* corrupção de storage — ignora */ }
    return INITIAL_RIDE;
  });
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Detectar transição para COMPLETED → activar post-ride review
  // ------------------------------------------------------------------
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
        });
      }, 2000);
    }
    prevStatusRef.current = curr;
  }, [ride.status]);

  // ── v3.0: Guarda estado da corrida no localStorage ───────────────────────
  useEffect(() => {
    if (ride.status === RideStatus.IDLE) {
      localStorage.removeItem(RIDE_STORAGE_KEY);
    } else {
      try {
        localStorage.setItem(RIDE_STORAGE_KEY, JSON.stringify(ride));
      } catch { /* storage cheio — ignora */ }
    }
  }, [ride]);

  // ------------------------------------------------------------------
  // ✅ FIX 1: applyDbRide popula driverName e passengerName
  // ------------------------------------------------------------------
  const applyDbRide = (r: DbRide & { driver_name?: string; passenger_name?: string }) => {
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
      // ✅ FIX 1: nomes vindos do join a profiles
      driverName:      r.driver_name    ?? undefined,
      passengerName:   r.passenger_name ?? undefined,
    });
  };

  // ------------------------------------------------------------------
  // ✅ FIX 2: subscribeToRide também subscreve à localização GPS
  // ------------------------------------------------------------------
  const subscribeToRide = useCallback((rideId: string, driverId?: string) => {
    unsubRef.current?.();
    unsubRef.current = rideService.subscribeToRide(rideId, (updated) => {
      // Preservar nomes já conhecidos enquanto o Realtime não os devolve
      setRide(prev => ({
        ...prev,
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
      }));

      // ✅ FIX 2: subscrever GPS quando motorista é atribuído
      if (updated.driver_id && driverLocUnsub.current === null) {
        driverLocUnsub.current = rideService.subscribeToDriverLocation(
          updated.driver_id,
          (coords) => setRide(prev => ({ ...prev, carLocation: coords }))
        );
      }

      if (updated.status === RideStatus.COMPLETED || updated.status === RideStatus.CANCELLED) {
        driverLocUnsub.current?.();
        driverLocUnsub.current = null;
        setTimeout(() => {
          if (updated.status !== RideStatus.COMPLETED) setRide(INITIAL_RIDE);
          unsubRef.current?.();
        }, updated.status === RideStatus.COMPLETED ? 5000 : 2000);
      }
    });

    // Subscrever GPS imediatamente se já há motorista
    if (driverId && driverLocUnsub.current === null) {
      driverLocUnsub.current = rideService.subscribeToDriverLocation(
        driverId,
        (coords) => setRide(prev => ({ ...prev, carLocation: coords }))
      );
    }
  }, []);

  // ------------------------------------------------------------------
  // LEILÃO
  // ------------------------------------------------------------------
  const startAuction = useCallback(async (pickupCoords: LatLng) => {
    setAuction({ loading: true, drivers: [], selectedDriver: null, error: null });
    const drivers = await rideService.getDriversForAuction(pickupCoords);
    if (drivers.length === 0) {
      setAuction({ loading: false, drivers: [], selectedDriver: null, error: 'Nenhum motorista disponível na tua zona. Tenta em breve.' });
      return;
    }
    setAuction({ loading: false, drivers, selectedDriver: null, error: null });
    setRide(prev => ({ ...prev, status: RideStatus.BROWSING }));
  }, []);

  const selectDriver = useCallback((driver: AuctionDriver) => {
    setAuction(prev => ({ ...prev, selectedDriver: driver }));
  }, []);

  const cancelAuction = useCallback(() => {
    setAuction(INITIAL_AUCTION);
    setRide(prev => ({ ...prev, status: RideStatus.IDLE }));
  }, []);

  // ------------------------------------------------------------------
  // requestRide
  // ------------------------------------------------------------------
  const requestRide = useCallback(async (
    pickup: string, pickupCoords: LatLng, dest: string, destCoords: LatLng
  ) => {
    if (!dbUser?.id) { setError({ code: 'not_auth', message: 'Precisas de fazer login.' }); return; }
    setLoading(true); setError(null);

    let rPickup = pickupCoords, rDest = destCoords;
    if (!pickupCoords.lat) { const g = await mapService.geocodeAddress(pickup); if (g) rPickup = g; }
    if (!destCoords.lat)   { const g = await mapService.geocodeAddress(dest);   if (g) rDest   = g; }

    const { data, error: e } = await rideService.createRide({
      passenger_id:       dbUser.id,
      origin_address:     pickup,   origin_lat: rPickup.lat, origin_lng: rPickup.lng,
      dest_address:       dest,     dest_lat:   rDest.lat,   dest_lng:   rDest.lng,
      selected_driver_id: auction.selectedDriver?.driver_id,
    });

    setLoading(false);
    if (e || !data) { setError(e ?? { code: 'unknown', message: 'Erro ao criar corrida.' }); return; }

    setAuction(INITIAL_AUCTION);
    applyDbRide(data);
    subscribeToRide(data.id, data.driver_id ?? undefined);
  }, [dbUser?.id, auction.selectedDriver, subscribeToRide]);

  // ------------------------------------------------------------------
  // cancelRide
  // ------------------------------------------------------------------
  const cancelRide = useCallback(async (reason?: string) => {
    if (!dbUser?.id || !ride.rideId) return;
    setLoading(true);
    await rideService.cancelRide(ride.rideId, dbUser.id, reason);
    setLoading(false);
    driverLocUnsub.current?.(); driverLocUnsub.current = null;
    setRide(INITIAL_RIDE); setAuction(INITIAL_AUCTION);
    unsubRef.current?.();
  }, [dbUser?.id, ride.rideId]);

  // ------------------------------------------------------------------
  // acceptRide / confirmRide / declineRide
  // ------------------------------------------------------------------
  const acceptRide = useCallback(async (rideId: string) => {
    if (!dbUser?.id) return;
    setLoading(true);
    const { data, error: e } = await rideService.acceptRide(rideId, dbUser.id);
    setLoading(false);
    if (e || !data) { setError(e ?? { code: 'accept_fail', message: 'Corrida já aceite.' }); return; }
    applyDbRide(data); subscribeToRide(data.id, data.driver_id ?? undefined);
  }, [dbUser?.id, subscribeToRide]);

  const confirmRide = useCallback(async (rideId: string) => {
    if (!dbUser?.id) return;
    setLoading(true);
    const { data, error: e } = await rideService.driverConfirmRide(rideId, dbUser.id);
    setLoading(false);
    if (e || !data) { setError(e ?? { code: 'confirm_fail', message: 'Erro ao confirmar.' }); return; }
    applyDbRide(data); subscribeToRide(data.id, data.driver_id ?? undefined);
  }, [dbUser?.id, subscribeToRide]);

  const declineRide = useCallback(async (rideId: string) => {
    if (!dbUser?.id) return;
    await rideService.driverDeclineRide(rideId, dbUser.id);
    driverLocUnsub.current?.(); driverLocUnsub.current = null;
    setRide(INITIAL_RIDE); unsubRef.current?.();
  }, [dbUser?.id]);

  // ------------------------------------------------------------------
  // advanceStatus
  // ------------------------------------------------------------------
  const advanceStatus = useCallback(async (status: RideStatus) => {
    if (!dbUser?.id || !ride.rideId) return;
    setLoading(true);
    const { data, error: e } = await rideService.updateRideStatus(ride.rideId, status, dbUser.id);
    setLoading(false);
    if (e || !data) { setError(e ?? { code: 'update_fail', message: 'Erro.' }); return; }
    applyDbRide(data);
  }, [dbUser?.id, ride.rideId]);

  // ------------------------------------------------------------------
  // submitReview
  // ------------------------------------------------------------------
  const submitReview = useCallback(async (score: number, comment?: string) => {
    if (!dbUser?.id || !postRide.rideId || !postRide.driverId) return;
    await rideService.submitRating({ ride_id: postRide.rideId, from_user: dbUser.id, to_user: postRide.driverId, score, comment });
    setPostRide(INITIAL_POST_RIDE);
    setRide(INITIAL_RIDE);
  }, [dbUser?.id, postRide]);

  const dismissPostRide = useCallback(() => {
    setPostRide(INITIAL_POST_RIDE);
    setRide(INITIAL_RIDE);
  }, []);

  return {
    ride, auction, postRide, loading, error,
    startAuction, selectDriver, cancelAuction,
    requestRide, cancelRide, acceptRide, confirmRide, declineRide, advanceStatus,
    submitReview, dismissPostRide,
    clearError: () => setError(null),
  };
}
