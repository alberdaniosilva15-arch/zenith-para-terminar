import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, RefreshCw } from 'lucide-react';

interface Passenger {
  id: string; name: string; phone: string | null;
  total_rides: number; total_spent_kz: number;
  user_tier: string; last_ride: string | null;
}

interface PassengerRideRow {
  price_kz: number | null;
  created_at: string;
  status: string;
}

interface PassengerProfileRow {
  user_id: string;
  name: string;
  phone: string | null;
  user_tier: string | null;
  rides?: PassengerRideRow[] | null;
}

const TIER_LABELS: Record<string, string> = {
  vip: '⭐ VIP', standard: 'Standard', problematic: '⚠️ Problemático',
};
const TIER_CLS: Record<string, string> = {
  vip: 'status-online', standard: 'status-offline', problematic: 'status-banned',
};

const PassengersPage: React.FC = () => {
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select(`user_id, name, phone, user_tier, users!inner(role), rides(price_kz, created_at, status)`)
      .eq('users.role', 'passenger')
      .order('name');

    const rows: Passenger[] = ((data ?? []) as PassengerProfileRow[]).map(r => {
      const rides = r.rides ?? [];
      const completedRides = rides.filter(rd => rd.status === 'completed');
      const lastRide = rides.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]?.created_at ?? null;
      return {
        id: r.user_id, name: r.name, phone: r.phone,
        total_rides: completedRides.length,
        total_spent_kz: completedRides.reduce((s, rd) => s + (rd.price_kz ?? 0), 0),
        user_tier: r.user_tier ?? 'standard',
        last_ride: lastRide,
      };
    });
    setPassengers(rows); setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const setTier = async (id: string, tier: string) => {
    await supabase.from('profiles').update({ user_tier: tier }).eq('user_id', id);
    setPassengers(prev => prev.map(p => p.id === id ? { ...p, user_tier: tier } : p));
  };

  const ban = async (id: string) => {
    await supabase
      .from('users')
      .update({ suspended_until: '2999-12-31T23:59:59.000Z' })
      .eq('id', id);
    load();
  };

  const filtered = passengers.filter(p => {
    const matchS = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.phone ?? '').includes(search);
    const matchF = filter === 'all' || p.user_tier === filter;
    return matchS && matchF;
  });

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Gestão de Passageiros</h1>
        <p className="page-sub">Tiers de utilizador afectam o preço silenciosamente via fórmula</p>
      </div>

      {/* Info sobre tiers */}
      <div className="card card-green mb-16" style={{ marginBottom:'16px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', textAlign:'center' }}>
          <div>
            <p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)' }}>TIER VIP (U=0.85)</p>
            <p style={{ color:'var(--green)', fontWeight:700 }}>15% desconto silencioso</p>
          </div>
          <div>
            <p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)' }}>TIER STANDARD (U=1.0)</p>
            <p style={{ color:'var(--text)', fontWeight:700 }}>Preço normal</p>
          </div>
          <div>
            <p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)' }}>TIER PROBLEMÁTICO (U=1.3)</p>
            <p style={{ color:'var(--amber)', fontWeight:700 }}>+30% sobretaxa silenciosa</p>
          </div>
        </div>
      </div>

      <div className="flex gap-12 items-center flex-wrap mb-16">
        <div style={{ position:'relative', flex:1, minWidth:'200px' }}>
          <Search size={13} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--text3)' }} />
          <input className="input" placeholder="Pesquisar..." style={{ paddingLeft:'32px' }}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['all','vip','standard','problematic'].map(f => (
          <button key={f} className={`btn btn-sm ${filter===f?'btn-primary':'btn-ghost'}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Todos' : TIER_LABELS[f]}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /></button>
      </div>

      <div className="card" style={{ padding:0 }}>
        <table className="data-table">
          <thead>
            <tr><th>Passageiro</th><th>Telefone</th><th>Corridas</th><th>Total Gasto</th><th>Última Corrida</th><th>Tier</th><th>Acções</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'32px' }}><span className="spinner" /></td></tr>
            ) : filtered.map(p => (
              <tr key={p.id}>
                <td>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <div style={{ width:'32px', height:'32px', borderRadius:'50%', background:'var(--bg4)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'13px', color:'var(--text)', flexShrink:0 }}>
                      {p.name.charAt(0)}
                    </div>
                    <span className="bold">{p.name}</span>
                  </div>
                </td>
                <td>{p.phone ?? '—'}</td>
                <td className="bold">{p.total_rides}</td>
                <td style={{ fontFamily:'var(--font-mono)', color:'var(--green)' }}>
                  {p.total_spent_kz.toLocaleString('pt-AO')} Kz
                </td>
                <td style={{ color:'var(--text3)', fontSize:'11px' }}>
                  {p.last_ride ? new Date(p.last_ride).toLocaleDateString('pt-AO') : '—'}
                </td>
                <td>
                  <span className={`status ${TIER_CLS[p.user_tier] ?? 'status-offline'}`}>
                    <span className="status-dot" />{TIER_LABELS[p.user_tier] ?? p.user_tier}
                  </span>
                </td>
                <td>
                  <div style={{ display:'flex', gap:'4px' }}>
                    <select className="input" style={{ width:'120px', padding:'4px 8px', fontSize:'11px' }}
                      value={p.user_tier}
                      onChange={e => setTier(p.id, e.target.value)}>
                      <option value="vip">VIP</option>
                      <option value="standard">Standard</option>
                      <option value="problematic">Problemático</option>
                    </select>
                    <button className="btn btn-danger btn-sm" onClick={() => ban(p.id)} title="Banir">⛔</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text3)', padding:'32px' }}>Nenhum passageiro</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PassengersPage;
