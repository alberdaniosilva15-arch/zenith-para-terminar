// =============================================================================
// ZENITH RIDE v3.2 — PassengerHome.tsx
// REFACTOR v3.2:
//   1. GPS automático ao montar — mapa centra no utilizador sem clicar nada
//   2. Rota REAL via Mapbox Directions API (distância por estrada, não Haversine)
//   3. Rota DESENHADA no mapa com animação (usa mapRoutingLayer existente)
//   4. Pesquisa de locais agora passa posição actual para resultados relevantes
//   5. RoutePreview mostra dados REAIS (km por estrada, minutos com trânsito)
// =============================================================================

import React, { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';

import LocationSearch from './passenger/LocationSearch';
import RoutePreview from './passenger/RoutePreview';
import AuctionList from './passenger/AuctionList';
import RideRequestForm from './passenger/RideRequestForm';
import ActiveRideCard from './passenger/ActiveRideCard';
import KazePreditivo  from './KazePreditivo';
import FreePerkBanner from './FreePerkBanner';
import NightSafetyBanner from './NightSafetyBanner';
import MultiStopInput from './passenger/MultiStopInput';
import PrivateDriverModal from './passenger/PrivateDriverModal';
import CharterModal from './passenger/CharterModal';
import CargoModal from './passenger/CargoModal';
import { ReferralModal } from './ReferralModal';
import { usePassengerGPS } from '../hooks/usePassengerGPS';
import { useNearbyDrivers } from '../hooks/useNearbyDrivers';
import AuctionScreen from './passenger/AuctionScreen';
const ZonePriceMap = React.lazy(() => import('./ZonePriceMap'));
import PanicButton from './PanicButton';
import { mapService, LUANDA_STATIC_LOCATIONS } from '../services/mapService';
import { applyScoreDiscount, zonePriceService } from '../services/zonePrice';
import { rideService } from '../services/rideService';
import { routeService } from '../services/routeService';
import type { RouteResult } from '../services/routeService';
import { supabase } from '../lib/supabase';
import { useIdleMount } from '../hooks/useIdleMount';
import { useAppStore } from '../store/useAppStore';
import { useSilentTripleTap } from '../hooks/useSilentTripleTap';
import { MapSingleton } from '../lib/mapInstance';
import { drawRoute, clearRoute } from '../map/mapRoutingLayer';
import type {
  RideState,
  AuctionState,
  AuctionDriver,
  FareEstimate,
  LocationResult,
  LatLng,
  PassengerScore,
  RidePrediction,
  ServiceType,
} from '../types';
import { RideStatus } from '../types';

const ScheduleRide = React.lazy(() => import('./passenger/ScheduleRide'));
const Map3D = React.lazy(() => import('./Map3D'));
const AgoraCall = React.lazy(() => import('./AgoraCall'));

interface PassengerHomeProps {
  ride:            RideState;
  auction:         AuctionState;
  userId:          string;
  onStartAuction:  (pickupCoords: LatLng) => Promise<void>;
  onSelectDriver:  (driver: AuctionDriver) => void;
  onCancelAuction: () => void;
  onRequestRide:   (
    pickup: string,
    pickupCoords: LatLng,
    dest: string,
    destCoords: LatLng,
    proposedPrice?: number,
    distanceKm?: number,
    durationMin?: number,
    vehicleType?: Extract<ServiceType, 'standard' | 'moto' | 'comfort' | 'xl'>
  ) => Promise<void>;
  onCancelRide:    (reason?: string) => Promise<void>;
  dataSaver:       boolean;
  emergencyPhone?: string;
  isVisible?:      boolean;
}

interface RouteInfo {
  distanceKm:  number;
  durationMin: number;
  isReal:      boolean;   // true = vem da Directions API (estrada), false = Haversine
}

type StandardVehicleType = Extract<ServiceType, 'standard' | 'moto' | 'comfort' | 'xl'>;
type PremiumServiceType = Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;

const PassengerHome: React.FC<PassengerHomeProps> = ({
  ride, auction, userId,
  onStartAuction, onSelectDriver, onCancelAuction,
  onRequestRide, onCancelRide, dataSaver, emergencyPhone,
  isVisible = true,
}) => {
  const navigate = useNavigate();
  const showToast = useAppStore((s) => s.showToast);
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
  const [routeLoading, setRouteLoading] = useState(false);
  const [loadingRide,  setLoadingRide]  = useState(false);
  // Engine Pro: rota real + preço calculado no servidor
  const [routeData,    setRouteData]    = useState<RouteResult | null>(null);
  const [fareData, setFareData] = useState<FareEstimate | null>(null);
  const [passengerScore, setPassengerScore] = useState<PassengerScore | null>(null);
  const [calculating,  setCalculating]  = useState(false);
  const [fareExpiresAt, setFareExpiresAt] = useState<number | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDefaults, setScheduleDefaults] = useState<{ date?: string; time?: string } | null>(null);
  const [showReferral, setShowReferral] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<StandardVehicleType>('standard');
  const [openPremiumService, setOpenPremiumService] = useState<PremiumServiceType | null>(null);
  const [silentPanicSignal, setSilentPanicSignal] = useState(0);
  const [extraDropAddress, setExtraDropAddress] = useState<string | null>(null);
  const [extraDropCoords, setExtraDropCoords] = useState<LatLng | null>(null);
  const shouldMountMap = useIdleMount(isVisible);
  const hasActiveRideSafety =
    ride.status === RideStatus.ACCEPTED || ride.status === RideStatus.IN_PROGRESS;

  const ensureEmergencyContact = useCallback((message = 'Define um contacto de emergência antes de continuar.') => {
    if (emergencyPhone) {
      return true;
    }

    showToast(message, 'error');
    navigate('/profile');
    return false;
  }, [emergencyPhone, navigate, showToast]);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeDrawnRef     = useRef(false); // evita redesenhar a mesma rota

  // ── GPS AUTOMÁTICO (hook extraído) ──
  const { userLocation, setUserLocation } = usePassengerGPS({
    isVisible: isVisible ?? true,
    existingPickupCoords: pickupCoords,
    onPickupDetected: (coords, address) => {
      setPickupName(address);
      setPickupCoords(coords);
    },
  });

  // ── Quando destino muda: calcular ROTA REAL via Mapbox Directions ──────────
  useEffect(() => {
    if (!isVisible || !pickupCoords || !destCoords) {
      setRouteInfo(null);
      routeDrawnRef.current = false;
      // Limpar rota do mapa se destino foi removido
      MapSingleton.onReady((map) => clearRoute(map));
      return;
    }

    let cancelled = false;
    setRouteLoading(true);

    // Mostrar estimativa rápida (Haversine) imediatamente enquanto a API carrega
    const quickEstimate = mapService.calculateRouteInfo(pickupCoords, destCoords);
    setRouteInfo({ ...quickEstimate, isReal: false });

    // DEBOUNCE: Aguardar 800ms antes de chamar a API real do Mapbox
    // Evita congelamentos quando o GPS varia muito ou enquanto se pesquisa
    const timerId = setTimeout(() => {
      // Buscar rota REAL via Mapbox Directions API
      mapService.getRouteDistance(pickupCoords, destCoords)
        .then((real) => {
          if (cancelled) return;
          setRouteInfo({
            distanceKm:  real.distanceKm,
            durationMin: real.durationMin,
            isReal:      real.geometry !== null,
          });

          // Desenhar rota no mapa (esperar que esteja pronto)
          const validGeo = real.geometry;
          if (validGeo && !routeDrawnRef.current) {
            MapSingleton.onReady((map) => {
              if (routeDrawnRef.current) return;
              clearRoute(map);
              drawRoute(map, {
                distanceKm:      real.distanceKm,
                durationMinutes: real.durationMin,
                durationText:    real.durationMin < 60
                  ? `${real.durationMin} min`
                  : `${Math.floor(real.durationMin / 60)}h ${real.durationMin % 60}min`,
                geojson: {
                  type: 'Feature',
                  geometry: validGeo,
                  properties: {},
                },
                bbox: calculateBBox(validGeo.coordinates as [number, number][]),
              });
              routeDrawnRef.current = true;
            });
          }

          setRouteLoading(false);
        })
        .catch(() => {
          if (!cancelled) setRouteLoading(false);
        });
    }, 800);

    return () => { 
      cancelled = true; 
      clearTimeout(timerId);
    };
  }, [pickupCoords, destCoords, isVisible]);

  // Reset do flag de rota desenhada quando coords mudam
  useEffect(() => {
    routeDrawnRef.current = false;
  }, [pickupCoords?.lat, pickupCoords?.lng, destCoords?.lat, destCoords?.lng]);

  // ── Motoristas próximos (hook extraído) ──
  const { nearbyCount } = useNearbyDrivers(pickupCoords, isVisible ?? true);

  // ── Carregar Passenger Score do Utilizador ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadPassengerScore = async () => {
      try {
        await supabase.rpc('calculate_passenger_score', { p_user_id: userId });
      } catch (err) {
        // A migração pode ainda não estar aplicada; seguimos sem desconto.
        // Registamos silenciosamente para facilitar debug sem assustar o utilizador.
        console.warn('[PassengerHome] calculate_passenger_score indisponível:', err);
      }

      try {
        const { data, error } = await supabase
          .from('passenger_scores')
          .select('user_id, score, rides_component, payment_component, behavior_component, cancel_rate_pct, last_calculated')
          .eq('user_id', userId)
          .maybeSingle();

        if (!cancelled) {
          setPassengerScore(data as PassengerScore);
        }
      } catch (err) {
        console.warn('[PassengerHome] loadPassengerScore fail:', err);
        if (!cancelled) {
          setPassengerScore(null);
        }
      }
    };

    void loadPassengerScore();

    return () => { cancelled = true; };
  }, [userId]);

  // ── Pesquisa com debounce — agora passa posição do utilizador ────────────────
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
        // v3.2: passa posição do utilizador para resultados mais relevantes
        const res = await mapService.searchPlaces(query, userLocation ?? undefined);
        setResults(res);
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [userLocation]);

  useEffect(() => {
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, []);

  useSilentTripleTap({
    enabled: isVisible && !!ride.rideId && (
      ride.status === RideStatus.ACCEPTED || ride.status === RideStatus.IN_PROGRESS
    ),
    onTrigger: () => setSilentPanicSignal((value) => value + 1),
  });

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
      setUserLocation(coords);
      setSelecting(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível obter a localização.';
      showToast(`📍 ${msg}`, 'error');
    } finally {
      setSearching(false);
    }
  };

  // ── Calcular rota real (Mapbox Directions API) + preço Engine Pro ───────────
  const handleConfirmRoute = async () => {
    if (!pickupCoords || !destCoords) return;
    setCalculating(true);
    setFareData(null);
    setRouteData(null);
    routeService.clearCache();
    try {
      // 1. Rota real — chamada à Directions API
      const route = await routeService.getRoute(pickupCoords, destCoords);
      setRouteData(route);

      // 2. Preço calculado no servidor (Engine Pro protegido)
      const hour      = new Date().getHours();
      const isNight   = hour >= 22 || hour < 6;
      const distToAirport = Math.sqrt(
        Math.pow(destCoords.lat - (-8.8577), 2) +
        Math.pow(destCoords.lng - 13.2312, 2)
      ) * 111;
      const isAirport = distToAirport < 1.0;

      const { data: fare, error: fareError } = await supabase.rpc(
        'calculate_fare_engine_pro_with_rate_limit',
        {
          p_distance_km:    route.distanceKm,
          p_duration_min:   route.durationMin,
          p_origin_lat:     pickupCoords.lat,
          p_origin_lng:     pickupCoords.lng,
          p_dest_lat:       destCoords.lat,
          p_dest_lng:       destCoords.lng,
          p_service_tier:   selectedVehicle,
          p_supply_count:   nearbyCount ?? 5,
          p_demand_count:   5,
          p_is_night:       isNight,
          p_is_airport:     isAirport,
          p_traffic_factor: route.trafficFactor,
        }
      );

      if (fareError) throw new Error('Erro ao calcular preço. O servidor não respondeu.');
      const fareQuote = fare as (FareEstimate & { error?: string }) | null;
      if (fareQuote?.error) throw new Error(fareQuote.error);
      if (!fareQuote) throw new Error('O servidor nao devolveu um preco valido.');
      const scoreDiscount = applyScoreDiscount(fareQuote.fare_kz, passengerScore?.score);
      setFareData({ ...fareQuote, score_discount: scoreDiscount });
      setFareExpiresAt(Date.now() + 120 * 1000); // 2 minutos de lock
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao calcular rota. Verifica a tua ligação.';
      showToast(`❌ ${msg}`, 'error');
      setRouteData(null);
      setFareData(null);
    } finally {
      setCalculating(false);
    }
  };

  // ── "VER MOTORISTAS" — pesquisa real de motoristas ────────────────────────────
  const handleShowDrivers = async () => {
    if (!ensureEmergencyContact('Define um contacto de emergência antes de pedir a tua primeira corrida.')) return;
    if (!pickupCoords || !destName) return;
    await onStartAuction(pickupCoords);
  };

  const handleCallTaxi = async () => {
    if (!pickupCoords) {
      setSearching(true);
      let success = false;
      try {
        const coords  = await mapService.getCurrentPosition();
        const address = await mapService.reverseGeocode(coords);
        setPickupName(address);
        setPickupCoords(coords);
        setUserLocation(coords);
        success = true;
      } catch (err) {
        showToast('❌ Não foi possível obter a tua localização. Activa o GPS.', 'error');
      } finally {
        setSearching(false);
      }
      
      if (success) {
        setSelecting('dest');
        handleSearch('');
      }
      return;
    }
    if (!destName) {
      setSelecting('dest');
      handleSearch('');
      return;
    }
    await handleShowDrivers();
  };

  // O Countdown foi movido para dentro do RideRequestForm para evitar re-renders do ecrã todo

  // ── Confirmar motorista escolhido ───────────────────────────────────────────
  const handleConfirmDriver = async () => {
    if (!ensureEmergencyContact()) return;
    if (!pickupName || !destName || !pickupCoords || !destCoords) return;
    setLoadingRide(true);
    try {
      await onRequestRide(
        pickupName,
        pickupCoords,
        destName,
        destCoords,
        undefined,
        routeData?.distanceKm,
        routeData?.durationMin,
        selectedVehicle,
      );
    } catch (err) {
      console.error('[PassengerHome] handleConfirmDriver falhou:', err);
      showToast('❌ Erro ao confirmar motorista. Verifica a tua ligação e tenta de novo.', 'error');
    } finally {
      setLoadingRide(false);
    }
  };

  // ── Solicitar Corrida (Preço base / normal) ─────────────────────────────────
  const handleRequestNormalRide = async (finalPriceKz: number) => {
    if (!ensureEmergencyContact('Define um contacto de emergência antes de pedir a tua primeira corrida.')) return;
    if (!pickupName || !destName || !pickupCoords || !destCoords) return;
    setLoadingRide(true);
    try {
      await onRequestRide(
        pickupName,
        pickupCoords,
        destName,
        destCoords,
        finalPriceKz,
        routeData?.distanceKm,
        routeData?.durationMin,
        selectedVehicle,
      );
    } catch (err) {
      console.error('[PassengerHome] handleRequestNormalRide falhou:', err);
      showToast('❌ Erro ao pedir corrida. Verifica a tua ligação e tenta de novo.', 'error');
    } finally {
      setLoadingRide(false);
    }
  };

  // ── Negociar preço (estilo InDriver) ────────────────────────────────────────
  const handleNegotiate = async (proposedPrice: number) => {
    if (!ensureEmergencyContact('Define um contacto de emergência antes de negociar a corrida.')) return;
    if (!pickupCoords || !destName || !destCoords || !pickupName) return;
    setLoadingRide(true);
    try {
      await onRequestRide(
        pickupName,
        pickupCoords,
        destName,
        destCoords,
        proposedPrice,
        routeData?.distanceKm,
        routeData?.durationMin,
        selectedVehicle,
      );
    } catch (e) {
      console.error('[PassengerHome] Negociação falhou:', e);
    } finally {
      setLoadingRide(false);
    }
  };

  const handleOpenService = useCallback((service: PremiumServiceType) => {
    if (!ensureEmergencyContact('Define um contacto de emergência antes de abrir este serviço.')) return;
    setOpenPremiumService(service);
  }, [ensureEmergencyContact]);

  const prepareRouteFromPrediction = useCallback((prediction: RidePrediction) => {
    setPickupName(prediction.origin_address);
    setPickupCoords({ lat: prediction.origin_lat, lng: prediction.origin_lng });
    setDestName(prediction.dest_address);
    setDestCoords({ lat: prediction.dest_lat, lng: prediction.dest_lng });
    setFareData(null);
    setRouteData(null);
    setFareExpiresAt(null);

    void zonePriceService.getZonePrice(prediction.origin_address, prediction.dest_address)
      .then((zp) => {
        if (zp) {
          setZonePrice(zp.price_kz);
          setZoneNames({ origin: zp.origin_zone, dest: zp.dest_zone });
          return;
        }

        setZonePrice(null);
        setZoneNames(null);
      })
      .catch(() => {
        setZonePrice(null);
        setZoneNames(null);
      });
  }, []);

  const handleSchedulePrediction = useCallback((prediction: RidePrediction) => {
    if (!ensureEmergencyContact('Define um contacto de emergência antes de agendar corridas.')) return;
    prepareRouteFromPrediction(prediction);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0] ?? '';
    const time = prediction.best_hour != null
      ? `${String(prediction.best_hour).padStart(2, '0')}:00`
      : '08:00';

    setScheduleDefaults({ date, time });
    setShowSchedule(true);
  }, [ensureEmergencyContact, prepareRouteFromPrediction]);

  const isReady     = !!pickupName && !!destName;
  const showAuction = ride.status === RideStatus.BROWSING;

  if (showAuction) {
    return (
      <>
      <AuctionScreen
        pickupName={pickupName}
        destName={destName}
        routeInfo={routeInfo}
        zonePrice={zonePrice}
        zoneNames={zoneNames}
        ride={ride}
        auction={auction}
        loadingRide={loadingRide}
        onCancelAuction={onCancelAuction}
        onSelectDriver={onSelectDriver}
        onConfirmDriver={handleConfirmDriver}
      />
      </>
    );
  }

  // ==================================================================
  // ECRÃ NORMAL
  // ==================================================================
  return (
    <>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Passageiro</p>
            <h1 className="zr-title zr-title--sm">Luanda pronta para sair</h1>
          </div>
          <div className="zr-inline">
            <span className="zr-chip zr-chip--gold">
              <span className="material-symbols-outlined" style={{fontSize:'16px'}}>stars</span> 5.0 Exclusive
            </span>
            <div className="zr-avatar">A</div>
          </div>
        </div>
      </header>

      <section className="zr-map">
        <div className="zr-curve"></div>
        {shouldMountMap ? (
          <Suspense fallback={<div className="zr-empty">A carregar mapa...</div>}>
            <Map3D
              mode="passenger"
              center={userLocation ? [userLocation.lng, userLocation.lat] : undefined}
            />
          </Suspense>
        ) : (
          <div className="zr-empty">A preparar mapa...</div>
        )}
      </section>

      <div className="zr-stack" style={{ marginTop: '16px', padding: '0 14px' }}>

        {/* Card de rota (oculto quando já estamos no check-out para dar destaque ao Mapa) */}
        {!fareData && !calculating && (
          <RoutePreview
            selecting={selecting}
            nearbyCount={nearbyCount}
            pickupName={pickupName}
            destName={destName}
            routeInfo={routeInfo}
            routeLoading={routeLoading}
            zonePrice={zonePrice}
            zoneNames={zoneNames}
            onSelectPickup={() => { setSelecting('pickup'); handleSearch(''); }}
            onSelectDest={() => { setSelecting('dest'); handleSearch(''); }}
          />
        )}

        {!emergencyPhone && ride.status === RideStatus.IDLE && (
          <div className="zr-alert-box zr-alert-box--warning">
            <div className="zr-alert-content">
              <strong>Contacto de emergência obrigatório</strong>
              <p>Antes da primeira corrida, adiciona um número SOS em Perfil para activar partilha, alertas e chamadas rápidas.</p>
            </div>
            <button
              className="zr-button zr-button--secondary"
              style={{ marginTop: '10px' }}
              onClick={() => navigate('/profile')}
            >
              Abrir Perfil
            </button>
          </div>
        )}

        {/* Multi-Stop: segundo destino para amigo */}
        {!fareData && !calculating && destCoords && (
          <MultiStopInput
            destCoords={destCoords}
            onExtraDropSet={(addr, coords) => {
              setExtraDropAddress(addr);
              setExtraDropCoords(coords);
            }}
            onExtraDropClear={() => {
              setExtraDropAddress(null);
              setExtraDropCoords(null);
            }}
          />
        )}

        {/* NightSafetyBanner */}
        <NightSafetyBanner
          hasEmergencyContact={!!emergencyPhone}
          hasActiveRide={hasActiveRideSafety}
          safetyContextKey={ride.rideId ?? null}
          onActivateSafety={() => {
            if (ride.rideId && emergencyPhone) {
              rideService.autoShareLiveTrackingOnRideStart({
                rideId: ride.rideId,
                ownerUserId: userId,
                emergencyPhone,
              });
            }
          }}
        />

        {/* Overlay de pesquisa */}
        {selecting && (
          <LocationSearch
            selecting={selecting}
            searchQuery={searchQuery}
            results={results}
            searching={searching}
            userLocation={userLocation}
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
                  onAccept={prepareRouteFromPrediction}
                  onSchedule={handleSchedulePrediction}
                />
                <FreePerkBanner userId={userId} />

                {/* ── ZONA DE CONTRATOS E SERVIÇOS ── */}
                <section className="zr-card">
                  <div className="zr-inline zr-inline--between">
                    <div>
                      <p className="zr-kicker">Acesso rapido</p>
                      <h2 className="zr-section-title">Overlays e modais do passageiro</h2>
                    </div>
                    <span className="material-symbols-outlined" style={{color:'var(--gold)'}}>widgets</span>
                  </div>
                  <div className="zr-scroll-x" style={{ marginTop: '14px' }}>
                    <button className="zr-option" onClick={() => navigate('/contrato')}>
                      <strong>Contratos</strong><span>Escolar, Familiar e Empresas</span>
                    </button>
                    <button className="zr-option" onClick={() => setShowReferral(true)}>
                      <strong>Traz o Mano</strong><span>Ganha 500 Kz por convite</span>
                    </button>
                    <button
                      className="zr-option"
                      onClick={() => {
                        if (!ensureEmergencyContact('Define um contacto de emergência antes de agendar corridas.')) return;
                        setScheduleDefaults(null);
                        setShowSchedule(true);
                      }}
                    >
                      <strong>Agendar</strong><span>Data, hora e recorrencia</span>
                    </button>
                    <button className="zr-option" onClick={() => navigate('/pos_viagem_review')}>
                      <strong>Pos-viagem</strong><span>Avaliacao e recibo</span>
                    </button>
                  </div>
                </section>
              </>
            )}

            <RideRequestForm
              rideStatus={ride.status}
              fareData={fareData}
              routeData={routeData}
              fareExpiresAt={fareExpiresAt}
              onFareExpire={() => { setFareData(null); setRouteData(null); }}
              isReady={isReady}
              searching={searching}
              calculating={calculating}
              onCalculatePrice={handleConfirmRoute}
              onCallTaxi={handleCallTaxi}
              onConfirmRideRequest={handleRequestNormalRide}
              onNegotiate={handleNegotiate}
              selectedVehicle={selectedVehicle}
              onVehicleChange={setSelectedVehicle}
              onOpenService={handleOpenService}
            />

            <ActiveRideCard
              ride={ride}
              userId={userId}
              routeInfo={routeInfo}
              onCancelRide={onCancelRide}
              emergencyPhone={emergencyPhone}
            />
            {hasActiveRideSafety && (
              <div style={{ position: 'fixed', top: '100px', right: '14px', zIndex: 1001, width: '220px' }}>
                <PanicButton
                  userId={userId}
                  rideId={ride.rideId}
                  emergencyPhone={emergencyPhone}
                  driverName={ride.driverName}
                  silentSignal={silentPanicSignal}
                  enableScreamDetection={true}
                />
              </div>
            )}

            {/* Adicionado espaço livre para quando a doca inferior com o Kaze está presente */}
            <div className="h-10" />
          </div>
        )}

        {/* Modal de agendamento */}
        {showSchedule && (
          <Suspense fallback={null}>
            <ScheduleRide
              userId={userId}
              pickupName={pickupName}
              destName={destName}
              pickupCoords={pickupCoords}
              destCoords={destCoords}
              defaultDate={scheduleDefaults?.date}
              defaultTime={scheduleDefaults?.time}
              onClose={() => {
                setScheduleDefaults(null);
                setShowSchedule(false);
              }}
              onScheduled={() => {
                setScheduleDefaults(null);
                setShowSchedule(false);
              }}
            />
          </Suspense>
        )}

        {/* Modal Traz o Mano */}
        {showReferral && (
          <ReferralModal 
            userId={userId} 
            onClose={() => setShowReferral(false)} 
          />
        )}

        {openPremiumService === 'private_driver' && (
          <PrivateDriverModal
            userId={userId}
            pickupName={pickupName}
            destName={destName}
            pickupCoords={pickupCoords}
            destCoords={destCoords}
            onClose={() => setOpenPremiumService(null)}
          />
        )}

        {openPremiumService === 'charter' && (
          <CharterModal
            userId={userId}
            pickupName={pickupName}
            destName={destName}
            pickupCoords={pickupCoords}
            destCoords={destCoords}
            onClose={() => setOpenPremiumService(null)}
          />
        )}

        {openPremiumService === 'cargo' && (
          <CargoModal
            userId={userId}
            pickupName={pickupName}
            destName={destName}
            pickupCoords={pickupCoords}
            destCoords={destCoords}
            onClose={() => setOpenPremiumService(null)}
          />
        )}

        {/* Kaze substituiu o FAB anterior e é injectado pelo App no topo */}
      </div>
    </>
  );
};

// ── Helper: calcular bounding box de coordenadas ────────────────────────────
function calculateBBox(coords: [number, number][]): [number, number, number, number] {
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export default PassengerHome;
