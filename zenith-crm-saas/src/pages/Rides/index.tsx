import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Search, Download, RefreshCw } from 'lucide-react';

interface Ride {
  id: string;
  origin_address: string;
  dest_address: string;
  price_kz: number;
  status: string;
  created_at: string;
  distance_km: number | null;
  surge_multiplier: number;
  passenger_name: string;
  driver_name: string;
}

type RideRow = Omit<Ride, 'passenger_name' | 'driver_name'>;

const STATUS_CLS: Record<string, string> = {
  completed: 'status-completed',
  cancelled: 'status-cancelled',
  in_progress: 'status-busy',
  searching: 'status-searching',
  accepted: 'status-searching',
  picking_up: 'status-busy',
};

const RidesPage: React.FC = () => {
  const [tab, setTab] = useState<'live' | 'history'>('live');
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadLive = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('rides')
      .select('id, origin_address, dest_address, price_kz, status, created_at, distance_km, surge_multiplier, passenger_id, driver_id')
      .in('status', ['searching', 'accepted', 'picking_up', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(50);

    setRides(
      ((data ?? []) as RideRow[]).map(r => ({
        ...r,
        passenger_name: '-',
        driver_name: '-',
      }))
    );
    setLoading(false);
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('rides')
      .select('id, origin_address, dest_address, price_kz, status, created_at, distance_km, surge_multiplier')
      .not('status', 'in', '("searching","accepted","picking_up","in_progress")')
      .order('created_at', { ascending: false })
      .limit(100);

    setRides(
      ((data ?? []) as RideRow[]).map(r => ({
        ...r,
        passenger_name: '-',
        driver_name: '-',
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    if (tab === 'live') {
      timer = window.setTimeout(() => {
        void loadLive();
      }, 0);
      channelRef.current = supabase
        .channel('crm-rides-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, loadLive)
        .subscribe();
    } else {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      timer = window.setTimeout(() => {
        void loadHistory();
      }, 0);
    }
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [tab, loadLive, loadHistory]);

  const exportCSV = () => {
    const header = 'ID,Origem,Destino,Preco (Kz),Estado,Distancia (km),Surge,Data';
    const rows = rides.map(r =>
      [
        r.id,
        `"${r.origin_address}"`,
        `"${r.dest_address}"`,
        r.price_kz,
        r.status,
        r.distance_km ?? '',
        r.surge_multiplier,
        new Date(r.created_at).toLocaleString('pt-AO'),
      ].join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zenith_rides_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const filtered = rides.filter(r => {
    const matchSearch =
      !search ||
      r.origin_address.toLowerCase().includes(search.toLowerCase()) ||
      r.dest_address.toLowerCase().includes(search.toLowerCase());
    const matchFilter = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Corridas</h1>
        <p className="page-sub">Feed ao vivo e historico de todas as corridas</p>
      </div>

      <div className="tabs">
        <button className={`tab-btn ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          Feed Ao Vivo
        </button>
        <button className={`tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          Historico
        </button>
      </div>

      <div className="flex gap-12 items-center flex-wrap mb-16">
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} />
          <input
            className="input"
            placeholder="Pesquisar endereco..."
            style={{ paddingLeft: '32px' }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {tab === 'history' &&
          ['all', 'completed', 'cancelled'].map(f => (
            <button key={f} className={`btn btn-sm ${statusFilter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatusFilter(f)}>
              {f === 'all' ? 'Todos' : f === 'completed' ? 'Concluidas' : 'Canceladas'}
            </button>
          ))}
        <button className="btn btn-ghost btn-sm" onClick={tab === 'live' ? loadLive : loadHistory}>
          <RefreshCw size={13} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
          <Download size={13} /> Exportar CSV
        </button>
      </div>

      {tab === 'live' && (
        <div className="card card-green mb-16" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="topbar-live-dot" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            <strong style={{ color: 'var(--green)' }}>{rides.length}</strong> corrida{rides.length !== 1 ? 's' : ''} activa{rides.length !== 1 ? 's' : ''} agora
          </span>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Origem</th>
              <th>Destino</th>
              <th>Preco</th>
              {tab === 'history' && <th>Distancia</th>}
              <th>Surge</th>
              <th>Estado</th>
              <th>Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>
                  <span className="spinner" />
                </td>
              </tr>
            ) : (
              filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.origin_address}</td>
                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.dest_address}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>{r.price_kz?.toLocaleString('pt-AO')} Kz</td>
                  {tab === 'history' && <td style={{ color: 'var(--text3)' }}>{r.distance_km ? `${r.distance_km.toFixed(1)} km` : '-'}</td>}
                  <td>{r.surge_multiplier > 1.1 ? <span className="badge-amber">{r.surge_multiplier.toFixed(1)}x</span> : <span style={{ color: 'var(--text3)' }}>1.0x</span>}</td>
                  <td>
                    <span className={`status ${STATUS_CLS[r.status] ?? 'status-offline'}`}>
                      <span className="status-dot" />
                      {r.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text3)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                    {new Date(r.created_at).toLocaleString('pt-AO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </td>
                </tr>
              ))
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text3)', padding: '32px' }}>
                  {tab === 'live' ? 'Nenhuma corrida activa agora' : 'Nenhum resultado'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default RidesPage;
