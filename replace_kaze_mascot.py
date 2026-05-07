import sys

with open('src/components/KazeMascot.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace thought balloon
code = code.replace('''      {/* Balão de pensamento espontâneo */}
      {thought && !isOpen && (
        <div
          className="mb-4 bg-surface-container/95 backdrop-blur-xl text-white p-5 rounded-[2.5rem] border-2 border-primary shadow-2xl max-w-[240px] animate-in slide-in-from-bottom-10 fade-in duration-700 pointer-events-auto cursor-pointer"
          onClick={() => setIsOpen(true)}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">Kaze - Zenith Ride</p>
          </div>
          <p className="text-xs font-bold italic">"{thought}"</p>
        </div>
      )}''', '''      {/* Balão de pensamento espontâneo */}
      {thought && !isOpen && (
        <div
          className="zr-card zr-card--soft"
          style={{ marginBottom: '16px', maxWidth: '240px', cursor: 'pointer', border: '1px solid var(--gold)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
          onClick={() => setIsOpen(true)}
        >
          <div className="zr-inline" style={{ marginBottom: '8px' }}>
            <span className="w-2 h-2 rounded-full animate-ping" style={{ backgroundColor: 'var(--gold)' }} />
            <p className="zr-meta" style={{ color: 'var(--gold)' }}>Kaze - Zenith Ride</p>
          </div>
          <p className="zr-copy" style={{ fontStyle: 'italic', fontWeight: 'bold' }}>"{thought}"</p>
        </div>
      )}''')

# Replace the main panel container
code = code.replace('''      {/* Painel principal */}
      {isOpen && (
        <div className="mb-4 w-[90vw] max-w-sm h-[60vh] max-h-[500px] bg-surface-container/98 backdrop-blur-3xl rounded-[3rem] border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden animate-in zoom-in-95 pointer-events-auto">

          {/* Header */}
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-blue-900/40 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 bg-surface-container-low/10 rounded-2xl flex items-center justify-center p-1 shadow-lg border border-white/10 relative">
                <img src={MASCOT_IMG} alt="Kaze" className="w-full h-full object-contain drop-shadow-lg" />
                <div className="absolute inset-0 bg-primary/15 blur-lg rounded-full animate-pulse -z-10" />
              </div>
              <div>
                <h4 className="text-white font-black text-xs uppercase tracking-tighter">KAZE 2.5</h4>
                <span className="text-[8px] text-primary font-black uppercase flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  {isDriver ? 'MOTORISTA ONLINE' : 'VIGILANTE ONLINE'}
                </span>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="w-8 h-8 rounded-lg bg-surface-container-low/5 text-white/40 flex items-center justify-center hover:text-white transition-all">✕</button>
          </div>

          {/* Tabs de modo */}
          <div className="flex bg-surface-container/50 p-1 mx-4 mt-4 rounded-xl border border-white/5">
            {(['chat', 'explore', 'voice'] as const).map(m => (
              <button
                key={m}
                onClick={() => m === 'voice' ? startVoiceMode() : setMode(m)}
                className={`flex-1 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                  mode === m
                    ? 'bg-primary/20 text-primary shadow-glow'
                    : 'text-on-surface-variant hover:text-white'
                }`}
              >
                {m === 'chat' ? 'Chat' : m === 'explore' ? 'Luanda' : 'Voz'}
              </button>
            ))}
          </div>''', '''      {/* Painel principal */}
      {isOpen && (
        <div className="zr-card" style={{ marginBottom: '16px', width: '90vw', maxWidth: '380px', height: '60vh', maxHeight: '500px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', pointerEvents: 'auto', border: '1px solid var(--gold-soft)', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>

          {/* Header */}
          <div className="zr-header" style={{ padding: '16px', borderBottom: '1px solid var(--surface-3)', background: 'linear-gradient(90deg, rgba(230,195,100,0.1), transparent)' }}>
            <div className="zr-inline zr-inline--between">
              <div className="zr-inline" style={{ gap: '12px' }}>
                <div style={{ width: '48px', height: '48px', background: 'var(--surface-3)', borderRadius: '12px', padding: '4px', position: 'relative' }}>
                  <img src={MASCOT_IMG} alt="Kaze" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <div>
                  <h4 className="zr-section-title" style={{ fontSize: '14px', margin: 0 }}>KAZE 2.5</h4>
                  <span className="zr-meta" style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--gold)' }} className="animate-pulse" />
                    {isDriver ? 'MOTORISTA ONLINE' : 'VIGILANTE ONLINE'}
                  </span>
                </div>
              </div>
              <button onClick={() => setIsOpen(false)} className="zr-icon-button">✕</button>
            </div>
          </div>

          {/* Tabs de modo */}
          <div style={{ padding: '0 16px', marginTop: '16px' }}>
            <div className="zr-scroll-x" style={{ background: 'var(--surface-3)', borderRadius: '12px', padding: '4px' }}>
              {(['chat', 'explore', 'voice'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => m === 'voice' ? startVoiceMode() : setMode(m)}
                  className={`zr-tab ${mode === m ? 'is-active' : ''}`}
                  style={{ flex: 1, padding: '8px', fontSize: '10px' }}
                >
                  {m === 'chat' ? 'Chat' : m === 'explore' ? 'Luanda' : 'Voz'}
                </button>
              ))}
            </div>
          </div>''')

# Replace the Chat Body
code = code.replace('''          {/* Corpo */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
            {mode !== 'voice' ? (
              <>
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center py-10">
                    <img src={MASCOT_IMG} className="w-24 h-24 opacity-40 mb-6" alt="Kaze" />
                    <p className="text-[10px] font-black uppercase text-primary/60 tracking-[0.2em] leading-relaxed max-w-[180px]">
                      {mode === 'explore' ? 'TRÂNSITO EM TEMPO REAL' : 'ASSISTENTE VIGILANTE PRONTO'}
                    </p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[90%] p-4 rounded-3xl text-[11px] font-bold leading-relaxed shadow-sm ${
                      m.role === 'user'
                        ? 'bg-primary/15 text-primary rounded-tr-none border border-primary/20'
                        : 'bg-surface-container/60 text-on-surface border border-white/10 backdrop-blur-md rounded-tl-none'
                    }`}>
                      {m.text}
                      {m.sources && m.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                          <p className="text-[8px] font-black text-primary/50 uppercase tracking-widest">Fontes:</p>
                          {m.sources.map((s: any, si: number) => (
                            <a key={si} href={s.uri} target="_blank" rel="noreferrer"
                              className="flex items-center gap-2 p-2 bg-surface-container-low/5 rounded-lg text-[9px] text-primary/70 hover:bg-surface-container-low/10 transition-colors">
                              <span className="opacity-60">📍</span>
                              <span className="truncate flex-1">{s.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div className="flex items-center gap-2 p-4 bg-primary/8 backdrop-blur-md rounded-2xl w-fit border border-primary/15">
                    <div className="flex gap-1">
                      {[0, 200, 400].map(d => (
                        <div key={d} className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                    <span className="text-[8px] font-black text-primary uppercase tracking-widest ml-2">Analisando Luanda...</span>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center space-y-8">
                <div className="relative">
                  <div className={`absolute -inset-10 bg-primary/12 rounded-full blur-3xl transition-all duration-1000 ${isLive ? 'scale-150 opacity-40' : 'scale-100 opacity-20'}`} />
                  <div className={`w-36 h-36 rounded-full flex items-center justify-center border-4 border-white/5 shadow-2xl overflow-hidden bg-surface-container/50 backdrop-blur-xl ${isLive ? 'border-primary/50' : ''}`}>
                    <img src={MASCOT_IMG} className={`w-24 h-24 object-contain transition-transform duration-500 ${isLive ? 'scale-110' : 'scale-90 opacity-50'}`} alt="Kaze" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-white font-black text-xs uppercase tracking-[0.3em] animate-pulse">SISTEMA VOZ KAZE</p>
                  <p className="text-[10px] text-primary/60 font-black uppercase mt-2 tracking-widest">
                    {isLive ? 'Fale agora com o Kaze' : 'Pronto para sincronizar'}
                  </p>
                </div>
                {!isLive && (
                  <button onClick={startVoiceMode}
                    className="gilded-gradient text-on-primary px-10 py-5 rounded-[2rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(230,195,100,0.25)] hover:scale-105 active:scale-95 transition-all">
                    Sintonizar Kaze
                  </button>
                )}
                {voiceError && (
                  <p className="text-[11px] text-error mt-3 px-6">{voiceError}</p>
                )}
              </div>
            )}
          </div>''', '''          {/* Corpo */}
          <div ref={scrollRef} className="zr-chat" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {mode !== 'voice' ? (
              <>
                {messages.length === 0 && (
                  <div className="zr-empty" style={{ height: '100%', justifyContent: 'center' }}>
                    <img src={MASCOT_IMG} style={{ width: '80px', opacity: 0.5, marginBottom: '16px' }} alt="Kaze" />
                    <p className="zr-meta" style={{ textAlign: 'center', maxWidth: '180px' }}>
                      {mode === 'explore' ? 'TRÂNSITO EM TEMPO REAL' : 'ASSISTENTE VIGILANTE PRONTO'}
                    </p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`zr-bubble ${m.role === 'user' ? 'zr-bubble--self' : 'zr-bubble--other'}`}>
                    {m.text}
                    {m.sources && m.sources.length > 0 && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--surface-3)' }}>
                        <p className="zr-meta" style={{ marginBottom: '8px' }}>Fontes:</p>
                        <div className="zr-stack" style={{ gap: '8px' }}>
                          {m.sources.map((s: any, si: number) => (
                            <a key={si} href={s.uri} target="_blank" rel="noreferrer" className="zr-chip" style={{ justifyContent: 'flex-start' }}>
                              📍 <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{s.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {isThinking && (
                  <div className="zr-bubble zr-bubble--other" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="zr-loading-dots"><span></span><span></span><span></span></div>
                    <span className="zr-meta" style={{ margin: 0, color: 'var(--gold)' }}>Analisando Luanda...</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '32px' }}>
                <div style={{ position: 'relative' }}>
                  <div className={`transition-all duration-1000 ${isLive ? 'animate-pulse' : ''}`} style={{ position: 'absolute', inset: '-20px', background: 'var(--gold)', borderRadius: '50%', filter: 'blur(30px)', opacity: isLive ? 0.3 : 0.1 }} />
                  <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'var(--surface-3)', border: isLive ? '2px solid var(--gold)' : '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
                    <img src={MASCOT_IMG} style={{ width: '80px', transform: isLive ? 'scale(1.1)' : 'scale(0.9)', transition: 'transform 0.5s', opacity: isLive ? 1 : 0.6 }} alt="Kaze" />
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p className="zr-section-title" style={{ fontSize: '14px', marginBottom: '8px' }}>SISTEMA VOZ KAZE</p>
                  <p className="zr-meta">{isLive ? 'Fale agora com o Kaze' : 'Pronto para sincronizar'}</p>
                </div>
                {!isLive && (
                  <button onClick={startVoiceMode} className="zr-button zr-button--block">
                    Sintonizar Kaze
                  </button>
                )}
                {voiceError && (
                  <p className="zr-meta" style={{ color: 'var(--danger)', textAlign: 'center' }}>{voiceError}</p>
                )}
              </div>
            )}
          </div>''')

# Replace Input
code = code.replace('''          {/* Input */}
          {mode !== 'voice' && (
            <div className="p-4 bg-black/20 border-t border-white/5 backdrop-blur-xl">
              <form onSubmit={handleSendText} className="flex gap-2">
                <input
                  className="flex-1 bg-surface-container-low/5 border border-white/10 rounded-2xl px-5 py-4 text-xs text-white outline-none focus:border-primary transition-all font-bold placeholder-white/20"
                  placeholder={mode === 'explore' ? 'Onde há trânsito agora?' : 'Falar com Kaze...'}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                />
                <button type="submit"
                  className="w-14 h-14 gilded-gradient text-on-primary rounded-2xl flex items-center justify-center text-xl shadow-xl active:scale-95 transition-all">
                  ➔
                </button>
              </form>
            </div>
          )}
        </div>
      )}''', '''          {/* Input */}
          {mode !== 'voice' && (
            <div style={{ padding: '16px', borderTop: '1px solid var(--surface-3)', background: 'var(--surface-2)' }}>
              <form onSubmit={handleSendText} className="zr-inline" style={{ gap: '8px' }}>
                <input
                  className="zr-input"
                  style={{ flex: 1 }}
                  placeholder={mode === 'explore' ? 'Onde há trânsito agora?' : 'Falar com Kaze...'}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                />
                <button type="submit" className="zr-icon-button" style={{ background: 'var(--gold)', color: '#000', width: '48px', height: '48px', borderRadius: '12px' }}>
                  <span className="material-symbols-outlined">send</span>
                </button>
              </form>
            </div>
          )}
        </div>
      )}''')

# Replace trigger button
code = code.replace('''      {/* Botão flutuante */}
      {/* O Avatar / Gatilho integrado no centro do navbar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-12 h-12 rounded-full overflow-hidden border-2 flex items-center justify-center shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all pointer-events-auto active:scale-95 z-[601] ${
          isOpen ? 'bg-primary border-primary scale-110 shadow-[0_10px_30px_rgba(37,99,235,0.7)]' : 'bg-[#0B0B0B] border-[#0A0A0A] hover:bg-surface-container-low hover:border-primary/50'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-blue-900/40 to-transparent" />
        <img
          src={MASCOT_IMG}
          alt="Kaze Mascot"
          className={`w-8 h-8 object-contain drop-shadow-md transition-all duration-500 relative z-10 ${isOpen || isThinking ? 'scale-110' : ''}`}
        />
        {/* Glow indicator if alive */}
        {kazeOnline === true && (
          <span className="absolute bottom-2 right-3 w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_#4ade80] animate-pulse z-20" />
        )}
      </button>''', '''      {/* Botão flutuante */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="zr-icon-button"
        style={{
          width: '56px', height: '56px', borderRadius: '28px', pointerEvents: 'auto', zIndex: 601,
          background: isOpen ? 'var(--gold)' : 'var(--surface-3)',
          border: isOpen ? 'none' : '2px solid var(--surface-1)',
          boxShadow: isOpen ? '0 10px 30px rgba(230,195,100,0.4)' : '0 10px 20px rgba(0,0,0,0.5)',
          position: 'relative'
        }}
      >
        <img src={MASCOT_IMG} alt="Kaze Mascot" style={{ width: '32px', height: '32px', objectFit: 'contain', transform: (isOpen || isThinking) ? 'scale(1.1)' : 'none', transition: 'transform 0.3s' }} />
        {kazeOnline === true && (
          <span style={{ position: 'absolute', bottom: '8px', right: '8px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} className="animate-pulse" />
        )}
      </button>''')

with open('src/components/KazeMascot.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("KazeMascot replaced")
