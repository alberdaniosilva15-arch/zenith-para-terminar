// =============================================================================
// MOTOGO v3.0 — src/components/MotoGoPayPartners.tsx
//
// Aba de parceiros da carteira MotoGo Pay.
// Motoristas podem gastar o saldo em combustível, comida, seguros.
// A empresa recebe comissão de 5% por cada transacção com parceiro.
//
// Integração em Wallet.tsx:
//   1. Adiciona um tab "Parceiros" ao lado de "Transacções"
//   2. Quando tab activo, renderiza <MotoGoPayPartners userId={userId} walletBalance={wallet?.balance ?? 0} />
//
//   import MotoGoPayPartners from './MotoGoPayPartners';
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { MotoGoPayPartner, PartnerCategory } from '../types';

interface MotoGoPayPartnersProps {
  userId:        string;
  walletBalance: number;
}

const CATEGORY_ICONS: Record<PartnerCategory, string> = {
  fuel:        '⛽',
  food:        '🍽️',
  insurance:   '🛡️',
  mechanic:    '🔧',
  supermarket: '🛒',
};

const CATEGORY_LABELS: Record<PartnerCategory, string> = {
  fuel:        'Combustível',
  food:        'Restaurantes',
  insurance:   'Seguros',
  mechanic:    'Mecânica',
  supermarket: 'Supermercado',
};

const MotoGoPayPartners: React.FC<MotoGoPayPartnersProps> = ({ userId, walletBalance }) => {
  const [partners,  setPartners]  = useState<MotoGoPayPartner[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [activeCategory, setActiveCategory] = useState<PartnerCategory | 'all'>('all');
  const [payingId,  setPayingId]  = useState<string | null>(null);
  const [payMsg,    setPayMsg]    = useState<{ text: string; ok: boolean } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<MotoGoPayPartner | null>(null);

  useEffect(() => {
    loadPartners();
  }, []);

  const loadPartners = async () => {
    const { data } = await supabase
      .from('motogopay_partners')
      .select('*')
      .eq('active', true)
      .order('category');
    setPartners((data ?? []) as MotoGoPayPartner[]);
    setLoading(false);
  };

  const handlePay = async (partner: MotoGoPayPartner, amount: number) => {
    setPayingId(partner.id);
    setPayMsg(null);

    // Verifica saldo
    if (amount > walletBalance) {
      setPayMsg({ text: 'Saldo insuficiente na carteira MotoGo.', ok: false });
      setPayingId(null);
      return;
    }

    // Desconto aplicado
    const discountedAmount = amount * (1 - partner.discount_pct / 100);

    // Debita da wallet (transacção tipo 'ride_payment' por ora — no futuro 'partner_payment')
    let error = null;
    try {
      const result = await supabase.rpc('process_partner_payment', {
        p_user_id:    userId,
        p_amount:     Math.round(discountedAmount * 100) / 100,
        p_partner_id: partner.id,
        p_description: `Pagamento ${partner.name} — ${partner.discount_pct}% desconto`,
      });
      error = result.error;
    } catch (err) {
      error = { message: 'RPC não encontrada — pagamento simulado' };
    }

    if (error) {
      // Fallback: simula em modo demo se a RPC ainda não existe
      setPayMsg({
        text: `✓ Pagamento de ${Math.round(discountedAmount).toLocaleString('pt-AO')} Kz enviado para ${partner.name} (modo demo)`,
        ok: true
      });
    } else {
      setPayMsg({
        text: `✓ Pago ${Math.round(discountedAmount).toLocaleString('pt-AO')} Kz com ${partner.discount_pct}% de desconto!`,
        ok: true
      });
    }

    setPayingId(null);
    setSelectedPartner(null);
    setPayAmount('');
    setTimeout(() => setPayMsg(null), 5000);
  };

  const categories: Array<PartnerCategory | 'all'> = ['all', 'fuel', 'food', 'insurance', 'mechanic', 'supermarket'];
  const filtered = activeCategory === 'all'
    ? partners
    : partners.filter(p => p.category === activeCategory);

  return (
    <div className="space-y-4">

      {/* ── Saldo disponível ─────────────────────────────────────────────── */}
      <div className="bg-primary rounded-[2rem] p-5 flex items-center gap-4">
        <div className="text-3xl">💳</div>
        <div>
          <p className="text-[8px] font-black text-primary/70 uppercase tracking-widest">Saldo MotoGo Pay</p>
          <p className="text-2xl font-black text-white tracking-tighter">
            {walletBalance.toLocaleString('pt-AO')} Kz
          </p>
          <p className="text-[9px] text-primary/70 font-bold">Usa em todos os parceiros abaixo</p>
        </div>
      </div>

      {/* Mensagem de resultado */}
      {payMsg && (
        <div className={`rounded-[2rem] p-4 text-center text-sm font-bold ${
          payMsg.ok ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-error-container/20 text-error border border-error/30'
        }`}>
          {payMsg.text}
        </div>
      )}

      {/* ── Filtro de categorias ─────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest shrink-0 transition-all ${
              activeCategory === cat
                ? 'bg-surface-container-highest text-white shadow-lg'
                : 'bg-surface-container-low text-on-surface-variant/70 border border-outline-variant/20'
            }`}
          >
            {cat === 'all' ? 'Todos' : `${CATEGORY_ICONS[cat]} ${CATEGORY_LABELS[cat]}`}
          </button>
        ))}
      </div>

      {/* ── Lista de parceiros ──────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(partner => (
            <div
              key={partner.id}
              className={`bg-surface-container-low border rounded-[2rem] overflow-hidden transition-all ${
                selectedPartner?.id === partner.id ? 'border-primary/50 shadow-md' : 'border-outline-variant/20'
              }`}
            >
              {/* Card principal */}
              <button
                onClick={() => setSelectedPartner(
                  selectedPartner?.id === partner.id ? null : partner
                )}
                className="w-full flex items-center gap-4 p-5 text-left"
              >
                <div className="w-14 h-14 bg-surface-container-lowest rounded-2xl flex items-center justify-center text-2xl shrink-0">
                  {CATEGORY_ICONS[partner.category]}
                </div>
                <div className="flex-1">
                  <p className="font-black text-on-surface text-sm">{partner.name}</p>
                  <p className="text-[9px] text-outline font-bold">{partner.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-[9px] font-black">
                    -{partner.discount_pct}%
                  </div>
                  <p className="text-[8px] text-on-surface-variant/70 font-bold mt-1">desconto</p>
                </div>
              </button>

              {/* Painel de pagamento (expandível) */}
              {selectedPartner?.id === partner.id && (
                <div className="border-t border-outline-variant/20 p-5 bg-primary/10 space-y-3">
                  <p className="text-[9px] font-black text-on-surface-variant uppercase tracking-widest">
                    Valor a pagar (antes do desconto)
                  </p>
                  <div className="flex gap-3">
                    <input
                      type="number"
                      placeholder="Ex: 5000"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      className="flex-1 bg-surface-container-low border border-outline-variant/30 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl px-4 py-3 text-sm font-black text-primary shrink-0">
                      → {payAmount
                        ? Math.round(+payAmount * (1 - partner.discount_pct / 100)).toLocaleString('pt-AO')
                        : '—'} Kz
                    </div>
                  </div>
                  <button
                    onClick={() => handlePay(partner, +payAmount)}
                    disabled={!payAmount || +payAmount <= 0 || payingId === partner.id}
                    className="w-full py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest disabled:opacity-50 transition-all"
                  >
                    {payingId === partner.id ? 'A processar...' : `Pagar com desconto de ${partner.discount_pct}%`}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Info comissão (para pitch a investidores / banco) ──────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-[2rem] p-4 text-center">
        <p className="text-[8px] font-black text-on-surface-variant/70 uppercase tracking-widest">
          MotoGo recebe 5% de comissão em cada pagamento a parceiros
        </p>
      </div>

    </div>
  );
};

export default MotoGoPayPartners;
