// =============================================================================
// ZENITH RIDE v3.3 — usePassengerSearch.ts
// Hook responsável pela pesquisa de locais com debounce, cancelamento e geocoding
// =============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { mapService, LUANDA_STATIC_LOCATIONS } from '../services/mapService';
import { zonePriceService } from '../services/zonePrice';
import type { LocationResult, LatLng } from '../types';

interface UsePassengerSearchProps {
  userLocation: LatLng | null;
  pickupName: string;
  onSelectPickup: (name: string, coords: LatLng) => void;
  onSelectDest: (name: string, coords: LatLng) => void;
  onZonePriceUpdate: (
    zonePrice: number | null,
    zoneNames: { origin: string; dest: string } | null,
  ) => void;
}

export function usePassengerSearch({
  userLocation,
  pickupName,
  onSelectPickup,
  onSelectDest,
  onZonePriceUpdate,
}: UsePassengerSearchProps) {
  const [selecting, setSelecting] = useState<'pickup' | 'dest' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);

      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }

      if (query.length < 2) {
        setResults(LUANDA_STATIC_LOCATIONS.filter((l: LocationResult) => l.isPopular));
        return;
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;

      searchDebounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const res = await mapService.searchPlaces(
            query,
            userLocation ?? undefined,
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setResults(res);
          }
        } catch (err: any) {
          if (err.name === 'AbortError') return;
          console.warn('[usePassengerSearch] Search error:', err);
        } finally {
          if (!controller.signal.aborted) {
            setSearching(false);
          }
        }
      }, 350);
    },
    [userLocation],
  );

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (searchAbortRef.current) searchAbortRef.current.abort();
    };
  }, []);

  const selectLocation = async (loc: LocationResult) => {
    if (loc.mapboxId && (!loc.coords || (loc.coords.lat === 0 && loc.coords.lng === 0))) {
      try {
        const retrieved = await mapService.retrievePlace(loc.mapboxId);
        if (retrieved) loc.coords = retrieved;
      } catch (err) {
        console.warn('[usePassengerSearch] Falha ao recuperar coordenadas:', err);
      }
    }

    if (selecting === 'pickup') {
      onSelectPickup(loc.name, loc.coords);
    } else {
      onSelectDest(loc.name, loc.coords);
      const currentPickup = pickupName || '';
      if (currentPickup && loc.name) {
        try {
          const zp = await zonePriceService.getZonePrice(currentPickup, loc.name);
          if (zp) {
            onZonePriceUpdate(zp.price_kz, { origin: zp.origin_zone, dest: zp.dest_zone });
          } else {
            onZonePriceUpdate(null, null);
          }
        } catch {
          onZonePriceUpdate(null, null);
        }
      }
    }

    setSelecting(null);
    setSearchQuery('');
    setResults([]);
  };

  const useGPS = async () => {
    setSearching(true);
    try {
      const coords = await mapService.getCurrentPosition();
      const address = await mapService.reverseGeocode(coords);
      onSelectPickup(address, coords);
      setSelecting(null);
      setSearchQuery('');
    } catch (err) {
      console.warn('[usePassengerSearch] GPS error:', err);
    } finally {
      setSearching(false);
    }
  };

  return {
    selecting,
    setSelecting,
    searchQuery,
    setSearchQuery,
    results,
    setResults,
    searching,
    setSearching,
    handleSearch,
    selectLocation,
    useGPS,
  };
}
