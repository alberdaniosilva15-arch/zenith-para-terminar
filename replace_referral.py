import sys

with open('src/components/ReferralModal.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace main structure
code = code.replace('''  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
      <section className="zr-card" style={{ width: '100%', maxWidth: '400px', backgroundColor: 'var(--bg)' }}>
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Ganhe na Zenith</p>
            <h2 className="zr-section-title">Traz o Mano</h2>
            <p className="zr-copy">Ganha 500 Kz por cada amigo que completar a 1ª viagem.</p>
          </div>
          <span className="zr-chip zr-chip--gold">{loading ? '...' : code || 'N/A'}</span>
        </div>
        <div className="zr-inline" style={{ marginTop: '14px' }}>
          <button 
            className="zr-button zr-button--sm" 
            onClick={handleCopy} 
            disabled={loading || !code}
          >
            Copiar código
          </button>
          <button 
            className="zr-button zr-button--sm zr-button--ghost" 
            onClick={handleShare} 
            disabled={loading || !code}
          >
            Partilhar no WhatsApp
          </button>
        </div>

        <div style={{ marginTop: '24px' }}>
          <p className="zr-kicker">Usar código de amigo</p>
          <div className="zr-inline" style={{ marginTop: '8px' }}>
            <input 
              type="text" 
              placeholder="Ex: TOMAS21" 
              value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              style={{ 
                flex: 1, 
                background: 'rgba(255,255,255,0.05)', 
                border: '1px solid rgba(255,255,255,0.1)', 
                padding: '8px 12px',
                borderRadius: '8px',
                color: 'white',
                fontSize: '14px'
              }}
            />
            <button 
              onClick={handleApply}
              disabled={applying || inputCode.length < 5}
              className="zr-button zr-button--sm"
            >
              {applying ? '...' : 'Aplicar'}
            </button>
          </div>
        </div>
        
        <button 
          onClick={onClose}
          className="zr-button zr-button--block zr-button--ghost"
          style={{ marginTop: '24px' }}
        >
          Fechar
        </button>
      </section>
    </div>
  );''', '''  return (
    <div className="zr-modal is-open">
      <div className="zr-modal-card zr-card--hero" style={{ padding: 0 }}>
        <div style={{ padding: '24px', background: 'linear-gradient(135deg, var(--surface-1), transparent)' }}>
          <p className="zr-kicker" style={{ color: 'var(--gold)' }}>Ganhe na Zenith</p>
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
  );''')

with open('src/components/ReferralModal.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("ReferralModal replaced")
