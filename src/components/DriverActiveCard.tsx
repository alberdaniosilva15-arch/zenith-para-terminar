import React, { Suspense } from 'react';
import RideChat from './RideChat';
import type { RideState } from '../types';
import { RideStatus } from '../types';
import { useAppStore } from '../store/useAppStore';

const AgoraCall = React.lazy(() => import('./AgoraCall'));

interface DriverActiveCardProps {
  ride: RideState;
  driverId: string;
  onAdvanceStatus: (status: RideStatus) => Promise<void>;
}

const DriverActiveCard: React.FC<DriverActiveCardProps> = ({ ride, driverId, onAdvanceStatus }) => {
  const showToast = useAppStore((s) => s.showToast);
  
  if (!ride.rideId) return null;

  const nextActionMap: Record<string, { label: string; next: RideStatus }> = {
    [RideStatus.ACCEPTED]:    { label: 'INICIAR ROTA / A CAMINHO', next: RideStatus.PICKING_UP },
    [RideStatus.PICKING_UP]:  { label: 'CHEGUEI AO CLIENTE',       next: RideStatus.IN_PROGRESS },
    [RideStatus.IN_PROGRESS]: { label: 'CONCLUIR CORRIDA',         next: RideStatus.COMPLETED },
  };
  const currentAction = ride.status ? nextActionMap[ride.status] : null;

  if (!currentAction) return null;

  return (
    <div className="zr-card zr-card--hero" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      <div className="zr-inline" style={{ gap: '16px', alignItems: 'center' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--gold)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 'bold' }}>
          {(ride.passengerName ?? 'P').charAt(0)}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <p className="zr-kicker" style={{ color: 'var(--gold)', margin: 0 }}>Passageiro a bordo</p>
          <h3 className="zr-section-title" style={{ fontSize: '18px', margin: '4px 0', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{ride.passengerName ?? 'Passageiro'}</h3>
          <p className="zr-meta" style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
            <span style={{ color: 'var(--success)' }}>{ride.pickup}</span> → {ride.destination}
          </p>
        </div>
      </div>

      <div className="zr-card zr-card--info" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="zr-inline zr-inline--between">
          <span className="zr-meta" style={{ color: 'inherit' }}>Comunicação Segura</span>
          <span className="zr-chip zr-chip--info" style={{ fontSize: '9px' }}>VoIP Activo</span>
        </div>
        <Suspense fallback={<div className="zr-loading-dots" style={{ alignSelf: 'center' }}><span></span><span></span><span></span></div>}>
          <AgoraCall
            corridaId={ride.rideId}
            userId={driverId}
            peerName={ride.passengerName ?? 'Passageiro'}
            onEndCall={() => {}}
          />
        </Suspense>
      </div>

      <div className="zr-card zr-card--success" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ display: 'block', fontSize: '14px', color: '#166534' }}>Live Share</strong>
          <span className="zr-meta" style={{ color: '#166534', opacity: 0.8 }}>Partilhar localização</span>
        </div>
        <button className="zr-button" style={{ backgroundColor: '#15803d', color: '#fff' }} onClick={() => {
          navigator.clipboard.writeText(`${window.location.origin}/track/${ride.rideId}`);
          showToast('Link copiado!', 'success');
        }}>
          Copiar Link
        </button>
      </div>

      <div style={{ marginTop: '8px' }}>
        <RideChat
          rideId={ride.rideId}
          myId={driverId}
          peerName={ride.passengerName ?? 'Passageiro'}
          phonePrivacyMode={true}
        />
      </div>

      <div className="zr-stack" style={{ gap: '12px', marginTop: '16px' }}>
        <button
          onClick={() => onAdvanceStatus(currentAction.next)}
          className="zr-button zr-button--block"
          style={{ fontSize: '14px', padding: '16px' }}
        >
          {currentAction.label}
        </button>
        <button
          onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
          className="zr-button zr-button--danger zr-button--block zr-button--ghost"
        >
          Cancelar corrida
        </button>
      </div>
    </div>
  );
};

export default DriverActiveCard;
