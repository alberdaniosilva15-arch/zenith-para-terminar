import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, Eye, Ban, RefreshCw } from 'lucide-react';

interface Driver {
  id: string;
  name: string;
  phone: string | null;
  rating: number;
  total_rides: number;
  level: string;
  status: string;
  last_seen: string | null;
  motogo_score: number | null;
  suspended_until: string | null;
}

interface DriverProfile extends Driver {
  email: string;
  recent_rides: {
    id: string;
    origin_address: string;
    dest_address: string;
    price_kz: number;
    status: string;
    created_at: string;
    distance_km: number | null;
  }[];
  ratings_received: {
    score: number;
    comment: string | null;
    created_at: string;
    from_name: string | null;
  }[];
  earnings_30d: number;
}

const statusCls = (s: string) => {
  if (s === 'available') return 'status-online';
  if (s === 'busy')      return 'status-busy';
  return 'status-offline';
};

const statusLabel = (s: string) => {
  if (s === 'available') return 'Online';
  if (s === 'busy')      return 'Em corrida';
  return 'Offline';
};

// ── Lista de Motoristas ───────────────────────────────────────────────────────
const DriversList: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select(`
        user_id,
        name,
        phone,
        rating,
        total_rides,
        level,
        users!inner(role, suspended_until),
        driver_locations(status, updated_at),
        motogo_scores(score)
      `)
      .eq('users.role', 'driver')
      .order('rating', { ascending: false });

    const rows = (data ?? []).map((r: any) => ({
      id:              r.user_id,
      name:            r.name,
      phone:           r.phone,
      rating:          r.rating ?? 0,
      total_rides:     r.total_rides ?? 0,
      level:           r.level ?? 'Novato',
      status:          r.driver_locations?.[0]?.status ?? 'offline',
      last_seen:       r.driver_locations?.[0]?.updated_at ?? null,
      motogo_score:    r.motogo_scores?.[0]?.score ?? null,
      suspended_until: r.users?.suspended_until ?? null,
    }));
    setDrivers(rows);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = drivers.filter(d => {
    const matchSearch = !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.phone ?? '').includes(search);
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'online'   ? d.status === 'available' :
      filter === 'busy'     ? d.status === 'busy' :
      filter === 'offline'  ? d.status === 'offline' :
      filter === 'suspended'? !!d.suspended_until : true;
    return matchSearch && matchFilter;
  });

  const suspend = async (id: string, days: number) => {
    const until = new Date(Date.now() + days * 864e5).toISOString();
    await supabase.from('users').update({ suspended_until: until }).eq('id', id);
    await supabase.from('driver_locations').update({ status: 'offline' }).eq('driver_id', id);
    load();
  };

  return (
    <div className="space-y-16">
      {/* Filtros */}
      <div className="flex gap-12 items-center flex-wrap">
        <div style={{ position:'relative', flex:1, minWidth:'200px' }}>
          <Search size={13} style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:'var(--text3)' }} />
          <input className="input" placeholder="Pesquisar nome ou telefone..."
            style={{ paddingLeft:'32px' }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['all','online','busy','offline','suspended'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f)}>
            {f === 'all' ? 'Todos' : f === 'online' ? '🟢 Online' : f === 'busy' ? '🟡 Em corrida' : f === 'offline' ? '⚫ Offline' : '⛔ Suspenso'}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /></button>
      </div>

      {/* Tabela */}
      <div className="card" style={{ padding:0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Motorista</th><th>Telefone</th><th>Estado</th>
              <th>Rating</th><th>Corridas</th><th>MotoScore</th><th>Acções</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign:'center', padding:'32px' }}><span className="spinner" /></td></tr>
            ) : filtered.map(d => (
              <tr key={d.id}>
                <td>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <div style={{
                      width:'32px', height:'32px', borderRadius:'50%',
                      background:'var(--bg4)', display:'flex', alignItems:'center',
                      justifyContent:'center', fontWeight:700, fontSize:'13px', color:'var(--text)',
                      flexShrink:0,
                    }}>{d.name.charAt(0)}</div>
                    <div>
                      <div style={{ fontWeight:600, color:'var(--text)', fontSize:'13px' }}>{d.name}</div>
                      <div style={{ fontSize:'10px', color:'var(--text3)' }}>{d.level}</div>
                    </div>
                  </div>
                </td>
                <td>{d.phone ?? '—'}</td>
                <td>
                  <span className={`status ${d.suspended_until ? 'status-banned' : statusCls(d.status)}`}>
                    <span className="status-dot" />
                    {d.suspended_until ? '⛔ Suspenso' : statusLabel(d.status)}
                  </span>
                </td>
                <td>
                  <span style={{ color:'var(--amber)', fontFamily:'var(--font-mono)', fontWeight:600 }}>
                    ★ {d.rating.toFixed(1)}
                  </span>
                </td>
                <td className="bold">{d.total_rides}</td>
                <td>
                  {d.motogo_score !== null
                    ? <span style={{ fontFamily:'var(--font-mono)', color:'var(--green)' }}>{d.motogo_score}</span>
                    : <span style={{ color:'var(--text3)' }}>—</span>
                  }
                </td>
                <td>
                  <div style={{ display:'flex', gap:'6px' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onSelect(d.id)} title="Ver perfil">
                      <Eye size={12} />
                    </button>
                    {!d.suspended_until && (
                      <button className="btn btn-amber btn-sm" onClick={() => suspend(d.id, 7)} title="Suspender 7 dias">
                        <Ban size={12} />
                      </button>
                    )}
                    {d.suspended_until && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={async () => { await supabase.from('users').update({ suspended_until: null }).eq('id', d.id); load(); }}>
                        Restaurar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--text3)', padding:'32px' }}>
                Nenhum motorista encontrado
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Perfil do Motorista ───────────────────────────────────────────────────────
const DriverProfile: React.FC<{ driverId: string; onBack: () => void }> = ({ driverId, onBack }) => {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [suspDays, setSuspDays] = useState(7);
  const [action, setAction] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [
        { data: prof },
        { data: rides },
        { data: ratings },
        { data: earns },
        { data: dloc },
        { data: score },
      ] = await Promise.all([
        supabase.from('profiles').select('name, phone, rating, total_rides, level').eq('user_id', driverId).single(),
        supabase.from('rides').select('id, origin_address, dest_address, price_kz, status, created_at, distance_km')
          .eq('driver_id', driverId).order('created_at', { ascending: false }).limit(10),
        supabase.from('ratings').select('score, comment, created_at, from_user').eq('to_user', driverId).order('created_at', { ascending: false }).limit(8),
        supabase.from('rides').select('price_kz').eq('driver_id', driverId).eq('status', 'completed')
          .gte('completed_at', new Date(Date.now() - 30 * 864e5).toISOString()),
        supabase.from('driver_locations').select('status, updated_at').eq('driver_id', driverId).maybeSingle(),
        supabase.from('motogo_scores').select('score, score_label, rides_component, rating_component').eq('driver_id', driverId).maybeSingle(),
      ]);
      const earnings30d = (earns ?? []).reduce((s: number, r: any) => s + (r.price_kz ?? 0), 0) * 0.85;
      setProfile({
        id: driverId, name: prof?.name ?? '—', phone: prof?.phone ?? null,
        email: '', rating: prof?.rating ?? 0, total_rides: prof?.total_rides ?? 0,
        level: prof?.level ?? 'Novato', status: dloc?.status ?? 'offline',
        last_seen: dloc?.updated_at ?? null, motogo_score: (score as any)?.score ?? null,
        suspended_until: null, earnings_30d: earnings30d,
        recent_rides: (rides ?? []) as DriverProfile['recent_rides'],
        ratings_received: (ratings ?? []).map((r: any) => ({
          score: r.score, comment: r.comment, created_at: r.created_at, from_name: null,
        })),
      });
      setLoading(false);
    };
    load();
  }, [driverId]);

  const doSuspend = async () => {
    const until = new Date(Date.now() + suspDays * 864e5).toISOString();
    await supabase.from('users').update({ suspended_until: until }).eq('id', driverId);
    setAction(`Suspenso por ${suspDays} dias`);
  };

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'50vh', gap:'16px' }}>
      <span className="spinner" />
    </div>
  );
  if (!profile) return null;

  return (
    <div className="fade-in space-y-16">
      {/* Header */}
      <div className="flex items-center gap-16">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Voltar</button>
        <div className="page-header" style={{ marginBottom:0, flex:1 }}>
          <h1 className="page-title">{profile.name}</h1>
          <p className="page-sub">{profile.level} · ★ {profile.rating.toFixed(1)} · {profile.total_rides} corridas</p>
        </div>
      </div>

      <div className="grid-3">
        <div className="metric-card"><div className="metric-card-label">Rating</div>
          <div className="metric-card-value amber">★ {profile.rating.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-card-label">Ganhos 30d (est.)</div>
          <div className="metric-card-value green">{Math.round(profile.earnings_30d).toLocaleString('pt-AO')} Kz</div></div>
        <div className="metric-card"><div className="metric-card-label">MotoGo Score</div>
          <div className="metric-card-value">{profile.motogo_score ?? '—'}<span style={{ fontSize:'14px', color:'var(--text3)' }}>/1000</span></div></div>
      </div>

      {/* Corridas recentes */}
      <div className="card" style={{ padding:0 }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', fontFamily:'var(--font-title)', fontWeight:700 }}>
          Corridas Recentes
        </div>
        <table className="data-table">
          <thead><tr><th>Origem</th><th>Destino</th><th>Preço</th><th>Estado</th><th>Data</th></tr></thead>
          <tbody>
            {profile.recent_rides.map(r => (
              <tr key={r.id}>
                <td style={{ maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.origin_address}</td>
                <td style={{ maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.dest_address}</td>
                <td className="bold">{r.price_kz?.toLocaleString('pt-AO')} Kz</td>
                <td><span className={`status status-${r.status}`}><span className="status-dot" />{r.status}</span></td>
                <td style={{ color:'var(--text3)', fontSize:'11px' }}>{new Date(r.created_at).toLocaleDateString('pt-AO')}</td>
              </tr>
            ))}
            {profile.recent_rides.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text3)', padding:'20px' }}>Sem corridas</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Avaliações */}
      {profile.ratings_received.length > 0 && (
        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'12px' }}>Avaliações Recebidas</h3>
          <div className="space-y-16">
            {profile.ratings_received.map((r, i) => (
              <div key={i} style={{ borderBottom:'1px solid var(--border)', paddingBottom:'12px' }}>
                <div className="flex items-center gap-8 mb-4">
                  {'★'.repeat(r.score)}{'☆'.repeat(5-r.score)}
                  <span style={{ fontSize:'10px', color:'var(--text3)' }}>{new Date(r.created_at).toLocaleDateString('pt-AO')}</span>
                </div>
                {r.comment && <p style={{ fontSize:'12px', color:'var(--text2)' }}>{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Acções */}
      <div className="card">
        <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>⚠️ Acções Administrativas</h3>
        {action && <div className="badge-amber" style={{ padding:'8px 14px', borderRadius:'8px', marginBottom:'12px', display:'block', background:'rgba(255,170,0,0.1)', color:'var(--amber)' }}>{action}</div>}
        <div className="flex gap-12 items-center flex-wrap">
          <div>
            <label className="input-label">Dias de suspensão</label>
            <select className="input" style={{ width:'140px' }} value={suspDays} onChange={e => setSuspDays(+e.target.value)}>
              <option value={1}>1 dia</option>
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
              <option value={365}>Permanente</option>
            </select>
          </div>
          <button className="btn btn-amber" onClick={doSuspend} style={{ marginTop:'18px' }}>
            <Ban size={13} /> Suspender
          </button>
          <button className="btn btn-danger" style={{ marginTop:'18px' }}
            onClick={async () => { await supabase.from('users').update({ role: 'banned' }).eq('id', driverId); setAction('Conta banida'); }}>
            ⛔ Banir Conta
          </button>
          <button className="btn btn-ghost" style={{ marginTop:'18px' }}
            onClick={async () => { await supabase.from('users').update({ suspended_until: null }).eq('id', driverId); setAction('Conta restaurada'); }}>
            🔄 Restaurar
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Página Principal ──────────────────────────────────────────────────────────
const DriversPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div className="fade-in">
      {!selectedId && (
        <>
          <div className="page-header">
            <h1 className="page-title">Gestão de Motoristas</h1>
            <p className="page-sub">Ver, aprovar, suspender e banir motoristas</p>
          </div>
          <DriversList onSelect={setSelectedId} />
        </>
      )}
      {selectedId && (
        <DriverProfile driverId={selectedId} onBack={() => setSelectedId(null)} />
      )}
    </div>
  );
};

export default DriversPage;
