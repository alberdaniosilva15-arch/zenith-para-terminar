import sys

with open('src/components/PanicButton.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace the sent state
code = code.replace('''  if (sent) {
    return (
      <div className="bg-red-900/30 border border-red-500/50 rounded-2xl p-5 space-y-3 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center shrink-0">
            <span className="text-xl">🆘</span>
          </div>
          <div>
            <p className="text-red-400 font-black text-sm">Alerta enviado</p>
            <p className="text-red-300/70 text-[10px] font-bold">
              Contacto de emergencia notificado via WhatsApp
            </p>
          </div>
        </div>

        {recording && (
          <div className="flex items-center gap-2 bg-red-500/10 rounded-xl p-3 border border-red-500/20">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
              A gravar audio de emergencia... (30s)
            </p>
          </div>
        )}

        {audioSaved && !recording && (
          <div className="flex items-center gap-2 bg-green-500/10 rounded-xl p-3 border border-green-500/20">
            <span className="text-sm">✅</span>
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest">
              Audio de evidencia guardado
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <a
            href="tel:113"
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest text-center active:scale-95 transition-all"
          >
            📞 Ligar 113
          </a>
          <a
            href="tel:112"
            className="flex-1 py-2.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl font-black text-[10px] uppercase tracking-widest text-center active:scale-95 transition-all"
          >
            📞 Ligar 112
          </a>
        </div>
      </div>
    );
  }''', '''  if (sent) {
    return (
      <div className="zr-card" style={{ border: '1px solid var(--danger-soft)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="zr-inline" style={{ gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', background: 'rgba(239, 68, 68, 0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            🆘
          </div>
          <div>
            <strong style={{ color: 'var(--danger-soft)', display: 'block', marginBottom: '4px' }}>Alerta enviado</strong>
            <span className="zr-meta" style={{ color: 'var(--danger-soft)', opacity: 0.8 }}>Contacto de emergência notificado</span>
          </div>
        </div>

        {recording && (
          <div className="zr-chip zr-chip--danger" style={{ justifyContent: 'flex-start' }}>
            <span style={{ width: '8px', height: '8px', backgroundColor: 'var(--danger)', borderRadius: '50%', marginRight: '8px' }} className="animate-pulse" />
            A gravar audio de emergência... (30s)
          </div>
        )}

        {audioSaved && !recording && (
          <div className="zr-chip zr-chip--success" style={{ justifyContent: 'flex-start' }}>
            <span style={{ marginRight: '8px' }}>✅</span>
            Áudio de evidência guardado
          </div>
        )}

        <div className="zr-inline" style={{ gap: '8px' }}>
          <a href="tel:113" className="zr-button zr-button--danger zr-button--block" style={{ flex: 1, padding: '10px 0', fontSize: '10px' }}>
            📞 Ligar 113
          </a>
          <a href="tel:112" className="zr-button zr-button--secondary zr-button--block" style={{ flex: 1, padding: '10px 0', fontSize: '10px', color: 'var(--danger-soft)', borderColor: 'var(--danger-soft)' }}>
            📞 Ligar 112
          </a>
        </div>
      </div>
    );
  }''')

# Replace initial button
code = code.replace('''  return (
    <button
      onClick={() => void triggerPanic(false)}
      className={`w-full py-4 rounded-2xl font-black text-sm transition-all active:scale-95 ${
        pressed
          ? 'bg-red-600 text-white animate-pulse border-2 border-red-400 shadow-[0_0_30px_rgba(239,68,68,0.4)]'
          : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/15'
      }`}
    >
      {pressed ? '🆘 CONFIRMA - toca de novo para enviar alerta' : '🛡️ Botao de Panico (SOS)'}
    </button>
  );''', '''  return (
    <button
      onClick={() => void triggerPanic(false)}
      className={`zr-button zr-button--block ${pressed ? 'zr-button--danger animate-pulse' : 'zr-button--secondary'}`}
      style={pressed ? { boxShadow: '0 0 20px rgba(239, 68, 68, 0.6)' } : { color: 'var(--danger-soft)', borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
    >
      {pressed ? '🆘 CONFIRMA - toca de novo para enviar alerta' : '🛡️ Botão de Pânico (SOS)'}
    </button>
  );''')

with open('src/components/PanicButton.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("PanicButton replaced")
