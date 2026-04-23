import React from 'react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useMetrics } from '../../hooks/useMetrics';
import { Car, Users, TrendingUp, X, Activity, Zap, Radio } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ── Formatador de moeda angolana ──────────────────────────────────────────────
const fmtKz = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M Kz`
    : v >= 1_000
    ? `${(v / 1_000).toFixed(0)}k Kz`
    : `${Math.round(v)} Kz`;

// ── MetricCard ────────────────────────────────────────────────────────────────
const MetricCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
  badge?: string;
  badgeType?: 'up' | 'down' | 'neutral' | 'blue' | 'amber';
  icon: React.ReactNode;
  valueColor?: 'green' | 'amber' | 'red';
}> = ({ label, value, sub, badge, badgeType = 'neutral', icon, valueColor }) => (
  <div className="metric-card fade-in">
    <div className="flex items-center justify-between mb-8">
      <span className="metric-card-label">{label}</span>
      <span style={{ color: 'var(--text3)', opacity: 0.7 }}>{icon}</span>
    </div>
    <div className={`metric-card-value${valueColor ? ` ${valueColor}` : ''}`}>{value}</div>
    {sub && <div className="metric-card-sub">{sub}</div>}
    {badge && <div className={`metric-card-badge badge-${badgeType}`}>{badge}</div>}
  </div>
);

// ── Tooltip personalizado ─────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: {
  active?: boolean; payload?: {value: number; name: string}[]; label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg3)', border: '1px solid var(--border2)',
      borderRadius: '8px', padding: '10px 14px', fontSize: '11px',
    }}>
      <p style={{ color: 'var(--text3)', marginBottom: '4px' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: 'var(--green)' }}>
          {p.name === 'gmv' ? fmtKz(p.value) : `${p.value} corridas`}
        </p>
      ))}
    </div>
  );
};

// ── HeatMap de Zonas ──────────────────────────────────────────────────────────
const ZoneHeatMap: React.FC<{ zones: { zone: string; count: number }[] }> = ({ zones }) => {
  const max = Math.max(...zones.map(z => z.count), 1);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        {zones.slice(0, 8).map(({ zone, count }) => {
          const pct = count / max;
          const cls = pct > 0.66 ? 'hot' : pct > 0.33 ? 'warm' : 'cool';
          return (
            <div key={zone} className={`heatmap-zone ${cls}`}>
              <div className="heatmap-zone-name">{zone}</div>
              <div className="heatmap-zone-count">{count}</div>
              <div className="heatmap-zone-label">corrida{count !== 1 ? 's' : ''}</div>
            </div>
          );
        })}
        {zones.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text3)', padding: '20px', fontSize: '12px' }}>
            Nenhuma corrida activa agora
          </div>
        )}
      </div>
    </div>
  );
};

// ── Dashboard Principal ───────────────────────────────────────────────────────
const Dashboard: React.FC = () => {
  const { metrics, hourly, zones, loading, refresh } = useMetrics();
  const [broadcastMsg, setBroadcastMsg] = React.useState('');

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    await supabase.channel('zenith_global').send({
      type: 'broadcast',
      event: 'admin_msg',
      payload: { message: broadcastMsg.trim(), time: new Date().toISOString() }
    });
    alert('Mensagem enviada simultaneamente a todos os utilizadores (Passageiros e Motoristas) online!');
    setBroadcastMsg('');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '16px' }}>
        <span className="spinner" style={{ width: '36px', height: '36px', borderWidth: '3px' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' }}>
          A carregar métricas em tempo real...
        </span>
      </div>
    );
  }

  return (
    <div className="fade-in space-y-24">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Dashboard Central</h1>
          <p className="page-sub">Métricas em tempo real — actualiza automaticamente</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refresh}>
          ↻ Actualizar
        </button>
      </div>

      {/* Métricas principais — fila 1 */}
      <div className="grid-4">
        <MetricCard
          label="Corridas Hoje"
          value={metrics.ridesCompletedToday.toString()}
          sub="Concluídas com sucesso"
          badge={`${metrics.ridesActiveNow} activas agora`}
          badgeType="blue"
          icon={<Car size={16} />}
          valueColor="green"
        />
        <MetricCard
          label="Motoristas Online"
          value={metrics.driversOnline.toString()}
          sub="Disponíveis para corridas"
          badge={metrics.driversOnline > 10 ? '✓ Boa cobertura' : '⚠ Cobertura baixa'}
          badgeType={metrics.driversOnline > 10 ? 'up' : 'amber'}
          icon={<Users size={16} />}
        />
        <MetricCard
          label="GMV Hoje"
          value={fmtKz(metrics.gmvToday)}
          sub={`${fmtKz(metrics.revenueToday)} receita plataforma`}
          badge={`Ticket médio: ${fmtKz(metrics.avgFare)}`}
          badgeType="neutral"
          icon={<TrendingUp size={16} />}
          valueColor="green"
        />
        <MetricCard
          label="Cancelamentos"
          value={metrics.ridesCancelledToday.toString()}
          sub={`Taxa: ${metrics.cancelRate.toFixed(1)}%`}
          badge={metrics.cancelRate > 15 ? '⚠ Alta' : '✓ Normal'}
          badgeType={metrics.cancelRate > 15 ? 'down' : 'up'}
          icon={<X size={16} />}
          valueColor={metrics.cancelRate > 15 ? 'red' : undefined}
        />
      </div>

      {/* Métricas mensais — fila 2 */}
      <div className="grid-3">
        <MetricCard
          label="GMV Este Mês"
          value={fmtKz(metrics.gmvMonth)}
          sub="Volume total transaccionado"
          icon={<Activity size={16} />}
          valueColor="green"
        />
        <MetricCard
          label="Receita Este Mês"
          value={fmtKz(metrics.revenueMonth)}
          sub="Comissão 15% sobre GMV"
          icon={<Zap size={16} />}
          valueColor="green"
        />
        <MetricCard
          label="Corridas Activas"
          value={metrics.ridesActiveNow.toString()}
          sub="A decorrer agora"
          badge={metrics.ridesActiveNow > 0 ? 'Em tempo real' : 'Nenhuma activa'}
          badgeType={metrics.ridesActiveNow > 0 ? 'blue' : 'neutral'}
          icon={<Car size={16} />}
        />
      </div>

      {/* Broadcast System - Transmissão para App Principal */}
      <div className="card" style={{ background: 'linear-gradient(145deg, var(--bg2), var(--bg3))', border: '1px solid var(--primary)' }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex flex-col items-center justify-center text-primary">
            <Radio size={20} />
          </div>
          <div>
            <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '15px', fontWeight: 900 }}>Comunicação Global (Omni-Broadcast)</h3>
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>A tua mensagem saltará instantaneamente no ecrã de todos os utilizadores online.</p>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          <input
            type="text"
            value={broadcastMsg}
            onChange={e => setBroadcastMsg(e.target.value)}
            placeholder="Ex: Alerta de Trânsito pesado na Marginal..."
            className="flex-1 bg-[var(--bg1)] border border-[var(--border1)] p-4 rounded-2xl outline-none focus:border-[var(--primary)] text-sm"
          />
          <button 
            onClick={sendBroadcast}
            disabled={!broadcastMsg.trim()}
            className="bg-primary text-black py-4 px-8 rounded-2xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            DISPARAR MENSAGEM
          </button>
        </div>
      </div>

      {/* Gráfico de corridas por hora */}
      <div className="card">
        <div className="flex items-center justify-between mb-16">
          <div>
            <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '14px', fontWeight: 700 }}>
              Corridas por Hora (últimas 24h)
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '3px' }}>
              Volume de corridas e GMV gerado por período
            </p>
          </div>
        </div>
        {hourly.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={hourly}>
              <defs>
                <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00e676" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#00e676" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid />
              <XAxis dataKey="hour" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="corridas" stroke="#00e676" fill="url(#greenGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: '12px' }}>
            Ainda sem corridas concluídas nas últimas 24h
          </div>
        )}
      </div>

      {/* Mapa de calor de zonas + GMV por zona */}
      <div className="grid-2">
        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>
            Mapa de Calor — Zonas Activas
          </h3>
          <ZoneHeatMap zones={zones} />
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-title)', fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>
            GMV por Hora (Kz)
          </h3>
          {hourly.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourly}>
                <CartesianGrid />
                <XAxis dataKey="hour" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="gmv" fill="#00e676" radius={[4,4,0,0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: '12px' }}>
              Sem dados de GMV
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default Dashboard;
