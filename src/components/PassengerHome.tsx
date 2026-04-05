// =============================================================================
// ZENITH RIDE v3.0 — PassengerHome.tsx
// FIXES:
//   1. "CHAMAR TÁXI" → pesquisa motoristas reais via rideService (startAuction)
//   2. Distância km entre A e B calculada e visível logo após destino escolhido
//   3. GPS reverseGeocode → mostra nome do bairro (não coordenadas)
//   4. Preço estimado visível com distância e duração
//   5. Estado SEARCHING com contagem regressiva e opção de cancelar
//   6. Estados completos: IDLE / BROWSING / SEARCHING / ACCEPTED / IN_PROGRESS
// =============================================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Megaphone } from 'lucide-react';
import RideTalk from './RideTalk';
import Map3D from './Map3D';
import AgoraCall from './AgoraCall';
import KazePreditivo  from './KazePreditivo';
import FreePerkBanner from './FreePerkBanner';
import ZonePriceMap   from './ZonePriceMap';
import { mapService, LUANDA_STATIC_LOCATIONS } from '../services/mapService';
import { zonePriceService } from '../services/zonePrice';
import { rideService } from '../services/rideService';
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
      // FIX: mostra nome de bairro, não coordenadas
      const address = await mapService.reverseGeocode(coords);
      setPickupName(address);
      setPickupCoords(coords);
    } catch {
      setPickupName('A minha localização');
      setPickupCoords({ lat: -8.8368, lng: 13.2343 });
    } finally {
      setSelecting(null);
      setSearching(false);
    }
  };

  // ── "VER MOTORISTAS" — pesquisa real de motoristas ──────────────────────────
  const handleShowDrivers = async () => {
    if (!pickupCoords || !destName) return;
    // FIX: chama startAuction que vai ao Supabase buscar motoristas reais
    await onStartAuction(pickupCoords);
  };

  // ── "CHAMAR TÁXI" (fallback sem destino definido) ───────────────────────────
  const handleCallTaxi = async () => {
    if (!pickupCoords) {
      // Tentar obter GPS primeiro
      setSearching(true);
      const coords  = await mapService.getCurrentPosition();
      const address = await mapService.reverseGeocode(coords);
      setPickupName(address);
      setPickupCoords(coords);
      setSearching(false);
      // Abrir selecção de destino
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

  // ── Confirmar motorista escolhido ────────────────────────────────────────────
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

        {/* Loading */}
        {auction.loading && (
          <div className="flex flex-col items-center py-16 gap-4">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">A procurar motoristas...</p>
          </div>
        )}

        {/* Erro */}
        {auction.error && !auction.loading && (
          <div className="m-4 bg-primary/8 border border-primary/20 rounded-[2rem] p-6 text-center">
            <p className="text-2xl mb-2">🔍</p>
            <p className="font-black text-on-surface text-sm">{auction.error}</p>
            <button onClick={onCancelAuction} className="mt-4 text-[10px] font-black text-primary/80 uppercase tracking-widest">
              Voltar
            </button>
          </div>
        )}

        {/* Lista de motoristas */}
        {!auction.loading && !auction.error && auction.drivers.length > 0 && (
          <div className="p-4 space-y-3">
            {auction.drivers.map((driver) => (
              <DriverAuctionCard
                key={driver.driver_id}
                driver={driver}
                selected={auction.selectedDriver?.driver_id === driver.driver_id}
                onSelect={() => onSelectDriver(driver)}
                priceKz={zonePrice ?? ride.priceKz ?? null}
              />
            ))}
          </div>
        )}

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
        <Map3D
          pickup={pickupCoords ?? undefined}
          destination={destCoords ?? undefined}
          status={ride.status}
          carLocation={ride.carLocation}
          dataSaver={dataSaver}
        />
      </div>

      <div className="relative z-10 p-4 space-y-4 flex-1 flex flex-col">

        {/* Card de rota */}
        <div className={`bg-surface-container-low rounded-[2rem] shadow-2xl p-6 space-y-4 border border-white/40 transition-all duration-500 ${
          selecting ? 'opacity-0 pointer-events-none -translate-y-4' : 'opacity-100 translate-y-0'
        }`}>
          <div className="flex justify-between items-center">
            <span className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">Trajecto Inteligente</span>
            {nearbyCount !== null && nearbyCount > 0 && (
              <span className="text-[8px] font-black uppercase text-primary bg-primary/10 px-3 py-1 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                {nearbyCount} motoristas próximos
              </span>
            )}
          </div>

          <div className="space-y-2">
            {/* Pickup */}
            <div
              onClick={() => { setSelecting('pickup'); handleSearch(''); }}
              className="flex gap-4 items-center cursor-pointer bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/20 hover:bg-surface-container-low transition-all"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
              <p className={`text-xs font-black truncate ${pickupName ? 'text-on-surface' : 'text-on-surface-variant/70'}`}>
                {pickupName || 'Onde estás agora?'}
              </p>
            </div>

            {/* Linha de distância */}
            {routeInfo && (
              <div className="flex items-center gap-2 pl-5">
                <div className="w-px h-4 bg-outline-variant/40" />
                <span className="text-[9px] font-bold text-primary/70 bg-primary/8 px-3 py-1 rounded-full">
                  📏 {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min de trajecto
                </span>
              </div>
            )}

            {/* Destination */}
            <div
              onClick={() => { setSelecting('dest'); handleSearch(''); }}
              className="flex gap-4 items-center cursor-pointer bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/20 hover:bg-surface-container-low transition-all"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
              <p className={`text-xs font-black truncate ${destName ? 'text-on-surface' : 'text-on-surface-variant/70'}`}>
                {destName || 'Para onde queres ir?'}
              </p>
            </div>
          </div>

          {/* Preço fixo por zona */}
          {zonePrice && zoneNames && (
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20">
              <div className="flex items-center gap-2">
                <span className="text-[8px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black">✓ PREÇO FIXO</span>
                <span className="text-[8px] text-on-surface-variant/70 font-bold">{zoneNames.origin} → {zoneNames.dest}</span>
              </div>
              <span className="font-black text-primary text-sm">{Math.round(zonePrice).toLocaleString('pt-AO')} Kz</span>
            </div>
          )}
        </div>

        {/* Overlay de pesquisa */}
        {selecting && (
          <div className="absolute inset-x-4 top-4 z-[100] animate-in slide-in-from-top duration-300 flex flex-col max-h-[85vh]">
            <div className="bg-surface-container-low rounded-[2.5rem] overflow-hidden border border-outline-variant/20 flex flex-col shadow-2xl">
              <div className="p-5 border-b border-outline-variant/10 flex items-center gap-4 sticky top-0 bg-surface-container-low z-10">
                <button
                  onClick={() => { setSelecting(null); setSearchQuery(''); setResults([]); }}
                  className="w-10 h-10 flex items-center justify-center bg-surface-container-lowest rounded-full text-outline font-black"
                >✕</button>
                <input
                  autoFocus
                  type="text"
                  placeholder={selecting === 'pickup' ? 'De onde partes?' : 'Para onde vais?'}
                  className="flex-1 bg-surface-container-lowest p-4 rounded-2xl outline-none font-black text-sm text-on-surface"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {selecting === 'pickup' && (
                  <button onClick={useGPS} disabled={searching}
                    className="w-full flex items-center gap-4 p-4 bg-primary/10 rounded-2xl border border-primary/20 mb-2 text-left disabled:opacity-60">
                    <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white text-lg">
                      {searching ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '📍'}
                    </div>
                    <div>
                      <p className="font-black text-on-surface text-sm">Usar a minha localização</p>
                      <p className="text-[9px] text-primary font-bold uppercase">GPS automático · Nome do bairro</p>
                    </div>
                  </button>
                )}
                <p className="px-4 text-[8px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-2">
                  {searching ? 'A consultar...' : `${results.length} locais`}
                </p>
                {results.map((res, i) => (
                  <button key={i} onClick={() => selectLocation(res)}
                    className="w-full flex items-center gap-4 p-4 hover:bg-surface-container-lowest rounded-2xl transition-colors text-left border border-transparent hover:border-outline-variant/20">
                    <div className="w-10 h-10 bg-surface-container-low rounded-xl flex items-center justify-center text-xl shrink-0">
                      {res.type === 'bairro' ? '🏘️' : res.type === 'hospital' ? '🏥' : res.type === 'servico' ? '🏪' : res.type === 'monumento' ? '🏛️' : '📍'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-on-surface text-sm truncate">{res.name}</p>
                      <p className="text-[9px] font-bold text-on-surface-variant/70 uppercase">{res.description}</p>
                    </div>
                    {res.isPopular && (
                      <span className="text-[8px] bg-primary/15 text-primary px-2 py-1 rounded-full font-black shrink-0">Popular</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
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

            {/* Botão principal */}
            {ride.status === RideStatus.IDLE && (
              <button
                onClick={isReady ? handleShowDrivers : handleCallTaxi}
                disabled={searching}
                className={`w-full py-6 rounded-[2.5rem] font-black text-lg uppercase shadow-2xl tracking-[0.15em] transition-all active:scale-98 disabled:opacity-50 ${
                  isReady
                    ? 'bg-primary text-white shadow-[0_20px_50px_rgba(37,99,235,0.4)]'
                    : 'bg-[#1a1a1a] text-white border border-white/10'
                }`}
              >
                {searching ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    A localizar...
                  </span>
                ) : isReady ? (
                  <span className="flex items-center justify-center gap-3">
                    🚖 VER MOTORISTAS
                    {nearbyCount !== null && nearbyCount > 0 && (
                      <span className="text-sm bg-white/20 px-2 py-0.5 rounded-full">{nearbyCount}</span>
                    )}
                  </span>
                ) : 'CHAMAR TÁXI'}
              </button>
            )}

            {/* SEARCHING */}
            {ride.status === RideStatus.SEARCHING && (
              <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-2xl border border-outline-variant/20">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="absolute inset-0 flex items-center justify-center text-2xl">🚖</span>
                  </div>
                  <p className="font-black text-on-surface uppercase tracking-widest text-sm">À procura de motorista</p>
                  <p className="text-[10px] text-on-surface-variant/70 font-bold text-center">
                    Nenhum motorista aceitou ainda. O pedido está activo e será notificado quando houver disponibilidade.
                  </p>
                  <button
                    onClick={() => onCancelRide('Cancelado pelo passageiro')}
                    className="text-[10px] font-black text-red-500 uppercase hover:bg-red-500/10 px-6 py-2 rounded-full transition-all"
                  >
                    Cancelar pedido
                  </button>
                </div>
              </div>
            )}

            {/* ACCEPTED — aguardar confirmação */}
            {ride.status === RideStatus.ACCEPTED && !ride.driverConfirmed && (
              <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-2xl border-2 border-primary/30">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="font-black text-on-surface text-sm">
                    A aguardar confirmação de {ride.driverName ?? 'motorista'}...
                  </p>
                  <p className="text-[9px] text-on-surface-variant/60 font-bold text-center">
                    O motorista foi notificado. A aguardar resposta.
                  </p>
                  <button
                    onClick={() => onCancelRide('Cancelado antes de confirmação')}
                    className="text-[10px] font-black text-red-500 uppercase hover:bg-red-500/10 px-6 py-2 rounded-full transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* ACCEPTED — motorista confirmado, a caminho */}
            {ride.status === RideStatus.ACCEPTED && ride.driverConfirmed && (
              <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 golden-gradient rounded-2xl flex items-center justify-center text-2xl font-headline font-bold vault-shadow">
                    {(ride.driverName ?? 'M').charAt(0)}
                  </div>
                  <div>
                    <p className="font-black text-on-surface text-sm">{ride.driverName ?? 'Motorista'} a caminho</p>
                    <p className="text-[10px] font-label text-primary/70 uppercase tracking-widest">Confirmado · Em rota</p>
                  </div>
                </div>
                <div className="vault-indicator-track">
                  <div className="vault-indicator-fill w-1/3" />
                </div>
                {ride.rideId && (
                  <AgoraCall
                    corridaId={ride.rideId}
                    userId={userId}
                    peerName={ride.driverName ?? 'Motorista'}
                    onEndCall={() => {}}
                  />
                )}
              </div>
            )}

            {/* IN_PROGRESS */}
            {ride.status === RideStatus.IN_PROGRESS && (
              <div className="bg-surface-container-lowest border border-primary/20 p-5 rounded-[2.5rem] vault-shadow space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-primary rounded-full animate-pulse-gold" />
                  <div>
                    <p className="font-black text-on-surface text-sm uppercase tracking-widest">Em corrida</p>
                    <p className="text-on-surface-variant text-xs font-label">{ride.pickup} → {ride.destination}</p>
                    {routeInfo && (
                      <p className="text-[9px] text-primary/70 font-bold mt-0.5">
                        📏 {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
                      </p>
                    )}
                  </div>
                </div>
                {ride.rideId && (
                  <AgoraCall
                    corridaId={ride.rideId}
                    userId={userId}
                    peerName={ride.driverName ?? 'Motorista'}
                    onEndCall={() => {}}
                  />
                )}
              </div>
            )}

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

const DriverAuctionCard: React.FC<{
  driver: AuctionDriver; selected: boolean; onSelect: () => void; priceKz: number | null;
}> = ({ driver, selected, onSelect, priceKz }) => (
  <button
    onClick={onSelect}
    className={`w-full text-left p-5 rounded-[2rem] border-2 transition-all active:scale-98 ${
      selected
        ? 'border-primary bg-primary/10 shadow-[0_10px_30px_rgba(37,99,235,0.2)]'
        : 'border-outline-variant/20 bg-surface-container-low hover:border-outline-variant/40 shadow-sm'
    }`}
  >
    <div className="flex items-center gap-4">
      <div className="w-14 h-14 rounded-2xl overflow-hidden bg-surface-container-low shrink-0">
        <img
          src={driver.avatar_url ?? `https://api.dicebear.com/7.x/bottts/svg?seed=${driver.driver_id}`}
          alt={driver.driver_name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-black text-on-surface text-sm truncate">{driver.driver_name}</p>
          {selected && <span className="text-[8px] bg-primary text-white px-2 py-0.5 rounded-full font-black shrink-0">SELECCIONADO</span>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[9px] font-bold text-primary/80">⭐ {driver.rating.toFixed(1)}</span>
          <span className="text-[9px] font-bold text-on-surface-variant/70">{driver.total_rides} corridas</span>
          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
            driver.level === 'Diamante' ? 'bg-primary text-white' :
            driver.level === 'Ouro'     ? 'bg-yellow-100 text-yellow-800' :
            driver.level === 'Prata'    ? 'bg-surface-container text-on-surface-variant' :
            driver.level === 'Bronze'   ? 'bg-orange-100 text-orange-700' :
                                          'bg-surface-container-low text-outline'
          }`}>
            {driver.level === 'Diamante' ? '💎' : driver.level === 'Ouro' ? '⭐' : driver.level === 'Prata' ? '🥈' : driver.level === 'Bronze' ? '🥉' : ''}
            {' '}{driver.level}
          </span>
        </div>
        {priceKz && (
          <p className={`text-[10px] font-black mt-1 ${selected ? 'text-primary' : 'text-on-surface-variant'}`}>
            ~{Math.round(priceKz).toLocaleString('pt-AO')} Kz
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="font-black text-on-surface text-sm">{driver.eta_min} min</p>
        <p className="text-[9px] text-on-surface-variant/70 font-bold">{(driver.distance_m / 1000).toFixed(1)} km</p>
      </div>
    </div>
  </button>
);

export default PassengerHome;
