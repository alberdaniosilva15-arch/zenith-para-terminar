// =============================================================================
// ZENITH RIDE v3.3 — src/hooks/useDriverLocationSync.ts
//
// Geolocalização contínua do motorista (extraído de DriverHome.tsx — SRP):
//   • Rastreio contínuo via GPS (watchPosition) e publicação em `driver_locations`
//   • Cálculo do índice geoespacial H3 (resolução 9) para o despacho por vizinhança
//   • Cálculo do rácio/consumo de bateria para o guarda de autonomia
//   • Persistência periódica e marcação de `online_minutes_idle`
//
// O hook devolve as coordenadas actuais (state) e uma ref sempre actualizada,
// que o cockpit usa para recalcular a rota de navegação.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { latLngToCell } from 'h3-js';
import { supabase } from '../lib/supabase';
import { mapService } from '../services/mapService';
import { rideService } from '../services/rideService';
import type { LatLng } from '../types';

interface UseDriverLocationSyncArgs {
  driverId: string;
  isOnline: boolean;
  /** Assinatura de ciclo de vida: quando a corrida activa arranca, o idle volta a 0. */
  activeRideId?: string | null;
  /** Momento (ISO) em que o motorista ficou online. */
  onlineSince: string | null;
  /** Notifica o cockpit do novo valor de minutos idle para UI. */
  onIdleMinutes?: (minutes: number) => void;
}

export function useDriverLocationSync({
  driverId,
  isOnline,
  activeRideId,
  onlineSince,
  onIdleMinutes,
}: UseDriverLocationSyncArgs) {
  const [driverCoords, setDriverCoords] = useState<LatLng | null>(null);
  const driverCoordsRef = useRef<LatLng | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [h3Cell, setH3Cell] = useState<string | null>(null);

  const gpsRef = useRef<(() => void) | null>(null);

  // ── Bateria: guarda de autonomia do turno ─────────────────────────────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !(navigator as any).getBattery) return;
    let battery: any;
    let cancelled = false;

    const sync = () => {
      if (!cancelled && battery) setBatteryLevel(battery.level);
    };

    (navigator as any).getBattery()
      .then((b: any) => {
        if (cancelled) return;
        battery = b;
        sync();
        b.addEventListener?.('levelchange', sync);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      battery?.removeEventListener?.('levelchange', sync);
    };
  }, []);

  // ── Rastreio GPS contínuo ─────────────────────────────────────────────────
  const startGpsTracking = useCallback(() => {
    if (gpsRef.current) return;

    gpsRef.current = mapService.watchPosition(async (coords, heading) => {
      setDriverCoords(coords);
      driverCoordsRef.current = coords;
      // Índice H3 de resolução 9 — usado pelo despacho por vizinhança.
      setH3Cell(latLngToCell(coords.lat, coords.lng, 9));
      await rideService.updateDriverLocation(driverId, coords, heading);
    });
  }, [driverId]);

  const stopGpsTracking = useCallback(() => {
    if (gpsRef.current) {
      gpsRef.current();
      gpsRef.current = null;
    }
  }, []);

  // Ligar/desligar com o estado online
  useEffect(() => {
    if (!isOnline) {
      stopGpsTracking();
      return;
    }
    startGpsTracking();
    return () => stopGpsTracking();
  }, [isOnline, startGpsTracking, stopGpsTracking]);

  // Limpeza final ao desmontar
  useEffect(() => {
    return () => {
      stopGpsTracking();
    };
  }, [stopGpsTracking]);

  // ── Minutos idle: mantém `driver_locations.online_minutes_idle` actualizado ─
  useEffect(() => {
    if (!isOnline || !onlineSince) {
      onIdleMinutes?.(0);
      return;
    }

    if (activeRideId) {
      onIdleMinutes?.(0);
      return;
    }

    const recalc = () => {
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(onlineSince).getTime()) / 60_000));
      onIdleMinutes?.(minutes);
      void supabase
        .from('driver_locations')
        .update({ online_minutes_idle: minutes })
        .eq('driver_id', driverId);
    };

    recalc();
    const interval = window.setInterval(recalc, 60_000);
    return () => window.clearInterval(interval);
  }, [driverId, isOnline, onlineSince, activeRideId, onIdleMinutes]);

  /** Define as coordenadas a partir de fora (ex: fallback do goOnline). */
  const primeCoords = useCallback((coords: LatLng) => {
    setDriverCoords(coords);
    driverCoordsRef.current = coords;
  }, []);

  return {
    driverCoords,
    setDriverCoords,
    driverCoordsRef,
    batteryLevel,
    h3Cell,
    startGpsTracking,
    stopGpsTracking,
    primeCoords,
    gpsRef,
  };
}
