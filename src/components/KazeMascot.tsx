// =============================================================================
// ZENITH RIDE v3.1 — KazeMascot.tsx
// FIXES v3.1:
//   1. Tabs: VOZ adicionada de volta (estava oculta)
//   2. Mensagem de erro: mostra o texto real do geminiService (com diagnóstico)
//   3. Indicador online/offline mais claro
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { geminiService } from '../services/geminiService';
import { UserRole, RideStatus } from '../types';

interface KazeMascotProps {
  role:        UserRole;
  rideStatus:  RideStatus;
  dataSaver:   boolean;
  userName?:   string;
}

const MASCOT_IMG = 'https://img.icons8.com/3d-fluency/180/robot-3.png';

const KAZE_GREETINGS: Record<string, string[]> = {
  passenger: [
    'Olá! Sou o Kaze, o teu assistente de corridas em Luanda. Como posso ajudar?',
    'Pronto para a tua próxima corrida? Diz-me onde queres ir!',
    'Bem-vindo ao Zenith Ride! Posso ajudar-te a encontrar o melhor trajecto.',
  ],
  driver: [
    'Força motorista! O Kaze está contigo na estrada.',
    'Boa corrida! Lembra-te: segurança em primeiro lugar.',
    'O trânsito de Luanda está aí. O Kaze tem dicas para ti!',
  ],
};

const KazeMascot: React.FC<KazeMascotProps> = ({ role, rideStatus, dataSaver, userName }) => {
  const [isOpen,      setIsOpen]      = useState(false);
  const [mode,        setMode]        = useState<'chat' | 'voice' | 'explore'>('chat');
  const [messages,    setMessages]    = useState<{ role: 'user' | 'model'; text: string; sources?: any[] }[]>([]);
  const [inputValue,  setInputValue]  = useState('');
  const [isThinking,  setIsThinking]  = useState(false);
  const [thought,     setThought]     = useState<string | null>(null);
  const [isLive,      setIsLive]      = useState(false);
  const [voiceError,  setVoiceError]  = useState<string | null>(null);
  const [kazeOnline,  setKazeOnline]  = useState<boolean | null>(null); // null = a verificar

  const chatRef   = useRef<ReturnType<typeof geminiService.createKazeChat> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ao adicionar mensagens
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isThinking]);

  // Mostrar mensagem de boas-vindas ao abrir o chat pela primeira vez
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greetings = KAZE_GREETINGS[role] ?? KAZE_GREETINGS.passenger;
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      const name = userName ? `, ${userName.split(' ')[0]}` : '';
      setMessages([{
        role: 'model',
        text: `Olá${name}! ${greeting}`,
      }]);
      setKazeOnline(true);
    }
  }, [isOpen]);

  // Pensamentos espontâneos — só quando há corrida activa e não está em modo silencioso
  useEffect(() => {
    if (dataSaver || rideStatus === RideStatus.IDLE) return;

    const generate = async () => {
      try {
        const insight = await geminiService.getKazeInsight({
          role,
          status: rideStatus,
          name:   userName,
        });
        if (insight.text) {
          setThought(insight.text);
          setTimeout(() => setThought(null), 10000);
        }
      } catch {
        // Silêncio se offline — não mostrar erro
      }
    };

    const timer    = setTimeout(generate, 5000);
    const interval = setInterval(generate, 90000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [rideStatus, dataSaver, role, userName]);

  // ------------------------------------------------------------------
  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isThinking) return;

    const userText = inputValue.trim();
    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsThinking(true);

    try {
      if (mode === 'explore') {
        const result = await geminiService.exploreLuanda(userText);
        setMessages(prev => [...prev, { role: 'model', text: result.text, sources: result.sources }]);
        // FIX: só marcar online se não há mensagem de erro no texto
        setKazeOnline(!result.text.startsWith('⚠️') && !result.text.startsWith('❌'));
      } else {
        if (!chatRef.current) chatRef.current = geminiService.createKazeChat();
        const response = await chatRef.current.sendMessage(userText);
        // FIX: mostrar a mensagem real (que já inclui diagnóstico do geminiService)
        setMessages(prev => [...prev, { role: 'model', text: response.text }]);
        const isError = response.text.startsWith('⚠️') || response.text.startsWith('❌') || response.text.startsWith('🔒') || response.text.startsWith('⏱️');
        setKazeOnline(!isError);
      }
    } catch (err) {
      console.warn('[KazeMascot] Erro ao enviar:', err);
      setKazeOnline(false);
      setMessages(prev => [...prev, {
        role: 'model',
        text: err instanceof Error ? err.message : '❌ Erro desconhecido. Tenta de novo.',
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const startVoiceMode = async () => {
    setMode('voice');
    setIsLive(false);
    try {
      const session = await geminiService.connectKazeLive({
        onmessage: () => {},
        onclose: () => setIsLive(false),
      });
      if (session) { setIsLive(true); setVoiceError(null); }
      else { setIsLive(false); setVoiceError('Modo de voz temporariamente indisponível.'); }
    } catch { setIsLive(false); setVoiceError('Activa a Edge Function gemini-proxy no painel Supabase.'); }
  };

  const isDriver = role === UserRole.DRIVER;

  return (
    <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[600] flex flex-col items-center pointer-events-none">

      {/* Balão de pensamento espontâneo */}
      {thought && !isOpen && (
        <div
          className="mb-4 bg-surface-container/95 backdrop-blur-xl text-white p-5 rounded-[2.5rem] border-2 border-primary shadow-2xl max-w-[240px] animate-in slide-in-from-bottom-10 fade-in duration-700 pointer-events-auto cursor-pointer"
          onClick={() => setIsOpen(true)}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">Kaze · Lukeni</p>
          </div>
          <p className="text-xs font-bold italic">"{thought}"</p>
        </div>
      )}

      {/* Painel principal */}
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
          </div>

          {/* Corpo */}
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
          </div>

          {/* Input */}
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
      )}

      {/* Botão flutuante */}
      {/* O Avatar / Gatilho integrado no centro do navbar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-16 h-16 rounded-full overflow-hidden border-4 flex items-center justify-center shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-all pointer-events-auto active:scale-95 z-[601] ${
          isOpen ? 'bg-primary border-primary scale-110 shadow-[0_20px_50px_rgba(37,99,235,0.7)]' : 'bg-[#0B0B0B] border-[#0A0A0A] hover:bg-surface-container-low hover:border-primary/50'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-blue-900/40 to-transparent" />
        <img
          src={MASCOT_IMG}
          alt="Kaze Mascot"
          className={`w-10 h-10 object-contain drop-shadow-md transition-all duration-500 relative z-10 ${isOpen || isThinking ? 'scale-110' : ''}`}
        />
        {/* Glow indicator if alive */}
        {kazeOnline === true && (
          <span className="absolute bottom-2 right-3 w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_#4ade80] animate-pulse z-20" />
        )}
      </button>
    </div>
  );
};

export default KazeMascot;
