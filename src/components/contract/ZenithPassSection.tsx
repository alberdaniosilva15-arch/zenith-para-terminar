// =============================================================================
// ZENITH RIDE v3.3 — src/components/contract/ZenithPassSection.tsx
//
// Secção "Zenith Pass": estado de compra, cálculo de poupança, débito de
// carteira e activação do pacote de corridas.
// Extraído de Contract.tsx (SRP) — comportamento inalterado.
// =============================================================================

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { StatCell, PASS_RIDES, PASS_DISCOUNT, AVERAGE_RIDE_KZ } from './ContractUi';
import type { KmBonus } from './ContractUi';

interface ZenithPassSectionProps {
  kmBonus: KmBonus | null;
  userId: string;
  showToast: (msg: string, type: 'success' | 'error') => void;
  onRefresh: () => void;
}

const ZenithPassSection: React.FC<ZenithPassSectionProps> = ({ kmBonus, userId, showToast, onRefresh }) => {
  const [buying, setBuying] = useState(false);
  const passActive = kmBonus?.has_pass && (kmBonus?.pass_rides_remaining ?? 0) > 0;
  const passExpired = kmBonus?.has_pass && (kmBonus?.pass_rides_remaining ?? 0) === 0;
  const totalPrice = PASS_RIDES * AVERAGE_RIDE_KZ;
  const passPrice = Math.round(totalPrice * PASS_DISCOUNT);
  const savings = totalPrice - passPrice;

  const handleBuyPass = async () => {
    setBuying(true);
    try {
      // Verificar saldo
      const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', userId).single();
      if (!wallet || wallet.balance < passPrice) {
        showToast(`Saldo insuficiente. Precisas de ${passPrice.toLocaleString()} Kz.`, 'error');
        return;
      }
      // Debitar e activar pass
      const { error: walletErr } = await supabase.rpc('process_withdrawal', { p_user_id: userId, p_amount: passPrice });
      if (walletErr) throw walletErr;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      await supabase.from('profiles').update({
        has_pass: true,
        pass_rides_remaining: PASS_RIDES,
        pass_expires_at: expiresAt.toISOString(),
      }).eq('user_id', userId);

      showToast(`Zenith Pass activado! ${PASS_RIDES} corridas disponíveis.`, 'success');
      onRefresh();
    } catch {
      showToast('Erro ao comprar Pass. Tenta de novo.', 'error');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Pass Status */}
      {passActive && (
        <div className="zr-alert-box zr-alert-box--success" style={{ marginBottom: 16 }}>
          <div className="zr-inline zr-inline--between">
            <div className="zr-inline" style={{ gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>confirmation_number</span>
              <div>
                <strong style={{ color: 'var(--gold)' }}>Zenith Pass Activo</strong>
                <p className="zr-meta" style={{ margin: 0 }}>
                  {kmBonus?.pass_rides_remaining} corridas restantes · Desconto 20%
                </p>
              </div>
            </div>
            <span className="zr-chip zr-chip--gold">{kmBonus?.pass_rides_remaining}/{PASS_RIDES}</span>
          </div>
        </div>
      )}

      {passExpired && (
        <div className="zr-alert-box zr-alert-box--warning" style={{ marginBottom: 16 }}>
          <span className="material-symbols-outlined">info</span>
          <div className="zr-alert-content">
            <strong>Pass expirado</strong>
            <p>As tuas {PASS_RIDES} corridas foram usadas. Renova para continuar a poupar.</p>
          </div>
        </div>
      )}

      {/* Buy Card */}
      <div className="zr-card" style={{ background: 'linear-gradient(135deg, rgba(230,195,100,0.08), rgba(230,195,100,0.02))' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 48 }}>confirmation_number</span>
          <h3 className="zr-section-title" style={{ margin: '8px 0 4px' }}>Zenith Pass</h3>
          <p className="zr-meta">Pacote de {PASS_RIDES} corridas com desconto de 20%</p>
        </div>

        <div className="zr-kpi-grid" style={{ marginBottom: 16 }}>
          <StatCell icon="confirmation_number" label="Corridas" value={`${PASS_RIDES}`} />
          <StatCell icon="savings" label="Poupança" value={`${savings.toLocaleString()} Kz`} gold />
          <StatCell icon="payments" label="Preço" value={`${passPrice.toLocaleString()} Kz`} gold />
        </div>

        <div className="zr-card" style={{ padding: 12, background: 'rgba(0,0,0,0.2)', marginBottom: 16 }}>
          <p className="zr-meta" style={{ margin: 0, textAlign: 'center' }}>
            Preço normal: <span style={{ textDecoration: 'line-through' }}>{totalPrice.toLocaleString()} Kz</span>
            → <strong style={{ color: 'var(--gold)' }}>{passPrice.toLocaleString()} Kz</strong>
          </p>
        </div>

        <button
          onClick={handleBuyPass}
          disabled={buying || !!passActive}
          className="zr-button zr-button--block"
          style={{ fontSize: 14 }}
        >
          {buying ? 'A processar...' : passActive ? <><span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>check_circle</span> Pass Activo</> : `Comprar Zenith Pass: ${passPrice.toLocaleString()} Kz`}
        </button>
      </div>
    </div>
  );
};

export default ZenithPassSection;
