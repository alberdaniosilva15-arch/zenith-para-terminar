// =============================================================================
// ZENITH RIDE v3.3 — src/components/contract/ContractCard.tsx
//
// Card individual de contrato: link de rastreio escolar via WhatsApp, exportação
// PDF (guardar/partilhar) e toggle de monitorização parental.
// Extraído de Contract.tsx (SRP) — comportamento inalterado.
// =============================================================================

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAppStore } from '../../store/useAppStore';
import EscolarMonitor from '../EscolarMonitor';
import { buildContractPDF, saveFile, shareFile } from '../../services/pdfService';
import { Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { CONTRACT_ICONS, CONTRACT_LABELS, StatCell, Badge } from './ContractUi';
import type { Contract } from './ContractUi';

interface ContractCardProps {
  contract: Contract;
  isScheduling: boolean;
  isSuccess: boolean;
  onSchedule: () => void;
  onDeactivate: () => void;
}

const ContractCard: React.FC<ContractCardProps> = ({
  contract: c, isScheduling, isSuccess, onSchedule, onDeactivate,
}) => {
  const [showMonitor, setShowMonitor] = useState(false);
  const showToast = useAppStore((s) => s.showToast);
  const [trackingToken, setTrackingToken] = useState<string | null>(null);
  const [sharingLink, setSharingLink] = useState(false);

  // Token gerado para rastreio: exposto em `data-*` para depuração em QA.
  void trackingToken;

  const generateTrackingLink = async () => {
    setSharingLink(true);
    try {
      const { data, error } = await supabase
        .from('school_tracking_sessions')
        .insert({
          contract_id: c.id,
          expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        })
        .select('public_token')
        .single();

      if (error || !data) {
        showToast('Erro ao gerar link. Tenta novamente.', 'error');
        return;
      }

      const link = `${window.location.origin}/track/${data.public_token}`;
      setTrackingToken(data.public_token);

      const msg = encodeURIComponent(
        `*Zenith Ride, rastreio em tempo real*\n\nPodes acompanhar a localização em tempo real aqui:\n${link}\n\n_O link expira em 8 horas._`
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    } finally {
      setSharingLink(false);
    }
  };

  const generateContractPDF = async (mode: 'save' | 'share') => {
    try {
      const base64 = await buildContractPDF(c as any);
      const fileName = `zenith_contrato_${c.id.substring(0, 8)}.pdf`;

      if (mode === 'share') {
        if (Capacitor.isNativePlatform()) {
          const uri = await saveFile(base64, fileName, Directory.Cache);
          await shareFile(uri, fileName, { title: 'Contrato Zenith Ride', dialogTitle: 'Partilhar contrato' });
        } else {
          await shareFile(base64, fileName, { title: 'Contrato Zenith Ride' });
        }
      } else {
        await saveFile(base64, fileName, Directory.Documents);
      }
    } catch (err) {
      console.error('[Contract.generateContractPDF]', err);
      showToast('Erro ao gerar/partilhar o PDF.', 'error');
    }
  };

  return (
    <div className="zr-card" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Success overlay */}
      {isSuccess && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--gold)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#000', marginBottom: '12px' }}>check_circle</span>
          <h4 className="zr-section-title" style={{ color: '#000' }}>Corrida Agendada!</h4>
          <p className="zr-meta" style={{ color: 'rgba(0,0,0,0.7)' }}>
            Motorista chega às {c.time_start}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="zr-inline zr-inline--between" style={{ alignItems: 'flex-start', marginBottom: '16px' }}>
        <div className="zr-inline" style={{ gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}>
            <span className="material-symbols-outlined">{CONTRACT_ICONS[c.contract_type]}</span>
          </div>
          <div>
            <p className="zr-kicker" style={{ margin: 0 }}>{CONTRACT_LABELS[c.contract_type]}</p>
            <h3 className="zr-section-title" style={{ fontSize: '18px', margin: 0 }}>{c.title}</h3>
            <p className="zr-meta" style={{ color: 'var(--gold)', marginTop: '4px' }}><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>location_on</span> {c.address}</p>
          </div>
        </div>
        <button onClick={onDeactivate} className="zr-icon-button" style={{ color: 'var(--danger-soft)' }}>
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Premium credit banner */}
      {(c.monthly_credit_kz ?? 0) > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(230,195,100,0.12), rgba(230,195,100,0.04))',
          border: '1px solid rgba(230,195,100,0.2)',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>Saldo do Contrato</span>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#ffaa00', fontFamily: 'var(--font-heading)', fontStyle: 'italic' }}>
              {(c.credit_remaining_kz ?? 0).toLocaleString()} Kz
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`zr-chip ${c.payment_status === 'active' ? 'zr-chip--gold' : c.payment_status === 'expired' ? 'zr-chip--danger' : 'zr-chip--muted'}`}>
              {c.payment_status === 'active' ? <><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>check_circle</span> Pago</> : c.payment_status === 'expired' ? <><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>cancel</span> Expirado</> : <><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>hourglass_empty</span> Pendente</>}
            </span>
            <p style={{ margin: '4px 0 0', fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>
              -{c.discount_pct ?? 25}% desconto
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="zr-kpi-grid" style={{ marginBottom: '20px' }}>
        <StatCell icon="schedule" label="Hora" value={`${c.time_start} – ${c.time_end}`} />
        <StatCell icon="route" label="Km Acum." value={`${c.km_accumulated} km`} />
        <StatCell icon="payments" label="Bónus" value={`${c.bonus_kz.toLocaleString()} Kz`} gold />
      </div>

      {/* Badges */}
      <div className="zr-inline" style={{ flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
        {c.parent_monitoring && <Badge icon="shield" label="Monitorização Parental" />}
        {c.route_deviation_alert && <Badge icon="alt_route" label={`Alerta Desvio > ${c.max_deviation_km}km`} />}
        {c.contact_name && <Badge icon="person" label={c.contact_name} />}
        {(c.monthly_credit_kz ?? 0) > 0 && <Badge icon="credit_card" label="Assinatura Premium" />}
      </div>

      {/* EscolarMonitor */}
      {c.parent_monitoring && (
        <div className="zr-stack" style={{ gap: '12px', marginBottom: '16px' }}>
          <button onClick={() => setShowMonitor(!showMonitor)} className="zr-button zr-button--secondary zr-button--block">
            <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>location_on</span>
            Ver Monitorização
            <span className="material-symbols-outlined" style={{ marginLeft: 'auto' }}>{showMonitor ? 'expand_less' : 'expand_more'}</span>
          </button>

          <button onClick={generateTrackingLink} disabled={sharingLink} className="zr-button zr-button--block" style={{ backgroundColor: '#25D366', color: '#fff' }}>
            <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>share</span>
            {sharingLink ? 'A gerar...' : <><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>location_on</span> Partilhar Rastreio via WhatsApp</>}
          </button>

          {showMonitor && (
            <div style={{ marginTop: '12px' }}>
              <EscolarMonitor contractId={c.id} contractTitle={c.title} />
            </div>
          )}
        </div>
      )}

      {/* PDF Buttons */}
      <div className="zr-inline" style={{ gap: '12px', marginBottom: '16px' }}>
        <button onClick={() => generateContractPDF('share')} className="zr-button zr-button--block" style={{ flex: 1, backgroundColor: '#25D366', color: '#fff' }}>
          <span className="material-symbols-outlined" style={{ marginRight: '4px', fontSize: '16px' }}>share</span> Partilhar PDF
        </button>
        <button onClick={() => generateContractPDF('save')} className="zr-button zr-button--secondary zr-button--block" style={{ flex: 1 }}>
          <span className="material-symbols-outlined" style={{ marginRight: '4px', fontSize: '16px' }}>save</span> Guardar
        </button>
      </div>

      {/* Schedule button */}
      <button onClick={onSchedule} disabled={isScheduling} className="zr-button zr-button--block">
        {isScheduling ? 'A sincronizar IA...' : 'Agendar Corrida'}
      </button>
    </div>
  );
};

export default ContractCard;
