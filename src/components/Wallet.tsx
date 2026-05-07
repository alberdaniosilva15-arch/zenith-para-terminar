// =============================================================================
// ZENITH RIDE v3.0 — Wallet.tsx
// Adicionado: carregamento via Multicaixa Express + modal de top-up
// =============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import { toDataURL } from 'qrcode';
import { supabase, edgeFunctionUrl } from '../lib/supabase';
import { rideService } from '../services/rideService';
import { useAuth } from '../contexts/AuthContext';
import type { DbWallet, DbTransaction } from '../types';
import { UserRole } from '../types';
import ZenithPayPartners from './MotoGoPayPartners';
import { useAppStore } from '../store/useAppStore';

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
  const { role, profile } = useAuth();
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
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount,    setWithdrawAmount]    = useState('');
  const [withdrawError,     setWithdrawError]     = useState('');
  const [withdrawLoading,   setWithdrawLoading]   = useState(false);

  // Toast System
  const showToast = useAppStore(s => s.showToast);

  // v3.0: tabs da carteira
  const [walletTab, setWalletTab] = useState<'transactions' | 'partners' | 'advance'>('transactions');
  const [showZenithPay, setShowZenithPay] = useState(false);
  const [zenithPayToken, setZenithPayToken] = useState<string | null>(null);
  const [zenithPayCopied, setZenithPayCopied] = useState(false);
  const [zenithPayQrDataUrl, setZenithPayQrDataUrl] = useState<string | null>(null);
  const [zenithPayQrError, setZenithPayQrError] = useState(false);

  const zenithPayUri = zenithPayToken ? `zenithpay://session/${zenithPayToken}` : '';

  const openZenithPay = () => {
    const tempToken = globalThis.crypto?.randomUUID?.()
      ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setZenithPayToken(tempToken);
    setZenithPayCopied(false);
    setZenithPayQrDataUrl(null);
    setZenithPayQrError(false);
    setShowZenithPay(true);
  };

  const closeZenithPay = () => {
    setShowZenithPay(false);
    setZenithPayToken(null);
    setZenithPayCopied(false);
    setZenithPayQrDataUrl(null);
    setZenithPayQrError(false);
  };

  const copyZenithPayCode = async () => {
    if (!zenithPayUri) return;
    try {
      await navigator.clipboard.writeText(zenithPayUri);
      setZenithPayCopied(true);
    } catch (err) {
      console.warn('[Wallet] clipboard:', err);
      setZenithPayCopied(false);
    }
  };

  useEffect(() => {
    if (!showZenithPay) return;

    let cancelled = false;

    toDataURL(zenithPayUri || 'zenithpay://session/pending', {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 200,
      color: {
        dark: '#111111',
        light: '#FFFFFF',
      },
    })
      .then((dataUrl: string) => {
        if (cancelled) return;
        setZenithPayQrDataUrl(dataUrl);
        setZenithPayQrError(false);
      })
      .catch((error: unknown) => {
        console.warn('[Wallet] Falha ao gerar QR local:', error);
        if (cancelled) return;
        setZenithPayQrDataUrl(null);
        setZenithPayQrError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [showZenithPay, zenithPayUri]);

  // ------------------------------------------------------------------
  const loadData = useCallback(async (pageNum = 0) => {
    if (pageNum === 0) setLoading(true); else setLoadingMore(true);
    const from = pageNum * PAGE_SIZE;

    try {
      const [walletRes, txRes] = await Promise.all([
        pageNum === 0 ? supabase.from('wallets').select('*').eq('user_id', userId).single() : Promise.resolve({ data: null, error: null }),
        supabase.from('transactions').select('*').eq('user_id', userId)
          .order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1),
      ]);

      if (walletRes.data) setWallet(walletRes.data as DbWallet);
      if (txRes.data) {
        setTransactions(prev => pageNum === 0 ? txRes.data as DbTransaction[] : [...prev, ...txRes.data as DbTransaction[]]);
        setHasMore(txRes.data.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error('[Wallet.loadData] Erro ao carregar dados:', err);
    } finally {
      if (pageNum === 0) setLoading(false); else setLoadingMore(false);
    }
  }, [userId]);

  useEffect(() => { loadData(0); }, [loadData]);
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

  const handleWithdrawClick   = () => { setWithdrawAmount(''); setWithdrawError(''); setShowWithdrawModal(true); };
  
  const handleWithdrawConfirm = async () => {
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount < 500)    { setWithdrawError('Montante mínimo: 500 Kz'); return; }
    if (amount > 500000)                              { setWithdrawError('Montante máximo: 500.000 Kz'); return; }
    if (wallet && amount > wallet.balance)            { setWithdrawError('Saldo insuficiente.'); return; }
    
    setWithdrawLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Sessão expirada. Faz login novamente.');
      }

      const res = await fetch(edgeFunctionUrl('multicaixa-pay'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'withdrawal', amount_kz: amount }),
      });

      if (!res.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        throw new Error('Resposta inválida do servidor.');
      }

      const data = await res.json().catch(() => null) as { success?: boolean; message?: string } | null;
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? 'Falha no processamento.');
      }
      
      setShowWithdrawModal(false);
      loadData(0);
      showToast(data.message ?? 'Levantamento submetido.', 'success');
    } catch (err: any) {
      setWithdrawError(err?.message ?? 'Erro ao processar. Tenta de novo.');
    } finally {
      setWithdrawLoading(false);
    }
  };

  if (loading) return (
    <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="zr-loading-dots"><span></span><span></span><span></span></div>
    </div>
  );

  const balance = wallet?.balance ?? 0;

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">{isDriver ? 'Motorista' : 'Passageiro'}</p>
            <h2 className="zr-section-title" style={{ fontSize: '18px' }}>Carteira</h2>
          </div>
          <button onClick={openZenithPay} className="zr-button zr-button--sm">
            <span className="material-symbols-outlined" style={{ fontSize: '16px', marginRight: '4px' }}>qr_code_scanner</span>
            ZenithPay
          </button>
        </div>
      </header>

      <div style={{ padding: '14px' }}>
        {/* Card de saldo */}
        <section className={`zr-card ${isDriver ? 'zr-card--danger' : 'zr-card--hero'}`} style={{ marginBottom: '24px', position: 'relative', overflow: 'hidden' }}>
          <p className="zr-kicker" style={{ color: isDriver ? 'var(--danger-soft)' : 'var(--gold-soft)' }}>
            {isDriver ? 'Lucro Líquido' : 'Saldo Zenith'}
          </p>
          <h2 className="zr-balance" style={{ fontSize: '48px', marginBottom: '8px' }}>
            {balance.toLocaleString('pt-AO', { minimumFractionDigits: 2 })}
            <span style={{ fontSize: '16px', opacity: 0.4 }}> Kz</span>
          </h2>
          <p className="zr-meta" style={{ marginBottom: '24px' }}>
            {wallet ? new Date(wallet.updated_at).toLocaleString('pt-AO') : '—'}
          </p>
          <div className="zr-inline" style={{ gap: '12px' }}>
            <button
              onClick={isDriver ? handleWithdrawClick : () => setShowTopUp(true)}
              disabled={withdrawLoading || topUpLoading}
              className={`zr-button ${isDriver ? 'zr-button--secondary' : ''}`}
              style={{ flex: 1 }}
            >
              {withdrawLoading ? 'A processar...' : isDriver ? 'LEVANTAR' : 'CARREGAR'}
            </button>
            <button onClick={() => loadData(0)} className="zr-button zr-button--ghost" style={{ flex: 1 }}>
              ACTUALIZAR
            </button>
          </div>
        </section>

        {/* Modal Multicaixa top-up */}
        {showTopUp && (
          <div className="zr-modal is-open">
            <div className="zr-modal-card animate-in fade-in zoom-in-95" style={{ animationDuration: '200ms' }}>
              <div className="zr-modal-head">
                <div>
                  <h3 className="zr-section-title" style={{ fontSize: '18px' }}>Carregar via Multicaixa</h3>
                  <p className="zr-meta">Pagamento móvel Angola</p>
                </div>
                <button onClick={() => { setShowTopUp(false); setTopUpMsg(null); }} className="zr-icon-button" style={{ background: 'var(--surface-3)', border: 'none', color: 'var(--text)', width: '32px', height: '32px', borderRadius: '50%' }}>✕</button>
              </div>

              <div style={{ padding: '20px' }}>
                {topUpMsg && (
                  <div className={`zr-alert-box ${topUpMsg.ok ? 'zr-alert-box--success' : 'zr-alert-box--danger'}`} style={{ marginBottom: '16px' }}>
                    <div className="zr-alert-content">{topUpMsg.text}</div>
                  </div>
                )}

                <div className="zr-stack" style={{ gap: '16px', marginBottom: '24px' }}>
                  <div>
                    <label className="zr-label">Valor (Kz)</label>
                    <input 
                      type="number" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)}
                      placeholder="ex: 5000" min={500} max={500000}
                      className="zr-input" 
                    />
                    <p className="zr-meta" style={{ marginTop: '4px' }}>Min: 500 Kz | Max: 500.000 Kz</p>
                  </div>

                  <div>
                    <label className="zr-label">Nº Multicaixa Express</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="tel" value="+244" disabled className="zr-input" style={{ width: '70px', backgroundColor: 'var(--surface-3)', opacity: 0.7 }} />
                      <input 
                        type="tel" value={topUpPhone} onChange={(e) => setTopUpPhone(e.target.value.replace(/\D/g,''))}
                        placeholder="923 456 789" maxLength={9}
                        className="zr-input" style={{ flex: 1 }}
                      />
                    </div>
                  </div>

                  {/* Valores rápidos */}
                  <div className="zr-inline" style={{ gap: '8px' }}>
                    {[1000, 2500, 5000, 10000].map(v => (
                      <button key={v} onClick={() => setTopUpAmount(String(v))}
                        className={`zr-chip ${topUpAmount === String(v) ? 'zr-chip--gold' : ''}`} style={{ flex: 1, justifyContent: 'center' }}>
                        {v >= 1000 ? `${v/1000}k` : v}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={handleTopUp} disabled={topUpLoading} className="zr-button zr-button--block">
                  {topUpLoading ? 'A processar...' : 'Confirmar carregamento'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Levantamento */}
        {showWithdrawModal && (
          <div className="zr-modal is-open">
            <div className="zr-modal-card animate-in fade-in zoom-in-95" style={{ animationDuration: '200ms' }}>
              <div className="zr-modal-head">
                <div>
                  <h3 className="zr-section-title" style={{ fontSize: '18px' }}>Levantamento</h3>
                  <p className="zr-meta">Transferir para o banco</p>
                </div>
                <button onClick={() => setShowWithdrawModal(false)} className="zr-icon-button" style={{ background: 'var(--surface-3)', border: 'none', color: 'var(--text)', width: '32px', height: '32px', borderRadius: '50%' }}>✕</button>
              </div>

              <div style={{ padding: '20px' }}>
                {withdrawError && (
                  <div className="zr-alert-box zr-alert-box--danger" style={{ marginBottom: '16px' }}>
                    <div className="zr-alert-content">{withdrawError}</div>
                  </div>
                )}

                <div className="zr-stack" style={{ gap: '16px', marginBottom: '24px' }}>
                  <div>
                    <label className="zr-label">Valor a levantar (Kz)</label>
                    <input 
                      type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="ex: 5000" min={500} max={500000}
                      className="zr-input" 
                    />
                    <p className="zr-meta" style={{ marginTop: '4px' }}>Min: 500 Kz | Max: 500.000 Kz | Disponível: {balance.toLocaleString('pt-AO')} Kz</p>
                  </div>
                </div>

                <button onClick={handleWithdrawConfirm} disabled={withdrawLoading} className="zr-button zr-button--block">
                  {withdrawLoading ? 'A processar...' : 'Confirmar levantamento'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal ZenithPay NFC/QR */}
        {showZenithPay && (
          <div className="zr-modal is-open">
            <div className="zr-modal-card animate-in fade-in zoom-in-95" style={{ animationDuration: '200ms' }}>
              <div className="zr-modal-head">
                <div>
                  <h3 className="zr-section-title" style={{ fontSize: '18px' }}>ZenithPay QR</h3>
                  <p className="zr-meta">Pagamento Aproximado</p>
                </div>
                <button onClick={closeZenithPay} className="zr-icon-button" style={{ background: 'var(--surface-3)', border: 'none', color: 'var(--text)', width: '32px', height: '32px', borderRadius: '50%' }}>✕</button>
              </div>

              <div style={{ padding: '20px' }}>
                <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '16px', width: '200px', height: '200px', margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {zenithPayQrDataUrl ? (
                    <img src={zenithPayQrDataUrl} alt="ZenithPay QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div className="zr-loading-dots"><span style={{ backgroundColor: '#000' }}></span><span style={{ backgroundColor: '#000' }}></span><span style={{ backgroundColor: '#000' }}></span></div>
                  )}
                </div>

                <div className="zr-card" style={{ marginBottom: '24px', textAlign: 'center', backgroundColor: 'var(--surface-3)' }}>
                  <p className="zr-meta" style={{ marginBottom: '8px' }}>Sessão temporária</p>
                  <p className="zr-copy" style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '12px', marginBottom: '16px' }}>
                    {zenithPayToken ?? 'a preparar...'}
                  </p>
                  <button onClick={copyZenithPayCode} className="zr-button zr-button--secondary zr-button--block">
                    {zenithPayCopied ? 'Código copiado' : 'Copiar código temporário'}
                  </button>
                </div>

                <p className="zr-meta" style={{ textAlign: 'center', marginBottom: '16px' }}>
                  Aproxima o telemóvel do dispositivo do motorista ou permite que ele leia este QR Code para pagar a corrida automaticamente sem Internet.
                </p>

                <div className="zr-inline" style={{ justifyContent: 'center' }}>
                  <span className="zr-chip zr-chip--success">NFC & QR Activos</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs da carteira */}
        <div className="zr-scroll-x" style={{ marginBottom: '24px' }}>
          {(['transactions', 'partners', 'advance'] as const).map(tab => (
            <button key={tab} onClick={() => setWalletTab(tab as any)}
              className={`zr-tab ${walletTab === tab ? 'is-active' : ''}`}>
              {tab === 'transactions' ? 'Movimentos' : tab === 'partners' ? 'Parceiros' : 'Adiantamento'}
            </button>
          ))}
        </div>

        {/* Cash Advance */}
        {walletTab === 'advance' && (
          <div className="animate-in fade-in" style={{ animationDuration: '200ms' }}>
            <section className="zr-card zr-card--soft">
              <h2 className="zr-section-title">Zenith Cash Advance</h2>
              <p className="zr-copy" style={{ marginBottom: '24px' }}>
                Disponível apenas para motoristas nível <strong style={{ color: 'var(--gold)' }}>Diamante</strong>. 
                Pede até 20.000 Kz de adiantamento descontado automaticamente das tuas próximas corridas (taxa 0%).
              </p>

              {role !== UserRole.DRIVER ? (
                <div className="zr-alert-box zr-alert-box--warning">
                  <div className="zr-alert-content">Apenas para Motoristas.</div>
                </div>
              ) : profile?.level !== 'Diamante' ? (
                <div className="zr-alert-box zr-alert-box--warning">
                  <div className="zr-alert-content">Requer nível Diamante. Toca em "Perfil" para veres o teu nível actual.</div>
                </div>
              ) : (balance < 0) ? (
                <div className="zr-alert-box zr-alert-box--warning">
                  <div className="zr-alert-content">Regulariza o teu saldo negativo antes de pedires um novo adiantamento.</div>
                </div>
              ) : (
                <button 
                  onClick={() => showToast("Funcionalidade em testes! O teu pedido será processado rapidamente pela equipa Zenith.", "info")} 
                  className="zr-button zr-button--block"
                >
                  SOLICITAR 20.000 KZ
                </button>
              )}
            </section>
          </div>
        )}

        {/* Histórico */}
        {walletTab === 'transactions' && (
          <div className="animate-in fade-in" style={{ animationDuration: '200ms' }}>
            <div className="zr-inline zr-inline--between" style={{ marginBottom: '16px' }}>
              <h4 className="zr-kicker">Movimentos recentes</h4>
              <span className="zr-meta">{transactions.length} registos</span>
            </div>

            {transactions.length === 0 ? (
              <div className="zr-empty">
                <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)', marginBottom: '16px' }}>account_balance_wallet</span>
                <p className="zr-copy">Ainda sem movimentos</p>
              </div>
            ) : (
              <div className="zr-list" style={{ marginBottom: '16px' }}>
                {transactions.map(tx => <TxItem key={tx.id} tx={tx} />)}
              </div>
            )}

            {hasMore && (
              <button onClick={() => { const n = page + 1; setPage(n); loadData(n); }} disabled={loadingMore}
                className="zr-button zr-button--secondary zr-button--block">
                {loadingMore ? 'A carregar...' : 'Ver Mais'}
              </button>
            )}
          </div>
        )}

        {walletTab === 'partners' && (
          <div className="animate-in fade-in" style={{ animationDuration: '200ms' }}>
            <ZenithPayPartners userId={userId} walletBalance={wallet?.balance ?? 0} />
          </div>
        )}
      </div>

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
    <div className="zr-list-item">
      <div>
        <strong style={{ display: 'block' }}>{tx.description ?? TX_LABELS[tx.type] ?? tx.type}</strong>
        <span className="zr-copy">{dateStr}</span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <strong style={{ display: 'block', color: isPos ? 'var(--success)' : 'inherit' }}>
          {isPos ? '+' : ''}{tx.amount.toLocaleString('pt-AO', { minimumFractionDigits: 2 })} Kz
        </strong>
        <span className="zr-copy">
          Saldo {tx.balance_after.toLocaleString('pt-AO', { maximumFractionDigits: 0 })}
        </span>
      </div>
    </div>
  );
};

export default Wallet;
