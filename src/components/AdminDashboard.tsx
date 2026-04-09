// =============================================================================
// ZENITH RIDE v3.1 — AdminDashboard.tsx
// ✅ FIX: Removidos os 3 valores hardcoded (linhas 110, 123, 127)
// ✅ NOVO: Queries reais Supabase — corridas 24h, motoristas activos, ganhos 24h
// ✅ NOVO: Subscrição Realtime a driver_locations para contagem ao vivo
// ✅ NOTA: A fórmula de preços é exclusiva do painel admin/CRM — nunca exposta aqui
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AutonomousCommand } from '../types';
import { geminiService } from '../services/geminiService';
import { supabase } from '../lib/supabase';

interface AdminDashboardProps {
  lastCommand?: AutonomousCommand | null;
}

interface DashboardMetrics {
  ridesLast24h:     number;
  activeDrivers:    number;
  revenueKzLast24h: number;
  loadingMetrics:   boolean;
}

const INITIAL_METRICS: DashboardMetrics = {
  ridesLast24h:     0,
  activeDrivers:    0,
  revenueKzLast24h: 0,
  loadingMetrics:   true,
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ lastCommand }) => {
  const [activeTab, setActiveTab] = useState<'security' | 'market' | 'kaze'>('security');
  const [commands,  setCommands]  = useState<AutonomousCommand[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [metrics,   setMetrics]   = useState<DashboardMetrics>(INITIAL_METRICS);

  const [zonesData, setZonesData] = useState<{ name: string; demand: number; risk: number }[]>([]);

  // Ref para subscrição Realtime — driver_locations
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Queries de métricas reais ─────────────────────────────────────────────
  const fetchMetrics = async () => {
    setMetrics(prev => ({ ...prev, loadingMetrics: true }));
    try {
      // 1. COUNT corridas completadas nas últimas 24h
      const { count: ridesCount, error: ridesErr } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (ridesErr) console.warn('[AdminDashboard] ridesCount error:', ridesErr.message);

      // 2. COUNT motoristas disponíveis agora
      const { count: driversCount, error: driversErr } = await supabase
        .from('driver_locations')
        .select('driver_id', { count: 'exact', head: true })
        .eq('status', 'available');

      if (driversErr) console.warn('[AdminDashboard] driversCount error:', driversErr.message);

      // 3. SUM receita das corridas completadas nas últimas 24h
      const { data: revenueData, error: revenueErr } = await supabase
        .from('rides')
        .select('price_kz')
        .eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (revenueErr) console.warn('[AdminDashboard] revenue error:', revenueErr.message);

      const totalRevenue = (revenueData ?? []).reduce(
        (sum, r) => sum + (Number(r.price_kz) || 0),
        0
      );

      setMetrics({
        ridesLast24h:     ridesCount ?? 0,
        activeDrivers:    driversCount ?? 0,
        revenueKzLast24h: totalRevenue,
        loadingMetrics:   false,
      });
    } catch (e) {
      console.error('[AdminDashboard] Erro ao carregar métricas:', e);
      setMetrics(prev => ({ ...prev, loadingMetrics: false }));
    }
  };

  // ── Subscrição Realtime a driver_locations (contador ao vivo) ─────────────
  const subscribeRealtime = () => {
    if (realtimeRef.current) {
      supabase.removeChannel(realtimeRef.current);
      realtimeRef.current = null;
    }

    realtimeRef.current = supabase
      .channel('admin-driver-locations-live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'driver_locations',
      }, () => {
        // Qualquer mudança em driver_locations → re-contar motoristas disponíveis
        supabase
          .from('driver_locations')
          .select('driver_id', { count: 'exact', head: true })
          .eq('status', 'available')
          .then(({ count }) => {
            if (count !== null) {
              setMetrics(prev => ({ ...prev, activeDrivers: count }));
            }
          });
      })
      .subscribe((status) => {
        console.log('[AdminDashboard] Realtime driver_locations:', status);
      });
  };

  // ── AI Vigilante + zonas ──────────────────────────────────────────────────
  useEffect(() => {
    const fetchDecisions = async () => {
      setLoading(true);
      try {
        const { data: zData } = await supabase.rpc('get_zones_demand');
        const activeZones = zData || [];
        setZonesData(activeZones);

        const data = await geminiService.getAutonomousDecisions({
          role: 'admin',
          activeRideStatus: 'IDLE',
          multiplier: 1,
          system_load: 0.85,
          luanda_time: new Date().toLocaleTimeString(),
          hot_zones: activeZones.filter((z: any) => z.demand > 80).map((z: any) => z.name)
        });
        setCommands(data);
      } catch (e) {
        console.error('[AdminDashboard] Erro ao carregar decisões AI');
      } finally {
        setLoading(false);
      }
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── Carregar métricas + iniciar Realtime ──────────────────────────────────
  useEffect(() => {
    fetchMetrics();
    subscribeRealtime();

    // Re-fetch métricas a cada 60s
    const metricsInterval = setInterval(fetchMetrics, 60_000);

    return () => {
      clearInterval(metricsInterval);
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, []);

  // ── Formatter de números ──────────────────────────────────────────────────
  const formatKz = (value: number): string => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString('pt-AO');
  };

  return (
    <div className="min-h-screen bg-surface-container-lowest flex flex-col">
      {/* Header */}
      <div className="bg-[#0A0A0A] p-10 space-y-4 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-primary rounded-full blur-[100px] opacity-20 animate-pulse" />
        <div className="flex justify-between items-start relative z-10">
          <div>
            <span className="bg-surface-container-low/10 border border-white/20 px-3 py-1 rounded-lg font-black text-[9px] uppercase tracking-widest mb-4 inline-block">
              Zenith Ride Core v4.5
            </span>
            <h1 className="text-3xl font-black tracking-tighter italic">
              PAINEL DE <span className="text-primary">CONTROLO</span>
            </h1>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black text-primary/60 uppercase tracking-widest">Vigilante Central</p>
            <p className="text-xs font-black text-primary flex items-center justify-end gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-primary/100 animate-pulse" /> ONLINE
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 -mt-8 relative z-20">
        <div className="bg-surface-container-low p-2 rounded-[2.5rem] shadow-2xl flex gap-1 border border-outline-variant/20">
          {(['security', 'market', 'kaze'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 rounded-[2rem] text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab
                  ? 'golden-gradient text-on-primary shadow-xl'
                  : 'text-on-surface-variant/70 hover:bg-surface-container-lowest'
              }`}
            >
              {tab === 'security' ? '🛡️ Segurança' : tab === 'market' ? '📈 Mercado' : '🤖 IA Core'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 space-y-6 flex-1 overflow-y-auto no-scrollbar">

        {/* ── TAB: SEGURANÇA ── */}
        {activeTab === 'security' && (
          <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center px-2">
              <h2 className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">
                Monitorização de Anomalias Luanda
              </h2>
              {loading && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {commands.map(cmd => (
                <div key={cmd.id} className="bg-surface-container-low p-6 rounded-[2.5rem] border-l-4 border-primary shadow-sm flex justify-between items-center">
                  <div className="space-y-1">
                    <p className="text-[8px] font-black uppercase text-primary tracking-widest">{cmd.type}</p>
                    <h4 className="font-black text-on-surface text-sm tracking-tight">{cmd.reason}</h4>
                    <p className="text-[9px] font-bold text-on-surface-variant/70 uppercase">{cmd.target}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black text-on-surface-variant/50 uppercase mb-1">Impacto</p>
                    <span className="bg-surface-container-highest text-white text-[9px] px-3 py-1 rounded-full font-black">
                      {cmd.intensity}x
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-red-950 text-white p-8 rounded-[3rem] shadow-2xl border border-white/5 space-y-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-red-500">
                Vigilante IA: Alertas Críticos
              </h3>
              <div className="space-y-4">
                <div className="flex gap-4 items-center bg-primary/5 p-4 rounded-2xl">
                  <span className="text-2xl">🚨</span>
                  <div>
                    <p className="text-xs font-black">Cazenga - Desvio Suspeito</p>
                    <p className="text-[9px] opacity-50 uppercase font-bold">
                      Vigilância activa em curso
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: MERCADO ── */}
        {activeTab === 'market' && (
          <div className="space-y-6 animate-in fade-in duration-500">

            {/* Métricas reais */}
            <div className="grid grid-cols-1 gap-4">

              {/* Card: Ganhos 24h */}
              <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">
                    Ganhos Globais 24h
                  </p>
                  {metrics.loadingMetrics && (
                    <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                {metrics.loadingMetrics ? (
                  <div className="h-9 w-32 bg-surface-container-highest rounded-xl animate-pulse mt-1" />
                ) : (
                  <p className="text-3xl font-black text-primary italic tracking-tighter">
                    {formatKz(metrics.revenueKzLast24h)}{' '}
                    <span className="text-xs font-normal">Kz</span>
                  </p>
                )}
                <p className="text-[8px] text-on-surface-variant/50 font-bold mt-1 uppercase">
                  Corridas concluídas: {metrics.ridesLast24h}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Card: Motoristas activos */}
                <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">
                      Motoristas Online
                    </p>
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  </div>
                  {metrics.loadingMetrics ? (
                    <div className="h-9 w-16 bg-surface-container-highest rounded-xl animate-pulse mt-1" />
                  ) : (
                    <p className="text-3xl font-black text-on-surface italic tracking-tighter">
                      {metrics.activeDrivers.toLocaleString('pt-AO')}
                    </p>
                  )}
                  <p className="text-[8px] text-green-400/70 font-bold mt-1 uppercase">
                    Disponíveis agora · ao vivo
                  </p>
                </div>

                {/* Card: Corridas 24h */}
                <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                  <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-1">
                    Corridas 24h
                  </p>
                  {metrics.loadingMetrics ? (
                    <div className="h-9 w-16 bg-surface-container-highest rounded-xl animate-pulse mt-1" />
                  ) : (
                    <p className="text-3xl font-black text-on-surface italic tracking-tighter">
                      {metrics.ridesLast24h.toLocaleString('pt-AO')}
                    </p>
                  )}
                  <p className="text-[8px] text-on-surface-variant/50 font-bold mt-1 uppercase">
                    Completadas
                  </p>
                </div>
              </div>
            </div>

            {/* Heatmap de zonas (dados reais via RPC) */}
            <div className="bg-surface-container-low p-8 rounded-[3rem] shadow-sm border border-outline-variant/20 h-80">
              <h3 className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-8">
                Heatmap de Demanda Luanda
              </h3>
              {zonesData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-[9px] text-on-surface-variant/60 font-bold uppercase tracking-widest">
                    A carregar dados de zonas...
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={zonesData}>
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      fontSize={9}
                      tick={{ fontWeight: '900', fill: '#94a3b8' }}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '20px', border: 'none',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
                        fontWeight: 'black', fontSize: '10px',
                      }}
                    />
                    <Bar dataKey="demand" radius={[12, 12, 12, 12]} barSize={28}>
                      {zonesData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.risk > 15 ? '#ef4444' : '#4f46e5'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Botão de refresh manual */}
            <button
              onClick={fetchMetrics}
              disabled={metrics.loadingMetrics}
              className="w-full py-4 rounded-[2rem] bg-surface-container-low border border-outline-variant/20 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/70 hover:bg-surface-container transition-all disabled:opacity-40"
            >
              {metrics.loadingMetrics ? '⏳ A actualizar...' : '🔄 Actualizar métricas'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
