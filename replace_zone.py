import sys

with open('src/components/ZonePriceMap.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Loading
code = code.replace('''  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }''', '''  if (loading) {
    return (
      <div className={compact ? '' : 'zr-app'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: compact ? 'auto' : '60vh', padding: '32px 0' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }''')

# Main container
code = code.replace('''  return (
    <div className={compact ? '' : 'p-4 space-y-5'}>

      {!compact && (
        <div className="px-2">
          <h2 className="text-2xl font-black text-on-surface tracking-tighter italic">
            Preços <span className="text-primary">Fixos</span>
          </h2>
          <p className="text-[9px] text-on-surface-variant/70 font-bold uppercase tracking-[0.2em]">
            Sem surpresas · Sem surge · Preço garantido
          </p>
        </div>
      )}

      {/* ── Selector de zona de origem ─────────────────────────────────── */}
      <div>
        {!compact && (
          <p className="text-[8px] font-black text-outline uppercase tracking-widest mb-2 px-1">
            Estou em
          </p>
        )}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {ALL_ZONES.map(zone => {
            const color = ZONE_COLORS[zone] ?? { bg: 'bg-surface-container-low', text: 'text-on-surface-variant', label: 'Zona' };
            const active = originFilter === zone;
            return (
              <button
                key={zone}
                onClick={() => setOriginFilter(zone)}
                className={`px-4 py-2 rounded-full text-[9px] font-black uppercase shrink-0 transition-all ${
                  active
                    ? 'bg-surface-container-highest text-white shadow-lg'
                    : `${color.bg} ${color.text}`
                }`}
              >
                {zone}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Grid de preços ─────────────────────────────────────────────── */}
      {filteredPrices.length === 0 ? (
        <p className="text-center text-on-surface-variant/70 text-sm py-8">
          Nenhum preço configurado para {originFilter}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredPrices.map((item, idx) => {
            const color = ZONE_COLORS[item.zone] ?? { bg: 'bg-surface-container-lowest', text: 'text-on-surface-variant', label: '' };
            return (
              <div
                key={`${item.zone}-${idx}`}
                className={`flex items-center gap-4 p-4 rounded-[2rem] border transition-all ${
                  item.isHighlight
                    ? 'border-primary/50 bg-primary/10 shadow-sm'
                    : 'border-outline-variant/20 bg-surface-container-low'
                }`}
              >
                {/* Zona destino */}
                <div className={`px-3 py-1.5 rounded-full text-[9px] font-black ${color.bg} ${color.text} shrink-0`}>
                  {item.zone}
                </div>

                {/* Linha tracejada */}
                <div className="flex-1 border-t border-dashed border-outline-variant/30" />

                {/* Distância */}
                <p className="text-[9px] font-bold text-on-surface-variant/70 shrink-0">
                  ~{item.distance_km} km
                </p>

                {/* Preço */}
                <div className="text-right shrink-0">
                  <p className="font-black text-on-surface text-sm">
                    {item.price_kz.toLocaleString('pt-AO')} Kz
                  </p>
                  {item.isHighlight && (
                    <p className="text-[7px] text-primary font-black uppercase">Seleccionado</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Nota de transparência ─────────────────────────────────────── */}
      {!compact && (
        <div className="bg-primary/10 border border-primary/30 rounded-[2rem] p-4 flex gap-3 items-start">
          <span className="text-xl">✅</span>
          <div>
            <p className="text-[10px] font-black text-primary">Preço que vês = preço que pagas</p>
            <p className="text-[9px] text-primary font-bold leading-relaxed">
              Os preços são fixos por zona e não mudam com a hora ou a procura. Podes confiar no que está aqui.
            </p>
          </div>
        </div>
      )}
    </div>
  );''', '''  return (
    <div className={compact ? '' : 'zr-app'} style={compact ? {} : { minHeight: '100vh', paddingBottom: '120px' }}>

      {!compact && (
        <header className="zr-header">
          <div className="zr-inline zr-inline--between">
            <div>
              <p className="zr-kicker">Sem surpresas · Sem surge</p>
              <h2 className="zr-section-title">Preços Fixos</h2>
            </div>
            <span className="zr-chip zr-chip--gold">Garantido</span>
          </div>
        </header>
      )}

      <div style={compact ? {} : { padding: '14px' }}>
        {/* ── Selector de zona de origem ─────────────────────────────────── */}
        <div style={{ marginBottom: '24px' }}>
          {!compact && (
            <p className="zr-label" style={{ marginBottom: '8px' }}>Estou em</p>
          )}
          <div className="zr-scroll-x">
            {ALL_ZONES.map(zone => {
              const active = originFilter === zone;
              return (
                <button
                  key={zone}
                  onClick={() => setOriginFilter(zone)}
                  className={`zr-tab ${active ? 'is-active' : ''}`}
                >
                  {zone}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Grid de preços ─────────────────────────────────────────────── */}
        {filteredPrices.length === 0 ? (
          <div className="zr-empty">
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)', marginBottom: '16px' }}>location_disabled</span>
            <p className="zr-copy">Nenhum preço configurado para {originFilter}</p>
          </div>
        ) : (
          <div className="zr-list" style={{ marginBottom: '24px' }}>
            {filteredPrices.map((item, idx) => {
              return (
                <div
                  key={`${item.zone}-${idx}`}
                  className="zr-list-item"
                  style={item.isHighlight ? { border: '1px solid var(--gold)' } : {}}
                >
                  <div>
                    <strong style={{ display: 'block', color: item.isHighlight ? 'var(--gold)' : 'inherit' }}>{item.zone}</strong>
                    <span className="zr-meta">~{item.distance_km} km</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong style={{ display: 'block' }}>{item.price_kz.toLocaleString('pt-AO')} Kz</strong>
                    {item.isHighlight && (
                      <span className="zr-meta" style={{ color: 'var(--gold)' }}>Seleccionado</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Nota de transparência ─────────────────────────────────────── */}
        {!compact && (
          <div className="zr-alert-box zr-alert-box--success">
            <div className="zr-alert-content">
              <strong>Preço que vês = preço que pagas</strong>
              <p style={{ marginTop: '4px' }}>Os preços são fixos por zona e não mudam com a hora ou a procura. Podes confiar no que está aqui.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );''')

with open('src/components/ZonePriceMap.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("ZonePriceMap replaced")
