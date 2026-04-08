import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Save } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface PricingConfig {
  id?: string;
  base_fare_kz: number;
  rate_per_km_kz: number;
  rate_per_min_kz: number;
  surge_alpha: number;
  surge_max: number;
  platform_commission: number;
  fee_night_kz: number;
  fee_airport_kz: number;
  fee_traffic_kz: number;
  fee_cancel_kz: number;
  wl_talatona: number;
  wl_miramar: number;
  wl_alvalade: number;
  wl_patriota: number;
  wl_viana: number;
  wl_cacuaco: number;
  wl_default: number;
  wl_premium: number;
  wl_standard: number;
  wl_eco: number;
  u_vip: number;
  u_standard: number;
  u_problematic: number;
  traffic_threshold: number;
}

interface ZonePrice {
  id?: string;
  origin_zone: string;
  dest_zone: string;
  price_kz: number;
  distance_km: number | null;
  active: boolean;
}

const ZONES = ['Centro','Miramar','Maianga','Cazenga','Rangel','Samba','Benfica','Talatona','Kilamba','Viana','Luanda Norte'];

const DEFAULT_CONFIG: PricingConfig = {
  base_fare_kz:300, rate_per_km_kz:182, rate_per_min_kz:15,
  surge_alpha:0.5, surge_max:2.5, platform_commission:0.15,
  fee_night_kz:200, fee_airport_kz:500, fee_traffic_kz:150, fee_cancel_kz:300,
  wl_talatona:1.4, wl_miramar:1.2, wl_alvalade:1.2, wl_patriota:1.4,
  wl_viana:0.9, wl_cacuaco:0.9, wl_default:1.0,
  wl_premium:1.8, wl_standard:1.0, wl_eco:0.8,
  u_vip:0.85, u_standard:1.0, u_problematic:1.3,
  traffic_threshold:1.3,
};

// ── Slider com label e valor ───────────────────────────────────────────────────
const SliderRow: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit = '', onChange }) => (
  <div className="slider-wrap">
    <div className="slider-header">
      <span className="slider-label">{label}</span>
      <span className="slider-value">{value}{unit}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))} />
  </div>
);

// ── Calculadora de Preview ────────────────────────────────────────────────────
const calcPreview = (cfg: PricingConfig, distKm = 10, durMin = 20, tier = 'standard', surge = 1.0) => {
  const Wl = cfg.wl_default;
  const C  = tier === 'premium' ? cfg.wl_premium : tier === 'eco' ? cfg.wl_eco : cfg.wl_standard;
  const U  = cfg.u_standard;
  const S  = Math.min(1 + cfg.surge_alpha * surge, cfg.surge_max);
  const raw = cfg.base_fare_kz
    + (distKm * cfg.rate_per_km_kz * Wl)
    + (durMin * cfg.rate_per_min_kz * 1.0) * S * C * U;
  const final = Math.floor(raw / 100) * 100 + 99;
  return { raw: Math.round(raw), final: Math.max(final, cfg.base_fare_kz), S: S.toFixed(2) };
};

// ── TAB 1: Calculadora ────────────────────────────────────────────────────────
const Calculator: React.FC = () => {
  const [cfg, setCfg]       = useState<PricingConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [distKm, setDistKm] = useState(10);
  const [durMin, setDurMin] = useState(20);
  const [tier,   setTier]   = useState('standard');
  const [demandRatio, setDemandRatio] = useState(1.0);

  useEffect(() => {
    supabase.from('pricing_config').select('*').eq('is_active', true).limit(1).single()
      .then(({ data }) => { if (data) setCfg(data as PricingConfig); });
  }, []);

  const set = (key: keyof PricingConfig) => (v: number) =>
    setCfg(prev => ({ ...prev, [key]: v }));

  const save = async () => {
    setSaving(true);
    const { id, ...rest } = cfg;
    await supabase.from('pricing_config')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('is_active', true);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const preview = calcPreview(cfg, distKm, durMin, tier, demandRatio);
  const driverShare = Math.round(preview.final * (1 - cfg.platform_commission));
  const platformShare = Math.round(preview.final * cfg.platform_commission);

  return (
    <div className="grid-2 gap-24">
      {/* Coluna esquerda — sliders */}
      <div className="space-y-16">
        <div className="card">
          <h3 style={{ fontSize:'13px', fontWeight:700, fontFamily:'var(--font-title)', marginBottom:'16px' }}>
            📐 Tarifas Base
          </h3>
          <div className="space-y-16">
            <SliderRow label="Tarifa base (B)" value={cfg.base_fare_kz} min={100} max={800} step={10} unit=" Kz" onChange={set('base_fare_kz')} />
            <SliderRow label="Preço por km (rd)" value={cfg.rate_per_km_kz} min={50} max={500} step={5} unit=" Kz" onChange={set('rate_per_km_kz')} />
            <SliderRow label="Preço por minuto (rt)" value={cfg.rate_per_min_kz} min={5} max={60} step={1} unit=" Kz" onChange={set('rate_per_min_kz')} />
            <SliderRow label="Comissão plataforma" value={Math.round(cfg.platform_commission*100)} min={5} max={35} step={1} unit="%" onChange={v => set('platform_commission')(v/100)} />
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize:'13px', fontWeight:700, fontFamily:'var(--font-title)', marginBottom:'16px' }}>
            ⚡ Surge Dinâmico
          </h3>
          <div className="space-y-16">
            <SliderRow label="Agressividade α" value={cfg.surge_alpha} min={0.1} max={2.0} step={0.05} onChange={set('surge_alpha')} />
            <SliderRow label="Surge máximo" value={cfg.surge_max} min={1.5} max={4.0} step={0.1} unit="×" onChange={set('surge_max')} />
            <SliderRow label="Threshold de tráfego" value={cfg.traffic_threshold} min={1.0} max={2.0} step={0.05} unit="×" onChange={set('traffic_threshold')} />
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize:'13px', fontWeight:700, fontFamily:'var(--font-title)', marginBottom:'16px' }}>
            💰 Taxas Extras (F)
          </h3>
          <div className="space-y-16">
            <SliderRow label="Taxa nocturna" value={cfg.fee_night_kz} min={0} max={800} step={25} unit=" Kz" onChange={set('fee_night_kz')} />
            <SliderRow label="Taxa aeroporto" value={cfg.fee_airport_kz} min={0} max={2000} step={50} unit=" Kz" onChange={set('fee_airport_kz')} />
            <SliderRow label="Taxa tráfego intenso" value={cfg.fee_traffic_kz} min={0} max={500} step={25} unit=" Kz" onChange={set('fee_traffic_kz')} />
            <SliderRow label="Taxa de cancelamento" value={cfg.fee_cancel_kz} min={0} max={1000} step={25} unit=" Kz" onChange={set('fee_cancel_kz')} />
          </div>
        </div>
        <div className="card">
          <h3 style={{ fontSize:'13px', fontWeight:700, fontFamily:'var(--font-title)', marginBottom:'16px' }}>
            🏘️ Multiplicadores de Zona (Wl)
          </h3>
          <div className="space-y-16">
            {(['wl_talatona','wl_miramar','wl_viana','wl_cacuaco'] as (keyof PricingConfig)[]).map(k => (
              <SliderRow key={k} label={k.replace('wl_','').charAt(0).toUpperCase()+k.slice(4)} value={cfg[k] as number} min={0.5} max={2.5} step={0.05} unit="×" onChange={set(k)} />
            ))}
          </div>
        </div>
      </div>

      {/* Coluna direita — preview */}
      <div style={{ position:'sticky', top:'0', alignSelf:'start' }}>
        <div className="card card-green" style={{ marginBottom:'16px' }}>
          <p style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--green)', textTransform:'uppercase', letterSpacing:'2px', marginBottom:'8px' }}>
            Preview de Preço
          </p>
          {/* Simulação */}
          <div style={{ display:'flex', flexDirection:'column', gap:'12px', marginBottom:'16px' }}>
            <SliderRow label="Distância de simulação" value={distKm} min={1} max={50} step={1} unit=" km" onChange={setDistKm} />
            <SliderRow label="Duração de simulação" value={durMin} min={5} max={90} step={5} unit=" min" onChange={setDurMin} />
            <SliderRow label="Rácio procura/oferta" value={demandRatio} min={0.5} max={5} step={0.25} onChange={setDemandRatio} />
            <div style={{ display:'flex', gap:'8px' }}>
              {['eco','standard','premium'].map(t => (
                <button key={t} onClick={() => setTier(t)}
                  className={`btn btn-sm ${tier === t ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex:1, justifyContent:'center' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="price-display">
            {preview.final.toLocaleString('pt-AO')}
            <span className="price-unit">Kz</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginTop:'12px' }}>
            <div className="card card-sm" style={{ textAlign:'center' }}>
              <p style={{ fontSize:'9px', color:'var(--text3)', fontFamily:'var(--font-mono)' }}>MOTORISTA</p>
              <p style={{ fontFamily:'var(--font-mono)', color:'var(--green)', fontSize:'16px', fontWeight:600 }}>
                {driverShare.toLocaleString('pt-AO')} Kz
              </p>
            </div>
            <div className="card card-sm" style={{ textAlign:'center' }}>
              <p style={{ fontSize:'9px', color:'var(--text3)', fontFamily:'var(--font-mono)' }}>PLATAFORMA</p>
              <p style={{ fontFamily:'var(--font-mono)', color:'var(--amber)', fontSize:'16px', fontWeight:600 }}>
                {platformShare.toLocaleString('pt-AO')} Kz
              </p>
            </div>
          </div>
          <div style={{ marginTop:'12px', fontSize:'11px', color:'var(--text3)', textAlign:'center' }}>
            Surge: {preview.S}× · Raw: {preview.raw.toLocaleString('pt-AO')} Kz
          </div>
        </div>

        <button className="btn btn-primary w-full btn-lg" onClick={save} disabled={saving}
          style={{ justifyContent:'center', gap:'8px' }}>
          {saving ? <span className="spinner" /> : <Save size={14} />}
          {saving ? 'A guardar...' : saved ? '✓ Guardado!' : 'GUARDAR CONFIGURAÇÃO'}
        </button>
        <p style={{ fontSize:'10px', color:'var(--text3)', textAlign:'center', marginTop:'8px' }}>
          A nova configuração aplica-se imediatamente às corridas seguintes
        </p>
      </div>
    </div>
  );
};

// ── TAB 2: Editor de Zonas ────────────────────────────────────────────────────
const ZoneEditor: React.FC = () => {
  const [prices, setPrices] = useState<ZonePrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, number>>({});
  const [newOrigin, setNewOrigin] = useState(ZONES[0]);
  const [newDest,   setNewDest]   = useState(ZONES[1]);
  const [newPrice,  setNewPrice]  = useState(1500);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('zone_prices')
      .select('*').order('origin_zone').order('dest_zone');
    setPrices((data ?? []) as ZonePrice[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const savePrice = async (p: ZonePrice, newVal: number) => {
    await supabase.from('zone_prices')
      .update({ price_kz: newVal }).eq('id', p.id);
    setPrices(prev => prev.map(r => r.id === p.id ? { ...r, price_kz: newVal } : r));
    setEditing(prev => { const n = {...prev}; delete n[p.id!]; return n; });
  };

  const toggleActive = async (p: ZonePrice) => {
    await supabase.from('zone_prices').update({ active: !p.active }).eq('id', p.id);
    setPrices(prev => prev.map(r => r.id === p.id ? { ...r, active: !r.active } : r));
  };

  const addPair = async () => {
    if (newOrigin === newDest) return;
    await supabase.from('zone_prices').insert({
      origin_zone: newOrigin, dest_zone: newDest,
      price_kz: newPrice, active: true,
    });
    load();
  };

  const exportCSV = () => {
    const rows = ['Origem,Destino,Preço (Kz),Activo', ...prices.map(p =>
      `${p.origin_zone},${p.dest_zone},${p.price_kz},${p.active}`)];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'zone_prices.csv'; a.click();
  };

  return (
    <div className="space-y-16">
      {/* Adicionar novo par */}
      <div className="card">
        <h3 style={{ fontSize:'13px', fontWeight:700, fontFamily:'var(--font-title)', marginBottom:'16px' }}>
          ➕ Adicionar Par de Zonas
        </h3>
        <div style={{ display:'flex', gap:'12px', alignItems:'flex-end', flexWrap:'wrap' }}>
          <div>
            <label className="input-label">Origem</label>
            <select className="input" style={{ width:'150px' }} value={newOrigin} onChange={e => setNewOrigin(e.target.value)}>
              {ZONES.map(z => <option key={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label">Destino</label>
            <select className="input" style={{ width:'150px' }} value={newDest} onChange={e => setNewDest(e.target.value)}>
              {ZONES.map(z => <option key={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label">Preço (Kz)</label>
            <input type="number" className="input" style={{ width:'120px' }} value={newPrice}
              onChange={e => setNewPrice(+e.target.value)} min={100} step={100} />
          </div>
          <button className="btn btn-primary" onClick={addPair}>Adicionar</button>
          <button className="btn btn-ghost" onClick={exportCSV} style={{ marginLeft:'auto' }}>
            ↓ Exportar CSV
          </button>
        </div>
      </div>

      {/* Tabela de preços */}
      <div className="card" style={{ padding:0 }}>
        <div style={{ overflowX:'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Origem</th><th>Destino</th><th>Preço (Kz)</th><th>Estado</th><th>Acções</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>
                  <span className="spinner" />
                </td></tr>
              ) : prices.map(p => (
                <tr key={p.id}>
                  <td className="bold">{p.origin_zone}</td>
                  <td>{p.dest_zone}</td>
                  <td>
                    {editing[p.id!] !== undefined ? (
                      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                        <input type="number" className="input" style={{ width:'100px' }}
                          value={editing[p.id!]} step={100}
                          onChange={e => setEditing(prev => ({...prev, [p.id!]: +e.target.value}))} />
                        <button className="btn btn-primary btn-sm" onClick={() => savePrice(p, editing[p.id!])}>✓</button>
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => setEditing(prev => { const n={...prev}; delete n[p.id!]; return n; })}>✕</button>
                      </div>
                    ) : (
                      <span style={{ fontFamily:'var(--font-mono)', cursor:'pointer', color:'var(--text)' }}
                        onClick={() => setEditing(prev => ({...prev, [p.id!]: p.price_kz}))}>
                        {p.price_kz.toLocaleString('pt-AO')} Kz ✎
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`status ${p.active ? 'status-online' : 'status-offline'}`}>
                      <span className="status-dot" />
                      {p.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(p)}>
                      {p.active ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && prices.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign:'center', color:'var(--text3)', padding:'32px' }}>
                  Nenhum par de zonas configurado
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ── TAB 3: Controlo de Surge ──────────────────────────────────────────────────
const SurgeControl: React.FC = () => {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [actives,   setActives]   = useState<Record<string, boolean>>({});
  const [globalMul, setGlobalMul] = useState(1.5);
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    supabase.from('zone_surge_overrides').select('*').then(({ data }) => {
      const ov: typeof overrides = {};
      const ac: typeof actives   = {};
      for (const row of (data ?? []) as {zone:string; multiplier:number; active:boolean}[]) {
        ov[row.zone] = row.multiplier;
        ac[row.zone] = row.active;
      }
      setOverrides(ov); setActives(ac);
    });
  }, []);

  const toggle = async (zone: string) => {
    const newActive = !actives[zone];
    const mul = overrides[zone] ?? 1.5;
    await supabase.from('zone_surge_overrides').upsert({ zone, multiplier: mul, active: newActive }, { onConflict: 'zone' });
    setActives(prev => ({ ...prev, [zone]: newActive }));
  };

  const setMul = (zone: string, v: number) =>
    setOverrides(prev => ({ ...prev, [zone]: v }));

  const saveAll = async () => {
    setSaving(true);
    await Promise.all(ZONES.map(z =>
      supabase.from('zone_surge_overrides').upsert({
        zone: z, multiplier: overrides[z] ?? 1.0, active: actives[z] ?? false,
      }, { onConflict: 'zone' })
    ));
    setSaving(false);
  };

  const activateGlobal = async () => {
    const ac: typeof actives = {};
    const ov: typeof overrides = {};
    ZONES.forEach(z => { ac[z] = true; ov[z] = globalMul; });
    setActives(ac); setOverrides(ov);
    await Promise.all(ZONES.map(z =>
      supabase.from('zone_surge_overrides').upsert({ zone: z, multiplier: globalMul, active: true }, { onConflict: 'zone' })
    ));
  };

  const deactivateAll = async () => {
    const ac: typeof actives = {};
    ZONES.forEach(z => { ac[z] = false; });
    setActives(ac);
    await supabase.from('zone_surge_overrides').update({ active: false }).in('zone', ZONES);
  };

  const activeCount = Object.values(actives).filter(Boolean).length;

  return (
    <div className="space-y-16">
      {/* Controlo global */}
      <div className="card card-green">
        <div className="flex items-center justify-between mb-16">
          <div>
            <h3 style={{ fontSize:'14px', fontWeight:700, fontFamily:'var(--font-title)', color:'var(--green)' }}>
              ⚡ Controlo Global de Surge
            </h3>
            <p style={{ fontSize:'11px', color:'var(--text3)', marginTop:'4px' }}>
              {activeCount} zona{activeCount !== 1 ? 's' : ''} com surge activo
            </p>
          </div>
          <div className="flex gap-8">
            <button className="btn btn-danger btn-sm" onClick={deactivateAll}>Desactivar Tudo</button>
            <button className="btn btn-primary" onClick={activateGlobal}>⚡ Activar Global</button>
          </div>
        </div>
        <SliderRow label="Multiplicador Global" value={globalMul} min={1.1} max={4.0} step={0.1} unit="×" onChange={setGlobalMul} />
      </div>

      {/* Grid de zonas */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'12px' }}>
        {ZONES.map(zone => {
          const isActive = actives[zone] ?? false;
          const mul = overrides[zone] ?? 1.0;
          return (
            <div key={zone} className={`card ${isActive ? 'card-green' : ''}`}>
              <div className="flex items-center justify-between mb-12">
                <span style={{ fontWeight:700, fontSize:'13px' }}>{zone}</span>
                <button
                  className={`btn btn-sm ${isActive ? 'btn-danger' : 'btn-ghost'}`}
                  onClick={() => toggle(zone)}>
                  {isActive ? 'OFF' : 'ON'}
                </button>
              </div>
              <SliderRow label="Multiplicador" value={mul} min={1.0} max={4.0} step={0.1} unit="×"
                onChange={v => setMul(zone, v)} />
              {isActive && (
                <div style={{ marginTop:'8px', textAlign:'center' }}>
                  <span className="badge-amber" style={{ padding:'3px 10px', borderRadius:'20px', fontSize:'11px', background:'rgba(255,170,0,0.1)', color:'var(--amber)' }}>
                    SURGE {mul}×
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button className="btn btn-primary btn-lg w-full" onClick={saveAll} disabled={saving}
        style={{ justifyContent:'center' }}>
        {saving ? <span className="spinner" /> : <Save size={14} />}
        {saving ? 'A guardar...' : 'GUARDAR CONFIGURAÇÃO DE SURGE'}
      </button>
    </div>
  );
};

// ── Página Pricing (com tabs) ─────────────────────────────────────────────────
const TABS = [
  { id:'calc',   label:'⚙️ Calculadora' },
  { id:'zones',  label:'🗺️ Zonas e Preços' },
  { id:'surge',  label:'⚡ Controlo de Surge' },
];

const PricingPage: React.FC = () => {
  const [tab, setTab] = useState('calc');
  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Pricing Engine</h1>
        <p className="page-sub">Configuração de preços — invisível para o utilizador final</p>
      </div>
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'calc'  && <Calculator />}
      {tab === 'zones' && <ZoneEditor />}
      {tab === 'surge' && <SurgeControl />}
    </div>
  );
};

export default PricingPage;
