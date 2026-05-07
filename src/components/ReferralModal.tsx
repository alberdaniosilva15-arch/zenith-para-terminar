import React, { useState, useEffect } from 'react';
import { ReferralService } from '../services/referralService';
import { useToastStore } from '../store/useAppStore';

interface ReferralModalProps {
  userId: string;
  onClose: () => void;
}

export const ReferralModal: React.FC<ReferralModalProps> = ({ userId, onClose }) => {
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [inputCode, setInputCode] = useState('');
  const [applying, setApplying] = useState(false);
  const { showToast } = useToastStore();

  useEffect(() => {
    let mounted = true;
    ReferralService.getMyReferralCode(userId).then(res => {
      if (!mounted) return;
      if (res.code) setCode(res.code);
      setLoading(false); // sempre terminar o loading, mesmo sem código
    });
    return () => { mounted = false; };
  }, [userId]);

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => {});
    showToast('Código copiado!', 'success');
  };

  const handleShare = async () => {
    if (!code) return;
    const text = `🚀 Usa o meu código *${code}* na Zenith Ride e ganha 500 Kz de bónus na primeira corrida! Descarrega em https://zenithride.ao`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Zenith Ride — Bónus de 500 Kz', text });
      } catch (err) {
        console.warn('[ReferralModal] share:', err);
      }
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
      showToast('Link copiado para partilhar!', 'success');
    }
  };

  const handleApply = async () => {
    if (inputCode.length < 5) return;
    setApplying(true);
    const res = await ReferralService.applyReferralCode(userId, inputCode);
    setApplying(false);
    if (res.success) {
      showToast(res.message, 'success');
      setInputCode('');
    } else {
      showToast(res.message, 'error');
    }
  };

  return (
    <div className="zr-modal is-open">
      <div className="zr-modal-card zr-card--hero" style={{ padding: 0 }}>
        <div style={{ padding: '24px', background: 'linear-gradient(135deg, var(--surface-1), transparent)' }}>
          <div className="zr-inline zr-inline--between" style={{ alignItems: 'flex-start', marginBottom: '8px' }}>
            <p className="zr-kicker" style={{ color: 'var(--gold)' }}>Ganhe na Zenith</p>
            <button onClick={onClose} className="zr-icon-button" style={{ width: '32px', height: '32px', minHeight: '32px', marginTop: '-8px', marginRight: '-8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            </button>
          </div>
          <h2 className="zr-balance" style={{ fontSize: '32px', margin: '4px 0 16px' }}>Traz o Mano</h2>
          
          <div className="zr-card" style={{ background: 'var(--surface-3)', border: '1px dashed var(--gold)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span className="zr-meta">O TEU CÓDIGO PESSOAL</span>
            <strong style={{ fontSize: '24px', color: 'var(--gold)', letterSpacing: '0.1em' }}>{loading ? '...' : code || 'N/A'}</strong>
          </div>

          <p className="zr-copy" style={{ textAlign: 'center', marginBottom: '20px' }}>Ganha 500 Kz por cada amigo que completar a 1ª viagem.</p>

          <div className="zr-inline" style={{ gap: '12px', marginBottom: '24px' }}>
            <button onClick={handleCopy} disabled={loading || !code} className="zr-button zr-button--secondary" style={{ flex: 1 }}>
              <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>content_copy</span> Copiar
            </button>
            <button onClick={handleShare} disabled={loading || !code} className="zr-button" style={{ flex: 1, backgroundColor: '#25D366', color: '#fff' }}>
              WhatsApp
            </button>
          </div>

          <div className="zr-card" style={{ backgroundColor: 'var(--surface-2)', padding: '16px' }}>
            <p className="zr-kicker" style={{ marginBottom: '12px' }}>Usar código de amigo</p>
            <div className="zr-inline" style={{ gap: '12px' }}>
              <input 
                type="text" 
                placeholder="Ex: TOMAS21" 
                value={inputCode}
                onChange={e => setInputCode(e.target.value.toUpperCase())}
                className="zr-input"
                style={{ flex: 1, textTransform: 'uppercase' }}
              />
              <button onClick={handleApply} disabled={applying || inputCode.length < 5} className="zr-button zr-button--secondary">
                {applying ? '...' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>

        <button onClick={onClose} className="zr-button zr-button--block zr-button--ghost" style={{ borderRadius: 0, padding: '16px', borderTop: '1px solid var(--surface-3)' }}>
          Fechar
        </button>
      </div>
    </div>
  );
};
