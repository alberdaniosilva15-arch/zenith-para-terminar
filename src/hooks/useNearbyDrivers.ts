// =============================================================================
// useNearbyDrivers — Hook para contar motoristas próximos
// Extração do useEffect (linhas 222-230 do PassengerHome original)
// =============================================================================

import { useState, useEffect } from 'react';
import { rideService } from '../services/rideService';
import type { LatLng } from '../types';

export function useNearbyDrivers(pickupCoords: LatLng | null, isVisible: boolean) {
  const [nearbyCount, setNearbyCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isVisible || !pickupCoords) {
      setNearbyCount(null);
      return;
    }

    let cancelled = false;
    rideService.findNearbyDrivers(pickupCoords, 8)
      .then(drivers => {
        if (!cancelled) setNearbyCount(drivers.length);
      })
      .catch(() => {
        if (!cancelled) setNearbyCount(null);
      });

    return () => { cancelled = true; };
  }, [pickupCoords, isVisible]);

  return { nearbyCount };
}
