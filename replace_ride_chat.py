import sys

with open('src/components/RideChat.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Closed state
code = code.replace('''  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
        className="relative flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-lg"
      >
        Chat com {peerName}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black">
            {unread}
          </span>
        )}
      </button>
    );
  }''', '''  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setUnread(0);
        }}
        className="zr-button"
        style={{ position: 'relative' }}
      >
        <span className="material-symbols-outlined" style={{ marginRight: '8px' }}>chat</span>
        Chat com {peerName}
        {unread > 0 && (
          <span style={{ position: 'absolute', top: '-4px', right: '-4px', backgroundColor: 'var(--danger)', color: '#fff', fontSize: '10px', fontWeight: 'bold', width: '20px', height: '20px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {unread}
          </span>
        )}
      </button>
    );
  }''')

# Open state
code = code.replace('''  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
      <div className="flex items-start justify-between border-b border-white/10 bg-[#111] px-4 py-3">
        <div className="space-y-2">
          <p className="text-sm font-bold text-white">{peerName}</p>
          {phonePrivacyMode && (
            <p className="text-[10px] text-yellow-400">Numero protegido - usa o chat</p>
          )}
          <KazeCreditsBadge userId={myId} rideId={rideId} />
        </div>
        <button onClick={() => setOpen(false)} className="text-2xl leading-none text-white/60">
          &times;
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {msgs.length === 0 && (
          <p className="mt-8 text-center text-xs text-white/30">Nenhuma mensagem ainda. Diz ola!</p>
        )}
        {msgs.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender_id === myId ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.sender_id === myId ? 'bg-primary text-white' : 'bg-white/10 text-white'
              }`}
            >
              {msg.text}
              <span className="mt-0.5 block text-right text-[9px] opacity-50">
                {new Date(msg.created_at).toLocaleTimeString('pt-PT', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {quickReplies.map((reply) => (
          <button
            key={reply}
            onClick={() => void send(reply)}
            className="shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] text-white"
          >
            {reply}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 bg-[#111] px-3 pb-4 pt-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void send(text);
            }
          }}
          placeholder="Escreve uma mensagem..."
          maxLength={500}
          className="flex-1 rounded-full border border-white/10 bg-white/10 px-4 py-2.5 text-sm text-white outline-none"
        />
        <button
          onClick={() => void send(text)}
          disabled={!text.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary disabled:opacity-40"
        >
          <span className="text-lg">&gt;</span>
        </button>
      </div>
    </div>
  );''', '''  return (
    <div className="zr-modal is-open zr-chat" style={{ zIndex: 50, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-1)' }}>
      <div className="zr-header" style={{ padding: '16px', borderBottom: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-inline zr-inline--between">
          <div>
            <h3 className="zr-section-title" style={{ fontSize: '16px', margin: 0 }}>{peerName}</h3>
            {phonePrivacyMode && (
              <span className="zr-meta" style={{ color: 'var(--gold)', fontSize: '10px' }}>Número protegido - usa o chat</span>
            )}
            <div style={{ marginTop: '4px' }}>
              <KazeCreditsBadge userId={myId} rideId={rideId} />
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="zr-icon-button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="zr-chat" style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {msgs.length === 0 && (
          <div className="zr-empty" style={{ margin: 'auto' }}>
            <p className="zr-meta">Nenhuma mensagem ainda. Diz olá!</p>
          </div>
        )}
        {msgs.map((msg) => (
          <div key={msg.id} className={`zr-bubble ${msg.sender_id === myId ? 'zr-bubble--self' : 'zr-bubble--other'}`}>
            {msg.text}
            <span className="zr-meta" style={{ display: 'block', textAlign: 'right', fontSize: '9px', marginTop: '4px', opacity: 0.7 }}>
              {new Date(msg.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '8px 16px', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-scroll-x">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              onClick={() => void send(reply)}
              className="zr-chip"
              style={{ fontSize: '10px' }}
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px', borderTop: '1px solid var(--surface-3)', backgroundColor: 'var(--surface-2)' }}>
        <div className="zr-inline" style={{ gap: '8px' }}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void send(text); }}
            placeholder="Escreve uma mensagem..."
            maxLength={500}
            className="zr-input"
            style={{ flex: 1 }}
          />
          <button
            onClick={() => void send(text)}
            disabled={!text.trim()}
            className="zr-icon-button"
            style={{ backgroundColor: 'var(--gold)', color: '#000', width: '48px', height: '48px', borderRadius: '12px' }}
          >
            <span className="material-symbols-outlined">send</span>
          </button>
        </div>
      </div>
    </div>
  );''')

with open('src/components/RideChat.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("RideChat replaced")
