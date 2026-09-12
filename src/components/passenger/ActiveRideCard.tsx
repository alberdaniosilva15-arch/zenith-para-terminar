// =============================================================================
// ZENITH RIDE v3.7 — ActiveRideCard.tsx
// FIX v3.7:
//   - BUG 1 RESOLVIDO: Suporte completo a PICKING_UP — passageiro mantém chat,
//     chamada, Safety Shield e SOS durante toda a fase "a caminho".
//   - BUG 4 RESOLVIDO: ACCEPTED com driver_confirmed=false mostra estado
//     "Aguardando confirmação" em vez de "Confirmado · Em rota".
//   - Safety Shield mantido em ACCEPTED, PICKING_UP e IN_PROGRESS.
// =============================================================================

import React, { Suspense } from 'react';
import { RideState, RideStatus } from '../../types';
import RideChat from '../RideChat';
import { LiveShareButton } from './LiveShareButton';

const AgoraCall = React.lazy(() => import('../AgoraCall'));

interface ActiveRideCardProps {
  ride:            RideState;
  userId:          string;
  routeInfo:       { distanceKm: number; durationMin: number } | null;
  onCancelRide:    (reason: string) => void;
  emergencyPhone?: string;
  driverName?:     string;
}

const ActiveRideCard: React.FC<ActiveRideCardProps> = ({
  ride,
  userId,
  routeInfo,
  onCancelRide,
  emergencyPhone,
}) => {
  // FIX BUG 1: Agora inclui PICKING_UP no guard
  if (
    ride.status !== RideStatus.SEARCHING &&
    ride.status !== RideStatus.ACCEPTED  &&
    ride.status !== RideStatus.PICKING_UP &&
    ride.status !== RideStatus.IN_PROGRESS
  ) {
    return null;
  }

  const resolvedDriverName = ride.driverName ?? 'Motorista';
  const resolvedRideId     = ride.rideId     ?? '';
  const confirmCancelRide = () => {
    onCancelRide('Cancelado pelo passageiro após aceitação');
  };

  // FIX BUG 4: Determinar se o motorista já confirmou (leilão vs fluxo normal)
  const isDriverConfirmed = ride.driverConfirmed !== false; // undefined = true (fluxo normal)
  // Determinar se estamos na fase "a caminho" (ACCEPTED confirmado OU PICKING_UP)
  const isEnRoute = (ride.status === RideStatus.ACCEPTED && isDriverConfirmed) ||
                     ride.status === RideStatus.PICKING_UP;

  // Progresso visual: ACCEPTED aguardando = 1/6, ACCEPTED confirmado = 1/3, PICKING_UP = 2/3, IN_PROGRESS = full
  const progressWidth =
    ride.status === RideStatus.ACCEPTED && !isDriverConfirmed ? 'w-1/6' :
    ride.status === RideStatus.ACCEPTED && isDriverConfirmed  ? 'w-1/3' :
    ride.status === RideStatus.PICKING_UP                     ? 'w-2/3' :
    'w-full';

  return (
    <div className="space-y-4">
      {/* ── Listener contínuo de chamada em background ── */}
      {resolvedRideId && !isEnRoute && ride.status !== RideStatus.IN_PROGRESS && (
        <Suspense fallback={null}>
          <AgoraCall
            corridaId={resolvedRideId}
            userId={userId}
            peerName={resolvedDriverName}
            silentIdle={true}
            onEndCall={() => {}}
          />
        </Suspense>
      )}

      {/* ── SEARCHING ─────────────────────────────────────────────────────── */}
      {ride.status === RideStatus.SEARCHING && (
        <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-2xl border border-outline-variant/20">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="absolute inset-0 flex items-center justify-center"><span className="material-symbols-outlined text-2xl">local_taxi</span></span>
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

      {/* ── ACCEPTED (driver_confirmed=false) — Aguardando confirmação do motorista ── */}
      {ride.status === RideStatus.ACCEPTED && !isDriverConfirmed && (
        <div className="bg-surface-container-low border border-yellow-500/30 p-6 rounded-[2.5rem] vault-shadow space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-yellow-500/20 rounded-2xl flex items-center justify-center vault-shadow">
              <span className="material-symbols-outlined text-2xl text-yellow-500 animate-pulse">hourglass_top</span>
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">{resolvedDriverName}</p>
              <p className="text-[10px] font-label text-yellow-500/80 uppercase tracking-widest">Aguardando confirmação</p>
            </div>
          </div>

          {/* Barra de progresso */}
          <div className="vault-indicator-track">
            <div className={`vault-indicator-fill ${progressWidth}`} style={{ backgroundColor: 'var(--warning, #eab308)' }} />
          </div>

          <p className="text-[10px] text-on-surface-variant/60 font-bold text-center">
            O motorista selecionado foi notificado. Aguarde a confirmação…
          </p>

          <button
            onClick={() => onCancelRide('Cancelado pelo passageiro — motorista não confirmou')}
            className="zr-button zr-button--block zr-button--secondary"
            style={{ color: 'var(--danger-soft)', borderColor: 'rgba(239, 68, 68, 0.35)' }}
          >
            Cancelar e escolher outro
          </button>
        </div>
      )}

      {/* ── ACCEPTED (confirmado) / PICKING_UP — motorista confirmou e está a caminho ── */}
      {isEnRoute && (
        <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
          {/* Header — motorista */}
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 golden-gradient rounded-2xl flex items-center justify-center text-2xl font-headline font-bold vault-shadow">
              {resolvedDriverName.charAt(0)}
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">{resolvedDriverName} a caminho</p>
              <p className="text-[10px] font-label text-primary/70 uppercase tracking-widest">
                {ride.status === RideStatus.PICKING_UP ? 'A caminho · Recolha' : 'Confirmado · Em rota'}
              </p>
            </div>
          </div>

          {/* Barra de progresso */}
          <div className="vault-indicator-track">
            <div className={`vault-indicator-fill ${progressWidth}`} />
          </div>

          {/* 🛡️ SAFETY SHIELD — partilha ao vivo */}
          {resolvedRideId && (
            <div className="border-t border-outline-variant/10 pt-4">
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/50 mb-2"><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>shield</span> Safety Shield</p>
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

          <div className="grid grid-cols-2 gap-2">
            <a
              href="tel:113"
              className="zr-button zr-button--danger zr-button--block"
              style={{ padding: '10px 0', fontSize: '10px' }}
            >
              <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>call</span> Ligar 113
            </a>
            <a
              href="tel:112"
              className="zr-button zr-button--secondary zr-button--block"
              style={{ padding: '10px 0', fontSize: '10px', color: 'var(--danger-soft)', borderColor: 'var(--danger-soft)' }}
            >
              <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>call</span> Ligar 112
            </a>
          </div>

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

          <button
            onClick={confirmCancelRide}
            className="zr-button zr-button--block zr-button--secondary"
            style={{ color: 'var(--danger-soft)', borderColor: 'rgba(239, 68, 68, 0.35)' }}
          >
            Cancelar corrida
          </button>
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
                  <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>straighten</span> {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
                </p>
              )}
            </div>
          </div>

          {/* 🛡️ SAFETY SHIELD — partilha + SOS */}
          {resolvedRideId && (
            <div className="border border-outline-variant/10 rounded-2xl p-4 space-y-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/50"><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>shield</span> Kaze Safety Shield</p>
              <LiveShareButton
                rideId={resolvedRideId}
                userId={userId}
                driverName={resolvedDriverName}
                emergencyPhone={emergencyPhone}
                pickup={ride.pickup}
                destination={ride.destination}
              />
              <div className="grid grid-cols-2 gap-2">
                <a
                  href="tel:113"
                  className="zr-button zr-button--danger zr-button--block"
                  style={{ padding: '10px 0', fontSize: '10px' }}
                >
                  <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>call</span> Ligar 113
                </a>
                <a
                  href="tel:112"
                  className="zr-button zr-button--secondary zr-button--block"
                  style={{ padding: '10px 0', fontSize: '10px', color: 'var(--danger-soft)', borderColor: 'var(--danger-soft)' }}
                >
                  <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>call</span> Ligar 112
                </a>
              </div>
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
