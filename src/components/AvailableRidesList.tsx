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
    <span className="text-lg shrink-0">{icon}</span>
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
          <button
            onClick={onDeclineAuction}
            disabled={actionLoading}
            className="py-5 rounded-3xl font-black text-[10px] uppercase bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-all disabled:opacity-60"
          >
            Recusar
          </button>
          <button
            onClick={onConfirmAuction}
            disabled={actionLoading}
            className="py-5 rounded-3xl font-black text-[10px] uppercase bg-primary text-white shadow-xl hover:bg-primary transition-all active:scale-95 disabled:opacity-60"
          >
            {actionLoading ? <Spinner /> : 'CONFIRMAR'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low border-2 border-outline-variant p-8 rounded-[3.5rem] shadow-2xl animate-in slide-in-from-bottom-20 duration-500">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-3 h-3 bg-primary rounded-full animate-ping" />
        <div>
          <p className="text-[10px] font-black text-primary uppercase tracking-widest">
            Nova corrida disponível
          </p>
          <p className="text-[8px] text-on-surface-variant/60 font-bold uppercase">
            Notificação persistente · não se perde
          </p>
        </div>
      </div>
      <InfoRow icon="📍" label="Origem"  value={incomingRide.origin_address} />
      <InfoRow icon="🏁" label="Destino" value={incomingRide.dest_address} />
      <div className="flex gap-2 my-4">
        <Pill label={`${incomingRide.price_kz.toLocaleString('pt-AO')} Kz`} blue />
        {incomingRide.distance_km && <Pill label={`${incomingRide.distance_km.toFixed(1)} km`} />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onIgnoreSearching}
          className="py-5 rounded-3xl font-black text-[10px] uppercase bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-all"
        >
          Ignorar
        </button>
        <button
          onClick={() => onAcceptSearching(incomingRide.id)}
          disabled={actionLoading}
          className="py-5 rounded-3xl font-black text-[10px] uppercase bg-[#0A0A0A] text-white shadow-xl hover:bg-surface-container-highest transition-all active:scale-95 disabled:opacity-60"
        >
          {actionLoading ? <Spinner /> : 'ACEITAR'}
        </button>
      </div>
    </div>
  );
};

export default AvailableRidesList;
