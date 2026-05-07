import sys

with open('src/components/ZenithScore.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace SCORE_COLORS
code = code.replace('''const SCORE_COLORS: Record<ScoreLabel, { bar: string; badge: string; text: string }> = {
  'Sem Historial': { bar: 'bg-outline-variant',    badge: 'bg-surface-container-low text-on-surface-variant',    text: 'text-on-surface-variant' },
  'Básico':        { bar: 'bg-primary/30',    badge: 'bg-primary/15 text-primary',    text: 'text-primary' },
  'Médio':         { bar: 'bg-primary/60',   badge: 'bg-primary/10 text-on-surface',  text: 'text-on-surface' },
  'Bom':           { bar: 'bg-primary',    badge: 'bg-primary/10 text-primary',    text: 'text-primary' },
  'Excelente':     { bar: 'bg-emerald-500',     badge: 'bg-emerald-500/10 text-emerald-500',      text: 'text-emerald-500' },
  'Extraordinário':{ bar: 'bg-yellow-400',   badge: 'bg-yellow-400/10 text-yellow-400',  text: 'text-yellow-400' },
};''', '''const SCORE_COLORS: Record<ScoreLabel, { bar: string; badgeBg: string; text: string }> = {
  'Sem Historial': { bar: 'var(--muted)', badgeBg: 'var(--surface-3)', text: 'var(--text)' },
  'Básico':        { bar: 'var(--gold-soft)', badgeBg: 'rgba(230,195,100,0.1)', text: 'var(--gold-soft)' },
  'Médio':         { bar: 'var(--gold-soft)', badgeBg: 'rgba(230,195,100,0.2)', text: 'var(--gold)' },
  'Bom':           { bar: 'var(--gold)', badgeBg: 'rgba(230,195,100,0.3)', text: 'var(--gold)' },
  'Excelente':     { bar: 'var(--success)', badgeBg: 'rgba(34,197,94,0.1)', text: 'var(--success)' },
  'Extraordinário':{ bar: 'var(--gold)', badgeBg: 'rgba(230,195,100,0.4)', text: 'var(--gold)' },
};''')

# Replace loading state
code = code.replace('''  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }''', '''  if (loading) {
    return (
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }''')

# Replace empty state
code = code.replace('''  // Se não há score, pede para calcular
  if (!scoreData) {
    return (
      <div className="p-6 flex flex-col items-center gap-6 text-center">
        <div className="w-24 h-24 rounded-full bg-surface-container-low flex items-center justify-center text-4xl">
          🏆
        </div>
        <div>
          <h3 className="font-black text-on-surface text-xl mb-2">Zenith Score</h3>
          <p className="text-outline text-sm leading-relaxed">
            O teu score de crédito baseado nas tuas corridas, avaliação e consistência. Bancos angolanos usam este score para aprovar crédito.
          </p>
        </div>
        <button
          onClick={recalculate}
          disabled={calculating || scoreUnavailable}
          className="w-full py-5 bg-primary text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-[0_10px_30px_rgba(37,99,235,0.4)] disabled:opacity-60 transition-all"
        >
          {calculating ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              A calcular...
            </span>
          ) : 'CALCULAR MEU SCORE'}
        </button>
      </div>
    );
  }''', '''  // Se não há score, pede para calcular
  if (!scoreData) {
    return (
      <div className="zr-app" style={{ minHeight: '100vh', padding: '24px' }}>
        <div className="zr-empty" style={{ marginBottom: '32px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', color: 'var(--gold)', marginBottom: '16px' }}>workspace_premium</span>
          <h3 className="zr-section-title">Zenith Score</h3>
          <p className="zr-copy" style={{ marginTop: '8px' }}>
            O teu score de crédito baseado nas tuas corridas, avaliação e consistência. Bancos angolanos usam este score para aprovar crédito.
          </p>
        </div>
        <button
          onClick={recalculate}
          disabled={calculating || scoreUnavailable}
          className="zr-button zr-button--block"
        >
          {calculating ? 'A calcular...' : 'Calcular Meu Score'}
        </button>
      </div>
    );
  }''')

# Replace main structure
old_main = '''  return (
    <div className="p-4 space-y-5 pb-10">

      {/* ── Cartão principal do score ─────────────────────────────────────── */}
      <div className="bg-[#0A0A0A] rounded-[2.5rem] p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Zenith Score</p>
            <p className="text-6xl font-black text-white tracking-tighter">{scoreData.score}</p>
            <p className="text-[9px] text-white/50 font-bold mt-1">de 1000 pontos</p>
          </div>
          <span className={`px-4 py-2 rounded-full text-[10px] font-black ${colors.badge}`}>
            {scoreData.score_label}
          </span>
        </div>

        {/* Barra de progresso */}
        <div className="h-3 bg-surface-container-low/10 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full ${colors.bar} rounded-full transition-all duration-1000`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-[8px] text-white/30 font-bold text-right">Actualizado: {lastCalc}</p>
      </div>

      {/* ── Detalhes da pontuação ──────────────────────────────────────────── */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-left bg-surface-container-low border border-outline-variant/20 rounded-[2rem] p-5"
      >
        <div className="flex justify-between items-center">
          <p className="font-black text-on-surface text-sm">Como é calculado</p>
          <span className="text-on-surface-variant/70 text-lg">{showDetails ? '▲' : '▼'}</span>
        </div>

        {showDetails && (
          <div className="mt-4 space-y-4">
            <ScoreComponent
              label="Corridas realizadas"
              value={scoreData.rides_component}
              max={400}
              desc={`${Math.round(scoreData.rides_component)} corridas · máx 400 pts`}
            />
            <ScoreComponent
              label="Avaliação média"
              value={scoreData.rating_component}
              max={300}
              desc={`Rating ${(scoreData.rating_component / 300 * 5).toFixed(1)}/5 · máx 300 pts`}
            />
            <ScoreComponent
              label="Nível de motorista"
              value={scoreData.level_component}
              max={200}
              desc={`${scoreData.level_component === 200 ? 'Diamante' : scoreData.level_component === 150 ? 'Ouro' : scoreData.level_component === 100 ? 'Prata' : scoreData.level_component === 50 ? 'Bronze' : 'Novato'} · máx 200 pts`}
            />
            <ScoreComponent
              label="Consistência (90 dias)"
              value={scoreData.consistency_pct}
              max={100}
              desc={`${scoreData.consistency_pct.toFixed(0)}% de conclusão · máx 100 pts`}
            />
          </div>
        )}
      </button>

      {/* ── Parceiros financeiros ──────────────────────────────────────────── */}
      <div>
        <div className="px-2 mb-3">
          <p className="font-black text-on-surface text-sm">Benefícios disponíveis</p>
          <p className="text-[9px] text-on-surface-variant/70 font-bold uppercase tracking-widest">
            Com o teu score actual
          </p>
        </div>

        <div className="space-y-3">
          {BANK_PARTNERS.map((partner, i) => {
            const isLocked = scoreData.score < 300 && i > 1;
            return (
              <div
                key={partner.name}
                className={`bg-surface-container-low border rounded-[2rem] p-5 flex items-center gap-4 ${
                  isLocked ? 'opacity-40 border-outline-variant/20' : 'border-primary/20 shadow-sm'
                }`}
              >
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-2xl shrink-0">
                  {partner.logo}
                </div>
                <div className="flex-1">
                  <p className="font-black text-on-surface text-sm">{partner.name}</p>
                  <p className="text-[10px] text-outline font-bold">{partner.benefit}</p>
                </div>
                {isLocked ? (
                  <span className="text-[8px] bg-surface-container-low text-on-surface-variant/70 px-3 py-1 rounded-full font-black">
                    Score &gt;300
                  </span>
                ) : (
                  <span className="text-[8px] bg-primary/10 text-primary px-3 py-1 rounded-full font-black">
                    ELEGÍVEL
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recalcular ────────────────────────────────────────────────────── */}
      <button
        onClick={recalculate}
        disabled={calculating}
        className="w-full py-4 border border-outline-variant/30 text-on-surface-variant rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-surface-container-lowest disabled:opacity-50 transition-all"
      >
        {calculating ? 'A actualizar score...' : '↻ Actualizar score'}
      </button>
    </div>
  );'''

new_main = '''  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <div style={{ padding: '14px' }}>

        {/* ── Cartão principal do score ─────────────────────────────────────── */}
        <section className="zr-bank" style={{ marginBottom: '24px' }}>
          <div className="zr-bank-head zr-inline zr-inline--between" style={{ alignItems: 'flex-start' }}>
            <div>
              <p className="zr-kicker">Zenith Score</p>
              <h2 className="zr-balance" style={{ fontSize: '48px', margin: '4px 0' }}>{scoreData.score}</h2>
              <p className="zr-meta" style={{ opacity: 0.6 }}>de 1000 pontos</p>
            </div>
            <div style={{ padding: '6px 12px', borderRadius: '16px', background: colors.badgeBg, color: colors.text, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }}>
              {scoreData.score_label}
            </div>
          </div>

          <div className="zr-progress" style={{ marginBottom: '8px' }}>
            <div className="zr-progress-bar" style={{ width: `${progressPct}%`, backgroundColor: colors.bar }} />
          </div>
          <p className="zr-meta" style={{ textAlign: 'right', fontSize: '8px' }}>Actualizado: {lastCalc}</p>
        </section>

        {/* ── Detalhes da pontuação ──────────────────────────────────────────── */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="zr-card"
          style={{ width: '100%', textAlign: 'left', marginBottom: '24px', cursor: 'pointer' }}
        >
          <div className="zr-inline zr-inline--between">
            <h3 className="zr-section-title" style={{ fontSize: '16px', margin: 0 }}>Como é calculado</h3>
            <span className="material-symbols-outlined">{showDetails ? 'expand_less' : 'expand_more'}</span>
          </div>

          {showDetails && (
            <div className="zr-stack" style={{ marginTop: '16px', gap: '16px' }}>
              <ScoreComponent label="Corridas realizadas" value={scoreData.rides_component} max={400} barColor={colors.bar} desc={`${Math.round(scoreData.rides_component)} corridas · máx 400 pts`} />
              <ScoreComponent label="Avaliação média" value={scoreData.rating_component} max={300} barColor={colors.bar} desc={`Rating ${(scoreData.rating_component / 300 * 5).toFixed(1)}/5 · máx 300 pts`} />
              <ScoreComponent label="Nível de motorista" value={scoreData.level_component} max={200} barColor={colors.bar} desc={`${scoreData.level_component === 200 ? 'Diamante' : scoreData.level_component === 150 ? 'Ouro' : scoreData.level_component === 100 ? 'Prata' : scoreData.level_component === 50 ? 'Bronze' : 'Novato'} · máx 200 pts`} />
              <ScoreComponent label="Consistência (90 dias)" value={scoreData.consistency_pct} max={100} barColor={colors.bar} desc={`${scoreData.consistency_pct.toFixed(0)}% de conclusão · máx 100 pts`} />
            </div>
          )}
        </button>

        {/* ── Parceiros financeiros ──────────────────────────────────────────── */}
        <div style={{ marginBottom: '24px' }}>
          <h3 className="zr-section-title" style={{ fontSize: '16px', marginBottom: '4px' }}>Benefícios disponíveis</h3>
          <p className="zr-meta" style={{ marginBottom: '16px' }}>Com o teu score actual</p>

          <div className="zr-list">
            {BANK_PARTNERS.map((partner, i) => {
              const isLocked = scoreData.score < 300 && i > 1;
              return (
                <div key={partner.name} className="zr-list-item" style={{ opacity: isLocked ? 0.4 : 1, filter: isLocked ? 'grayscale(1)' : 'none' }}>
                  <div className="zr-inline" style={{ gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', background: 'var(--surface-3)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
                      {partner.logo}
                    </div>
                    <div>
                      <strong style={{ display: 'block' }}>{partner.name}</strong>
                      <span className="zr-meta">{partner.benefit}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {isLocked ? (
                      <span className="zr-chip zr-chip--danger" style={{ fontSize: '8px' }}>Score &gt;300</span>
                    ) : (
                      <span className="zr-chip zr-chip--success" style={{ fontSize: '8px' }}>Elegível</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Recalcular ────────────────────────────────────────────────────── */}
        <button onClick={recalculate} disabled={calculating} className="zr-button zr-button--secondary zr-button--block">
          {calculating ? 'A actualizar score...' : '↻ Actualizar score'}
        </button>
      </div>
    </div>
  );'''
code = code.replace(old_main, new_main)

# Replace ScoreComponent
code = code.replace('''const ScoreComponent: React.FC<{
  label: string; value: number; max: number; desc: string;
}> = ({ label, value, max, desc }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <p className="text-[10px] font-bold text-on-surface-variant">{label}</p>
      <p className="text-[10px] font-black text-on-surface">{Math.round(value)} pts</p>
    </div>
    <div className="h-1.5 bg-surface-container-low rounded-full overflow-hidden mb-1">
      <div
        className="h-full bg-primary rounded-full transition-all"
        style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
      />
    </div>
    <p className="text-[9px] text-on-surface-variant/70 font-bold">{desc}</p>
  </div>
);''', '''const ScoreComponent: React.FC<{
  label: string; value: number; max: number; desc: string; barColor: string;
}> = ({ label, value, max, desc, barColor }) => (
  <div>
    <div className="zr-inline zr-inline--between" style={{ marginBottom: '4px' }}>
      <p className="zr-meta" style={{ fontSize: '10px' }}>{label}</p>
      <p style={{ fontSize: '10px', fontWeight: 'bold' }}>{Math.round(value)} pts</p>
    </div>
    <div className="zr-progress" style={{ marginBottom: '4px' }}>
      <div className="zr-progress-bar" style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: barColor }} />
    </div>
    <p className="zr-meta" style={{ fontSize: '9px' }}>{desc}</p>
  </div>
);''')

with open('src/components/ZenithScore.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("ZenithScore replaced")
