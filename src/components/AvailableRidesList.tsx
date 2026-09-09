import React, { useState, useEffect } from 'react';
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

const InfoRow: React.FC<{ icon: string; label: string; value: string; iconColor?: string }> = ({
  icon,
  label,
  value,
  iconColor = 'text-[#F2D38A]'
}) => (
  <div className="flex gap-3 items-start">
    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
      <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[9px] font-black text-neutral-400 uppercase tracking-wider">{label}</p>
      <p className="text-xs sm:text-sm font-bold text-white truncate">{value}</p>
    </div>
  </div>
);

const Spinner = () => (
  <span className="flex items-center justify-center gap-2">
    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
    A PROCESSAR...
  </span>
);

const AvailableRidesList: React.FC<AvailableRidesListProps> = ({
  isOnline,
  incomingRide,
  isAuctionRide,
  hasActiveRide,
  actionLoading,
  pendingNotifCount: _pendingNotifCount,
  onDeclineAuction,
  onConfirmAuction,
  onAcceptSearching,
  onIgnoreSearching,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(90);

  // Contador decrescente visual de 90 segundos
  useEffect(() => {
    if (!incomingRide?.id) return;
    setSecondsLeft(90);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Vibração táctil em dispositivos móveis
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([250, 100, 250]);
      }
    } catch {
      // Ignorar caso o browser bloqueie
    }

    return () => clearInterval(interval);
  }, [incomingRide?.id]);

  if (!isOnline || !incomingRide || hasActiveRide) return null;

  const passName = (incomingRide as any).passenger_name || 'Passageiro Zenith';
  const passRating = (incomingRide as any).passenger_rating ?? 5.0;
  const passAvatar = (incomingRide as any).passenger_avatar_url;
  const initial = passName.trim().charAt(0).toUpperCase() || 'P';

  const progressPercent = Math.max(0, Math.min(100, (secondsLeft / 90) * 100));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nova solicitação de corrida"
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg liquid-glass-card border-2 border-[#DCB354]/90 p-5 sm:p-6 rounded-[32px] shadow-[0_25px_80px_rgba(0,0,0,0.95)] animate-in slide-in-from-bottom-8 duration-300 relative overflow-hidden">
        
        {/* Barra de Progresso do Cronómetro (90s) */}
        <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-[#DCB354] via-[#F5DE9E] to-[#DCB354] transition-all duration-1000 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Topo: Notificação e Tempo Restante */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DCB354] opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-[#DCB354]" />
            </span>
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest gold-gradient-text">
                {isAuctionRide ? 'Passageiro Escolheu-te!' : 'Nova Corrida Disponível'}
              </p>
              <p className="text-[10px] text-neutral-400 font-medium">
                {isAuctionRide ? 'Pedido directo de viagem' : 'Disponível na tua área'}
              </p>
            </div>
          </div>

          <div className="px-2.5 py-1 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">timer</span>
            <span>{secondsLeft}s</span>
          </div>
        </div>

        {/* Card do Passageiro */}
        <div className="liquid-glass-subcard p-3.5 rounded-2xl border border-white/10 flex items-center gap-3.5 mb-3.5">
          {passAvatar ? (
            <img
              src={passAvatar}
              alt={passName}
              className="w-12 h-12 rounded-2xl object-cover border border-[#DCB354]/50 shadow-md"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#DCB354] to-[#8C6D23] flex items-center justify-center font-black text-black text-lg shadow-md">
              {initial}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-white truncate">{passName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] font-bold text-amber-300 flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[13px] fill-current">star</span>
                {typeof passRating === 'number' ? passRating.toFixed(1) : '5.0'}
              </span>
              <span className="text-[10px] text-neutral-400">• Passageiro Verificado</span>
            </div>
          </div>
        </div>

        {/* Detalhes da Rota */}
        <div className="liquid-glass-subcard p-3.5 rounded-2xl border border-white/10 space-y-3 mb-4">
          <InfoRow
            icon="my_location"
            label="Ponto de Recolha"
            value={incomingRide.origin_address}
            iconColor="text-emerald-400"
          />
          <div className="border-t border-white/5" />
          <InfoRow
            icon="location_on"
            label="Destino Final"
            value={incomingRide.dest_address}
            iconColor="text-[#F2D38A]"
          />
        </div>

        {/* Preço e Distância em Destaque */}
        <div className="flex items-center justify-between gap-3 mb-5 p-3 rounded-2xl bg-[#DCB354]/10 border border-[#DCB354]/30">
          <div>
            <p className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Ganhos da Corrida</p>
            <p className="text-lg sm:text-xl font-black text-[#F5DE9E]">
              {incomingRide.price_kz.toLocaleString('pt-AO')} Kz
            </p>
          </div>

          <div className="flex items-center gap-2">
            {incomingRide.distance_km && (
              <span className="px-2.5 py-1 rounded-xl text-xs font-bold text-neutral-200 bg-white/10 border border-white/10">
                {incomingRide.distance_km.toFixed(1)} km
              </span>
            )}
            {incomingRide.duration_min && (
              <span className="px-2.5 py-1 rounded-xl text-xs font-bold text-neutral-200 bg-white/10 border border-white/10">
                ~{incomingRide.duration_min} min
              </span>
            )}
          </div>
        </div>

        {/* Botões de Ação Táteis */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={isAuctionRide ? onDeclineAuction : onIgnoreSearching}
            disabled={actionLoading}
            className="py-4 rounded-2xl font-bold text-xs uppercase tracking-wider text-neutral-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/15 transition active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isAuctionRide ? 'Recusar' : 'Ignorar'}
          </button>

          <button
            type="button"
            onClick={isAuctionRide ? onConfirmAuction : () => onAcceptSearching(incomingRide.id)}
            disabled={actionLoading}
            className="champagne-gold-cta py-4 rounded-2xl font-black text-xs uppercase tracking-wider text-black flex items-center justify-center gap-2 shadow-[0_4px_25px_rgba(220,179,84,0.4)] transition active:scale-95 disabled:opacity-50 cursor-pointer hover:brightness-110"
          >
            {actionLoading ? <Spinner /> : isAuctionRide ? 'CONFIRMAR' : 'ACEITAR CORRIDA'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AvailableRidesList;
