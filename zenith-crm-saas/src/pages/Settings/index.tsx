import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Save } from 'lucide-react';

interface AppSetting {
  key: string;
  value: string | number | boolean;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, step, unit = '', onChange }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 60px', alignItems: 'center', gap: '16px' }}>
    <label style={{ fontSize: '12px', color: 'var(--text2)' }}>{label}</label>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} />
    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontSize: '12px', textAlign: 'right' }}>
      {value}
      {unit}
    </span>
  </div>
);

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, string | number | boolean>>({
    matching_radius_km: 7,
    matching_expansion: true,
    max_searching_minutes: 5,
    notif_expiry_minutes: 5,
    max_drivers_to_notify: 3,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('key, value')
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string | number | boolean> = {};
        for (const row of data as AppSetting[]) {
          map[row.key] = row.value;
        }
        setSettings(prev => ({ ...prev, ...map }));
      });
  }, []);

  const save = async () => {
    setSaving(true);
    await Promise.all(
      Object.entries(settings).map(([key, value]) =>
        supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
      )
    );
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const setSetting = (key: string, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">Configuracoes</h1>
        <p className="page-sub">Parametros globais do sistema</p>
      </div>

      <div className="space-y-16">
        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-title)', fontWeight: 700, marginBottom: '16px' }}>Matching de Motoristas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <SliderRow
              label="Raio de matching (km)"
              value={Number(settings.matching_radius_km)}
              min={2}
              max={20}
              step={1}
              unit=" km"
              onChange={value => setSetting('matching_radius_km', value)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text2)', minWidth: '220px' }}>Expansao automatica de raio</label>
              <button
                className={`btn btn-sm ${settings.matching_expansion ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSetting('matching_expansion', !settings.matching_expansion)}
              >
                {settings.matching_expansion ? 'Activado' : 'Desactivado'}
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
                {settings.matching_expansion ? '5-7-12km automatico' : 'Raio fixo'}
              </span>
            </div>
            <SliderRow
              label="Tempo max. a procurar (min)"
              value={Number(settings.max_searching_minutes)}
              min={1}
              max={15}
              step={1}
              unit=" min"
              onChange={value => setSetting('max_searching_minutes', value)}
            />
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-title)', fontWeight: 700, marginBottom: '16px' }}>Notificacoes de Corridas</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <SliderRow
              label="Expiracao da notificacao"
              value={Number(settings.notif_expiry_minutes)}
              min={1}
              max={15}
              step={1}
              unit=" min"
              onChange={value => setSetting('notif_expiry_minutes', value)}
            />
            <SliderRow
              label="Max. motoristas a notificar"
              value={Number(settings.max_drivers_to_notify)}
              min={1}
              max={10}
              step={1}
              onChange={value => setSetting('max_drivers_to_notify', value)}
            />
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-title)', fontWeight: 700, marginBottom: '16px' }}>Integracoes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { name: 'Supabase (Base de Dados)', ok: true },
              { name: 'Google Maps (Geocoding + Routes)', ok: true },
              { name: 'Agora (VoIP)', ok: true },
              { name: 'Multicaixa Express (Pagamentos)', ok: false },
              { name: 'Gemini AI (Kaze + Analise)', ok: true },
            ].map(int => (
              <div key={int.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span className={`status ${int.ok ? 'status-online' : 'status-offline'}`}>
                  <span className="status-dot" />
                  {int.ok ? 'Ligado' : 'Erro'}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{int.name}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '12px' }}>
            As chaves de API nunca sao expostas neste painel - geridas via variaveis de ambiente.
          </p>
        </div>

        <button className="btn btn-primary btn-lg w-full" style={{ justifyContent: 'center', gap: '8px' }} onClick={save} disabled={saving}>
          {saving ? <span className="spinner" /> : <Save size={14} />}
          {saving ? 'A guardar...' : saved ? 'Guardado!' : 'GUARDAR CONFIGURACOES'}
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;
