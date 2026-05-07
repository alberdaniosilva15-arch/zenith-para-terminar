import sys

with open('src/components/EscolarMonitor.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace the idle state
code = code.replace('''  if (!session) {
    return (
      <div className="mt-4">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center gap-4 bg-primary/5 border border-primary/15 p-5 rounded-[2rem] text-left hover:bg-primary/10 transition-all"
          >
            <div className="w-12 h-12 bg-primary/20 border border-primary/30 rounded-2xl flex items-center justify-center text-xl text-white shrink-0">
              🛡️
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">Partilhar com pais</p>
              <p className="text-[9px] text-primary/60 font-bold uppercase tracking-widest">
                Gerar link de monitorização
              </p>
            </div>
          </button>
        ) : (
          <div className="bg-surface-container-low border border-outline-variant/20 rounded-[2.5rem] p-5 space-y-4">
            <p className="font-black text-on-surface text-sm">Partilhar rastreamento</p>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Nome dos pais (obrigatório)"
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="tel"
                placeholder="Telefone (opcional)"
                value={parentPhone}
                onChange={e => setParentPhone(e.target.value)}
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 border border-outline-variant/30 rounded-2xl font-black text-xs text-outline uppercase"
              >
                Cancelar
              </button>
              <button
                onClick={createSession}
                disabled={!parentName || creating}
                className="flex-1 py-3 gilded-gradient text-on-primary rounded-2xl font-black text-xs uppercase disabled:opacity-50"
              >
                {creating ? 'A criar...' : 'Gerar link'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }''', '''  if (!session) {
    return (
      <div style={{ marginTop: '16px' }}>
        {!showForm ? (
          <button onClick={() => setShowForm(true)} className="zr-card" style={{ width: '100%', textAlign: 'left', padding: '16px' }}>
            <div className="zr-inline" style={{ gap: '16px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                🛡️
              </div>
              <div>
                <strong style={{ display: 'block' }}>Partilhar com pais</strong>
                <span className="zr-meta" style={{ color: 'var(--gold)' }}>Gerar link de monitorização</span>
              </div>
            </div>
          </button>
        ) : (
          <div className="zr-card">
            <h3 className="zr-section-title" style={{ fontSize: '16px', marginBottom: '16px' }}>Partilhar rastreamento</h3>
            <div className="zr-stack" style={{ gap: '12px' }}>
              <input
                type="text"
                placeholder="Nome dos pais (obrigatório)"
                value={parentName}
                onChange={e => setParentName(e.target.value)}
                className="zr-input"
              />
              <input
                type="tel"
                placeholder="Telefone (opcional)"
                value={parentPhone}
                onChange={e => setParentPhone(e.target.value)}
                className="zr-input"
              />
            </div>
            <div className="zr-inline" style={{ marginTop: '16px', gap: '12px' }}>
              <button onClick={() => setShowForm(false)} className="zr-button zr-button--secondary" style={{ flex: 1 }}>
                Cancelar
              </button>
              <button onClick={createSession} disabled={!parentName || creating} className="zr-button" style={{ flex: 1 }}>
                {creating ? 'A criar...' : 'Gerar link'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }''')

# Replace the active state
code = code.replace('''  // ─── Sessão activa ────────────────────────────────────────────────────────
  return (
    <div className="mt-4 bg-surface-container-lowest rounded-[2.5rem] p-5 space-y-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/50/10 rounded-full blur-[60px]" />

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-primary animate-pulse shrink-0" />
        <div className="flex-1">
          <p className="text-[8px] font-black text-primary uppercase tracking-widest">
            Monitorização activa
          </p>
          <p className="text-white font-black text-sm">
            {session.parent_name} está a acompanhar
          </p>
        </div>
      </div>

      {/* Status da corrida */}
      {activeRide && activeRide.status !== RideStatus.IDLE && (
        <div className="bg-surface-container-low/5 rounded-2xl p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {activeRide.status === RideStatus.IN_PROGRESS ? '🚗' :
               activeRide.status === RideStatus.PICKING_UP ? '📍' :
               activeRide.status === RideStatus.COMPLETED ? '✅' : '⏳'}
            </span>
            <p className="text-[10px] font-bold text-white/70">
              {activeRide.status === RideStatus.PICKING_UP  ? 'Motorista a caminho da escola' :
               activeRide.status === RideStatus.IN_PROGRESS ? `Em rota para ${activeRide.destination?.split(',')[0]}` :
               activeRide.status === RideStatus.COMPLETED   ? 'Corrida concluída ✓' :
               'Corrida em curso'}
            </p>
          </div>
        </div>
      )}

      {/* Link */}
      <div className="bg-surface-container-low/5 rounded-2xl p-3">
        <p className="text-[8px] font-black text-primary/70 uppercase mb-1">Link dos pais</p>
        <p className="text-[9px] text-white/50 font-mono break-all">
          {trackingUrl}
        </p>
      </div>

      {/* Botões de partilha */}
      <div className="flex gap-3">
        <button
          onClick={copyLink}
          className={`flex-1 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest transition-all ${
            linkCopied
              ? 'bg-primary/100 text-white'
              : 'bg-surface-container-low/10 text-white hover:bg-surface-container-low/20'
          }`}
        >
          {linkCopied ? '✓ Copiado!' : 'Copiar link'}
        </button>
        <button
          onClick={shareWhatsApp}
          className="flex-1 py-3 bg-primary text-white rounded-2xl font-black text-[9px] uppercase tracking-widest hover:bg-primary/100 transition-all"
        >
          WhatsApp
        </button>
      </div>

      {/* Expirar */}
      <button
        onClick={expireSession}
        className="w-full text-[8px] text-white/20 font-black uppercase tracking-widest hover:text-white/40 transition-all"
      >
        Desactivar monitorização
      </button>
    </div>
  );''', '''  // ─── Sessão activa ────────────────────────────────────────────────────────
  return (
    <div className="zr-card" style={{ marginTop: '16px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: '120px', height: '120px', background: 'var(--gold)', borderRadius: '50%', filter: 'blur(60px)', opacity: 0.1 }} />

      {/* Header */}
      <div className="zr-inline" style={{ gap: '12px', marginBottom: '16px' }}>
        <div style={{ width: '12px', height: '12px', backgroundColor: 'var(--success)', borderRadius: '50%' }} className="animate-pulse" />
        <div>
          <p className="zr-kicker" style={{ margin: 0, color: 'var(--success)' }}>Monitorização Activa</p>
          <strong style={{ fontSize: '14px' }}>{session.parent_name} está a acompanhar</strong>
        </div>
      </div>

      {/* Status da corrida */}
      {activeRide && activeRide.status !== RideStatus.IDLE && (
        <div className="zr-alert-box zr-alert-box--info" style={{ marginBottom: '16px' }}>
          <div className="zr-inline" style={{ gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>
              {activeRide.status === RideStatus.IN_PROGRESS ? '🚗' :
               activeRide.status === RideStatus.PICKING_UP ? '📍' :
               activeRide.status === RideStatus.COMPLETED ? '✅' : '⏳'}
            </span>
            <p style={{ fontSize: '12px', fontWeight: 'bold' }}>
              {activeRide.status === RideStatus.PICKING_UP  ? 'Motorista a caminho da escola' :
               activeRide.status === RideStatus.IN_PROGRESS ? `Em rota para ${activeRide.destination?.split(',')[0]}` :
               activeRide.status === RideStatus.COMPLETED   ? 'Corrida concluída ✓' :
               'Corrida em curso'}
            </p>
          </div>
        </div>
      )}

      {/* Link */}
      <div style={{ padding: '12px', background: 'var(--surface-3)', borderRadius: '12px', marginBottom: '16px' }}>
        <p className="zr-meta" style={{ marginBottom: '4px' }}>Link dos pais</p>
        <p style={{ fontSize: '10px', wordBreak: 'break-all', fontFamily: 'monospace', opacity: 0.8 }}>{trackingUrl}</p>
      </div>

      {/* Botões de partilha */}
      <div className="zr-inline" style={{ gap: '12px', marginBottom: '16px' }}>
        <button onClick={copyLink} className="zr-button zr-button--secondary" style={{ flex: 1, backgroundColor: linkCopied ? 'var(--gold)' : 'transparent', color: linkCopied ? '#000' : 'inherit' }}>
          {linkCopied ? '✓ Copiado!' : 'Copiar link'}
        </button>
        <button onClick={shareWhatsApp} className="zr-button" style={{ flex: 1, backgroundColor: '#25D366', color: '#fff' }}>
          WhatsApp
        </button>
      </div>

      {/* Expirar */}
      <button onClick={expireSession} className="zr-button zr-button--danger zr-button--block" style={{ backgroundColor: 'transparent', border: '1px dashed var(--danger-soft)' }}>
        Desactivar monitorização
      </button>
    </div>
  );''')

with open('src/components/EscolarMonitor.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("EscolarMonitor replaced")
