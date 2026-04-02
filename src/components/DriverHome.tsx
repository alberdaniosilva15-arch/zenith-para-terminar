// =============================================================================
// MOTOGO AI v2.1 — DriverHome.tsx
// Adicionado: popup para corridas do leilão (confirmar/recusar),
//             subscrição a assignments directos do passageiro
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import RideTalk from './RideTalk';
import Map3D from './Map3D';
import AgoraCall from './AgoraCall';
import { geminiService } from '../services/geminiService';
import { rideService } from '../services/rideService';
import { mapService } from '../services/mapService';
import { useAuth } from '../contexts/AuthContext';
import type { RideState, DbRide } from '../types';
import { RideStatus, UserRole } from '../types';

interface DriverHomeProps {
  ride:            RideState;
  onAcceptRide:    (rideId: string) => Promise<void>;    // modelo searching
  onConfirmRide:   (rideId: string) => Promise<void>;    // modelo leilão
  onDeclineRide:   (rideId: string) => Promise<void>;
  onAdvanceStatus: (status: RideStatus) => Promise<void>;
  driverId:        string;
}

const DriverHome: React.FC<DriverHomeProps> = ({
  ride, onAcceptRide, onConfirmRide, onDeclineRide, onAdvanceStatus, driverId,
}) => {
  const { profile } = useAuth();
  const [isOnline,        setIsOnline]        = useState(false);
  const [availableRides,  setAvailableRides]  = useState<DbRide[]>([]);
  const [incomingRide,    setIncomingRide]    = useState<DbRide | null>(null);
  const [isAuctionRide,   setIsAuctionRide]   = useState(false);  // passageiro escolheu-me?
  const [simulation,      setSimulation]      = useState<{ dailyEstimateKz: number; bestZones: string[]; tips: string } | null>(null);
  const [actionLoading,   setActionLoading]   = useState(false);

  const gpsRef    = useRef<(() => void) | null>(null);
  const unsubRef1 = useRef<(() => void) | null>(null);
  const unsubRef2 = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!profile) return;
    geminiService.simulateEarnings({ rating: profile.rating, totalRides: profile.total_rides, level: profile.level })
      .then(s => setSimulation(s));
  }, [profile]);

  // ------------------------------------------------------------------
  const goOnline = useCallback(async () => {
    setIsOnline(true);
    await rideService.setDriverStatus(driverId, 'available');

    // GPS tracking
    gpsRef.current = mapService.watchPosition(async (coords, heading) => {
      await rideService.updateDriverLocation(driverId, coords, heading);
    });

    // Subscrição 1: corridas em "searching" (fallback)
    const rides = await rideService.getAvailableRides();
    setAvailableRides(rides);
    if (rides.length > 0) { setIncomingRide(rides[0]); setIsAuctionRide(false); }

    unsubRef1.current = rideService.subscribeToAvailableRides(
      (r) => { setAvailableRides(prev => [r, ...prev]); if (!ride.rideId) { setIncomingRide(r); setIsAuctionRide(false); } },
      (id) => { setAvailableRides(prev => prev.filter(r => r.id !== id)); setIncomingRide(prev => prev?.id === id ? null : prev); }
    );

    // Subscrição 2: passageiro escolheu-me directamente (leilão)
    unsubRef2.current = rideService.subscribeToDriverAssignments(driverId, (r) => {
      if (!ride.rideId) { setIncomingRide(r); setIsAuctionRide(true); }
    });
  }, [driverId, ride.rideId]);

  const goOffline = useCallback(async () => {
    setIsOnline(false); setAvailableRides([]); setIncomingRide(null);
    await rideService.setDriverStatus(driverId, 'offline');
    gpsRef.current?.(); gpsRef.current = null;
    unsubRef1.current?.(); unsubRef1.current = null;
    unsubRef2.current?.(); unsubRef2.current = null;
  }, [driverId]);

  useEffect(() => () => {
    gpsRef.current?.(); unsubRef1.current?.(); unsubRef2.current?.();
    rideService.setDriverStatus(driverId, 'offline');
  }, [driverId]);

  // ------------------------------------------------------------------
  const handleConfirmAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    await onConfirmRide(incomingRide.id);
    setIncomingRide(null); setActionLoading(false);
  };

  const handleDeclineAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    await onDeclineRide(incomingRide.id);
    setIncomingRide(null); setActionLoading(false);
  };

  const handleAcceptSearching = async (rideId: string) => {
    setActionLoading(true);
    await onAcceptRide(rideId);
    setIncomingRide(null); setActionLoading(false);
  };

  // Avançar estado da corrida activa
  const nextAction: Record<string, { label: string; next: RideStatus }> = {
    [RideStatus.PICKING_UP]:  { label: 'CHEGUEI AO CLIENTE',  next: RideStatus.IN_PROGRESS },
    [RideStatus.IN_PROGRESS]: { label: 'CONCLUIR CORRIDA',    next: RideStatus.COMPLETED },
  };
  const currentAction = ride.status ? nextAction[ride.status] : null;

  return (
    <div className="p-4 space-y-5 bg-[#F8FAFC] min-h-screen pb-32">

      {/* HUD ganhos + toggle online */}
      <div className="bg-surface-container-low border border-outline-variant/20 p-6 rounded-[2.5rem] shadow-sm flex justify-between items-center">
        <div>
          <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1 h-1 bg-primary rounded-full" /> PREVISÃO DIÁRIA
          </p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-black text-on-surface italic">
              {simulation ? simulation.dailyEstimateKz.toLocaleString('pt-AO') : '—'}
            </span>
            <span className="text-[10px] font-black text-on-surface-variant/70 uppercase">Kz</span>
          </div>
          {simulation?.bestZones?.[0] && <p className="text-[8px] text-on-surface-variant/70 mt-1 font-bold">Zona: {simulation.bestZones[0]}</p>}
        </div>
        <button onClick={isOnline ? goOffline : goOnline}
          className={`px-8 py-4 rounded-3xl font-black text-[10px] uppercase flex items-center gap-3 active:scale-95 transition-all ${isOnline ? 'bg-primary/100 text-white shadow-[0_15px_30px_rgba(34,197,94,0.3)]' : 'bg-[#0A0A0A] text-white shadow-xl'}`}>
          <div className="relative">
            <span className={`w-2.5 h-2.5 rounded-full bg-surface-container-low block ${isOnline ? 'animate-pulse' : ''}`} />
            {isOnline && <span className="absolute inset-0 bg-surface-container-low rounded-full animate-ping opacity-50" />}
          </div>
          {isOnline ? 'ONLINE' : 'FICAR ONLINE'}
        </button>
      </div>

      {/* Mapa */}
      <div className="aspect-[4/3] w-full relative z-0 overflow-hidden rounded-[3rem] shadow-2xl border-4 border-white">
        <Map3D pickup={ride.pickupCoords} destination={ride.destCoords} carLocation={ride.carLocation} status={ride.status} />
        <div className="absolute top-6 right-6 bg-surface-container-low/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-outline-variant/20 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/8 rounded-xl flex items-center justify-center text-xl">⛽</div>
          <div><p className="text-[8px] font-black text-on-surface-variant/70 uppercase">Média Luanda</p><p className="text-xs font-black text-on-surface">300 Kz/L</p></div>
        </div>
        <div className="absolute bottom-6 left-6 bg-[#0A0A0A]/90 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-xl flex items-center gap-3">
          <span className="text-xs">🛡️</span>
          <div><p className="text-[8px] font-black text-primary uppercase">Vigilante</p><p className="text-[10px] font-black text-white uppercase">Zona Segura</p></div>
        </div>
      </div>

      {/* POPUP: passageiro escolheu-te (leilão) */}
      {isOnline && incomingRide && isAuctionRide && !ride.rideId && (
        <div className="bg-surface-container-low border-2 border-primary p-8 rounded-[3.5rem] shadow-[0_40px_100px_rgba(230,195,100,0.1)] animate-in slide-in-from-bottom-20 duration-500">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl">🎯</span>
            <div>
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">Passageiro escolheu-te!</p>
              <p className="text-[9px] text-on-surface-variant/70 font-bold">Confirma para começar a corrida</p>
            </div>
          </div>
          <InfoRow icon="📍" label="Origem"  value={incomingRide.origin_address} />
          <InfoRow icon="🏁" label="Destino" value={incomingRide.dest_address} />
          <div className="flex gap-2 my-4">
            <Pill label={`${incomingRide.price_kz.toLocaleString('pt-AO')} Kz`} blue />
            {incomingRide.distance_km && <Pill label={`${incomingRide.distance_km.toFixed(1)} km`} />}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button onClick={handleDeclineAuction} disabled={actionLoading}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-all disabled:opacity-60">
              Recusar
            </button>
            <button onClick={handleConfirmAuction} disabled={actionLoading}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-primary text-white shadow-xl hover:bg-primary transition-all active:scale-95 disabled:opacity-60">
              {actionLoading ? <Spinner /> : 'CONFIRMAR'}
            </button>
          </div>
        </div>
      )}

      {/* POPUP: nova corrida em searching (fallback) */}
      {isOnline && incomingRide && !isAuctionRide && !ride.rideId && (
        <div className="bg-surface-container-low border-2 border-outline-variant p-8 rounded-[3.5rem] shadow-2xl animate-in slide-in-from-bottom-20 duration-500">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-3 h-3 bg-primary rounded-full animate-ping" />
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">Nova corrida disponível</p>
          </div>
          <InfoRow icon="📍" label="Origem"  value={incomingRide.origin_address} />
          <InfoRow icon="🏁" label="Destino" value={incomingRide.dest_address} />
          <div className="flex gap-2 my-4">
            <Pill label={`${incomingRide.price_kz.toLocaleString('pt-AO')} Kz`} blue />
            {incomingRide.distance_km && <Pill label={`${incomingRide.distance_km.toFixed(1)} km`} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setIncomingRide(null)}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-all">
              Ignorar
            </button>
            <button onClick={() => handleAcceptSearching(incomingRide.id)} disabled={actionLoading}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-[#0A0A0A] text-white shadow-xl hover:bg-surface-container-highest transition-all active:scale-95 disabled:opacity-60">
              {actionLoading ? <Spinner /> : 'ACEITAR'}
            </button>
          </div>
        </div>
      )}

      {/* Corrida activa — avançar estado + VoIP */}
      {currentAction && ride.rideId && (
        <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 golden-gradient rounded-2xl flex items-center justify-center text-lg font-headline font-bold shrink-0">
              {(ride.driverName ?? 'P').charAt(0)}
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">Corrida activa</p>
              <p className="text-[10px] text-on-surface-variant font-label truncate">{ride.pickup} → {ride.destination}</p>
            </div>
          </div>

          {/* Chamada VoIP com passageiro */}
          <AgoraCall
            corridaId={ride.rideId}
            userId={driverId}
            peerName={ride.passengerName ?? 'Passageiro'}
            onEndCall={() => {}}
          />

          <button onClick={() => onAdvanceStatus(currentAction.next)}
            className="w-full py-5 golden-gradient rounded-3xl font-black text-[10px] uppercase tracking-widest vault-shadow active:scale-95 luxury-transition">
            {currentAction.label}
          </button>
          <button onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
            className="w-full py-3 text-error font-black text-[9px] uppercase tracking-widest hover:bg-error/10 rounded-2xl luxury-transition">
            Cancelar corrida
          </button>
        </div>
      )}

      {/* Offline */}
      {!isOnline && !ride.rideId && (
        <div className="bg-surface-container-low rounded-[2.5rem] p-8 text-center">
          <p className="text-3xl mb-3">🏍️</p>
          <p className="font-black text-on-surface-variant uppercase text-[10px] tracking-widest">Estás offline</p>
          <p className="text-xs text-on-surface-variant/70 mt-2 font-bold">Clica em FICAR ONLINE para receber corridas</p>
          {simulation?.tips && <p className="text-[10px] text-primary font-bold mt-4 italic">💡 {simulation.tips}</p>}
        </div>
      )}

      {isOnline && <RideTalk zone="Motoristas" role={UserRole.DRIVER} />}
    </div>
  );
};

const InfoRow: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex gap-3 items-start mb-3">
    <span className="text-lg shrink-0">{icon}</span>
    <div className="min-w-0"><p className="text-[8px] font-black text-on-surface-variant/70 uppercase">{label}</p><p className="text-sm font-black text-on-surface truncate">{value}</p></div>
  </div>
);

const Pill: React.FC<{ label: string; blue?: boolean }> = ({ label, blue }) => (
  <span className={`text-[10px] font-black px-3 py-1.5 rounded-full ${blue ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'}`}>{label}</span>
);

const Spinner = () => (
  <span className="flex items-center justify-center gap-2">
    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    A processar...
  </span>
);

export default DriverHome;
