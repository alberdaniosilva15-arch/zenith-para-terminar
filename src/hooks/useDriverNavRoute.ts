// =============================================================================
// ZENITH RIDE v3.3 — useDriverNavRoute.ts
// Hook de rota de navegação operacional do cockpit com recálculo dinâmico
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import { MapSingleton } from '../lib/mapInstance';
import { drawRoute, clearRoute } from '../map/mapRoutingLayer';
import { haversineMeters } from '../lib/geo';
import { mapService } from '../services/mapService';
import type { RideState, LatLng } from '../types';
import { RideStatus } from '../types';

function calculateBBox(coords: [number, number][]): [number, number, number, number] {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

interface UseDriverNavRouteProps {
  ride: RideState;
  driverCoords: LatLng | null;
  driverCoordsRef: React.MutableRefObject<LatLng | null>;
}

export function useDriverNavRoute({
  ride,
  driverCoords,
  driverCoordsRef,
}: UseDriverNavRouteProps) {
  const driverRouteCoordsRef = useRef<[number, number][]>([]);
  const lastDriverRecalcTimeRef = useRef<number>(0);
  const [navEtaMin, setNavEtaMin] = useState<number | null>(null);

  useEffect(() => {
    const isActiveRide =
      ride.status === RideStatus.ACCEPTED ||
      ride.status === RideStatus.PICKING_UP ||
      ride.status === RideStatus.IN_PROGRESS;

    const map = MapSingleton.get();

    if (!isActiveRide) {
      if (map) clearRoute(map);
      driverRouteCoordsRef.current = [];
      setNavEtaMin(null);
      return;
    }

    // Alvo: se em viagem (in_progress) vai até ao destino; se a recolher vai ao ponto de encontro
    const targetCoords =
      ride.status === RideStatus.IN_PROGRESS
        ? ride.destCoords
        : ride.pickupCoords;

    const startCoords = driverCoordsRef.current ?? ride.carLocation ?? ride.pickupCoords;

    if (!targetCoords || !startCoords || !map) return;

    const now = Date.now();
    const hasRoute = driverRouteCoordsRef.current.length > 0;
    let shouldRecalculate = !hasRoute;

    if (hasRoute && driverCoordsRef.current && now - lastDriverRecalcTimeRef.current > 4000) {
      let minDistance = Infinity;
      for (const [rLng, rLat] of driverRouteCoordsRef.current) {
        const d = haversineMeters(driverCoordsRef.current.lat, driverCoordsRef.current.lng, rLat, rLng);
        if (d < minDistance) minDistance = d;
      }
      // Se o condutor passou a curva, desviou-se ou entrou noutra via (> 45m)
      if (minDistance > 45) {
        shouldRecalculate = true;
      }
    }

    if (!shouldRecalculate) return;

    let cancelled = false;
    lastDriverRecalcTimeRef.current = now;

    mapService.getRouteDistance(startCoords, targetCoords)
      .then((routeResult) => {
        if (cancelled) return;
        if (routeResult.durationMin) setNavEtaMin(routeResult.durationMin);
        if (routeResult.geometry?.coordinates) {
          driverRouteCoordsRef.current = routeResult.geometry.coordinates as [number, number][];
          clearRoute(map);
          drawRoute(map, {
            distanceKm: routeResult.distanceKm,
            durationMinutes: routeResult.durationMin,
            durationText: `${routeResult.durationMin} min`,
            geojson: {
              type: 'Feature',
              geometry: routeResult.geometry,
              properties: {},
            },
            bbox: calculateBBox(routeResult.geometry.coordinates as [number, number][]),
          });
        }
      })
      .catch((err) => console.warn('[useDriverNavRoute] Falha ao traçar rota no cockpit:', err));

    return () => {
      cancelled = true;
    };
  }, [
    ride.status,
    driverCoords?.lat,
    driverCoords?.lng,
    ride.carLocation?.lat,
    ride.carLocation?.lng,
    ride.pickupCoords?.lat,
    ride.pickupCoords?.lng,
    ride.destCoords?.lat,
    ride.destCoords?.lng,
  ]);

  return { navEtaMin };
}
