// =============================================================================
// ZENITH RIDE v3.3 — src/components/contract/ContractUi.tsx
//
// Componentes atómicos e tipos partilhados da área de Contratos & Zenith Pass.
// Extraído de Contract.tsx para eliminar duplicação inline (SRP).
// =============================================================================

import React from 'react';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ContractType = 'school' | 'family' | 'corporate';

export interface Contract {
  id: string;
  user_id: string;
  contract_type: ContractType;
  title: string;
  address: string;
  dest_lat: number;
  dest_lng: number;
  time_start: string;
  time_end: string;
  parent_monitoring: boolean;
  km_accumulated: number;
  bonus_kz: number;
  active: boolean;
  created_at: string;
  route_deviation_alert: boolean;
  max_deviation_km: number;
  contact_name?: string;
  contact_phone?: string;
  // Premium fields
  monthly_credit_kz?: number;
  credit_remaining_kz?: number;
  discount_pct?: number;
  payment_status?: 'active' | 'expired' | 'pending';
}

export interface KmBonus {
  km_total: number;
  free_km_available: number;
  km_to_next_perk: number;
  has_pass?: boolean;
  pass_rides_remaining?: number;
  pass_expires_at?: string;
}

export interface ContractFormState {
  title: string;
  address: string;
  time_start: string;
  time_end: string;
  parent_monitoring: boolean;
  route_deviation_alert: boolean;
  max_deviation_km: number;
  contact_name: string;
  contact_phone: string;
}

export const EMPTY_CONTRACT_FORM: ContractFormState = {
  title: '',
  address: '',
  time_start: '07:30',
  time_end: '13:00',
  parent_monitoring: true,
  route_deviation_alert: true,
  max_deviation_km: 2,
  contact_name: '',
  contact_phone: '',
};

// ─── Constantes de domínio ────────────────────────────────────────────────────

export const PERK_THRESHOLD = 70;

export const CONTRACT_ICONS: Record<ContractType, string> = {
  school: 'school',
  family: 'family_home',
  corporate: 'business',
};

export const CONTRACT_LABELS: Record<ContractType, string> = {
  school: 'Contrato Escolar',
  family: 'Contrato Familiar',
  corporate: 'Contrato Empresarial',
};

export const PASS_RIDES = 10;
export const PASS_DISCOUNT = 0.80; // 80% do preço = 20% desconto
export const AVERAGE_RIDE_KZ = 3000;

// ─── Componentes atómicos ─────────────────────────────────────────────────────

export const StatCell: React.FC<{ icon: string; label: string; value: string; gold?: boolean }> = ({ icon, label, value, gold }) => (
  <div style={{ padding: '12px', textAlign: 'center' }}>
    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--muted)', marginBottom: '4px' }}>{icon}</span>
    <p className="zr-meta" style={{ fontSize: '9px', marginBottom: '4px' }}>{label}</p>
    <p style={{ fontFamily: 'var(--font-heading)', fontSize: '14px', fontWeight: 'bold', fontStyle: 'italic', color: gold ? 'var(--gold)' : 'var(--text)' }}>{value}</p>
  </div>
);

export const Badge: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div className="zr-chip zr-chip--gold">
    <span className="material-symbols-outlined" style={{ fontSize: '12px', marginRight: '4px' }}>{icon}</span>
    {label}
  </div>
);

export const ZField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder: string }> = ({ label, value, onChange, placeholder }) => (
  <div>
    <label className="zr-label">{label}</label>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="zr-input" />
  </div>
);

export const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="zr-inline zr-inline--between" style={{ padding: '8px 0' }}>
    <span className="zr-meta">{label}</span>
    <button onClick={() => onChange(!value)} style={{ width: '40px', height: '24px', borderRadius: '12px', background: value ? 'var(--gold)' : 'var(--surface-3)', position: 'relative', border: 'none', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', top: '2px', left: value ? '18px' : '2px', width: '20px', height: '20px', borderRadius: '10px', background: value ? '#000' : 'var(--gold-soft)', transition: 'left 0.2s' }} />
    </button>
  </div>
);
