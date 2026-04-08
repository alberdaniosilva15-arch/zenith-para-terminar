import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { Download } from 'lucide-react';

interface PeriodRow { period: string; corridas: number; gmv: number; receita: number; ticket_medio: number; }

const fmtKz = (v: number) =>
  v >= 1_000_000 ? `${(v/1_000_000).toFixed(2)}M Kz`
  : v >= 1_000   ? `${(v/1_000).toFixed(0)}k Kz`
  : `${Math.round(v)} Kz`;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:'8px', padding:'10px 14px', fontSize:'11px' }}>
      <p style={{ color:'var(--text3)', marginBottom:'6px' }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.dataKey === 'receita' ? 'var(--amber)' : 'var(--green)' }}>
          {p.name}: {p.dataKey.includes('corridas') ? p.value : fmtKz(p.value)}
        </p>
      ))}
    </div>
  );
};

// ── Projecções (Zenith Engine Pro — separador Receita & Lucro) ────────────────
const Projections: React.FC = () => {
  const [rides,    setRides]    = useState(150);
  const [fare,     setFare]     = useState(2500);
  const [comm,     setComm]     = useState(15);
  const [opex,     setOpex]     = useState(35);
  const [surgePct, setSurgePct] = useState(25);
  const [surgeM,   setSurgeM]   = useState(1.5);

  const gmvDay     = rides * fare;
  const surgeExtra = rides * (surgePct/100) * fare * (surgeM - 1) * (comm/100);
  const revDay     = gmvDay * (comm/100) + surgeExtra;
  const lucroDay   = revDay * (1 - opex/100);
  const revMonth   = revDay * 30;
  const lucroMonth = lucroDay * 30;
  const margem     = ((lucroDay / revDay) * 100).toFixed(1);

  const phases = [
    { label:'Mês 1-2',  rides:50,   fare:2000 },
    { label:'Mês 3-6',  rides:200,  fare:2500 },
    { label:'Mês 7-12', rides:600,  fare:2800 },
    { label:'Ano 2',    rides:1500, fare:3000 },
    { label:'Ano 3',    rides:3000, fare:3200 },
  ].map(p => ({
    label: p.label,
    gmv:   Math.round(p.rides * p.fare * 30 / 1000),
    receita: Math.round(p.rides * p.fare * 30 * (comm/100) / 1000),
    lucro:   Math.round(p.rides * p.fare * 30 * (comm/100) * (1-opex/100) / 1000),
  }));

  const Slider = ({ label, value, min, max, step, unit = '', onChange }: any) => (
    <div className="slider-wrap">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );

  return (
    <div className="grid-2 gap-24">
      <div className="space-y-16">
        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>⚙️ Parâmetros</h3>
          <div className="space-y-16">
            <Slider label="Corridas por dia" value={rides} min={10} max={3000} step={10} onChange={setRides} />
            <Slider label="Tarifa média" value={fare} min={500} max={8000} step={100} unit=" Kz" onChange={setFare} />
            <Slider label="Comissão plataforma" value={comm} min={5} max={35} step={1} unit="%" onChange={setComm} />
            <Slider label="OpEx (% receita)" value={opex} min={10} max={80} step={5} unit="%" onChange={setOpex} />
            <Slider label="% Corridas com Surge" value={surgePct} min={0} max={80} step={5} unit="%" onChange={setSurgePct} />
            <Slider label="Multiplicador Surge médio" value={surgeM} min={1.1} max={3.0} step={0.1} unit="×" onChange={setSurgeM} />
          </div>
        </div>
        {/* Comparativo de mercado */}
        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'12px' }}>📊 Comissões do Mercado Angolano</h3>
          {[
            { name:'inDrive', pct:0, note:'Promoção — modelo licitação' },
            { name:'Heetch Angola', pct:11.4, note:'Modelo europeu adaptado' },
            { name:'Yango Angola', pct:13, note:'Standard Yandex' },
            { name:`Zenith (actual)`, pct:comm, note:'Configurável via CRM', highlight:true },
            { name:'Kubinga', pct:25, note:'Mercado informal' },
          ].map(m => (
            <div key={m.name} style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'8px' }}>
              <span style={{ width:'130px', fontSize:'11px', fontWeight: m.highlight?700:400, color: m.highlight?'var(--green)':'var(--text2)' }}>{m.name}</span>
              <div style={{ flex:1, height:'6px', background:'var(--bg4)', borderRadius:'3px', overflow:'hidden' }}>
                <div style={{ width:`${(m.pct/35)*100}%`, height:'100%', background: m.highlight?'var(--green)':'var(--bg5)', borderRadius:'3px' }} />
              </div>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:'11px', color: m.highlight?'var(--green)':'var(--text3)', width:'36px', textAlign:'right' }}>{m.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-16">
        <div className="card card-green">
          <p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--green)', textTransform:'uppercase', letterSpacing:'2px', marginBottom:'12px' }}>
            Projecção Diária
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
            {[
              { label:'GMV/dia',     value: fmtKz(gmvDay),     color:'var(--text)' },
              { label:'Receita/dia', value: fmtKz(revDay),     color:'var(--green)' },
              { label:'Lucro/dia',   value: fmtKz(lucroDay),   color:'var(--green)' },
              { label:'Margem',      value: `${margem}%`,       color:'var(--amber)' },
            ].map(m => (
              <div key={m.label} style={{ textAlign:'center' }}>
                <p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)', marginBottom:'4px' }}>{m.label}</p>
                <p style={{ fontFamily:'var(--font-mono)', fontSize:'20px', fontWeight:600, color:m.color }}>{m.value}</p>
              </div>
            ))}
          </div>
          <hr className="divider" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', textAlign:'center' }}>
            <div><p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)' }}>RECEITA/MÊS</p>
              <p style={{ fontFamily:'var(--font-mono)', fontSize:'18px', color:'var(--green)', fontWeight:600 }}>{fmtKz(revMonth)}</p></div>
            <div><p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)' }}>LUCRO/MÊS</p>
              <p style={{ fontFamily:'var(--font-mono)', fontSize:'18px', color:'var(--green)', fontWeight:600 }}>{fmtKz(lucroMonth)}</p></div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>📈 Curva de Crescimento (GMV vs Receita vs Lucro — em milhares Kz)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={phases}>
              <CartesianGrid />
              <XAxis dataKey="label" tick={{ fontSize:9 }} />
              <YAxis tick={{ fontSize:9 }} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="gmv"     name="GMV"     fill="var(--bg5)"  radius={[4,4,0,0]} />
              <Bar dataKey="receita" name="Receita"  fill="var(--green)" radius={[4,4,0,0]} opacity={0.85} />
              <Bar dataKey="lucro"   name="Lucro"    fill="var(--amber)" radius={[4,4,0,0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

// ── Página Financeira ─────────────────────────────────────────────────────────
const FinancePage: React.FC = () => {
  const [tab,     setTab]     = useState<'overview'|'report'|'proj'>('overview');
  const [period,  setPeriod]  = useState<'day'|'week'|'month'>('day');
  const [data,    setData]    = useState<PeriodRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [todayMetrics, setTodayMetrics] = useState({ gmv:0, receita:0, corridas:0, avgFare:0 });
  const [monthMetrics, setMonthMetrics] = useState({ gmv:0, receita:0 });

  const COMMISSION = 0.15;

  const loadOverview = useCallback(async () => {
    const todayISO = new Date(new Date().setHours(0,0,0,0)).toISOString();
    const monthISO = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const [{ data: todayD }, { data: monthD }] = await Promise.all([
      supabase.from('rides').select('price_kz').eq('status','completed').gte('created_at', todayISO),
      supabase.from('rides').select('price_kz').eq('status','completed').gte('created_at', monthISO),
    ]);
    const t = (todayD ?? []) as {price_kz:number}[];
    const m = (monthD ?? []) as {price_kz:number}[];
    const gmvT = t.reduce((s,r)=>s+r.price_kz,0);
    const gmvM = m.reduce((s,r)=>s+r.price_kz,0);
    setTodayMetrics({ gmv:gmvT, receita:gmvT*COMMISSION, corridas:t.length, avgFare:t.length>0?gmvT/t.length:0 });
    setMonthMetrics({ gmv:gmvM, receita:gmvM*COMMISSION });
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    const since = period === 'day'
      ? new Date(Date.now()-30*864e5).toISOString()
      : period === 'week'
      ? new Date(Date.now()-12*7*864e5).toISOString()
      : new Date(new Date().getFullYear(),0,1).toISOString();

    const { data: rows } = await supabase.from('rides')
      .select('price_kz, created_at')
      .eq('status','completed').gte('created_at', since);

    const buckets: Record<string, {corridas:number; gmv:number}> = {};
    for (const r of (rows ?? []) as {price_kz:number; created_at:string}[]) {
      const d = new Date(r.created_at);
      const key = period === 'day'
        ? d.toISOString().slice(0,10)
        : period === 'week'
        ? `Sem ${Math.ceil(d.getDate()/7)} ${d.toLocaleString('pt-AO',{month:'short'})}`
        : d.toLocaleString('pt-AO', {month:'short', year:'numeric'});
      if (!buckets[key]) buckets[key] = { corridas:0, gmv:0 };
      buckets[key].corridas++;
      buckets[key].gmv += r.price_kz;
    }
    const result: PeriodRow[] = Object.entries(buckets)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([period, v]) => ({
        period, corridas: v.corridas, gmv: v.gmv,
        receita: Math.round(v.gmv * COMMISSION),
        ticket_medio: v.corridas > 0 ? Math.round(v.gmv / v.corridas) : 0,
      }));
    setData(result);
    setLoading(false);
  }, [period]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { if (tab === 'report') loadReport(); }, [tab, loadReport]);

  const exportCSV = () => {
    const header = 'Período,Corridas,GMV (Kz),Receita (Kz),Ticket Médio (Kz)';
    const rows = data.map(r => `${r.period},${r.corridas},${r.gmv},${r.receita},${r.ticket_medio}`);
    const blob = new Blob([[header,...rows].join('\n')], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='zenith_finance.csv'; a.click();
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Painel Financeiro</h1>
        <p className="page-sub">GMV, receita da plataforma e projecções de crescimento</p>
      </div>

      <div className="tabs">
        {[['overview','📊 Visão Geral'],['report','📋 Relatório'],['proj','📈 Projecções']].map(([id,label]) => (
          <button key={id} className={`tab-btn ${tab===id?'active':''}`} onClick={() => setTab(id as any)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-16">
          <div className="grid-4">
            {[
              { label:'GMV Hoje',          value:fmtKz(todayMetrics.gmv),      color:'green' },
              { label:'Receita Hoje',      value:fmtKz(todayMetrics.receita),  color:'green' },
              { label:'Corridas Hoje',     value:String(todayMetrics.corridas),color:'' },
              { label:'Ticket Médio',      value:fmtKz(todayMetrics.avgFare),  color:'' },
            ].map(m => (
              <div key={m.label} className="metric-card">
                <div className="metric-card-label">{m.label}</div>
                <div className={`metric-card-value${m.color?' '+m.color:''}`}>{m.value}</div>
              </div>
            ))}
          </div>
          <div className="grid-2">
            <div className="metric-card">
              <div className="metric-card-label">GMV Este Mês</div>
              <div className="metric-card-value green">{fmtKz(monthMetrics.gmv)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-card-label">Receita Este Mês (15%)</div>
              <div className="metric-card-value green">{fmtKz(monthMetrics.receita)}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'report' && (
        <div className="space-y-16">
          <div className="flex gap-8 items-center">
            {[['day','Por Dia'],['week','Por Semana'],['month','Por Mês']].map(([p,l]) => (
              <button key={p} className={`btn btn-sm ${period===p?'btn-primary':'btn-ghost'}`}
                onClick={() => setPeriod(p as any)}>{l}</button>
            ))}
            <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }} onClick={exportCSV}>
              <Download size={13} /> CSV
            </button>
          </div>

          {!loading && data.length > 0 && (
            <div className="card">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data}>
                  <CartesianGrid /><XAxis dataKey="period" tick={{ fontSize:9 }} />
                  <YAxis tick={{ fontSize:9 }} tickFormatter={v=>`${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="gmv"     name="GMV"    fill="var(--bg5)"   radius={[4,4,0,0]} />
                  <Bar dataKey="receita" name="Receita" fill="var(--green)" radius={[4,4,0,0]} opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card" style={{ padding:0 }}>
            <table className="data-table">
              <thead><tr><th>Período</th><th>Corridas</th><th>GMV</th><th>Receita</th><th>Ticket Médio</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign:'center', padding:'24px' }}><span className="spinner" /></td></tr>
                ) : data.map(r => (
                  <tr key={r.period}>
                    <td className="bold mono">{r.period}</td>
                    <td>{r.corridas}</td>
                    <td style={{ color:'var(--text)', fontFamily:'var(--font-mono)' }}>{fmtKz(r.gmv)}</td>
                    <td style={{ color:'var(--green)', fontFamily:'var(--font-mono)', fontWeight:600 }}>{fmtKz(r.receita)}</td>
                    <td style={{ color:'var(--text3)' }}>{fmtKz(r.ticket_medio)}</td>
                  </tr>
                ))}
                {!loading && data.length===0 && (
                  <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text3)', padding:'24px' }}>Sem dados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'proj' && <Projections />}
    </div>
  );
};

export default FinancePage;
