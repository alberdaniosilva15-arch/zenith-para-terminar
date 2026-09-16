// =============================================================================
// ZENITH RIDE v3.3 — usePassengerLiveRoute.ts
// Hook de rastreio dinâmico do motorista e recálculo da rota de aproximação
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import type mapboxgl from 'mapbox-gl';
import { MapSingleton } from '../lib/mapInstance';
import { createDriverMarkerElement } from '../lib/driverMarker';
import { drawRoute, clearRoute } from '../map/mapRoutingLayer';
import { haversineMeters } from '../lib/geo';
import { mapService } from '../services/mapService';
import type { RideState } from '../types';
import { RideStatus } from '../types';

function calculateBBox(coords: [number, number][]): [number, number, number, number] {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

interface UsePassengerLiveRouteProps {
  ride: RideState;
  isVisible?: boolean;
}

export function usePassengerLiveRoute({ ride, isVisible = true }: UsePassengerLiveRouteProps) {
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const currentRouteCoordsRef = useRef<[number, number][]>([]);
  const lastRecalcTimeRef = useRef<number>(0);
  const [approachEtaMin, setApproachEtaMin] = useState<number | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    const isActiveRide =
      ride.status === RideStatus.ACCEPTED ||
      ride.status === RideStatus.PICKING_UP ||
      ride.status === RideStatus.IN_PROGRESS;

    const map = MapSingleton.get();

    if (!isActiveRide) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      currentRouteCoordsRef.current = [];
      setApproachEtaMin(null);
      return;
    }

    // Alvo da rota: se em viagem (in_progress) vai até ao destino; se a recolher vai até ao passageiro
    const targetCoords =
      ride.status === RideStatus.IN_PROGRESS
        ? ride.destCoords
        : ride.pickupCoords;

    const startCoords = ride.carLocation ?? ride.pickupCoords;

    if (!targetCoords || !map) return;

    // 1. Atualizar ou posicionar o marcador do motorista no mapa com rotação real
    if (ride.carLocation && Number.isFinite(ride.carLocation.lng) && Number.isFinite(ride.carLocation.lat)) {
      const [lng, lat] = [ride.carLocation.lng, ride.carLocation.lat];
      const heading = (ride.carLocation as any).heading ?? 0;

      if (!driverMarkerRef.current) {
        const markerEl = createDriverMarkerElement(heading);
        import('mapbox-gl').then((mb) => {
          if (!driverMarkerRef.current && map) {
            driverMarkerRef.current = new mb.default.Marker({ element: markerEl, rotationAlignment: 'map' })
              .setLngLat([lng, lat])
              .addTo(map);
          }
        });
      } else {
        driverMarkerRef.current.setLngLat([lng, lat]);
        const el = driverMarkerRef.current.getElement();
        if (el && typeof heading === 'number') {
          el.style.transform = `rotate(${heading}deg)`;
        }
      }
    }

    // 2. Traçar ou recalcular rota se desvio detectado (> 45m) ou se ainda não temos rota traçada
    if (!startCoords) return;

    const now = Date.now();
    const hasRoute = currentRouteCoordsRef.current.length > 0;
    let shouldRecalculate = !hasRoute;

    if (hasRoute && ride.carLocation && now - lastRecalcTimeRef.current > 5000) {
      // Calcular distância mínima aos pontos da rota traçada
      let minDistance = Infinity;
      for (const [rLng, rLat] of currentRouteCoordsRef.current) {
        const d = haversineMeters(ride.carLocation.lat, ride.carLocation.lng, rLat, rLng);
        if (d < minDistance) minDistance = d;
      }
      // Se o motorista passou uma curva ou entrou noutra via (> 45m fora da linha)
      if (minDistance > 45) {
        shouldRecalculate = true;
      }
    }

    if (!shouldRecalculate) return;

    let cancelled = false;
    lastRecalcTimeRef.current = now;

    mapService.getRouteDistance(startCoords, targetCoords)
      .then((routeResult) => {
        if (cancelled) return;
        if (routeResult.durationMin) setApproachEtaMin(routeResult.durationMin);
        if (routeResult.geometry?.coordinates) {
          currentRouteCoordsRef.current = routeResult.geometry.coordinates as [number, number][];
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
      .catch((err) => console.warn('[usePassengerLiveRoute] Falha ao traçar/recalcular rota da corrida:', err));

    return () => {
      cancelled = true;
    };
  }, [
    isVisible,
    ride.status,
    ride.carLocation?.lat,
    ride.carLocation?.lng,
    (ride.carLocation as any)?.heading,
    ride.pickupCoords?.lat,
    ride.pickupCoords?.lng,
    ride.destCoords?.lat,
    ride.destCoords?.lng,
  ]);

  return { approachEtaMin };
}
