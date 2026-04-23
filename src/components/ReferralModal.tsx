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
      try { await navigator.share({ title: 'Zenith Ride — Bónus de 500 Kz', text }); } catch { /* utilizador cancelou */ }
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
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-surface-container-low rounded-[2rem] w-full max-w-sm overflow-hidden flex flex-col pt-8">
        <h2 className="text-xl font-black text-center mb-2 px-6">Traz o Mano!</h2>
        <p className="text-xs text-on-surface-variant/70 text-center px-6 mb-6">
          Convida amigos e ganha 500 Kz de bónus por cada <br/> assinatura ou primeira corrida.
        </p>

        <div className="px-6 space-y-6 flex-1 mb-6">
          <div className="bg-primary/10 rounded-2xl p-4 flex justify-between items-center border border-primary/20">
            <div>
              <p className="text-[10px] font-black uppercase text-primary mb-1">O TEU CÓDIGO</p>
              {loading ? (
                <div className="h-6 w-24 bg-surface-container-high rounded animate-pulse" />
              ) : (
                <div className="text-2xl font-black tracking-widest text-[#050912] dark:text-white drop-shadow-sm">{code}</div>
              )}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleCopy}
                disabled={loading || !code}
                className="bg-primary text-white w-10 h-10 rounded-xl flex items-center justify-center font-black active:scale-90 transition-transform"
                title="Copiar código"
              >
                📋
              </button>
              <button 
                onClick={handleShare}
                disabled={loading || !code}
                className="bg-surface-container-high text-on-surface w-10 h-10 rounded-xl flex items-center justify-center font-black active:scale-90 transition-transform"
                title="Partilhar"
              >
                📤
              </button>
            </div>
          </div>

          <div className="h-px bg-outline-variant/30 w-full" />

          <div>
            <p className="text-[10px] font-black uppercase text-on-surface-variant mb-2">Usar código de amigo</p>
            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Ex: TOMAS21" 
                value={inputCode}
                onChange={e => setInputCode(e.target.value.toUpperCase())}
                className="flex-1 bg-surface-container-high rounded-xl px-4 text-sm font-bold uppercase tracking-widest border border-outline-variant/30 focus:border-primary focus:outline-none"
              />
              <button 
                onClick={handleApply}
                disabled={applying || inputCode.length < 5}
                className="bg-on-surface text-surface px-4 rounded-xl font-black text-xs disabled:opacity-50"
              >
                {applying ? '...' : 'APLICAR'}
              </button>
            </div>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full py-5 border-t border-outline-variant/20 font-black text-xs uppercase tracking-widest active:bg-surface-container-high transition-colors"
        >
          Fechar
        </button>
      </div>
    </div>
  );
};
