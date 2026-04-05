// =============================================================================
// MOTOGO AI v2.0 — RidesHistory.tsx
// ANTES: 3 corridas mock hardcoded
// DEPOIS: histórico real do Supabase com paginação e análise de segurança Kaze
// =============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { rideService } from '../services/rideService';
import { geminiService } from '../services/geminiService';
import { useAuth } from '../contexts/AuthContext';
import type { DbRide } from '../types';
import { RideStatus } from '../types';

interface RidesHistoryProps {
  userId: string;
}

const PAGE_SIZE = 10;

const RidesHistory: React.FC<RidesHistoryProps> = ({ userId }) => {
  const { role } = useAuth();

  const [rides,       setRides]       = useState<DbRide[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [aiSummary,   setAiSummary]   = useState<string>('A analisar o teu histórico...');
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Carregar corridas
  // ------------------------------------------------------------------
  const loadRides = useCallback(async (pageNum = 0) => {
    if (pageNum === 0) setLoading(true);
    else setLoadingMore(true);

    const { rides: newRides, total: newTotal } = await rideService.getRideHistory(userId, pageNum, PAGE_SIZE);

    setTotal(newTotal);
    setRides(prev => pageNum === 0 ? newRides : [...prev, ...newRides]);

    if (pageNum === 0) setLoading(false);
    else setLoadingMore(false);
  }, [userId]);

  useEffect(() => { loadRides(0); }, [loadRides]);

  // ------------------------------------------------------------------
  // Insight de segurança Kaze (após carregar corridas)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (rides.length === 0) return;

    const completedCount = rides.filter(r => r.status === RideStatus.COMPLETED).length;
    const cancelledCount = rides.filter(r => r.status === RideStatus.CANCELLED).length;
    const completionRate = rides.length > 0 ? Math.round((completedCount / rides.length) * 100) : 0;

    geminiService.getKazeInsight({
      role:   role,
      status: RideStatus.IDLE,
      extraText: `${completedCount} corridas concluídas, ${cancelledCount} canceladas, taxa ${completionRate}%`,
    } as any).then(insight => {
        if (insight && insight.text) {
          setAiSummary(insight.text);
        }
    });
  }, [rides.length, role]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    loadRides(next);
  };

  const hasMore = rides.length < total;

  // ------------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="p-4 flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">A carregar corridas...</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-28">
      {/* Cabeçalho */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-black text-on-surface">As tuas corridas</h2>
          <p className="text-[10px] text-on-surface-variant/70 font-bold mt-0.5">
            {total} corrida{total !== 1 ? 's' : ''} no total
          </p>
        </div>
        <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
          Histórico Completo
        </span>
      </div>

      {/* Lista de corridas */}
      {rides.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-[2.5rem] p-12 text-center">
          <p className="text-4xl mb-3">🏍️</p>
          <p className="font-black text-outline text-sm">Ainda sem corridas</p>
          <p className="text-xs text-on-surface-variant/70 mt-1 font-bold">A tua primeira corrida aparece aqui</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rides.map((ride) => (
            <RideCard
              key={ride.id}
              ride={ride}
              expanded={expandedId === ride.id}
              onToggle={() => setExpandedId(expandedId === ride.id ? null : ride.id)}
            />
          ))}
        </div>
      )}

      {/* Botão de paginação */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-4 bg-surface-container-low text-on-surface-variant rounded-xl font-label font-bold text-[10px] uppercase tracking-widest hover:bg-surface-container transition-all disabled:opacity-50"
        >
          {loadingMore ? 'A carregar...' : `VER MAIS (${total - rides.length} restantes)`}
        </button>
      )}

      {/* Card de análise Kaze */}
      {rides.length > 0 && (
        <div className="bg-surface-container-lowest text-on-surface p-5 rounded-2xl shadow-lg">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xl">🛡️</span>
            <p className="text-[10px] font-black uppercase text-primary/70 tracking-widest">Kaze • Análise de Segurança</p>
          </div>
          <p className="text-xs italic leading-relaxed opacity-90">{aiSummary}</p>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// SUB-COMPONENTE: card de corrida individual
// =============================================================================
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  [RideStatus.COMPLETED]:  { label: 'Concluída',  color: 'text-primary', bg: 'bg-primary/10' },
  [RideStatus.CANCELLED]:  { label: 'Cancelada',  color: 'text-error',   bg: 'bg-error-container/20' },
  [RideStatus.IN_PROGRESS]: { label: 'Em curso',  color: 'text-primary',  bg: 'bg-primary/10' },
  [RideStatus.SEARCHING]:  { label: 'À procura',  color: 'text-primary', bg: 'bg-primary/8' },
  [RideStatus.ACCEPTED]:   { label: 'Aceite',     color: 'text-primary',  bg: 'bg-primary/10' },
  [RideStatus.PICKING_UP]: { label: 'A caminho',  color: 'text-primary',  bg: 'bg-primary/10' },
};

const RideCard: React.FC<{
  ride:     DbRide;
  expanded: boolean;
  onToggle: () => void;
}> = ({ ride, expanded, onToggle }) => {
  const status = STATUS_CONFIG[ride.status] ?? { label: ride.status, color: 'text-on-surface-variant', bg: 'bg-surface-container-lowest' };
  const date   = new Date(ride.created_at);

  const today     = new Date();
  const isToday   = date.toDateString() === today.toDateString();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const dateLabel = isToday
    ? `Hoje, ${date.toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' })}`
    : isYesterday
      ? `Ontem, ${date.toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' })}`
      : date.toLocaleDateString('pt-AO', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="bg-surface-container-low border border-outline-variant/15 p-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
      {/* Cabeçalho do card */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏍️</span>
          <div>
            <p className="text-[10px] text-on-surface-variant/60 font-bold uppercase">{dateLabel}</p>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
              {status.label}
            </span>
          </div>
        </div>
        <p className="font-black text-on-surface">
          {ride.price_kz.toLocaleString('pt-AO', { maximumFractionDigits: 0 })} Kz
        </p>
      </div>

      {/* Rota */}
      <div className="space-y-2 relative pl-5">
        <div className="absolute left-[7px] top-2 bottom-2 w-[1px] border-l border-dashed border-outline-variant/30" />
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center z-10 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
          </div>
          <p className="text-xs text-on-surface-variant truncate">{ride.origin_address}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-red-100 flex items-center justify-center z-10 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-red-600" />
          </div>
          <p className="text-xs text-on-surface-variant truncate">{ride.dest_address}</p>
        </div>
      </div>

      {/* Métricas básicas */}
      {(ride.distance_km || ride.duration_min) && (
        <div className="flex gap-2 mt-3">
          {ride.distance_km && (
            <span className="text-[9px] bg-surface-container-low text-on-surface-variant px-2 py-1 rounded-full font-bold">
              {ride.distance_km.toFixed(1)} km
            </span>
          )}
          {ride.duration_min && (
            <span className="text-[9px] bg-surface-container-low text-on-surface-variant px-2 py-1 rounded-full font-bold">
              ~{ride.duration_min} min
            </span>
          )}
          {ride.surge_multiplier > 1 && (
            <span className="text-[9px] bg-primary/15 text-primary px-2 py-1 rounded-full font-bold">
              ×{ride.surge_multiplier} surge
            </span>
          )}
        </div>
      )}

      {/* Detalhes expandidos */}
      {ride.status === RideStatus.COMPLETED && (
        <>
          <button
            onClick={onToggle}
            className="mt-4 w-full py-2 bg-surface-container-lowest text-[10px] font-bold text-primary rounded-lg hover:bg-primary/10 transition-colors uppercase tracking-widest"
          >
            {expanded ? 'Fechar' : 'Ver recibo'}
          </button>

          {expanded && (
            <div className="mt-3 bg-surface-container-lowest rounded-2xl p-4 space-y-2 text-xs animate-in slide-in-from-top duration-200">
              <ReceiptRow label="Tarifa base"   value="500 Kz" />
              <ReceiptRow
                label={`Por km (${ride.distance_km?.toFixed(1) ?? '—'} km)`}
                value={`${ride.distance_km ? Math.round(ride.distance_km * 250).toLocaleString('pt-AO') : '—'} Kz`}
              />
              {ride.surge_multiplier > 1 && (
                <ReceiptRow
                  label={`Surge ×${ride.surge_multiplier}`}
                  value={`+${Math.round(ride.price_kz * (1 - 1 / ride.surge_multiplier)).toLocaleString('pt-AO')} Kz`}
                  highlight
                />
              )}
              <div className="border-t border-outline-variant/30 pt-2">
                <ReceiptRow
                  label="Total pago"
                  value={`${ride.price_kz.toLocaleString('pt-AO', { maximumFractionDigits: 0 })} Kz`}
                  bold
                />
              </div>
              {ride.completed_at && (
                <p className="text-[9px] text-on-surface-variant/70 font-bold pt-1">
                  Concluída: {new Date(ride.completed_at).toLocaleString('pt-AO')}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Motivo de cancelamento */}
      {ride.status === RideStatus.CANCELLED && ride.cancel_reason && (
        <p className="mt-2 text-[9px] text-red-500 font-bold">
          Motivo: {ride.cancel_reason}
        </p>
      )}
    </div>
  );
};

const ReceiptRow: React.FC<{ label: string; value: string; bold?: boolean; highlight?: boolean }> = ({
  label, value, bold, highlight
}) => (
  <div className={`flex justify-between ${bold ? 'font-black text-on-surface' : 'text-on-surface-variant'}`}>
    <span>{label}</span>
    <span className={highlight ? 'text-primary/80' : ''}>{value}</span>
  </div>
);

export default RidesHistory;
