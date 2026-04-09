import React, { Suspense } from 'react';
import { RideState, RideStatus } from '../../types';

const AgoraCall = React.lazy(() => import('../AgoraCall'));

interface ActiveRideCardProps {
  ride: RideState;
  userId: string;
  routeInfo: { distanceKm: number; durationMin: number } | null;
  onCancelRide: (reason: string) => void;
}

const ActiveRideCard: React.FC<ActiveRideCardProps> = ({
  ride,
  userId,
  routeInfo,
  onCancelRide,
}) => {
  if (
    ride.status !== RideStatus.SEARCHING &&
    ride.status !== RideStatus.ACCEPTED &&
    ride.status !== RideStatus.IN_PROGRESS
  ) {
    return null;
  }

  return (
    <div className="space-y-4">
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
            <Suspense fallback={<div className="text-white/50 text-xs p-2 text-center">A iniciar chamada...</div>}>
              <AgoraCall
                corridaId={ride.rideId}
                userId={userId}
                peerName={ride.driverName ?? 'Motorista'}
                onEndCall={() => {}}
              />
            </Suspense>
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
            <Suspense fallback={<div className="text-white/50 text-xs p-2 text-center">A iniciar chamada...</div>}>
              <AgoraCall
                corridaId={ride.rideId}
                userId={userId}
                peerName={ride.driverName ?? 'Motorista'}
                onEndCall={() => {}}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
};

export default ActiveRideCard;
