import sys

with open('src/components/Wallet.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace loading
code = code.replace('''  if (loading) return (
    <div className="p-4 flex justify-center items-center min-h-[60vh]">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );''', '''  if (loading) return (
    <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="zr-loading-dots"><span></span><span></span><span></span></div>
    </div>
  );''')

# Replace top layout
code = code.replace('''  return (
    <div className="p-4 space-y-6 pb-28">
      {/* Card de saldo */}
      <div className={`text-white p-8 rounded-[3rem] shadow-2xl relative overflow-hidden ${isDriver ? 'bg-[#0A0A0A]' : 'bg-surface-container-highest'}`}>
        <div className={`absolute -right-10 -top-10 w-48 h-48 opacity-20 rounded-full blur-[80px] ${isDriver ? 'bg-red-600' : 'bg-primary'}`} />
        <div className="flex justify-between items-start mb-3">
          <p className={`text-[9px] font-black uppercase tracking-[0.2em] ${isDriver ? 'text-error' : 'text-primary'}`}>
            {isDriver ? 'LUCRO LÍQUIDO' : 'SALDO ZENITH'}
          </p>
          <button 
            onClick={openZenithPay}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 transition-all rounded-full px-3 py-1.5"
          >
            <span className="text-xs">📱</span>
            <span className="text-[9px] font-black uppercase tracking-widest text-white">ZenithPay</span>
          </button>
        </div>
        <h2 className="text-5xl font-black mb-2 tracking-tighter italic">
          {balance.toLocaleString('pt-AO', { minimumFractionDigits: 2 })}
          <span className="text-lg font-medium opacity-40"> Kz</span>
        </h2>
        <p className="text-[9px] text-white/40 font-bold mb-8">
          {wallet ? new Date(wallet.updated_at).toLocaleString('pt-AO') : '—'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={isDriver ? handleWithdrawClick : () => setShowTopUp(true)}
            disabled={withdrawLoading || topUpLoading}
            className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-60 ${isDriver ? 'bg-red-600 hover:bg-error-container/200' : 'bg-primary hover:bg-primary'}`}
          >
            {withdrawLoading ? 'A processar...' : isDriver ? 'LEVANTAR' : 'CARREGAR'}
          </button>
          <button onClick={() => loadData(0)}
            className="flex-1 bg-surface-container-low/10 hover:bg-surface-container-low/20 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-white/5 transition-all">
            ACTUALIZAR
          </button>
        </div>
      </div>''', '''  return (
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
        </section>''')

# Replace Multicaixa Modal
code = code.replace('''      {/* Modal Multicaixa top-up */}
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
      )}''', '''        {/* Modal Multicaixa top-up */}
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
        )}''')

# Replace ZenithPay Modal
code = code.replace('''      {/* Modal ZenithPay NFC/QR */}
      {showZenithPay && (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-surface-container-low w-full max-w-sm rounded-[2rem] p-8 border border-outline-variant/20 shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-black text-on-surface">ZenithPay <span className="text-primary">QR</span></h3>
                <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant/70">Pagamento Aproximado</p>
              </div>
              <button 
                onClick={closeZenithPay}
                className="w-10 h-10 bg-surface-container rounded-full flex items-center justify-center font-black active:scale-90 transition-all"
              >
                ✕
              </button>
            </div>
            
            <div className="bg-white p-4 rounded-3xl mx-auto w-48 h-48 flex items-center justify-center mb-6">
              {zenithPayQrDataUrl ? (
                <img
                  src={zenithPayQrDataUrl}
                  alt="ZenithPay QR"
                  className="w-full h-full object-cover rounded-xl"
                />
              ) : (
                <div className="w-full h-full rounded-xl border border-black/10 flex flex-col items-center justify-center text-center px-4">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-black/60">
                    {zenithPayQrError ? 'QR indisponivel' : 'A gerar QR local'}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-surface-container rounded-2xl border border-outline-variant/20 p-4 mb-6">
              <p className="text-[9px] font-black uppercase tracking-widest text-on-surface-variant/70 mb-2">
                Sessao temporaria
              </p>
              <p className="text-[11px] font-mono break-all text-on-surface mb-3">
                {zenithPayToken ?? 'a preparar...'}
              </p>
              <button
                onClick={copyZenithPayCode}
                className="w-full py-3 rounded-2xl bg-surface-container-highest text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
              >
                {zenithPayCopied ? 'Codigo copiado' : 'Copiar codigo temporario'}
              </button>
            </div>
            
            <p className="text-center text-xs font-bold text-on-surface-variant mb-6 leading-relaxed">
              Aproxima o telemóvel do dispositivo do motorista ou permite que ele leia este QR Code para pagar a corrida automaticamente sem Internet.
            </p>
            
            <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-primary/70">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              NFC & QR Activos
            </div>
          </div>
        </div>
      )}''', '''        {/* Modal ZenithPay NFC/QR */}
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
        )}''')

# Replace Tabs and history
code = code.replace('''      {/* v3.0: Tabs da carteira */}
      <div className="flex gap-2">
        {(['transactions', 'partners', 'advance'] as const).map(tab => (
          <button key={tab} onClick={() => setWalletTab(tab as any)}
            className={`flex-1 py-3 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${
              walletTab === tab ? 'bg-surface-container-highest text-white shadow-lg' : 'bg-surface-container-low text-outline'
            }`}>
            {tab === 'transactions' ? '📋 Movimentos' : tab === 'partners' ? '🤝 Parceiros' : '💸 Adiantamento'}
          </button>
        ))}
      </div>

      {/* Cash Advance */}
      {walletTab === 'advance' && (
        <div className="space-y-4 animate-in slide-in-from-right duration-300">
          <div className="bg-surface-container-low p-6 rounded-[2rem] border border-outline-variant/20">
            <h3 className="text-sm font-black text-on-surface mb-2">Zenith Cash Advance</h3>
            <p className="text-xs font-bold text-on-surface-variant/70 mb-6 leading-relaxed">
              Disponível apenas para motoristas nível <strong className="text-primary">Diamante</strong>. 
              Pede até 20.000 Kz de adiantamento descontado automaticamente das tuas próximas corridas (taxa 0%).
            </p>

            {role !== UserRole.DRIVER ? (
              <p className="text-[10px] font-black uppercase text-error text-center p-4 bg-error-container/10 rounded-2xl">
                Apenas para Motoristas.
              </p>
            ) : profile?.level !== 'Diamante' ? (
              <p className="text-[10px] font-black uppercase text-error text-center p-4 bg-error-container/10 rounded-2xl">
                Requer nível Diamante. Toca em "Perfil" para veres o teu nível actual.
              </p>
            ) : (balance < 0) ? (
              <p className="text-[10px] font-black uppercase text-error text-center p-4 bg-error-container/10 rounded-2xl">
                Regulariza o teu saldo negativo antes de pedires um novo adiantamento.
              </p>
            ) : (
             <button 
                onClick={() => alert("Funcionalidade em testes! O teu pedido será processado rapidamente pela equipa Zenith.")} 
                className="w-full py-4 text-[10px] font-black uppercase tracking-widest bg-primary text-white rounded-2xl shadow-sm"
              >
                SOLICITAR 20.000 KZ
              </button>
            )}
          </div>
        </div>
      )}

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
        <ZenithPayPartners userId={userId} walletBalance={wallet?.balance ?? 0} />
      )}
    </div>
  );
};''', '''        {/* Tabs da carteira */}
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
                  onClick={() => alert("Funcionalidade em testes! O teu pedido será processado rapidamente pela equipa Zenith.")} 
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
};''')

# Replace TxItem
code = code.replace('''const TxItem: React.FC<{ tx: DbTransaction }> = ({ tx }) => {
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
};''', '''const TxItem: React.FC<{ tx: DbTransaction }> = ({ tx }) => {
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
};''')

with open('c:/Users/Ariane Marcelino/Videos/nunca mexer/zenith-ride-final-v3/zenith-ride-build/src/components/Wallet.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Replacement done")
