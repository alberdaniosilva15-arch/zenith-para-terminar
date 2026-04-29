// =============================================================================
// usePassengerGPS — Hook de GPS automático para PassengerHome
// Extração do useEffect de GPS (linhas 126-149 do PassengerHome original)
// =============================================================================

import { useState, useEffect } from 'react';
import { mapService } from '../services/mapService';
import type { LatLng } from '../types';

interface UsePassengerGPSOptions {
  isVisible: boolean;
  existingPickupCoords: LatLng | null;
  onPickupDetected?: (coords: LatLng, address: string) => void;
}

export function usePassengerGPS({
  isVisible,
  existingPickupCoords,
  onPickupDetected,
}: UsePassengerGPSOptions) {
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;

    mapService.getCurrentPosition()
      .then(async (coords) => {
        if (cancelled) return;
        setUserLocation(coords);
        // Se não há pickup definido, usar a posição GPS como pickup
        if (!existingPickupCoords) {
          const address = await mapService.reverseGeocode(coords);
          if (!cancelled && onPickupDetected) {
            onPickupDetected(coords, address);
          }
        }
      })
      .catch(() => {
        // GPS indisponível — usar fallback silencioso Luanda Centro
        if (!cancelled) {
          setUserLocation({ lat: -8.8390, lng: 13.2343 });
        }
      });

    return () => { cancelled = true; };
  }, [isVisible]); // NÃO adicionar existingPickupCoords como dependência — executa só 1x

  return { userLocation, setUserLocation };
}
