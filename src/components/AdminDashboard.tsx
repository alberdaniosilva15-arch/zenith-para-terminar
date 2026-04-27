// =============================================================================
// ZENITH RIDE v3.4 — AdminDashboard.tsx
// PRO: Mapa de controlo de tráfego em tempo real + gestão de preços
// Features:
//   - Mapa Mapbox dark-v11 com motoristas online (markers verdes pulsantes)
//   - Corridas activas (markers laranjas com rota)
//   - Subscrição Realtime a driver_locations
//   - Métricas reais do Supabase (corridas 24h, motoristas, receita)
//   - Gestão de preços por zona (admin altera → invalida cache → reflecte em todo app)
//   - AI Vigilante (alertas)
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AutonomousCommand } from '../types';
import { geminiService } from '../services/geminiService';
import { supabase } from '../lib/supabase';
import { parseSupabasePoint } from '../services/rideService';
import { zonePriceService } from '../services/zonePrice';
import { AdminDriverDocs } from './AdminDriverDocs';
import AdminSOSPanel from './admin/AdminSOSPanel';
import AdminUsersPanel from './admin/AdminUsersPanel';
import AdminServicesPanel from './admin/AdminServicesPanel';

interface AdminDashboardProps {
  lastCommand?: AutonomousCommand | null;
}

interface DashboardMetrics {
  ridesLast24h:     number;
  activeDrivers:    number;
  revenueKzLast24h: number;
  activeRides:      number;
  loadingMetrics:   boolean;
}

interface ReferralStats {
  totalCodes: number;
  usedCodes: number;
  revenueKz: number;
  topReferrers: Array<{ name: string; total: number }>;
}

interface DriverMarker {
  driver_id: string;
  lat: number;
  lng: number;
  status: string;
  name?: string;
}

interface ActiveRide {
  id: string;
  origin_address: string;
  dest_address: string;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  price_kz: number;
  status: string;
  driver_name?: string;
  passenger_name?: string;
}

const INITIAL_METRICS: DashboardMetrics = {
  ridesLast24h: 0, activeDrivers: 0, revenueKzLast24h: 0, activeRides: 0, loadingMetrics: true,
};

const INITIAL_REFERRAL_STATS: ReferralStats = {
  totalCodes: 0,
  usedCodes: 0,
  revenueKz: 0,
  topReferrers: [],
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ lastCommand }) => {
  const [activeTab, setActiveTab] = useState<'map' | 'market' | 'prices' | 'sos' | 'users' | 'services' | 'drivers' | 'security'>('map');
  const [commands, setCommands]   = useState<AutonomousCommand[]>([]);
  const [loading, setLoading]     = useState(false);
  const [metrics, setMetrics]     = useState<DashboardMetrics>(INITIAL_METRICS);
  const [zonesData, setZonesData] = useState<{ name: string; demand: number; risk: number }[]>([]);
  const [activeSosCount, setActiveSosCount] = useState(0);
  const [referralStats, setReferralStats] = useState<ReferralStats>(INITIAL_REFERRAL_STATS);
  
  // Mapa
  const [driverMarkers, setDriverMarkers] = useState<DriverMarker[]>([]);
  const [activeRides, setActiveRides]     = useState<ActiveRide[]>([]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<mapboxgl.Map | null>(null);
  const markersRef      = useRef<mapboxgl.Marker[]>([]);
  const mapboxglRef     = useRef<typeof import('mapbox-gl').default | null>(null);
  const [mapReady, setMapReady] = useState(false);
  
  // Realtime
  const realtimeRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ridesChRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Preços
  const [zonePrices, setZonePrices]     = useState<{ id?: string; origin_zone: string; dest_zone: string; price_kz: number; distance_km: number }[]>([]);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [editValue, setEditValue]       = useState('');
  const [savingPrice, setSavingPrice]   = useState(false);

  // ── Queries de métricas ──────────────────────────────────────────────────
  const fetchMetrics = useCallback(async () => {
    setMetrics(prev => ({ ...prev, loadingMetrics: true }));
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [ridesRes, driversRes, revenueRes, activeRes] = await Promise.all([
        supabase.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', since24h),
        supabase.from('driver_locations').select('driver_id', { count: 'exact', head: true }).eq('status', 'available'),
        supabase.from('rides').select('price_kz').eq('status', 'completed').gte('created_at', since24h),
        supabase.from('rides').select('id', { count: 'exact', head: true }).in('status', ['searching', 'accepted', 'picking_up', 'in_progress']),
      ]);

      const totalRevenue = (revenueRes.data ?? []).reduce((sum, r) => sum + (Number(r.price_kz) || 0), 0);

      setMetrics({
        ridesLast24h:     ridesRes.count ?? 0,
        activeDrivers:    driversRes.count ?? 0,
        revenueKzLast24h: totalRevenue,
        activeRides:      activeRes.count ?? 0,
        loadingMetrics:   false,
      });
    } catch (e) {
      console.error('[AdminDashboard] Erro métricas:', e);
      setMetrics(prev => ({ ...prev, loadingMetrics: false }));
    }
  }, []);

  // ── Carregar motoristas para o mapa ──────────────────────────────────────
  const fetchDriverLocations = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('driver_locations')
        .select('driver_id, location, status, heading')
        .in('status', ['available', 'busy', 'on_trip']);

      if (!data) return;

      // Carregar nomes dos motoristas
      const driverIds = data.map(d => d.driver_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name')
        .in('user_id', driverIds);

      const nameMap = new Map((profiles ?? []).map((p: { user_id: string; name: string }) => [p.user_id, p.name]));

      const markers: DriverMarker[] = data
        .map(d => {
          const coords = parseSupabasePoint(d.location);
          if (!coords) return null;
          return {
            driver_id: d.driver_id,
            lat: coords.lat,
            lng: coords.lng,
            status: d.status,
            name: nameMap.get(d.driver_id) ?? 'Motorista',
          };
        })
        .filter(Boolean) as DriverMarker[];

      setDriverMarkers(markers);
    } catch (e) {
      console.error('[AdminDashboard] Erro driver locations:', e);
    }
  }, []);

  // ── Carregar corridas activas ────────────────────────────────────────────
  const fetchActiveRides = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('rides')
        .select('id, origin_address, dest_address, origin_lat, origin_lng, dest_lat, dest_lng, price_kz, status, driver_id, passenger_id')
        .in('status', ['searching', 'accepted', 'picking_up', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(50);

      setActiveRides((data ?? []) as ActiveRide[]);
    } catch (e) {
      console.error('[AdminDashboard] Erro active rides:', e);
    }
  }, []);

  // ── Carregar preços ──────────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('zone_prices')
        .select('id, origin_zone, dest_zone, price_kz, distance_km')
        .eq('active', true)
        .order('origin_zone');
      setZonePrices((data ?? []) as typeof zonePrices);
    } catch (e) {
      console.error('[AdminDashboard] Erro preços:', e);
    }
  }, []);

  const fetchReferralStats = useCallback(async () => {
    try {
      const { data: referrals } = await supabase
        .from('referrals')
        .select('referrer_id, status, reward_kz');

      if (!referrals?.length) {
        setReferralStats(INITIAL_REFERRAL_STATS);
        return;
      }

      const totalsByReferrer = referrals.reduce<Record<string, number>>((acc, referral) => {
        if (referral.referrer_id) {
          acc[referral.referrer_id] = (acc[referral.referrer_id] ?? 0) + 1;
        }
        return acc;
      }, {});

      const referrerIds = Object.keys(totalsByReferrer);
      const { data: profiles } = referrerIds.length === 0
        ? { data: [] as Array<{ user_id: string; name: string | null }> }
        : await supabase.from('profiles').select('user_id, name').in('user_id', referrerIds);

      const profileMap = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.name ?? 'Utilizador Zenith']));
      const usedCodes = referrals.filter((referral) => referral.status === 'completed').length;
      const revenueKz = referrals
        .filter((referral) => referral.status === 'completed')
        .reduce((sum, referral) => sum + Number(referral.reward_kz ?? 0), 0);

      setReferralStats({
        totalCodes: referrals.length,
        usedCodes,
        revenueKz,
        topReferrers: referrerIds
          .map((id) => ({
            name: profileMap.get(id) ?? 'Utilizador Zenith',
            total: totalsByReferrer[id],
          }))
          .sort((left, right) => right.total - left.total)
          .slice(0, 10),
      });
    } catch (e) {
      console.error('[AdminDashboard] Erro referral stats:', e);
    }
  }, []);

  // ── Salvar preço editado ─────────────────────────────────────────────────
  const handleSavePrice = async (priceId: string) => {
    const newPrice = parseInt(editValue);
    if (isNaN(newPrice) || newPrice <= 0) return;
    
    setSavingPrice(true);
    try {
      const { error } = await supabase
        .from('zone_prices')
        .update({ price_kz: newPrice })
        .eq('id', priceId);

      if (!error) {
        // Invalidar cache de preços em TODO o app
        zonePriceService.clearCache();
        // Re-fetch preços actualizados
        await fetchPrices();
        setEditingPrice(null);
        setEditValue('');
      }
    } catch (e) {
      console.error('[AdminDashboard] Erro ao salvar preço:', e);
    } finally {
      setSavingPrice(false);
    }
  };

  // ── Mapa Mapbox ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'map' || !mapContainerRef.current || mapRef.current) return;

    const initMap = async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      if (!token) return;
      mapboxgl.accessToken = token;
      mapboxglRef.current = mapboxgl;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [13.2344, -8.8383], // Luanda
        zoom: 11.5,
        attributionControl: false,
      });

      map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
      map.on('load', () => setMapReady(true));
      mapRef.current = map;
    };

    initMap();

    return () => {
      setMapReady(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [activeTab]);

  // ── Actualizar markers no mapa ───────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    // Limpar markers antigos
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const mapboxgl = mapboxglRef.current;
    if (!mapboxgl) return;

    // Markers de motoristas
    driverMarkers.forEach(d => {
      const el = document.createElement('div');
      el.className = 'admin-driver-marker';
      el.innerHTML = `
        <div style="
          width: 14px; height: 14px; border-radius: 50%;
          background: ${d.status === 'available' ? '#22c55e' : '#f59e0b'};
          border: 2px solid white;
          box-shadow: 0 0 8px ${d.status === 'available' ? 'rgba(34,197,94,0.6)' : 'rgba(245,158,11,0.6)'};
          animation: pulse 2s infinite;
        "></div>
        <div style="
          position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
          background: rgba(0,0,0,0.8); color: white; font-size: 8px; font-weight: 900;
          padding: 2px 6px; border-radius: 6px; white-space: nowrap;
          letter-spacing: 0.05em; text-transform: uppercase;
        ">${d.name ?? 'Motorista'}</div>
      `;

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([d.lng, d.lat])
        .addTo(mapRef.current!);
      markersRef.current.push(marker);
    });

    // Markers de corridas activas
    activeRides.forEach(r => {
      if (r.origin_lat && r.origin_lng) {
        const el = document.createElement('div');
        el.innerHTML = `
          <div style="
            width: 10px; height: 10px; border-radius: 50%;
            background: #3b82f6; border: 2px solid white;
            box-shadow: 0 0 6px rgba(59,130,246,0.6);
          "></div>
        `;
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([r.origin_lng, r.origin_lat])
          .addTo(mapRef.current!);
        markersRef.current.push(marker);
      }
    });

  }, [activeRides, driverMarkers, mapReady]);

  // ── Subscrição Realtime ──────────────────────────────────────────────────
  useEffect(() => {
    // Canal driver_locations
    realtimeRef.current = supabase
      .channel('admin-drivers-live-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, () => {
        fetchDriverLocations();
        supabase.from('driver_locations')
          .select('driver_id', { count: 'exact', head: true })
          .eq('status', 'available')
          .then(({ count }) => {
            if (count !== null) setMetrics(prev => ({ ...prev, activeDrivers: count }));
          });
      })
      .subscribe();

    // Canal rides
    ridesChRef.current = supabase
      .channel('admin-rides-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => {
        fetchActiveRides();
      })
      .subscribe();

    return () => {
      if (realtimeRef.current) { supabase.removeChannel(realtimeRef.current); realtimeRef.current = null; }
      if (ridesChRef.current) { supabase.removeChannel(ridesChRef.current); ridesChRef.current = null; }
    };
  }, [fetchDriverLocations, fetchActiveRides]);

  // ── Init data ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchMetrics();
    fetchDriverLocations();
    fetchActiveRides();
    fetchPrices();
    fetchReferralStats();

    const interval = setInterval(fetchMetrics, 60_000);
    return () => clearInterval(interval);
  }, [fetchMetrics, fetchDriverLocations, fetchActiveRides, fetchPrices, fetchReferralStats]);

  // ── AI Vigilante ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchDecisions = async () => {
      setLoading(true);
      try {
        const { data: zData } = await supabase.rpc('get_zones_demand');
        const activeZones = zData || [];
        setZonesData(activeZones);

        const data = await geminiService.getAutonomousDecisions({
          role: 'admin', activeRideStatus: 'IDLE', multiplier: 1,
          system_load: 0.85, luanda_time: new Date().toLocaleTimeString(),
          hot_zones: activeZones.filter((z: any) => z.demand > 80).map((z: any) => z.name),
        });
        setCommands(data);
      } catch (e) {
        console.error('[AdminDashboard] Erro AI:', e);
      } finally { setLoading(false); }
    };
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 60000);
    return () => clearInterval(interval);
  }, []);

  const formatKz = (value: number): string => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}k`;
    return value.toLocaleString('pt-AO');
  };

  const TABS = [
    { id: 'map',      icon: '🗺️', label: 'Mapa' },
    { id: 'market',   icon: '📈', label: 'Mercado' },
    { id: 'prices',   icon: '💰', label: 'Preços' },
    { id: 'sos',      icon: '🚨', label: 'SOS', badge: activeSosCount },
    { id: 'users',    icon: '👥', label: 'Utilizadores' },
    { id: 'services', icon: '🚀', label: 'Serviços' },
    { id: 'drivers',  icon: '🪪', label: 'BI / Carros' },
    { id: 'security', icon: '🛡️', label: 'Segurança' },
  ] as const;

  return (
    <div className="min-h-screen bg-surface-container-lowest flex flex-col">
      {/* Header compacto */}
      <div className="bg-[#0A0A0A] p-6 space-y-2 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-60 h-60 bg-primary rounded-full blur-[80px] opacity-20 animate-pulse" />
        <div className="flex justify-between items-center relative z-10">
          <div>
            <span className="bg-surface-container-low/10 border border-white/20 px-2 py-0.5 rounded-md font-black text-[7px] uppercase tracking-widest">
              Admin v3.4
            </span>
            <h1 className="text-xl font-black tracking-tighter italic mt-1">
              PAINEL DE <span className="text-primary">CONTROLO</span>
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs font-black text-primary flex items-center justify-end gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> ONLINE
            </p>
          </div>
        </div>
        
        {/* Stats mini */}
        <div className="flex gap-3 relative z-10">
          <div className="flex-1 bg-white/5 rounded-xl p-3 text-center">
            <p className="text-[7px] font-black text-white/40 uppercase">Motoristas</p>
            <p className="text-lg font-black text-green-400">{metrics.activeDrivers}</p>
          </div>
          <div className="flex-1 bg-white/5 rounded-xl p-3 text-center">
            <p className="text-[7px] font-black text-white/40 uppercase">Corridas</p>
            <p className="text-lg font-black text-blue-400">{metrics.activeRides}</p>
          </div>
          <div className="flex-1 bg-white/5 rounded-xl p-3 text-center">
            <p className="text-[7px] font-black text-white/40 uppercase">Receita 24h</p>
            <p className="text-lg font-black text-primary">{formatKz(metrics.revenueKzLast24h)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 -mt-4 relative z-20">
        <div className="no-scrollbar overflow-x-auto bg-surface-container-low p-1.5 rounded-2xl shadow-2xl flex gap-1 border border-outline-variant/20">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`relative shrink-0 min-w-[112px] py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? 'golden-gradient text-on-primary shadow-lg'
                  : 'text-on-surface-variant/70 hover:bg-surface-container-lowest'
              }`}
            >
              {tab.icon} {tab.label}
              {'badge' in tab && tab.badge > 0 && (
                <span className="absolute right-2 top-1.5 flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-black text-white animate-pulse">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">

        {/* ── TAB: MAPA DE CONTROLO ── */}
        {activeTab === 'map' && (
          <div className="relative animate-in fade-in duration-300">
            {/* Mapa full */}
            <div ref={mapContainerRef} className="w-full h-[65vh] relative">
              {/* Overlay stats */}
              <div className="absolute top-4 left-4 z-10 bg-[#0A0A0A]/90 backdrop-blur-xl rounded-2xl p-4 border border-white/10 space-y-2 min-w-[160px]">
                <p className="text-[7px] font-black text-white/40 uppercase tracking-widest">Ao Vivo</p>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-xs font-black text-white">{driverMarkers.filter(d => d.status === 'available').length} disponíveis</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                  <span className="text-xs font-black text-white">{driverMarkers.filter(d => d.status !== 'available').length} em corrida</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-400 rounded-full" />
                  <span className="text-xs font-black text-white">{activeRides.length} corridas activas</span>
                </div>
              </div>

              {/* Botão refresh */}
              <button
                onClick={() => { fetchDriverLocations(); fetchActiveRides(); }}
                className="absolute top-4 right-4 z-10 bg-[#0A0A0A]/90 backdrop-blur-xl rounded-xl px-3 py-2 border border-white/10 text-[8px] font-black text-white/70 uppercase tracking-widest active:scale-95"
              >
                🔄 Refresh
              </button>
            </div>

            {/* Lista de corridas activas */}
            <div className="p-4 space-y-3">
              <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">
                Corridas Activas ({activeRides.length})
              </p>
              {activeRides.length === 0 ? (
                <p className="text-xs text-on-surface-variant/50 text-center py-4">Nenhuma corrida activa</p>
              ) : (
                activeRides.map(ride => (
                  <div key={ride.id} className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant/20 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        ride.status === 'searching' ? 'bg-yellow-500/15 text-yellow-500' :
                        ride.status === 'in_progress' ? 'bg-green-500/15 text-green-400' :
                        'bg-blue-500/15 text-blue-400'
                      }`}>
                        {ride.status === 'searching' ? '🔍 A procurar' :
                         ride.status === 'in_progress' ? '🚗 Em curso' :
                         ride.status === 'picking_up' ? '📍 A recolher' : '✅ Aceite'}
                      </span>
                      <span className="text-sm font-black text-primary">{ride.price_kz?.toLocaleString('pt-AO') ?? '—'} Kz</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                      <span className="font-bold text-on-surface truncate">{ride.origin_address}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                      <span className="font-bold text-on-surface truncate">{ride.dest_address}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'sos' && (
          <div className="p-6">
            <AdminSOSPanel onActiveCountChange={setActiveSosCount} />
          </div>
        )}

        {activeTab === 'users' && (
          <div className="animate-in fade-in duration-300">
            <AdminUsersPanel />
          </div>
        )}

        {activeTab === 'services' && (
          <div className="animate-in fade-in duration-300">
            <AdminServicesPanel />
          </div>
        )}

        {/* ── TAB: MOTORISTAS SENSÍVEIS (AdminDriverDocs) ── */}
        {activeTab === 'drivers' && (
          <div className="h-[600px] bg-surface-container-lowest rounded-[2.5rem] overflow-hidden mb-6">
            <AdminDriverDocs />
          </div>
        )}

        {/* ── TAB: MERCADO ── */}
        {activeTab === 'market' && (
          <div className="p-6 space-y-6 animate-in fade-in duration-500">
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-1">Ganhos Globais 24h</p>
                <p className="text-3xl font-black text-primary italic tracking-tighter">
                  {formatKz(metrics.revenueKzLast24h)} <span className="text-xs font-normal">Kz</span>
                </p>
                <p className="text-[8px] text-on-surface-variant/50 font-bold mt-1 uppercase">
                  Corridas concluídas: {metrics.ridesLast24h}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                  <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-1">Motoristas Online</p>
                  <p className="text-3xl font-black text-on-surface italic">{metrics.activeDrivers}</p>
                  <p className="text-[8px] text-green-400/70 font-bold mt-1 uppercase">Ao vivo</p>
                </div>
                <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20">
                  <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-1">Corridas 24h</p>
                  <p className="text-3xl font-black text-on-surface italic">{metrics.ridesLast24h}</p>
                  <p className="text-[8px] text-on-surface-variant/50 font-bold mt-1 uppercase">Completadas</p>
                </div>
              </div>
            </div>

            {/* Heatmap */}
            <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20 h-72">
              <h3 className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest mb-6">
                Heatmap de Demanda
              </h3>
              {zonesData.length === 0 ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={zonesData}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={9} tick={{ fontWeight: '900', fill: '#94a3b8' }} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', fontWeight: 'bold', fontSize: '10px' }} />
                    <Bar dataKey="demand" radius={[10, 10, 10, 10]} barSize={24}>
                      {zonesData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.risk > 15 ? '#ef4444' : '#4f46e5'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-surface-container-low p-6 rounded-[2.5rem] shadow-sm border border-outline-variant/20 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">Programa Referral</p>
                  <h3 className="mt-1 text-lg font-black text-on-surface">Convites e receita por indicação</h3>
                </div>
                <button
                  onClick={fetchReferralStats}
                  className="rounded-full bg-primary/10 px-3 py-1.5 text-[8px] font-black uppercase tracking-widest text-primary"
                >
                  Actualizar
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-4">
                  <p className="text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">Códigos gerados</p>
                  <p className="mt-2 text-2xl font-black text-on-surface">{referralStats.totalCodes}</p>
                </div>
                <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-4">
                  <p className="text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">Códigos usados</p>
                  <p className="mt-2 text-2xl font-black text-on-surface">{referralStats.usedCodes}</p>
                </div>
                <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-4">
                  <p className="text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">Receita referral</p>
                  <p className="mt-2 text-2xl font-black text-primary">{formatKz(referralStats.revenueKz)} Kz</p>
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest p-4">
                <p className="text-[8px] font-black uppercase tracking-widest text-on-surface-variant/50">Top 10 referrers</p>
                <div className="mt-4 space-y-2">
                  {referralStats.topReferrers.length === 0 ? (
                    <p className="text-xs font-bold text-on-surface-variant/50">Sem convites concluídos ainda.</p>
                  ) : (
                    referralStats.topReferrers.map((referrer, index) => (
                      <div key={`${referrer.name}-${index}`} className="flex items-center justify-between rounded-xl bg-surface-container-low p-3">
                        <p className="text-xs font-black text-on-surface">{index + 1}. {referrer.name}</p>
                        <span className="text-[10px] font-black uppercase tracking-widest text-primary">{referrer.total} convites</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={fetchMetrics}
              disabled={metrics.loadingMetrics}
              className="w-full py-4 rounded-[2rem] bg-surface-container-low border border-outline-variant/20 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/70 hover:bg-surface-container transition-all disabled:opacity-40"
            >
              {metrics.loadingMetrics ? '⏳ A actualizar...' : '🔄 Actualizar métricas'}
            </button>
          </div>
        )}

        {/* ── TAB: GESTÃO DE PREÇOS ── */}
        {activeTab === 'prices' && (
          <div className="p-6 space-y-4 animate-in fade-in duration-300">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-black text-on-surface">Preços por Zona</h2>
                <p className="text-[9px] text-on-surface-variant/70 font-bold">Alterações reflectem-se em todo o app automaticamente</p>
              </div>
              <button
                onClick={fetchPrices}
                className="text-[8px] font-black text-primary uppercase tracking-widest bg-primary/10 px-3 py-1.5 rounded-full"
              >
                🔄 Refresh
              </button>
            </div>

            {zonePrices.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-on-surface-variant/50">Nenhum preço configurado</p>
                <p className="text-[9px] text-on-surface-variant/40 mt-1">Execute o SQL de setup primeiro</p>
              </div>
            ) : (
              <div className="space-y-2">
                {zonePrices.map((p, idx) => (
                  <div key={p.id ?? idx} className="bg-surface-container-low rounded-2xl p-4 border border-outline-variant/20 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[10px] font-black text-on-surface">
                        <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[8px]">{p.origin_zone}</span>
                        <span className="text-on-surface-variant/40">→</span>
                        <span className="bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full text-[8px]">{p.dest_zone}</span>
                      </div>
                      <p className="text-[8px] text-on-surface-variant/50 font-bold mt-1">~{p.distance_km} km</p>
                    </div>

                    {editingPrice === p.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="w-20 bg-surface-container-lowest border border-primary rounded-lg px-2 py-1 text-xs font-black text-on-surface outline-none text-right"
                          autoFocus
                        />
                        <span className="text-[8px] text-on-surface-variant/50 font-black">Kz</span>
                        <button
                          onClick={() => handleSavePrice(p.id!)}
                          disabled={savingPrice}
                          className="text-[8px] font-black text-green-400 bg-green-500/10 px-2 py-1 rounded-lg"
                        >
                          {savingPrice ? '...' : '✓'}
                        </button>
                        <button
                          onClick={() => { setEditingPrice(null); setEditValue(''); }}
                          className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-1 rounded-lg"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingPrice(p.id ?? null); setEditValue(String(p.price_kz)); }}
                        className="text-right shrink-0 group"
                      >
                        <p className="text-sm font-black text-on-surface group-hover:text-primary transition-colors">
                          {p.price_kz.toLocaleString('pt-AO')} Kz
                        </p>
                        <p className="text-[7px] text-primary/60 font-black uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                          Editar
                        </p>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-primary/10 border border-primary/30 rounded-2xl p-4 flex gap-3 items-start">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="text-[10px] font-black text-primary">Alterações são instantâneas</p>
                <p className="text-[9px] text-primary font-bold leading-relaxed">
                  Quando alteras um preço aqui, o cache é invalidado e TODOS os passageiros/motoristas veem o novo preço imediatamente.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: SEGURANÇA ── */}
        {activeTab === 'security' && (
          <div className="p-6 space-y-6 animate-in slide-in-from-bottom duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">
                Alertas IA — Luanda
              </h2>
              {loading && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
            </div>

            <div className="grid grid-cols-1 gap-4">
              {commands.map(cmd => (
                <div key={cmd.id} className="bg-surface-container-low p-5 rounded-2xl border-l-4 border-primary shadow-sm flex justify-between items-center">
                  <div className="space-y-1">
                    <p className="text-[8px] font-black uppercase text-primary tracking-widest">{cmd.type}</p>
                    <h4 className="font-black text-on-surface text-sm tracking-tight">{cmd.reason}</h4>
                    <p className="text-[9px] font-bold text-on-surface-variant/70">{cmd.target}</p>
                  </div>
                  <span className="bg-surface-container-highest text-white text-[9px] px-3 py-1 rounded-full font-black">
                    {cmd.intensity}x
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-red-950 text-white p-6 rounded-[2rem] shadow-2xl border border-white/5 space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-red-500">
                Vigilante IA: Alertas Críticos
              </h3>
              <div className="bg-primary/5 p-4 rounded-2xl flex gap-4 items-center">
                <span className="text-2xl">🚨</span>
                <div>
                  <p className="text-xs font-black">Sistema monitorizado</p>
                  <p className="text-[9px] opacity-50 uppercase font-bold">Vigilância activa em curso</p>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default AdminDashboard;
