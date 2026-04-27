import React, { Suspense } from 'react';
import RideChat from './RideChat';
import type { RideState } from '../types';
import { RideStatus } from '../types';

const AgoraCall = React.lazy(() => import('./AgoraCall'));

interface DriverActiveCardProps {
  ride: RideState;
  driverId: string;
  onAdvanceStatus: (status: RideStatus) => Promise<void>;
}

const DriverActiveCard: React.FC<DriverActiveCardProps> = ({ ride, driverId, onAdvanceStatus }) => {
  if (!ride.rideId) return null;

  const nextActionMap: Record<string, { label: string; next: RideStatus }> = {
    [RideStatus.ACCEPTED]:    { label: 'INICIAR ROTA / A CAMINHO', next: RideStatus.PICKING_UP },
    [RideStatus.PICKING_UP]:  { label: 'CHEGUEI AO CLIENTE',       next: RideStatus.IN_PROGRESS },
    [RideStatus.IN_PROGRESS]: { label: 'CONCLUIR CORRIDA',         next: RideStatus.COMPLETED },
  };
  const currentAction = ride.status ? nextActionMap[ride.status] : null;

  if (!currentAction) return null;

  return (
    <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
      <div className="flex gap-4 items-start">
        <div className="w-10 h-10 golden-gradient rounded-2xl flex items-center justify-center text-lg font-headline font-bold shrink-0">
          {(ride.passengerName ?? 'P').charAt(0)}
        </div>
        <div>
          <p className="font-black text-on-surface text-sm">Corrida activa</p>
          <p className="text-[10px] text-on-surface-variant font-label truncate">
            {ride.pickup} → {ride.destination}
          </p>
        </div>
      </div>

      <Suspense fallback={<div className="text-white/50 text-xs p-2 text-center">A iniciar chamada...</div>}>
        <AgoraCall
          corridaId={ride.rideId}
          userId={driverId}
          peerName={ride.passengerName ?? 'Passageiro'}
          onEndCall={() => {}}
        />
      </Suspense>

      {/* Chat directo com o passageiro */}
      <RideChat
        rideId={ride.rideId}
        myId={driverId}
        peerName={ride.passengerName ?? 'Passageiro'}
        phonePrivacyMode={true}
      />

      <button
        onClick={() => onAdvanceStatus(currentAction.next)}
        className="w-full py-5 golden-gradient rounded-3xl font-black text-[10px] uppercase tracking-widest vault-shadow active:scale-95 luxury-transition"
      >
        {currentAction.label}
      </button>
      <button
        onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
        className="w-full py-3 text-error font-black text-[9px] uppercase tracking-widest hover:bg-error/10 rounded-2xl luxury-transition"
      >
        Cancelar corrida
      </button>
    </div>
  );
};

export default DriverActiveCard;
