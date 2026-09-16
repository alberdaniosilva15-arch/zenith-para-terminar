// =============================================================================
// ZENITH RIDE v3.3 — src/components/contract/AddContractForm.tsx
//
// Formulário de criação de contratos (escolar, familiar, corporativo) com
// validação de campos, seletores de horário e toggles de segurança.
// Extraído de Contract.tsx (SRP) — comportamento inalterado.
// =============================================================================

import React from 'react';
import {
  CONTRACT_ICONS,
  ZField,
  Toggle,
} from './ContractUi';
import type { ContractType, ContractFormState } from './ContractUi';

interface AddContractFormProps {
  activeContractType: ContractType;
  onChangeContractType: (type: ContractType) => void;
  form: ContractFormState;
  onFormChange: React.Dispatch<React.SetStateAction<ContractFormState>>;
  saving: boolean;
  saveError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

const AddContractForm: React.FC<AddContractFormProps> = ({
  activeContractType,
  onChangeContractType,
  form,
  onFormChange,
  saving,
  saveError,
  onSubmit,
  onCancel,
}) => {
  const showGuardianFields = activeContractType === 'school' || activeContractType === 'family';

  return (
    <div className="zr-card" style={{ marginBottom: '24px' }}>
      <div>
        <p className="zr-label" style={{ marginBottom: '8px' }}>Tipo de Contrato</p>
        <div className="zr-inline" style={{ marginBottom: '16px', gap: '8px' }}>
          {(['school', 'family', 'corporate'] as ContractType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onChangeContractType(t)}
              className={`zr-chip ${activeContractType === t ? 'zr-chip--gold' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>{CONTRACT_ICONS[t]}</span>
              {t === 'school' ? 'Escola' : t === 'family' ? 'Família' : 'Empresa'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={onSubmit} className="zr-stack" style={{ gap: '16px' }}>
        <ZField
          label={activeContractType === 'school' ? 'Nome da Escola' : activeContractType === 'family' ? 'Nome da Família' : 'Nome da Empresa'}
          value={form.title}
          onChange={v => onFormChange(p => ({ ...p, title: v }))}
          placeholder="ex: Creche Estrelinhas"
        />
        <ZField
          label="Morada de Destino"
          value={form.address}
          onChange={v => onFormChange(p => ({ ...p, address: v }))}
          placeholder="Rua, Bairro, Luanda"
        />

        {showGuardianFields && (
          <ZField
            label="Nome do Responsável"
            value={form.contact_name}
            onChange={v => onFormChange(p => ({ ...p, contact_name: v }))}
            placeholder="Nome do pai/mãe/tutor"
          />
        )}
        {showGuardianFields && (
          <ZField
            label="Telemóvel (+244)"
            value={form.contact_phone}
            onChange={v => onFormChange(p => ({ ...p, contact_phone: v }))}
            placeholder="9XX XXX XXX"
          />
        )}

        <div className="zr-inline" style={{ gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <p className="zr-label">Hora Ida</p>
            <input
              type="time"
              value={form.time_start}
              onChange={e => onFormChange(p => ({ ...p, time_start: e.target.value }))}
              className="zr-input"
            />
          </div>
          <div style={{ flex: 1 }}>
            <p className="zr-label">Hora Volta</p>
            <input
              type="time"
              value={form.time_end}
              onChange={e => onFormChange(p => ({ ...p, time_end: e.target.value }))}
              className="zr-input"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="zr-stack" style={{ gap: '8px' }}>
          <Toggle
            label="Monitorização Parental em Tempo Real"
            value={form.parent_monitoring}
            onChange={v => onFormChange(p => ({ ...p, parent_monitoring: v }))}
          />
          <Toggle
            label="Alerta de Desvio de Rota"
            value={form.route_deviation_alert}
            onChange={v => onFormChange(p => ({ ...p, route_deviation_alert: v }))}
          />
          {form.route_deviation_alert && (
            <div style={{ paddingLeft: '16px' }}>
              <p className="zr-meta" style={{ marginBottom: '8px' }}>Tolerância de desvio: {form.max_deviation_km} km</p>
              <input
                type="range"
                min={1}
                max={5}
                value={form.max_deviation_km}
                onChange={e => onFormChange(p => ({ ...p, max_deviation_km: +e.target.value }))}
                style={{ width: '100%', accentColor: 'var(--gold)' }}
              />
            </div>
          )}
        </div>

        {saveError && (
          <p className="zr-meta" style={{ color: 'var(--danger)', textAlign: 'center' }}>{saveError}</p>
        )}

        <div className="zr-inline" style={{ gap: '8px', marginTop: '8px' }}>
          <button type="button" onClick={onCancel} className="zr-button zr-button--secondary" style={{ flex: 1 }}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="zr-button" style={{ flex: 2 }}>
            {saving ? 'A guardar...' : 'Criar Contrato'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddContractForm;
