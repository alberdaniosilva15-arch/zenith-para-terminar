import React from 'react';
import type { DbRide } from '../types';

interface AvailableRidesListProps {
  isOnline: boolean;
  incomingRide: DbRide | null;
  isAuctionRide: boolean;
  hasActiveRide: boolean;
  actionLoading: boolean;
  pendingNotifCount: number;
  onDeclineAuction: () => Promise<void>;
  onConfirmAuction: () => Promise<void>;
  onAcceptSearching: (rideId: string) => Promise<void>;
  onIgnoreSearching: () => void;
}

const InfoRow: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex gap-3 items-start mb-3">
    <span className="material-symbols-outlined shrink-0" style={{ fontSize: '20px' }}>{icon}</span>
    <div className="min-w-0">
      <p className="text-[8px] font-black text-on-surface-variant/70 uppercase">{label}</p>
      <p className="text-sm font-black text-on-surface truncate">{value}</p>
    </div>
  </div>
);

const Pill: React.FC<{ label: string; blue?: boolean }> = ({ label, blue }) => (
  <span className={`text-[10px] font-black px-3 py-1.5 rounded-full ${
    blue ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'
  }`}>
    {label}
  </span>
);

const Spinner = () => (
  <span className="flex items-center justify-center gap-2">
    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    A processar...
  </span>
);

const AvailableRidesList: React.FC<AvailableRidesListProps> = ({
  isOnline,
  incomingRide,
  isAuctionRide,
  hasActiveRide,
  actionLoading,
  pendingNotifCount,
  onDeclineAuction,
  onConfirmAuction,
  onAcceptSearching,
  onIgnoreSearching
}) => {
  if (!isOnline || !incomingRide || hasActiveRide) return null;

  if (isAuctionRide) {
    return (
      <div className="liquid-glass-card border border-[#DCB354]/60 p-6 rounded-[28px] shadow-[0_20px_60px_rgba(220,179,84,0.18)] animate-in slide-in-from-bottom-5 duration-300 mt-3.5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[#DCB354]/20 border border-[#DCB354]/40 flex items-center justify-center">
            <span className="material-symbols-outlined text-[#F5DE9E] text-xl">star</span>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest gold-gradient-text">Passageiro escolheu-te!</p>
            <p className="text-[11px] text-neutral-300 font-medium">Confirma para iniciar a viagem</p>
          </div>
        </div>

        <div className="liquid-glass-subcard p-3.5 rounded-2xl border border-white/10 space-y-2 mb-4">
          <InfoRow icon="location_on" label="Origem"  value={incomingRide.origin_address} />
          <InfoRow icon="flag" label="Destino" value={incomingRide.dest_address} />
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-[#DCB354]/20 border border-[#DCB354]/50 text-[#F5DE9E]">
            {incomingRide.price_kz.toLocaleString('pt-AO')} Kz
          </span>
          {incomingRide.distance_km && (
            <span className="liquid-glass-subcard px-3 py-1.5 rounded-xl text-xs font-bold text-neutral-300 border border-white/10">
              {incomingRide.distance_km.toFixed(1)} km
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDeclineAuction}
            disabled={actionLoading}
            className="liquid-glass-subcard py-3.5 rounded-2xl font-bold text-xs uppercase tracking-wider text-neutral-400 hover:text-white border border-white/10 hover:border-red-400/40 transition disabled:opacity-50 cursor-pointer"
          >
            Recusar
          </button>
          <button
            type="button"
            onClick={onConfirmAuction}
            disabled={actionLoading}
            className="champagne-gold-cta py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider text-black flex items-center justify-center gap-2 shadow-lg transition active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {actionLoading ? <Spinner /> : 'CONFIRMAR'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="liquid-glass-card border border-[#DCB354]/50 p-6 rounded-[28px] shadow-[0_20px_60px_rgba(0,0,0,0.8)] animate-in slide-in-from-bottom-5 duration-300 mt-3.5">
      <div className="flex items-center gap-3 mb-4">
        <span className="relative flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DCB354] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#DCB354]"></span>
        </span>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest gold-gradient-text">
            Nova Corrida Disponível
          </p>
          <p className="text-[11px] text-neutral-300 font-medium">
            Passageiro aguarda confirmação
          </p>
        </div>
      </div>

      <div className="liquid-glass-subcard p-3.5 rounded-2xl border border-white/10 space-y-2 mb-4">
        <InfoRow icon="location_on" label="Origem"  value={incomingRide.origin_address} />
        <InfoRow icon="flag" label="Destino" value={incomingRide.dest_address} />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="px-3 py-1.5 rounded-xl text-xs font-black bg-[#DCB354]/20 border border-[#DCB354]/50 text-[#F5DE9E]">
          {incomingRide.price_kz.toLocaleString('pt-AO')} Kz
        </span>
        {incomingRide.distance_km && (
          <span className="liquid-glass-subcard px-3 py-1.5 rounded-xl text-xs font-bold text-neutral-300 border border-white/10">
            {incomingRide.distance_km.toFixed(1)} km
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onIgnoreSearching}
          className="liquid-glass-subcard py-3.5 rounded-2xl font-bold text-xs uppercase tracking-wider text-neutral-400 hover:text-white border border-white/10 hover:border-white/20 transition cursor-pointer"
        >
          Ignorar
        </button>
        <button
          type="button"
          onClick={() => onAcceptSearching(incomingRide.id)}
          disabled={actionLoading}
          className="champagne-gold-cta py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider text-black flex items-center justify-center gap-2 shadow-lg transition active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {actionLoading ? <Spinner /> : 'ACEITAR'}
        </button>
      </div>
    </div>
  );
};

export default AvailableRidesList;
