import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, RefreshCw } from 'lucide-react';

interface Tenant {
  id: string; name: string; slug: string; plan: string;
  logo_url: string | null; primary_color: string; active: boolean;
  created_at: string;
}

const PLANS = ['basic','pro','enterprise'];
const PLAN_COLORS: Record<string,string> = {
  basic:'var(--text3)', pro:'var(--blue)', enterprise:'var(--green)',
};

const TenantsPage: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name:'', slug:'', plan:'basic', primary_color:'#00e676' });
  const [msg, setMsg] = useState<{text:string; ok:boolean}|null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('tenants').select('*').order('created_at');
    setTenants((data ?? []) as Tenant[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.slug) return;
    const { error } = await supabase.from('tenants').insert({
      name: form.name, slug: form.slug, plan: form.plan,
      primary_color: form.primary_color, active: true,
    });
    if (error) { setMsg({ text:`Erro: ${error.message}`, ok:false }); return; }
    setMsg({ text:'Tenant criado com sucesso!', ok:true });
    setCreating(false);
    setForm({ name:'', slug:'', plan:'basic', primary_color:'#00e676' });
    load();
  };

  const toggleActive = async (t: Tenant) => {
    await supabase.from('tenants').update({ active: !t.active }).eq('id', t.id);
    setTenants(prev => prev.map(x => x.id === t.id ? { ...x, active: !x.active } : x));
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">White-Label / Tenants</h1>
        <p className="page-sub">Empresas parceiras que usam o Zenith como plataforma base</p>
      </div>

      {msg && (
        <div style={{ padding:'10px 16px', borderRadius:'8px', marginBottom:'16px',
          background: msg.ok?'rgba(0,230,118,0.1)':'rgba(255,68,68,0.1)',
          color: msg.ok?'var(--green)':'var(--red)', fontSize:'12px',
          border:`1px solid ${msg.ok?'rgba(0,230,118,0.2)':'rgba(255,68,68,0.2)'}`,
        }}>{msg.text}</div>
      )}

      <div className="flex items-center gap-12 mb-16">
        <button className="btn btn-primary" onClick={() => setCreating(!creating)}>
          <Plus size={13} /> {creating ? 'Cancelar' : 'Novo Tenant'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /></button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom:'16px' }}>
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>➕ Criar Nova Empresa</h3>
          <form onSubmit={create} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
            <div>
              <label className="input-label">Nome *</label>
              <input className="input" required value={form.name} onChange={e => setForm(p=>({...p,name:e.target.value}))} placeholder="Ex: Kubinga Ride" />
            </div>
            <div>
              <label className="input-label">Slug *</label>
              <input className="input" required value={form.slug} onChange={e => setForm(p=>({...p,slug:e.target.value.toLowerCase()}))} placeholder="kubinga" />
            </div>
            <div>
              <label className="input-label">Plano</label>
              <select className="input" value={form.plan} onChange={e => setForm(p=>({...p,plan:e.target.value}))}>
                {PLANS.map(pl => <option key={pl}>{pl}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Cor primária</label>
              <div style={{ display:'flex', gap:'8px' }}>
                <input type="color" value={form.primary_color} onChange={e => setForm(p=>({...p,primary_color:e.target.value}))}
                  style={{ width:'44px', height:'36px', border:'none', cursor:'pointer' }} />
                <input className="input" value={form.primary_color} onChange={e => setForm(p=>({...p,primary_color:e.target.value}))} />
              </div>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <button type="submit" className="btn btn-primary">Criar</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'16px' }}>
        {loading ? (
          <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'40px' }}><span className="spinner" /></div>
        ) : tenants.map(t => (
          <div key={t.id} className="card" style={{ opacity: t.active?1:0.5 }}>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'12px' }}>
              <div style={{ width:'44px', height:'44px', borderRadius:'12px', background:`${t.primary_color}22`, border:`2px solid ${t.primary_color}`,
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', fontWeight:800, color:t.primary_color, fontFamily:'var(--font-title)' }}>
                {t.name.charAt(0)}
              </div>
              <div>
                <div style={{ fontWeight:700, color:'var(--text)', fontSize:'14px' }}>{t.name}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:'9px', color:'var(--text3)' }}>/{t.slug}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:'8px', marginBottom:'12px' }}>
              <span className="status" style={{ background:`${PLAN_COLORS[t.plan]}15`, color:PLAN_COLORS[t.plan] }}>
                <span className="status-dot" style={{ background:PLAN_COLORS[t.plan] }} />
                {t.plan.toUpperCase()}
              </span>
              <span className={`status ${t.active?'status-online':'status-offline'}`}>
                <span className="status-dot" />{t.active?'Activo':'Inactivo'}
              </span>
            </div>
            <div style={{ height:'4px', borderRadius:'2px', background:t.primary_color, marginBottom:'12px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:'10px', color:'var(--text3)' }}>{new Date(t.created_at).toLocaleDateString('pt-AO')}</span>
              <button className={`btn btn-sm ${t.active?'btn-danger':'btn-ghost'}`} onClick={() => toggleActive(t)}>
                {t.active?'Desactivar':'Activar'}
              </button>
            </div>
          </div>
        ))}
        {!loading && tenants.length === 0 && (
          <div style={{ gridColumn:'1/-1', textAlign:'center', color:'var(--text3)', padding:'40px' }}>
            Nenhum tenant — clica em "Novo Tenant"
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantsPage;
