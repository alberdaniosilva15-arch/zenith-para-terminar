import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface DashboardMetrics {
  ridesCompletedToday:  number;
  ridesActiveNow:       number;
  ridesCancelledToday:  number;
  driversOnline:        number;
  gmvToday:             number;
  revenueToday:         number;
  avgFare:              number;
  gmvMonth:             number;
  revenueMonth:         number;
  cancelRate:           number;
}

export interface HourlyPoint { hour: string; corridas: number; gmv: number; }
export interface ZoneHeat    { zone: string; count: number; }

const EMPTY: DashboardMetrics = {
  ridesCompletedToday:0, ridesActiveNow:0, ridesCancelledToday:0,
  driversOnline:0, gmvToday:0, revenueToday:0, avgFare:0,
  gmvMonth:0, revenueMonth:0, cancelRate:0,
};

export function useMetrics() {
  const [metrics,  setMetrics]  = useState<DashboardMetrics>(EMPTY);
  const [hourly,   setHourly]   = useState<HourlyPoint[]>([]);
  const [zones,    setZones]    = useState<ZoneHeat[]>([]);
  const [loading,  setLoading]  = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchAll = async () => {
    try {
      const today = new Date(); today.setHours(0,0,0,0);
      const todayISO  = today.toISOString();
      const monthISO  = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

      // Corridas de hoje (completed)
      const [
        { count: completed  },
        { count: active     },
        { count: cancelled  },
        { count: driverOnline },
        { data: gmvData     },
        { data: monthData   },
        { data: hourlyData  },
        { data: zoneData    },
      ] = await Promise.all([
        supabase.from('rides').select('*', { count: 'exact', head: true })
          .eq('status', 'completed').gte('created_at', todayISO),
        supabase.from('rides').select('*', { count: 'exact', head: true })
          .in('status', ['searching','accepted','picking_up','in_progress']),
        supabase.from('rides').select('*', { count: 'exact', head: true })
          .eq('status', 'cancelled').gte('cancelled_at', todayISO),
        supabase.from('driver_locations').select('*', { count: 'exact', head: true })
          .eq('status', 'available'),
        supabase.from('rides').select('price_kz')
          .eq('status', 'completed').gte('created_at', todayISO),
        supabase.from('rides').select('price_kz')
          .eq('status', 'completed').gte('created_at', monthISO),
        supabase.from('rides').select('price_kz, created_at')
          .eq('status', 'completed').gte('created_at', new Date(Date.now() - 24*3600*1000).toISOString()),
        supabase.from('rides').select('origin_address')
          .in('status', ['searching','accepted','picking_up','in_progress']),
      ]);

      const commission = 0.15;
      const gmvToday   = (gmvData  ?? []).reduce((s, r: {price_kz: number}) => s + (r.price_kz ?? 0), 0);
      const gmvMonth   = (monthData ?? []).reduce((s, r: {price_kz: number}) => s + (r.price_kz ?? 0), 0);
      const totalRides = completed ?? 0;

      // Agregar por hora
      const hourMap: Record<string, { corridas: number; gmv: number }> = {};
      for (const r of (hourlyData ?? []) as {price_kz: number; created_at: string}[]) {
        const h = new Date(r.created_at).getHours().toString().padStart(2,'0') + 'h';
        if (!hourMap[h]) hourMap[h] = { corridas: 0, gmv: 0 };
        hourMap[h].corridas++;
        hourMap[h].gmv += r.price_kz ?? 0;
      }

      // Agregar por zona (simplificado)
      const zoneMap: Record<string, number> = {};
      const ZONE_KEYS = ['Talatona','Miramar','Viana','Centro','Cazenga','Kilamba','Cacuaco','Rangel','Samba','Benfica','Maianga'];
      for (const r of (zoneData ?? []) as {origin_address: string}[]) {
        const addr = (r.origin_address ?? '').toLowerCase();
        const zone = ZONE_KEYS.find(z => addr.includes(z.toLowerCase())) ?? 'Outras';
        zoneMap[zone] = (zoneMap[zone] ?? 0) + 1;
      }

      setMetrics({
        ridesCompletedToday: totalRides,
        ridesActiveNow:      active     ?? 0,
        ridesCancelledToday: cancelled  ?? 0,
        driversOnline:       driverOnline ?? 0,
        gmvToday,
        revenueToday:  gmvToday  * commission,
        avgFare:       totalRides > 0 ? gmvToday / totalRides : 0,
        gmvMonth,
        revenueMonth:  gmvMonth * commission,
        cancelRate:    totalRides > 0 ? ((cancelled ?? 0) / (totalRides + (cancelled ?? 0))) * 100 : 0,
      });

      setHourly(Object.entries(hourMap).sort(([a],[b]) => a.localeCompare(b))
        .map(([hour, v]) => ({ hour, ...v })));
      setZones(Object.entries(zoneMap).map(([zone, count]) => ({ zone, count }))
        .sort((a, b) => b.count - a.count));

    } catch (err) {
      console.error('[useMetrics]', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();

    // Realtime — rides e driver_locations
    channelRef.current = supabase
      .channel('crm-metrics-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, fetchAll)
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  return { metrics, hourly, zones, loading, refresh: fetchAll };
}
