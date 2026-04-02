// =============================================================================
// MOTOGO AI v2.1 — Wallet.tsx
// Adicionado: carregamento via Multicaixa Express + modal de top-up
// =============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { rideService } from '../services/rideService';
import { useAuth } from '../contexts/AuthContext';
import type { DbWallet, DbTransaction } from '../types';
import { UserRole } from '../types';
import MotoGoPayPartners from './MotoGoPayPartners';

interface WalletProps { userId: string; }

const PAGE_SIZE = 15;

const TX_LABELS: Record<string, string> = {
  ride_payment: 'Pagamento de corrida', ride_earning: 'Ganho de corrida',
  top_up: 'Carregamento', refund: 'Reembolso', bonus: 'Bónus', withdrawal: 'Levantamento',
};
const TX_ICONS: Record<string, string> = {
  ride_payment: '🏍️', ride_earning: '💰', top_up: '➕',
  refund: '↩️', bonus: '⭐', withdrawal: '🏦',
};

const Wallet: React.FC<WalletProps> = ({ userId }) => {
  const { role } = useAuth();
  const isDriver = role === UserRole.DRIVER;

  const [wallet,       setWallet]       = useState<DbWallet | null>(null);
  const [transactions, setTransactions] = useState<DbTransaction[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [page,         setPage]         = useState(0);
  const [hasMore,      setHasMore]      = useState(true);

  // Modal Multicaixa
  const [showTopUp,    setShowTopUp]    = useState(false);
  const [topUpAmount,  setTopUpAmount]  = useState('');
  const [topUpPhone,   setTopUpPhone]   = useState('');
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpMsg,     setTopUpMsg]     = useState<{ text: string; ok: boolean } | null>(null);

  // Levantamento
  const [withdrawing,  setWithdrawing]  = useState(false);
  // v3.0: tabs da carteira
  const [walletTab, setWalletTab] = useState<'transactions' | 'partners'>('transactions');

  // ------------------------------------------------------------------
  const loadData = useCallback(async (pageNum = 0) => {
    if (pageNum === 0) setLoading(true); else setLoadingMore(true);
    const from = pageNum * PAGE_SIZE;

    const [walletRes, txRes] = await Promise.all([
      pageNum === 0 ? supabase.from('wallets').select('*').eq('user_id', userId).single() : { data: wallet, error: null },
      supabase.from('transactions').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1),
    ]);

    if (walletRes.data) setWallet(walletRes.data as DbWallet);
    if (txRes.data) {
      setTransactions(prev => pageNum === 0 ? txRes.data as DbTransaction[] : [...prev, ...txRes.data as DbTransaction[]]);
      setHasMore(txRes.data.length === PAGE_SIZE);
    }
    if (pageNum === 0) setLoading(false); else setLoadingMore(false);
  }, [userId, wallet]);

  useEffect(() => { loadData(0); }, [userId]);

  // Realtime
  useEffect(() => {
    const ch = supabase.channel(`wallet:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${userId}` },
        (p) => setWallet(p.new as DbWallet))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` },
        (p) => setTransactions(prev => [p.new as DbTransaction, ...prev]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // ------------------------------------------------------------------
  // Multicaixa top-up
  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount < 500) { setTopUpMsg({ text: 'Mínimo: 500 Kz', ok: false }); return; }
    if (!/^9[0-9]{8}$/.test(topUpPhone)) { setTopUpMsg({ text: 'Número inválido. Ex: 923456789', ok: false }); return; }

    setTopUpLoading(true); setTopUpMsg(null);
    const result = await rideService.initiateTopUp(amount, topUpPhone);
    setTopUpLoading(false);
    setTopUpMsg({ text: result.message, ok: result.success });
    if (result.success) { setTopUpAmount(''); setTopUpPhone(''); setTimeout(() => setShowTopUp(false), 3000); }
  };

  const handleWithdraw = async () => {
    if (!wallet || wallet.balance < 1000) {
      alert('Saldo mínimo para levantamento: 1.000 Kz');
      return;
    }
    const amountStr = prompt(`Valor a levantar (saldo: ${wallet.balance.toLocaleString('pt-AO')} Kz):`);
    if (!amountStr) return;
    const amount = parseFloat(amountStr.replace(/\D/g, ''));
    if (!amount || amount < 1000) { alert('Mínimo: 1.000 Kz'); return; }
    if (amount > wallet.balance)  { alert('Saldo insuficiente.'); return; }
    setWithdrawing(true);
    const result = await rideService.initiateTopUp(-amount, ''); // reuse pattern
    // Chamar directamente multicaixa-pay withdrawal
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/multicaixa-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ action: 'withdrawal', user_id: session?.user?.id, amount_kz: amount }),
      });
      const data = await res.json();
      alert(data.message ?? 'Levantamento submetido.');
      if (data.success) loadData(0);
    } catch {
      alert('Erro de rede. Tenta de novo.');
    }
    setWithdrawing(false);
  };

  if (loading) return (
    <div className="p-4 flex justify-center items-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const balance = wallet?.balance ?? 0;

  return (
    <div className="p-4 space-y-6 pb-28">
      {/* Card de saldo */}
      <div className={`text-white p-8 rounded-[3rem] shadow-2xl relative overflow-hidden ${isDriver ? 'bg-[#0A0A0A]' : 'bg-surface-container-highest'}`}>
        <div className={`absolute -right-10 -top-10 w-48 h-48 opacity-20 rounded-full blur-[80px] ${isDriver ? 'bg-red-600' : 'bg-primary'}`} />
        <p className={`text-[9px] font-black uppercase tracking-[0.2em] mb-3 ${isDriver ? 'text-error' : 'text-primary'}`}>
          {isDriver ? 'LUCRO LÍQUIDO' : 'SALDO MOTOGO'}
        </p>
        <h2 className="text-5xl font-black mb-2 tracking-tighter italic">
          {balance.toLocaleString('pt-AO', { minimumFractionDigits: 2 })}
          <span className="text-lg font-medium opacity-40"> Kz</span>
        </h2>
        <p className="text-[9px] text-white/40 font-bold mb-8">
          {wallet ? new Date(wallet.updated_at).toLocaleString('pt-AO') : '—'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={isDriver ? handleWithdraw : () => setShowTopUp(true)}
            disabled={withdrawing}
            className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-60 ${isDriver ? 'bg-red-600 hover:bg-error-container/200' : 'bg-primary hover:bg-primary'}`}
          >
            {withdrawing ? 'A processar...' : isDriver ? 'LEVANTAR' : 'CARREGAR'}
          </button>
          <button onClick={() => loadData(0)}
            className="flex-1 bg-surface-container-low/10 hover:bg-surface-container-low/20 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-white/5 transition-all">
            ACTUALIZAR
          </button>
        </div>
      </div>

      {/* Modal Multicaixa top-up */}
      {showTopUp && (
        <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end p-4">
          <div className="w-full rounded-[2rem] p-6 space-y-5 shadow-2xl animate-in slide-in-from-bottom-10 duration-300" style={{ background: '#141414', border: '1px solid rgba(230,195,100,0.25)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-black text-on-surface text-lg">Carregar via Multicaixa</p>
                <p className="text-[9px] text-on-surface-variant/70 font-bold uppercase tracking-widest">Pagamento móvel Angola</p>
              </div>
              <button onClick={() => { setShowTopUp(false); setTopUpMsg(null); }}
                className="w-10 h-10 bg-surface-container-low rounded-full flex items-center justify-center text-outline font-black">✕</button>
            </div>

            {topUpMsg && (
              <div className={`p-4 rounded-2xl text-sm font-bold text-center ${topUpMsg.ok ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-error-container/20 text-error border border-error/30'}`}>
                {topUpMsg.text}
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest ml-2">Valor (Kz)</label>
                <input type="number" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)}
                  placeholder="ex: 5000" min={500} max={500000}
                  className="w-full bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-2xl outline-none focus:ring-2 focus:ring-primary font-black text-on-surface text-lg" />
                <p className="text-[8px] text-on-surface-variant/70 font-bold ml-2">Min: 500 Kz | Max: 500.000 Kz</p>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest ml-2">Nº Multicaixa Express</label>
                <div className="flex bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden">
                  <span className="px-4 flex items-center text-on-surface-variant/70 font-black text-sm bg-surface-container-low border-r border-outline-variant/20">+244</span>
                  <input type="tel" value={topUpPhone} onChange={(e) => setTopUpPhone(e.target.value.replace(/\D/g,''))}
                    placeholder="923 456 789" maxLength={9}
                    className="flex-1 bg-transparent p-4 outline-none font-black text-on-surface" />
                </div>
              </div>

              {/* Valores rápidos */}
              <div className="flex gap-2">
                {[1000, 2500, 5000, 10000].map(v => (
                  <button key={v} onClick={() => setTopUpAmount(String(v))}
                    className={`flex-1 py-3 rounded-2xl text-[9px] font-black transition-all ${topUpAmount === String(v) ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}`}>
                    {v >= 1000 ? `${v/1000}k` : v} Kz
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleTopUp} disabled={topUpLoading}
              className="w-full py-5 bg-[#0A0A0A] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest disabled:opacity-60 active:scale-95 transition-all">
              {topUpLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  A processar...
                </span>
              ) : 'CONFIRMAR CARREGAMENTO'}
            </button>
          </div>
        </div>
      )}

      {/* v3.0: Tabs da carteira */}
      <div className="flex gap-2">
        {(['transactions', 'partners'] as const).map(tab => (
          <button key={tab} onClick={() => setWalletTab(tab)}
            className={`flex-1 py-3 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${
              walletTab === tab ? 'bg-surface-container-highest text-white shadow-lg' : 'bg-surface-container-low text-outline'
            }`}>
            {tab === 'transactions' ? '📋 Transacções' : '🤝 Parceiros'}
          </button>
        ))}
      </div>

      {/* Histórico */}
      {walletTab === 'transactions' && (
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <h4 className="text-[9px] font-black uppercase text-on-surface-variant/70 tracking-widest">Movimentos</h4>
          <span className="text-[8px] text-on-surface-variant/50 font-bold">{transactions.length} registos</span>
        </div>
        {transactions.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl p-8 text-center">
            <p className="text-2xl mb-2">💳</p>
            <p className="text-xs font-bold text-on-surface-variant/70">Ainda sem movimentos</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map(tx => <TxItem key={tx.id} tx={tx} />)}
          </div>
        )}
        {hasMore && (
          <button onClick={() => { const n = page + 1; setPage(n); loadData(n); }} disabled={loadingMore}
            className="w-full py-4 bg-surface-container-low text-on-surface-variant rounded-3xl font-black text-[10px] uppercase tracking-widest hover:bg-surface-container transition-all disabled:opacity-50">
            {loadingMore ? 'A carregar...' : 'VER MAIS'}
          </button>
        )}
      </div>
      )}

      {walletTab === 'partners' && (
        <MotoGoPayPartners userId={userId} walletBalance={wallet?.balance ?? 0} />
      )}
    </div>
  );
};

const TxItem: React.FC<{ tx: DbTransaction }> = ({ tx }) => {
  const isPos  = tx.amount > 0;
  const date   = new Date(tx.created_at);
  const today  = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const dateStr = isToday
    ? `Hoje, ${date.toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString('pt-AO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="bg-surface-container p-5 rounded-xl flex justify-between items-center border border-outline-variant/10 shadow-sm hover:border-outline-variant/30 transition-all">
      <div className="flex gap-4 items-center">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg ${isPos ? 'bg-primary/10' : 'bg-error-container/20'}`}>
          {TX_ICONS[tx.type] ?? '💳'}
        </div>
        <div>
          <p className="text-[11px] font-black text-on-surface">{tx.description ?? TX_LABELS[tx.type] ?? tx.type}</p>
          <p className="text-[8px] text-on-surface-variant/70 font-bold uppercase mt-0.5">{dateStr}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`font-black text-xs ${isPos ? 'text-primary' : 'text-on-surface'}`}>
          {isPos ? '+' : ''}{tx.amount.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
        </p>
        <p className="text-[8px] text-on-surface-variant/50 font-bold mt-0.5">
          Saldo: {tx.balance_after.toLocaleString('pt-AO', { maximumFractionDigits: 0 })} Kz
        </p>
      </div>
    </div>
  );
};

export default Wallet;
