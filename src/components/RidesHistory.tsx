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

// Helper breakdown
interface ReceiptBreakdown {
  baseKz: number;
  distanceKz: number;
  surgeKz: number;
  totalKz: number;
  surgeLabel: string | null;
  effectiveCostPerKm: number | null;
}

export function calculateReceiptBreakdown(ride: DbRide): ReceiptBreakdown {
  const total    = ride.price_kz   ?? 0;
  const surge    = ride.surge_multiplier ?? 1;
  const distKm   = ride.distance_km ?? null;

  const hasSurge = surge > 1.0;

  const preSurgeTotal = hasSurge
    ? Math.round(total / surge)
    : total;

  const BASE_RATIO    = 0.30;
  const baseKz        = Math.round(preSurgeTotal * BASE_RATIO);
  const distanceKz    = preSurgeTotal - baseKz;
  const surgeKz       = hasSurge ? total - preSurgeTotal : 0;

  const effectiveCostPerKm = distKm
    ? Math.round(distanceKz / distKm)
    : null;

  return {
    baseKz,
    distanceKz,
    surgeKz,
    totalKz: total,
    surgeLabel:        hasSurge ? `${surge.toFixed(1)}×` : null,
    effectiveCostPerKm,
  };
}

const STATUS_CONFIG: Record<string, { label: string; chipClass: string }> = {
  [RideStatus.COMPLETED]:  { label: 'Concluída',  chipClass: 'zr-chip--success' },
  [RideStatus.CANCELLED]:  { label: 'Cancelada',  chipClass: 'zr-chip--danger' },
  [RideStatus.IN_PROGRESS]: { label: 'Em curso',  chipClass: 'zr-chip--info' },
  [RideStatus.SEARCHING]:  { label: 'À procura',  chipClass: 'zr-chip--warning' },
  [RideStatus.ACCEPTED]:   { label: 'Aceite',     chipClass: 'zr-chip--info' },
  [RideStatus.PICKING_UP]: { label: 'A caminho',  chipClass: 'zr-chip--info' },
};

const RidesHistory: React.FC<RidesHistoryProps> = ({ userId }) => {
  const { role } = useAuth();

  const [rides,       setRides]       = useState<DbRide[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [aiSummary,   setAiSummary]   = useState<string>('A analisar o teu histórico...');
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

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

  useEffect(() => {
    if (rides.length === 0) return;

    const completedCount = rides.filter(r => r.status === RideStatus.COMPLETED).length;
    const cancelledCount = rides.filter(r => r.status === RideStatus.CANCELLED).length;
    const completionRate = rides.length > 0 ? Math.round((completedCount / rides.length) * 100) : 0;

    geminiService.getKazeInsight({
      role:   role,
      status: RideStatus.IDLE,
      extraText: `${completedCount} corridas concluídas, ${cancelledCount} canceladas, taxa ${completionRate}%`,
    }).then(insight => {
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

  if (loading) {
    return (
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">As tuas corridas</p>
            <h2 className="zr-section-title">Histórico</h2>
          </div>
          <span className="zr-chip zr-chip--gold">{total} Corridas</span>
        </div>
      </header>

      {/* Card IA */}
      {rides.length > 0 && (
        <section className="zr-card zr-card--info" style={{ marginInline: '14px', marginTop: '14px' }}>
          <div className="zr-inline" style={{ marginBottom: '8px' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--info)' }}>smart_toy</span>
            <strong>Kaze AI Insights</strong>
          </div>
          <p className="zr-copy">{aiSummary}</p>
        </section>
      )}

      {/* Lista de corridas */}
      <section className="zr-card" style={{ marginInline: '14px', marginTop: '14px' }}>
        <div className="zr-list">
          {rides.length === 0 ? (
            <div className="zr-empty">
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)' }}>receipt_long</span>
              <p>Ainda não tens corridas</p>
            </div>
          ) : (
            rides.map(ride => (
              <RideRow 
                key={ride.id} 
                ride={ride} 
                expanded={expandedId === ride.id}
                onToggle={() => setExpandedId(expandedId === ride.id ? null : ride.id)}
              />
            ))
          )}
        </div>

        {hasMore && (
          <button 
            onClick={loadMore} 
            disabled={loadingMore}
            className="zr-button zr-button--block zr-button--ghost" 
            style={{ marginTop: '14px' }}
          >
            {loadingMore ? 'A carregar...' : `VER MAIS (${total - rides.length})`}
          </button>
        )}
      </section>
    </div>
  );
};

// =============================================================================
// ROW COMPONENT
// =============================================================================
const RideRow: React.FC<{
  ride: DbRide;
  expanded: boolean;
  onToggle: () => void;
}> = ({ ride, expanded, onToggle }) => {
  const status = STATUS_CONFIG[ride.status] ?? { label: ride.status, chipClass: 'zr-chip--muted' };
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

  const fmt = (kz: number) => kz.toLocaleString('pt-AO');

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div 
        className="zr-list-item zr-list-item--interactive" 
        onClick={onToggle}
        style={{ padding: 0, border: 'none', background: 'transparent' }}
      >
        <div style={{ flex: 1 }}>
          <strong style={{ display: 'block', fontSize: '15px' }}>{ride.dest_address || 'Destino'}</strong>
          <span className="zr-meta">{dateLabel}</span>
          <div style={{ marginTop: '4px' }}>
            <span className={`zr-chip ${status.chipClass}`} style={{ fontSize: '10px' }}>{status.label}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <strong style={{ display: 'block', color: 'var(--gold)', fontSize: '16px' }}>{fmt(ride.price_kz)} Kz</strong>
          {(ride.distance_km || ride.duration_min) && (
            <span className="zr-copy">{ride.distance_km?.toFixed(1)} km · {ride.duration_min} min</span>
          )}
        </div>
      </div>

      {expanded && ride.status === RideStatus.COMPLETED && (
        <RideReceiptDetails ride={ride} />
      )}
      
      {expanded && ride.status === RideStatus.CANCELLED && ride.cancel_reason && (
        <div className="zr-alert-box zr-alert-box--danger" style={{ marginTop: '12px' }}>
          <div className="zr-alert-content">
            <strong>Motivo</strong>
            <p>{ride.cancel_reason}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export function RideReceiptDetails({ ride }: { ride: DbRide }) {
  const fmt = (kz: number) => kz.toLocaleString('pt-AO');
  const breakdown = calculateReceiptBreakdown(ride);

  return (
    <div style={{ marginTop: '14px', padding: '14px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
      <p className="zr-kicker" style={{ marginBottom: '8px' }}>Recibo</p>
      
      <div className="zr-inline zr-inline--between" style={{ marginBottom: '6px' }}>
        <span className="zr-copy">Tarifa base</span>
        <strong className="zr-copy">{fmt(breakdown.baseKz)} Kz</strong>
      </div>

      <div className="zr-inline zr-inline--between" style={{ marginBottom: '6px' }}>
        <span className="zr-copy">Distância ({ride.distance_km?.toFixed(1) ?? '—'} km)</span>
        <strong className="zr-copy">{fmt(breakdown.distanceKz)} Kz</strong>
      </div>

      {breakdown.surgeKz > 0 && (
        <div className="zr-inline zr-inline--between" style={{ marginBottom: '6px' }}>
          <span className="zr-copy" style={{ color: 'var(--warning)' }}>Procura elevada ({breakdown.surgeLabel})</span>
          <strong className="zr-copy" style={{ color: 'var(--warning)' }}>+ {fmt(breakdown.surgeKz)} Kz</strong>
        </div>
      )}

      <div className="zr-inline zr-inline--between" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--line)' }}>
        <strong>Total pago</strong>
        <strong style={{ color: 'var(--gold)' }}>{fmt(breakdown.totalKz)} Kz</strong>
      </div>
    </div>
  );
}

export default RidesHistory;
