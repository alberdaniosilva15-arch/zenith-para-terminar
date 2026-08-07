// =============================================================================
// ZENITH RIDE v3.0 — DriverRecharge.tsx
// Modal de recarga de crédito operacional do motorista
// =============================================================================

import React, { useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

interface DriverRechargeProps {
  onClose: () => void;
  onSuccess: () => void;
}

const PACKAGES = [
  { id: 'basico', amount: 10000, credit: 45000, label: 'Básico', desc: 'Lucro até ~45.000 Kz', color: 'border-primary/30 hover:border-primary/60' },
  { id: 'standard', amount: 20000, credit: 90000, label: 'Standard', desc: 'Lucro até ~90.000 Kz', color: 'border-primary/50 hover:border-primary/80' },
  { id: 'premium', amount: 50000, credit: 225000, label: 'Premium', desc: 'Lucro até ~225.000 Kz', color: 'border-yellow-500/50 hover:border-yellow-500/80' },
];

export default function DriverRecharge({ onClose, onSuccess }: DriverRechargeProps) {
  const [step, setStep] = useState<'select' | 'confirm' | 'code' | 'loading' | 'error'>('select');
  const [selectedPkg, setSelectedPkg] = useState<typeof PACKAGES[number] | null>(null);
  const [rechargeCode, setRechargeCode] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSelect = useCallback((pkg: typeof PACKAGES[number]) => {
    setSelectedPkg(pkg);
    setAmountPaid(pkg.amount.toLocaleString('pt-AO'));
    setStep('confirm');
  }, []);

  const handleCreateRecharge = useCallback(async () => {
    if (!selectedPkg) return;
    setStep('loading');
    setErrorMsg('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-proxy`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action: 'create_driver_recharge',
            amount_paid: selectedPkg.amount,
          }),
        }
      );

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro ao criar recarga');

      setRechargeCode(data.uuid_code);
      setStep('code');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      setErrorMsg(message);
      setStep('error');
    }
  }, [selectedPkg]);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rechargeCode);
    } catch {
      // Fallback: select text
    }
  }, [rechargeCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0A0A0A] border border-primary/20 rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="font-black text-white text-sm uppercase tracking-widest">
            {step === 'select' && 'Recarregar Crédito'}
            {step === 'confirm' && 'Confirmar Recarga'}
            {step === 'code' && 'Código de Recarga'}
            {step === 'loading' && 'A processar...'}
            {step === 'error' && 'Erro'}
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {step === 'select' && (
            <div className="space-y-3">
              <p className="text-white/50 text-xs mb-4">
                Escolhe o pacote de crédito operacional. O valor pago dá-te direito a faturar até o limite indicado.
              </p>
              {PACKAGES.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => handleSelect(pkg)}
                  className={`w-full p-4 rounded-xl border ${pkg.color} bg-white/5 text-left transition-all hover:bg-white/10`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-black text-sm">{pkg.label}</p>
                      <p className="text-white/40 text-xs mt-1">{pkg.desc}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-primary font-black text-lg">{pkg.amount.toLocaleString('pt-AO')} Kz</p>
                      <p className="text-white/30 text-xs">limite: {pkg.credit.toLocaleString('pt-AO')} Kz</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'confirm' && selectedPkg && (
            <div className="space-y-4">
              <div className="bg-white/5 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white/50 text-xs">Pacote</span>
                  <span className="text-white font-bold text-sm">{selectedPkg.label}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white/50 text-xs">Valor a pagar</span>
                  <span className="text-primary font-black text-lg">{selectedPkg.amount.toLocaleString('pt-AO')} Kz</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/50 text-xs">Crédito desbloqueado</span>
                  <span className="text-green-400 font-black text-lg">{selectedPkg.credit.toLocaleString('pt-AO')} Kz</span>
                </div>
              </div>

              <p className="text-white/30 text-xs text-center">
                Após pagamento, o código será activado e o crédito creditado na tua conta.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('select')}
                  className="flex-1 py-3 bg-white/5 text-white/60 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-colors"
                >
                  Voltar
                </button>
                <button
                  onClick={() => void handleCreateRecharge()}
                  className="flex-1 py-3 bg-primary text-black rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-colors"
                >
                  Gerar Código
                </button>
              </div>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-center">
                <span className="material-symbols-outlined text-green-400 text-3xl mb-2">check_circle</span>
                <p className="text-green-400 font-bold text-sm">Código gerado com sucesso!</p>
              </div>

              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-white/50 text-xs mb-2">Código UUID (partilhe com o agente):</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-primary font-mono text-xs break-all bg-black/50 p-3 rounded-lg border border-primary/20">
                    {rechargeCode}
                  </code>
                  <button
                    onClick={() => void handleCopyCode()}
                    className="p-2 bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
                  >
                    <span className="material-symbols-outlined text-primary text-lg">content_copy</span>
                  </button>
                </div>
              </div>

              <p className="text-white/30 text-xs text-center">
                Este código é único e temporário. Partilhe com o agente para confirmação de pagamento.
              </p>

              <button
                onClick={onSuccess}
                className="w-full py-3 bg-primary text-black rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-colors"
              >
                Concluir
              </button>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-white/60 text-sm">A gerar código de recarga...</p>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
                <span className="material-symbols-outlined text-red-400 text-3xl mb-2">error</span>
                <p className="text-red-400 font-bold text-sm">{errorMsg}</p>
              </div>
              <button
                onClick={() => setStep('select')}
                className="w-full py-3 bg-white/5 text-white/60 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                Tentar de Novo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
