// =============================================================================
// ZENITH RIDE v3.2 — DriverActiveCard.tsx
// Cartão de corrida activa do motorista com layout ergonómico e comunicação integrada
// =============================================================================

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

  const nextActionMap: Record<string, { label: string; icon: string; next: RideStatus; statusBadge: string }> = {
    [RideStatus.ACCEPTED]:    { label: 'A CAMINHO DO CLIENTE', icon: 'navigation',      next: RideStatus.PICKING_UP, statusBadge: 'Em Rota de Recolha' },
    [RideStatus.PICKING_UP]:  { label: 'CHEGUEI AO LOCAL',     icon: 'pin_drop',        next: RideStatus.IN_PROGRESS, statusBadge: 'No Ponto de Encontro' },
    [RideStatus.IN_PROGRESS]: { label: 'CONCLUIR CORRIDA',     icon: 'flag_circle',     next: RideStatus.COMPLETED, statusBadge: 'Corrida em Curso' },
  };
  const currentAction = ride.status ? nextActionMap[ride.status] : null;

  if (!currentAction) return null;

  const passengerName = ride.passengerName || 'Passageiro';
  const priceDisplay = ride.priceKz ? `${ride.priceKz.toLocaleString('pt-AO')} Kz` : null;

  return (
    <div className="bg-[#121214] border border-primary/30 rounded-3xl p-5 shadow-2xl space-y-4 text-white">
      
      {/* 1. Cabeçalho com Info do Passageiro e Preço */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-12 h-12 rounded-2xl golden-gradient text-black flex items-center justify-center font-headline font-black text-xl shadow-md flex-shrink-0">
            {passengerName.charAt(0).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-primary tracking-wider uppercase">{currentAction.statusBadge}</span>
            </div>
            <h3 className="font-headline font-black text-base text-white truncate">{passengerName}</h3>
          </div>
        </div>

        {priceDisplay && (
          <div className="text-right flex-shrink-0 bg-white/5 px-3 py-1.5 rounded-xl border border-white/10">
            <span className="text-[9px] text-white/50 block font-mono">VALOR</span>
            <span className="font-headline font-black text-sm text-primary">{priceDisplay}</span>
          </div>
        )}
      </div>

      {/* 2. Rota: Origem -> Destino */}
      <div className="bg-black/40 rounded-2xl p-3 border border-white/5 space-y-2 text-xs">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-emerald-400 text-sm mt-0.5">trip_origin</span>
          <div className="overflow-hidden">
            <span className="text-[9px] text-white/40 block font-mono">RECOLHA</span>
            <span className="font-medium text-white truncate block">{ride.pickup || 'Ponto de recolha'}</span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-primary text-sm mt-0.5">location_on</span>
          <div className="overflow-hidden">
            <span className="text-[9px] text-white/40 block font-mono">DESTINO</span>
            <span className="font-medium text-white truncate block">{ride.destination || 'Destino da corrida'}</span>
          </div>
        </div>
      </div>

      {/* 3. Acção Principal do Motorista (Destaque ergonómico) */}
      <button
        onClick={() => onAdvanceStatus(currentAction.next)}
        className="w-full py-4 px-4 rounded-2xl golden-gradient text-black font-headline font-black text-sm uppercase tracking-wider shadow-glow gold-box-glow active:scale-98 luxury-transition flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-xl">{currentAction.icon}</span>
        <span>{currentAction.label}</span>
      </button>

      {/* 4. Módulo de Comunicação: VoIP + Chat + Partilha */}
      <div className="space-y-2.5 pt-1 border-t border-white/10">
        <p className="text-[9px] font-black uppercase tracking-wider text-white/40 mb-1">
          Comunicação Segura & Ferramentas
        </p>

        {/* VoIP Agora */}
        <Suspense fallback={<div className="h-11 bg-white/5 rounded-2xl animate-pulse" />}>
          <AgoraCall
            corridaId={ride.rideId}
            userId={driverId}
            peerName={passengerName}
            onEndCall={() => {}}
          />
        </Suspense>

        {/* Barra de 2 colunas: Chat e Live Share */}
        <div className="grid grid-cols-2 gap-2">
          <RideChat
            rideId={ride.rideId}
            myId={driverId}
            peerName={passengerName}
            phonePrivacyMode={true}
          />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}/track/${ride.rideId}`);
              showToast('Link de localização copiado!', 'success');
            }}
            className="flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-surface-container border border-primary/20 hover:border-primary/50 text-on-surface font-bold text-xs luxury-transition active:scale-98 shadow-md"
            title="Copiar link de localização em tempo real"
          >
            <span className="material-symbols-outlined text-primary text-lg">share_location</span>
            <span>Partilhar Rota</span>
          </button>
        </div>
      </div>

      {/* 5. Cancelar Corrida */}
      <div className="pt-2 text-center">
        <button
          onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
          className="text-error/70 hover:text-error text-xs font-bold transition-all py-1 px-3 rounded-lg hover:bg-error/10 inline-block"
        >
          Cancelar corrida
        </button>
      </div>
    </div>
  );
};

export default DriverActiveCard;
