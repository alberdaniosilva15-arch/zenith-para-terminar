// =============================================================================
// ZENITH RIDE v3.6 — ActiveRideCard.tsx
// FIX v3.6:
//   - BUG 4 RESOLVIDO: Removido estado intermédio "aguardar confirmação"
//     accept_ride_atomic agora define driver_confirmed=true atomicamente
//   - ACCEPTED mostra sempre o motorista confirmado + chat + chamada
//   - Safety Shield mantido em ACCEPTED e IN_PROGRESS
// =============================================================================

import React, { Suspense } from 'react';
import { RideState, RideStatus } from '../../types';
import RideChat from '../RideChat';
import PanicButton from '../PanicButton';
import { LiveShareButton } from './LiveShareButton';

const AgoraCall = React.lazy(() => import('../AgoraCall'));

interface ActiveRideCardProps {
  ride:            RideState;
  userId:          string;
  routeInfo:       { distanceKm: number; durationMin: number } | null;
  onCancelRide:    (reason: string) => void;
  emergencyPhone?: string;
  driverName?:     string;
  silentPanicSignal?: number;
}

const ActiveRideCard: React.FC<ActiveRideCardProps> = ({
  ride,
  userId,
  routeInfo,
  onCancelRide,
  emergencyPhone,
  silentPanicSignal,
}) => {
  if (
    ride.status !== RideStatus.SEARCHING &&
    ride.status !== RideStatus.ACCEPTED  &&
    ride.status !== RideStatus.IN_PROGRESS
  ) {
    return null;
  }

  const resolvedDriverName = ride.driverName ?? 'Motorista';
  const resolvedRideId     = ride.rideId     ?? '';

  return (
    <div className="space-y-4">

      {/* ── SEARCHING ─────────────────────────────────────────────────────── */}
      {ride.status === RideStatus.SEARCHING && (
        <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-2xl border border-outline-variant/20">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="absolute inset-0 flex items-center justify-center text-2xl">🚖</span>
            </div>
            <p className="font-black text-on-surface uppercase tracking-widest text-sm">À procura de motorista</p>
            <p className="text-[10px] text-on-surface-variant/70 font-bold text-center">
              O pedido está activo e será notificado quando houver disponibilidade.
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

      {/* ── ACCEPTED — motorista confirmado e a caminho ─────────────────────── */}
      {ride.status === RideStatus.ACCEPTED && (
        <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
          {/* Header — motorista */}
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 golden-gradient rounded-2xl flex items-center justify-center text-2xl font-headline font-bold vault-shadow">
              {resolvedDriverName.charAt(0)}
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">{resolvedDriverName} a caminho</p>
              <p className="text-[10px] font-label text-primary/70 uppercase tracking-widest">Confirmado · Em rota</p>
            </div>
          </div>

          {/* Barra de progresso */}
          <div className="vault-indicator-track">
            <div className="vault-indicator-fill w-1/3" />
          </div>

          {/* 🛡️ SAFETY SHIELD — partilha ao vivo */}
          {resolvedRideId && (
            <div className="border-t border-outline-variant/10 pt-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">🛡️ Safety Shield</p>
              <LiveShareButton
                rideId={resolvedRideId}
                userId={userId}
                driverName={resolvedDriverName}
                emergencyPhone={emergencyPhone}
                pickup={ride.pickup}
                destination={ride.destination}
              />
            </div>
          )}

          {/* Chamada Agora */}
          {resolvedRideId && (
            <Suspense fallback={<div className="text-white/50 text-xs p-2 text-center">A iniciar chamada...</div>}>
              <AgoraCall
                corridaId={resolvedRideId}
                userId={userId}
                peerName={resolvedDriverName}
                onEndCall={() => {}}
              />
            </Suspense>
          )}

          {/* Chat directo */}
          {resolvedRideId && (
            <RideChat
              rideId={resolvedRideId}
              myId={userId}
              peerName={resolvedDriverName}
              phonePrivacyMode={true}
            />
          )}
        </div>
      )}

      {/* ── IN_PROGRESS — corrida em curso ────────────────────────────────── */}
      {ride.status === RideStatus.IN_PROGRESS && (
        <div className="bg-surface-container-lowest border border-primary/20 p-5 rounded-[2.5rem] vault-shadow space-y-4">
          {/* Status */}
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

          {/* 🛡️ SAFETY SHIELD — partilha + SOS */}
          {resolvedRideId && (
            <div className="border border-outline-variant/10 rounded-2xl p-4 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/50">🛡️ Kaze Safety Shield</p>
              <LiveShareButton
                rideId={resolvedRideId}
                userId={userId}
                driverName={resolvedDriverName}
                emergencyPhone={emergencyPhone}
                pickup={ride.pickup}
                destination={ride.destination}
              />
              <PanicButton
                userId={userId}
                rideId={resolvedRideId}
                driverName={resolvedDriverName}
                emergencyPhone={emergencyPhone}
                silentSignal={silentPanicSignal}
              />
            </div>
          )}

          {/* Chamada Agora */}
          {resolvedRideId && (
            <Suspense fallback={<div className="text-white/50 text-xs p-2 text-center">A iniciar chamada...</div>}>
              <AgoraCall
                corridaId={resolvedRideId}
                userId={userId}
                peerName={resolvedDriverName}
                onEndCall={() => {}}
              />
            </Suspense>
          )}

          {/* Chat directo */}
          {resolvedRideId && (
            <RideChat
              rideId={resolvedRideId}
              myId={userId}
              peerName={resolvedDriverName}
              phonePrivacyMode={true}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default ActiveRideCard;
