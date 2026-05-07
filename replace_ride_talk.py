import sys

with open('src/components/RideTalk.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# TYPE COLORS mapping
code = code.replace('''const TYPE_COLORS: Record<string, string> = {
  status: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  alert:  'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse',
  event:  'bg-primary/10 text-primary border-primary/20',
};''', '''const TYPE_COLORS: Record<string, string> = {
  status: 'zr-chip--info',
  alert:  'zr-chip--danger animate-pulse',
  event:  'zr-chip--gold',
};''')

# Replace the main UI
code = code.replace('''  return (
    <div className="mt-4 bg-surface-container-low border border-outline-variant/20 rounded-[2.5rem] overflow-hidden shadow-sm">

      {/* Header */}
      <div className="bg-[#0A0A0A] px-6 py-5 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📻</span>
          <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">
            RideTalk · {zone}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[8px] text-white/50 font-black uppercase">LIVE</span>
        </div>
      </div>

      {/* Filtros de categoria */}
      <div className="flex gap-2 p-4 bg-surface-container-lowest/50 border-b border-outline-variant/20 overflow-x-auto no-scrollbar">
        {(['all', 'status', 'alert', 'event'] as Category[]).map(cat => {
          const counts = cat === 'all'
            ? messages.length
            : messages.filter(m => m.type === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCat(cat)}
              className={`px-4 py-2 rounded-full text-[9px] font-black uppercase border transition-all shrink-0 flex items-center gap-1.5 ${
                activeCat === cat
                  ? cat === 'alert'
                    ? 'bg-red-600 text-white border-red-600'
                    : cat === 'event'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface-container-highest text-white border-outline-variant shadow-lg'
                  : 'bg-surface-container-low text-on-surface-variant/70 border-outline-variant/20 hover:border-outline-variant/50'
              }`}
            >
              {cat === 'alert' ? '🚨' : cat === 'event' ? '📍' : cat === 'status' ? '💬' : '📻'}
              {CAT_LABELS[cat]}
              {counts > 0 && (
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black ${
                  activeCat === cat ? 'bg-white/20' : 'bg-outline/20'
                }`}>
                  {counts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Feed de mensagens */}
      <div className="p-4 max-h-72 overflow-y-auto no-scrollbar space-y-3 bg-surface-container-low">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">A carregar...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">
              {activeCat === 'alert' ? '🚨' : activeCat === 'event' ? '📍' : '📻'}
            </p>
            <p className="text-[10px] font-black text-on-surface-variant/50 uppercase tracking-widest">
              {activeCat === 'all'
                ? 'Nenhuma publicação ainda'
                : `Sem ${CAT_LABELS[activeCat].toLowerCase()}s na zona ${zone}`}
            </p>
            <p className="text-[9px] text-on-surface-variant/40 font-bold mt-1">
              Sê o primeiro a partilhar!
            </p>
          </div>
        ) : (
          filtered.map(msg => (
            <div
              key={msg.id}
              className="bg-surface-container-lowest p-4 rounded-[1.5rem] border border-outline-variant/15 transition-all hover:border-outline-variant/40"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-black text-primary shrink-0">
                    {msg.senderName.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[9px] font-black text-on-surface">
                    {msg.senderName}
                  </span>
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${TYPE_COLORS[msg.type] ?? TYPE_COLORS.status}`}>
                    {TYPE_ICONS[msg.type]} {msg.type === 'alert' ? 'Alerta' : msg.type === 'event' ? 'Evento' : 'Status'}
                  </span>
                  {msg.zone && msg.zone !== 'Geral' && (
                    <span className="text-[8px] font-bold text-on-surface-variant/60">📍 {msg.zone}</span>
                  )}
                </div>
                <span className="text-[8px] text-on-surface-variant/50 font-bold shrink-0">{timeAgo(msg.timestamp)}</span>
              </div>

              <p className="text-[11px] font-bold text-on-surface leading-relaxed mt-2 mb-3">
                {msg.text}
              </p>

              <button
                onClick={() => handleConfirm(msg)}
                className="flex items-center gap-1.5 text-[9px] font-black text-on-surface-variant/60 hover:text-primary transition-colors"
              >
                <span>👍</span>
                <span>Confirmar · {msg.confirmations}</span>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Input de envio */}
      <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low">
        {/* Selector de tipo */}
        <div className="flex gap-2 mb-3">
          {(['status', 'alert', 'event'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveCat(t)}
              className={`px-3 py-1.5 rounded-full text-[8px] font-black uppercase border transition-all flex items-center gap-1 ${
                activeCat === t
                  ? t === 'alert' ? 'bg-red-600 text-white border-red-600'
                  : t === 'event' ? 'bg-primary text-white border-primary'
                  : 'bg-surface-container-highest text-white border-outline-variant'
                  : 'bg-transparent text-on-surface-variant/60 border-outline-variant/20'
              }`}
            >
              {TYPE_ICONS[t]} {CAT_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleVoiceRecord}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg transition-all shadow-sm ${
              isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-surface-container-lowest text-outline border border-outline-variant/20'
            }`}
            aria-label="Gravar voz"
          >
            {isRecording ? '⏹️' : '🎙️'}
          </button>

          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeCat === 'alert' ? '🚨 Reportar alerta de trânsito...' :
              activeCat === 'event' ? '📍 Partilhar evento em Luanda...' :
              '💬 Partilhar o teu status...'
            }
            className="flex-1 bg-surface-container-lowest border border-outline-variant/20 text-[11px] font-bold px-4 py-3 rounded-2xl outline-none focus:ring-2 focus:ring-primary/40 transition-all text-on-surface placeholder:text-on-surface-variant/30"
          />

          <button
            onClick={handleSend}
            disabled={sending || !newMessage.trim() || !profile}
            className="bg-[#0A0A0A] text-white px-5 rounded-2xl text-[10px] font-black shadow-lg disabled:opacity-40 active:scale-95 transition-all hover:bg-primary"
          >
            {sending ? '...' : 'ENVIAR'}
          </button>
        </div>
      </div>
    </div>
  );''', '''  return (
    <div className="zr-card" style={{ marginTop: '16px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="zr-header" style={{ padding: '16px', borderBottom: '1px solid var(--surface-3)', background: 'linear-gradient(90deg, var(--surface-2), transparent)' }}>
        <div className="zr-inline zr-inline--between">
          <div className="zr-inline" style={{ gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>📻</span>
            <h3 className="zr-section-title" style={{ fontSize: '14px', margin: 0 }}>RideTalk · {zone}</h3>
          </div>
          <div className="zr-inline" style={{ gap: '4px' }}>
            <span className="animate-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
            <span className="zr-meta" style={{ fontSize: '10px', color: 'var(--success)' }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* Filtros de categoria */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-1)' }}>
        <div className="zr-scroll-x">
          {(['all', 'status', 'alert', 'event'] as Category[]).map(cat => {
            const counts = cat === 'all' ? messages.length : messages.filter(m => m.type === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`zr-tab ${activeCat === cat ? 'is-active' : ''}`}
                style={{ fontSize: '10px', padding: '6px 12px' }}
              >
                {cat === 'alert' ? '🚨 ' : cat === 'event' ? '📍 ' : cat === 'status' ? '💬 ' : '📻 '}
                {CAT_LABELS[cat]}
                {counts > 0 && <span style={{ marginLeft: '4px', opacity: 0.7 }}>({counts})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed de mensagens */}
      <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--surface-1)' }}>
        {loading ? (
          <div className="zr-loading-dots" style={{ alignSelf: 'center', margin: '32px 0' }}><span></span><span></span><span></span></div>
        ) : filtered.length === 0 ? (
          <div className="zr-empty" style={{ margin: '32px 0' }}>
            <span style={{ fontSize: '32px', marginBottom: '8px' }}>{activeCat === 'alert' ? '🚨' : activeCat === 'event' ? '📍' : '📻'}</span>
            <p className="zr-copy">{activeCat === 'all' ? 'Nenhuma publicação ainda' : `Sem ${CAT_LABELS[activeCat].toLowerCase()}s na zona ${zone}`}</p>
          </div>
        ) : (
          filtered.map(msg => (
            <div key={msg.id} className="zr-card zr-card--soft" style={{ padding: '12px' }}>
              <div className="zr-inline zr-inline--between" style={{ alignItems: 'flex-start', marginBottom: '8px' }}>
                <div className="zr-inline" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', fontWeight: 'bold' }}>
                    {msg.senderName.charAt(0).toUpperCase()}
                  </div>
                  <strong style={{ fontSize: '12px' }}>{msg.senderName}</strong>
                  <span className={`zr-chip ${TYPE_COLORS[msg.type] ?? 'zr-chip--info'}`} style={{ fontSize: '8px', padding: '2px 6px' }}>
                    {TYPE_ICONS[msg.type]} {msg.type === 'alert' ? 'Alerta' : msg.type === 'event' ? 'Evento' : 'Status'}
                  </span>
                  {msg.zone && msg.zone !== 'Geral' && (
                    <span className="zr-meta" style={{ fontSize: '10px' }}>📍 {msg.zone}</span>
                  )}
                </div>
                <span className="zr-meta" style={{ fontSize: '10px' }}>{timeAgo(msg.timestamp)}</span>
              </div>

              <p className="zr-copy" style={{ fontSize: '12px', marginBottom: '12px' }}>{msg.text}</p>

              <button onClick={() => handleConfirm(msg)} className="zr-icon-button" style={{ fontSize: '12px', color: 'var(--gold-soft)', display: 'inline-flex', gap: '4px', width: 'auto', padding: '4px 8px', height: 'auto', borderRadius: '16px' }}>
                👍 Confirmar · {msg.confirmations}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Input de envio */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-scroll-x" style={{ marginBottom: '12px' }}>
          {(['status', 'alert', 'event'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveCat(t)}
              className={`zr-chip ${activeCat === t ? (t === 'alert' ? 'zr-chip--danger' : t === 'event' ? 'zr-chip--gold' : 'zr-chip--info') : ''}`}
              style={{ fontSize: '10px', padding: '4px 12px', border: activeCat !== t ? '1px solid var(--surface-3)' : 'none' }}
            >
              {TYPE_ICONS[t]} {CAT_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="zr-inline" style={{ gap: '12px' }}>
          <button onClick={handleVoiceRecord} className={`zr-icon-button ${isRecording ? 'animate-pulse' : ''}`} style={{ backgroundColor: isRecording ? 'var(--danger)' : 'var(--surface-3)', color: isRecording ? '#fff' : 'inherit' }}>
            {isRecording ? '⏹️' : '🎙️'}
          </button>

          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeCat === 'alert' ? '🚨 Reportar alerta de trânsito...' : activeCat === 'event' ? '📍 Partilhar evento...' : '💬 Partilhar status...'}
            className="zr-input"
            style={{ flex: 1 }}
          />

          <button onClick={handleSend} disabled={sending || !newMessage.trim() || !profile} className="zr-button" style={{ padding: '0 16px' }}>
            {sending ? '...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );''')

with open('src/components/RideTalk.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("RideTalk replaced")
