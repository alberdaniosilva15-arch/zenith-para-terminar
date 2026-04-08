import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Save } from 'lucide-react';

interface AppSetting { key: string; value: any; }

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Record<string,any>>({
    matching_radius_km:   7,
    matching_expansion:   true,
    max_searching_minutes: 5,
    notif_expiry_minutes: 5,
    max_drivers_to_notify: 3,
  });
  const [loading, setSaving] = useState(false);
  const [saved,   setSaved]  = useState(false);

  useEffect(() => {
    supabase.from('app_settings').select('key, value').then(({ data }) => {
      if (!data) return;
      const map: Record<string,any> = {};
      for (const row of (data as AppSetting[])) map[row.key] = row.value;
      setSettings(prev => ({ ...prev, ...map }));
    });
  }, []);

  const save = async () => {
    setSaving(true);
    await Promise.all(Object.entries(settings).map(([key, value]) =>
      supabase.from('app_settings').upsert({ key, value }, { onConflict:'key' })
    ));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const set = (key: string, value: any) => setSettings(prev => ({ ...prev, [key]: value }));

  const SliderRow: React.FC<{label:string;k:string;min:number;max:number;step:number;unit?:string}> = ({label,k,min,max,step,unit=''}) => (
    <div style={{ display:'grid', gridTemplateColumns:'220px 1fr 60px', alignItems:'center', gap:'16px' }}>
      <label style={{ fontSize:'12px', color:'var(--text2)' }}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={Number(settings[k])}
        onChange={e => set(k, parseFloat(e.target.value))} />
      <span style={{ fontFamily:'var(--font-mono)', color:'var(--green)', fontSize:'12px', textAlign:'right' }}>
        {settings[k]}{unit}
      </span>
    </div>
  );

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Configurações</h1>
        <p className="page-sub">Parâmetros globais do sistema</p>
      </div>

      <div className="space-y-16">
        {/* Matching */}
        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>🔍 Matching de Motoristas</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <SliderRow label="Raio de matching (km)" k="matching_radius_km" min={2} max={20} step={1} unit=" km" />
            <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <label style={{ fontSize:'12px', color:'var(--text2)', minWidth:'220px' }}>Expansão automática de raio</label>
              <button
                className={`btn btn-sm ${settings.matching_expansion ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => set('matching_expansion', !settings.matching_expansion)}>
                {settings.matching_expansion ? '✓ Activado' : 'Desactivado'}
              </button>
              <span style={{ fontSize:'11px', color:'var(--text3)' }}>
                {settings.matching_expansion ? '5→7→12km automático' : 'Raio fixo'}
              </span>
            </div>
            <SliderRow label="Tempo máx. a procurar (min)" k="max_searching_minutes" min={1} max={15} step={1} unit=" min" />
          </div>
        </div>

        {/* Notificações */}
        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>🔔 Notificações de Corridas</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <SliderRow label="Expiração da notificação" k="notif_expiry_minutes" min={1} max={15} step={1} unit=" min" />
            <SliderRow label="Max. motoristas a notificar" k="max_drivers_to_notify" min={1} max={10} step={1} />
          </div>
        </div>

        {/* Integrações — apenas estado */}
        <div className="card">
          <h3 style={{ fontFamily:'var(--font-title)', fontWeight:700, marginBottom:'16px' }}>🔌 Integrações</h3>
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            {[
              { name:'Supabase (Base de Dados)', ok:true },
              { name:'Google Maps (Geocoding + Routes)', ok:true },
              { name:'Agora (VoIP)', ok:true },
              { name:'Multicaixa Express (Pagamentos)', ok:true },
              { name:'Gemini AI (Kaze + Análise)', ok:true },
            ].map(int => (
              <div key={int.name} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                <span className={`status ${int.ok?'status-online':'status-offline'}`}>
                  <span className="status-dot" />{int.ok?'Ligado':'Erro'}
                </span>
                <span style={{ fontSize:'12px', color:'var(--text2)' }}>{int.name}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize:'10px', color:'var(--text3)', marginTop:'12px' }}>
            As chaves de API nunca são expostas neste painel — geridas exclusivamente via variáveis de ambiente.
          </p>
        </div>

        <button className="btn btn-primary btn-lg w-full" style={{ justifyContent:'center', gap:'8px' }}
          onClick={save} disabled={loading}>
          {loading ? <span className="spinner" /> : <Save size={14} />}
          {loading ? 'A guardar...' : saved ? '✓ Guardado!' : 'GUARDAR CONFIGURAÇÕES'}
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;
