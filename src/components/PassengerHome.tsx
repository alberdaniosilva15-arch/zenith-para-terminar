// =============================================================================
// ZENITH RIDE v3.1 — PassengerHome.tsx
// FIXES v3.1:
//   1. userLocation → posição GPS real passada ao Map3D (mapa centra correctamente)
//   2. useGPS actualiza userLocation imediatamente → mapa move-se para o utilizador
//   3. Map3D recebe userLocation={userLocation} em vez de ficara centrado em Luanda
// =============================================================================

import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { Megaphone } from 'lucide-react';
import RideTalk from './RideTalk';
import LocationSearch from './passenger/LocationSearch';
import RoutePreview from './passenger/RoutePreview';
import AuctionList from './passenger/AuctionList';
import RideRequestForm from './passenger/RideRequestForm';
import ActiveRideCard from './passenger/ActiveRideCard';
const Map3D = React.lazy(() => import('./Map3D'));
const AgoraCall = React.lazy(() => import('./AgoraCall'));
import KazePreditivo  from './KazePreditivo';
import FreePerkBanner from './FreePerkBanner';
import ZonePriceMap   from './ZonePriceMap';
import { mapService, LUANDA_STATIC_LOCATIONS } from '../services/mapService';
import { zonePriceService } from '../services/zonePrice';
import { rideService } from '../services/rideService';
import { routeService, RouteResult } from '../services/routeService';
import { supabase } from '../lib/supabase';
import type { RideState, AuctionState, AuctionDriver, LocationResult, LatLng } from '../types';
import { RideStatus, UserRole } from '../types';

interface PassengerHomeProps {
  ride:            RideState;
  auction:         AuctionState;
  userId:          string;
  onStartAuction:  (pickupCoords: LatLng) => Promise<void>;
  onSelectDriver:  (driver: AuctionDriver) => void;
  onCancelAuction: () => void;
  onRequestRide:   (pickup: string, pickupCoords: LatLng, dest: string, destCoords: LatLng) => Promise<void>;
  onCancelRide:    (reason?: string) => Promise<void>;
  dataSaver:       boolean;
}

interface RouteInfo {
  distanceKm:  number;
  durationMin: number;
}

const PassengerHome: React.FC<PassengerHomeProps> = ({
  ride, auction, userId,
  onStartAuction, onSelectDriver, onCancelAuction,
  onRequestRide, onCancelRide, dataSaver,
}) => {
  const [selecting,    setSelecting]    = useState<'pickup' | 'dest' | null>(null);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [results,      setResults]      = useState<LocationResult[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [pickupName,   setPickupName]   = useState(ride.pickup ?? '');
  const [pickupCoords, setPickupCoords] = useState<LatLng | null>(ride.pickupCoords ?? null);
  const [destName,     setDestName]     = useState(ride.destination ?? '');
  const [destCoords,   setDestCoords]   = useState<LatLng | null>(ride.destCoords ?? null);
  const [zonePrice,    setZonePrice]    = useState<number | null>(null);
  const [zoneNames,    setZoneNames]    = useState<{ origin: string; dest: string } | null>(null);
  const [routeInfo,    setRouteInfo]    = useState<RouteInfo | null>(null);
  const [loadingRide,  setLoadingRide]  = useState(false);
  const [nearbyCount,  setNearbyCount]  = useState<number | null>(null);
  // FIX v3.1: posição GPS real do utilizador — passada ao Map3D para centrar correctamente
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  // Engine Pro: rota real + preço calculado no servidor
  const [routeData,    setRouteData]    = useState<RouteResult | null>(null);
  const [fareData, setFareData] = useState<{
    fare_kz: number;
    badges: string[];
    surge_factor: number;
    zone_multiplier: number;
    traffic_multiplier: number;
  } | null>(null);
  const [calculating,  setCalculating]  = useState(false);
  const [priceTimer,   setPriceTimer]   = useState<number>(0);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Quando destino muda: calcular distância + buscar preço de zona ──────────
  useEffect(() => {
    if (!pickupCoords || !destCoords) { setRouteInfo(null); return; }
    const info = mapService.calculateRouteInfo(pickupCoords, destCoords);
    setRouteInfo(info);
  }, [pickupCoords, destCoords]);

  // ── Buscar motoristas próximos para mostrar contador ─────────────────────────
  useEffect(() => {
    if (!pickupCoords) { setNearbyCount(null); return; }
    let cancelled = false;
    rideService.findNearbyDrivers(pickupCoords, 8).then(drivers => {
      if (!cancelled) setNearbyCount(drivers.length);
    });
    return () => { cancelled = true; };
  }, [pickupCoords]);

  // ── Pesquisa com debounce ────────────────────────────────────────────────────
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    if (query.length < 2) {
      setResults(LUANDA_STATIC_LOCATIONS.filter((l: LocationResult) => l.isPopular));
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await mapService.searchPlaces(query);
        setResults(res);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  useEffect(() => {
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, []);

  const selectLocation = async (loc: LocationResult) => {
    if (selecting === 'pickup') {
      setPickupName(loc.name);
      setPickupCoords(loc.coords);
    } else {
      setDestName(loc.name);
      setDestCoords(loc.coords);
      const currentPickup = pickupName || '';
      if (currentPickup && loc.name) {
        const zp = await zonePriceService.getZonePrice(currentPickup, loc.name);
        if (zp) {
          setZonePrice(zp.price_kz);
          setZoneNames({ origin: zp.origin_zone, dest: zp.dest_zone });
        } else {
          setZonePrice(null);
          setZoneNames(null);
        }
      }
    }
    setSelecting(null);
    setSearchQuery('');
    setResults([]);
  };

  // ── GPS com nome de bairro ───────────────────────────────────────────────────
  const useGPS = async () => {
    setSearching(true);
    try {
      const coords  = await mapService.getCurrentPosition();
      const address = await mapService.reverseGeocode(coords);
      setPickupName(address);
      setPickupCoords(coords);
      // FIX v3.1: guardar posição real para o mapa centrar correctamente
      setUserLocation(coords);
      setSelecting(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível obter a localização.';
      alert(`📍 ${msg}`);
    } finally {
      setSearching(false);
    }
  };

  // ── Calcular rota real (Google Routes API) + preço Engine Pro ───────────────
  const handleConfirmRoute = async () => {
    if (!pickupCoords || !destCoords) return;
    setCalculating(true);
    setFareData(null);
    setRouteData(null);
    routeService.clearCache();
    try {
      // 1. Rota real — chamada ÚNICA à Routes API
      const route = await routeService.getRoute(pickupCoords, destCoords);
      setRouteData(route);

      // 2. Preço calculado no servidor (Engine Pro protegido)
      const hour      = new Date().getHours();
      const isNight   = hour >= 22 || hour < 6;
      // Detectar aeroporto FAAN (lat -8.8577, lng 13.2312) no raio de 1km
      const distToAirport = Math.sqrt(
        Math.pow(destCoords.lat - (-8.8577), 2) +
        Math.pow(destCoords.lng - 13.2312, 2)
      ) * 111;
      const isAirport = distToAirport < 1.0;

      const { data: fare, error: fareError } = await supabase.rpc(
        'calculate_fare_engine_pro',
        {
          p_distance_km:    route.distanceKm,
          p_duration_min:   route.durationMin,
          p_origin_lat:     pickupCoords.lat,
          p_origin_lng:     pickupCoords.lng,
          p_dest_lat:       destCoords.lat,
          p_dest_lng:       destCoords.lng,
          p_service_tier:   'standard',
          p_demand_count:   5,
          p_supply_count:   5,
          p_is_night:       isNight,
          p_is_airport:     isAirport,
          p_traffic_factor: route.trafficFactor,
        }
      );

      if (fareError) throw new Error('Erro ao calcular preço. O servidor não respondeu.');
      setFareData(fare);
      setPriceTimer(120); // 2 minutos de lock
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao calcular rota. Verifica a tua ligação.';
      alert(`❌ ${msg}`);
      setRouteData(null);
      setFareData(null);
    } finally {
      setCalculating(false);
    }
  };

  // ── "VER MOTORISTAS" — pesquisa real de motoristas ─────────────────────────────
  const handleShowDrivers = async () => {
    if (!pickupCoords || !destName) return;
    await onStartAuction(pickupCoords);
  };

  // ── "CHAMAR TÁXI" (fallback sem destino definido) ───────────────────────────
  const handleCallTaxi = async () => {
    if (!pickupCoords) {
      setSearching(true);
      try {
        const coords  = await mapService.getCurrentPosition();
        const address = await mapService.reverseGeocode(coords);
        setPickupName(address);
        setPickupCoords(coords);
      } catch { /* usar fallback se GPS falhar */ } finally {
        setSearching(false);
      }
      setSelecting('dest');
      handleSearch('');
      return;
    }
    if (!destName) {
      setSelecting('dest');
      handleSearch('');
      return;
    }
    await handleShowDrivers();
  };

  // ── Countdown do lock de preço (2 minutos) ────────────────────────────────
  useEffect(() => {
    if (priceTimer <= 0) return;
    const interval = setInterval(() => {
      setPriceTimer(prev => {
        if (prev <= 1) {
          setFareData(null);
          setRouteData(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [priceTimer]);

  // ── Confirmar motorista escolhido ───────────────────────────────────────────────
  const handleConfirmDriver = async () => {
    if (!pickupName || !destName || !pickupCoords || !destCoords) return;
    setLoadingRide(true);
    await onRequestRide(pickupName, pickupCoords, destName, destCoords);
    setLoadingRide(false);
  };

  const isReady     = !!pickupName && !!destName;
  const showAuction = ride.status === RideStatus.BROWSING;

  // ==================================================================
  // ECRÃ DO LEILÃO — passageiro escolhe motorista
  // ==================================================================
  if (showAuction) {
    return (
      <div className="flex flex-col bg-[#F8FAFC] min-h-screen pb-28">
        <div className="bg-[#0A0A0A] px-6 pt-8 pb-6 flex items-center gap-4">
          <button
            onClick={onCancelAuction}
            className="w-10 h-10 bg-surface-container-low/10 rounded-full flex items-center justify-center text-white font-black hover:bg-surface-container-low/20 transition-all"
          >
            ←
          </button>
          <div>
            <p className="text-white font-black text-sm">Escolhe o teu motorista</p>
            <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest">
              {auction.loading ? 'A procurar...' : `${auction.drivers.length} disponíveis na tua zona`}
            </p>
          </div>
        </div>

        {/* Rota + distância */}
        <div className="mx-4 mt-4 bg-surface-container-low rounded-[2rem] p-4 border border-outline-variant/20 shadow-sm space-y-2">
          <RouteRow dot="bg-primary"  value={pickupName || 'Partida'} />
          <div className="my-1 pl-3 border-l-2 border-dashed border-outline-variant/30">
            {routeInfo && (
              <p className="text-[9px] font-bold text-on-surface-variant/70 py-1">
                📏 {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
              </p>
            )}
          </div>
          <RouteRow dot="bg-red-600"  value={destName || 'Destino'} />
          {(zonePrice || ride.priceKz) && (
            <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between">
              {zonePrice && zoneNames ? (
                <span className="text-[8px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black">✓ PREÇO FIXO</span>
              ) : (
                <span className="text-[8px] text-on-surface-variant/60 font-bold">Estimativa</span>
              )}
              <p className="text-right text-sm font-black text-primary">
                {Math.round(zonePrice ?? ride.priceKz ?? 0).toLocaleString('pt-AO')} Kz
              </p>
            </div>
          )}
        </div>

        <AuctionList
          auction={auction}
          onSelectDriver={onSelectDriver}
          onCancelAuction={onCancelAuction}
          zonePrice={zonePrice}
          priceKz={ride.priceKz ?? null}
        />

        {/* Botão confirmar */}
        {auction.selectedDriver && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface-container-low/95 backdrop-blur-sm border-t border-outline-variant/20">
            <button
              onClick={handleConfirmDriver}
              disabled={loadingRide}
              className="w-full py-6 bg-primary text-white rounded-[2.5rem] font-black text-sm uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(37,99,235,0.4)] active:scale-98 transition-all disabled:opacity-60"
            >
              {loadingRide ? (
                <span className="flex items-center justify-center gap-3">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  A confirmar...
                </span>
              ) : (
                `CONFIRMAR ${auction.selectedDriver.driver_name.split(' ')[0].toUpperCase()}`
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ==================================================================
  // ECRÃ NORMAL
  // ==================================================================
  return (
    <div className="relative min-h-full flex flex-col bg-[#050912]">
      <div className="absolute inset-0 z-0">
        <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-[#050912] text-white/50 text-xs">A carregar mapa...</div>}>
          <Map3D
            pickup={pickupCoords ?? undefined}
            destination={destCoords ?? undefined}
            status={ride.status}
            carLocation={ride.carLocation}
            userLocation={userLocation ?? undefined}
            dataSaver={dataSaver}
          />
        </Suspense>
      </div>

      <div className="relative z-10 p-4 space-y-4 flex-1 flex flex-col">

        {/* Card de rota */}
        <RoutePreview
          selecting={selecting}
          nearbyCount={nearbyCount}
          pickupName={pickupName}
          destName={destName}
          routeInfo={routeInfo}
          zonePrice={zonePrice}
          zoneNames={zoneNames}
          onSelectPickup={() => { setSelecting('pickup'); handleSearch(''); }}
          onSelectDest={() => { setSelecting('dest'); handleSearch(''); }}
        />

        {/* Overlay de pesquisa */}
        {selecting && (
          <LocationSearch
            selecting={selecting}
            searchQuery={searchQuery}
            results={results}
            searching={searching}
            onSearchChange={handleSearch}
            onClose={() => { setSelecting(null); setSearchQuery(''); setResults([]); }}
            onUseGPS={useGPS}
            onSelectLocation={selectLocation}
          />
        )}

        <div className="flex-1" />

        {/* Acções */}
        {!selecting && (
          <div className="space-y-4">
            {ride.status === RideStatus.IDLE && (
              <>
                <KazePreditivo
                  userId={userId}
                  onAccept={(pred) => {
                    setPickupName(pred.origin_address);
                    setPickupCoords({ lat: pred.origin_lat, lng: pred.origin_lng });
                    setDestName(pred.dest_address);
                    setDestCoords({ lat: pred.dest_lat, lng: pred.dest_lng });
                    zonePriceService.getZonePrice(pred.origin_address, pred.dest_address)
                      .then(zp => {
                        if (zp) { setZonePrice(zp.price_kz); setZoneNames({ origin: zp.origin_zone, dest: zp.dest_zone }); }
                      });
                  }}
                />
                <FreePerkBanner userId={userId} />
              </>
            )}

            <RideRequestForm
              rideStatus={ride.status}
              fareData={fareData}
              routeData={routeData}
              priceTimer={priceTimer}
              isReady={isReady}
              searching={searching}
              calculating={calculating}
              onCalculatePrice={handleConfirmRoute}
              onCallTaxi={handleCallTaxi}
              onConfirmRideRequest={handleShowDrivers}
            />

            <ActiveRideCard
              ride={ride}
              userId={userId}
              routeInfo={routeInfo}
              onCancelRide={onCancelRide}
            />

            <RideTalk zone="Geral" role={UserRole.PASSENGER} />
          </div>
        )}

        {/* FAB de destino rápido */}
        {!selecting && ride.status === RideStatus.IDLE && (
          <button
            onClick={() => { setSelecting('dest'); handleSearch(''); }}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 w-16 h-16 bg-primary text-white rounded-full shadow-[0_20px_50px_rgba(37,99,235,0.5)] flex items-center justify-center hover:scale-110 active:scale-95 transition-all border-4 border-white/30"
            aria-label="Escolher destino"
          >
            <Megaphone className="w-8 h-8" />
          </button>
        )}
      </div>
    </div>
  );
};

// ── Sub-componentes ────────────────────────────────────────────────────────────
const RouteRow: React.FC<{ dot: string; value: string }> = ({ dot, value }) => (
  <div className="flex items-center gap-3">
    <div className={`w-2 h-2 rounded-full ${dot} shrink-0`} />
    <p className="text-xs font-black text-on-surface-variant truncate">{value}</p>
  </div>
);

export default PassengerHome;
