// =============================================================================
// ZENITH RIDE v3.1 — KazeMascot.tsx
// FIXES v3.1:
//   1. Tabs: VOZ adicionada de volta (estava oculta)
//   2. Mensagem de erro: mostra o texto real do geminiService (com diagnóstico)
//   3. Indicador online/offline mais claro
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { geminiService } from '../services/geminiService';
import { kazeSpeak } from '../lib/kazeVoice';
import { UserRole, RideStatus } from '../types';

interface KazeMascotProps {
  role:        UserRole;
  rideStatus:  RideStatus;
  dataSaver:   boolean;
  userName?:   string;
}

const MASCOT_IMG = '/kaze-avatar.png';
const MASCOT_FALLBACK = 'https://img.icons8.com/3d-fluency/180/robot-3.png';

type SupportedKazeGreetingRole = UserRole.PASSENGER | UserRole.DRIVER;

const KAZE_GREETINGS: Record<SupportedKazeGreetingRole, readonly string[]> = {
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

function getGreetingPool(role: UserRole): readonly string[] {
  return role === UserRole.DRIVER ? KAZE_GREETINGS.driver : KAZE_GREETINGS.passenger;
}

function pickGreeting(greetings: readonly string[]): string {
  const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
  return randomGreeting ?? greetings[0] ?? 'Estou aqui para ajudar.';
}

const KazeMascot: React.FC<KazeMascotProps> = ({ role, rideStatus, dataSaver, userName }) => {
  const [isOpen,      setIsOpen]      = useState(false);
  const [mode,        setMode]        = useState<'chat' | 'voice' | 'explore'>('chat');
  const [messages,    setMessages]    = useState<{ role: 'user' | 'model'; text: string; sources?: any[] }[]>([]);
  const [inputValue,  setInputValue]  = useState('');
  const [isThinking,  setIsThinking]  = useState(false);
  const [thought,     setThought]     = useState<string | null>(null);
  const [isLive,      setIsLive]      = useState(false);
  const [voiceError,  setVoiceError]  = useState<string | null>(null);
  const [kazeOnline,  setKazeOnline]  = useState<boolean | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true); // Ativado por defeito no app

  const chatRef   = useRef<ReturnType<typeof geminiService.createKazeChat> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ao adicionar mensagens
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isThinking]);

  // Mostrar mensagem de boas-vindas ao abrir o chat pela primeira vez
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting = pickGreeting(getGreetingPool(role));
      const name = userName ? `, ${userName.split(' ')[0]}` : '';
      setMessages([{
        role: 'model',
        text: `Olá${name}! ${greeting}`,
      }]);
      setKazeOnline(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, role, userName]);

  // Pensamentos espontâneos — SÓ quando corrida activa E painel aberto (economia de bateria/dados)
  useEffect(() => {
    // FIX: Só faz chamadas API quando há corrida activa E o Kaze está aberto
    if (dataSaver || rideStatus === RideStatus.IDLE) return;
    if (!isOpen) return; // Não gastar recursos com painel fechado

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
      } catch (err) {
        console.warn('[KazeMascot] fetch:', err);
        // Silêncio se offline — não mostrar erro
      }
    };

    const timer    = setTimeout(generate, 5000);
    const interval = setInterval(generate, 120000); // 2 min em vez de 90s — menos chamadas
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [rideStatus, dataSaver, role, userName, isOpen]);

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
        if (voiceEnabled) kazeSpeak(result.text);
        // FIX: só marcar online se não há mensagem de erro no texto
        setKazeOnline(!result.text.startsWith('⚠️') && !result.text.startsWith('❌'));
      } else {
        if (!chatRef.current) chatRef.current = geminiService.createKazeChat({ rideStatus, role, mode });
        const response = await chatRef.current.sendMessage(userText, { rideStatus, role, mode, time: new Date().toISOString() });
        setMessages(prev => [...prev, { role: 'model', text: response.text }]);
        if (voiceEnabled) kazeSpeak(response.text);
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
    } catch (err) {
      console.warn('[KazeMascot] voice:', err);
      setIsLive(false);
      setVoiceError('Activa a Edge Function gemini-proxy no painel Supabase.');
    }
  };

  const isDriver = role === UserRole.DRIVER;

  return (
    <div className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[600] flex flex-col items-center pointer-events-none">

      {/* Balão de pensamento espontâneo */}
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
      )}

      {/* Painel principal */}
      {isOpen && (
        <div className="zr-card" style={{ marginBottom: '16px', width: '90vw', maxWidth: '380px', height: '60vh', maxHeight: '500px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', pointerEvents: 'auto', border: '1px solid var(--gold-soft)', boxShadow: '0 20px 40px rgba(0,0,0,0.8)' }}>

          {/* Header */}
          <div className="zr-header" style={{ padding: '16px', borderBottom: '1px solid var(--surface-3)', background: 'linear-gradient(90deg, rgba(230,195,100,0.1), transparent)' }}>
            <div className="zr-inline zr-inline--between">
              <div className="zr-inline" style={{ gap: '12px' }}>
                <div style={{ width: '48px', height: '48px', background: 'var(--surface-3)', borderRadius: '12px', padding: '4px', position: 'relative' }}>
                  <img src={MASCOT_IMG} alt="Kaze" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={(e) => { e.currentTarget.src = MASCOT_FALLBACK; }} />
                </div>
                <div>
                  <h4 className="zr-section-title" style={{ fontSize: '14px', margin: 0 }}>KAZE 2.5</h4>
                  <span className="zr-meta" style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--gold)' }} className="" />
                    {isDriver ? 'MOTORISTA ONLINE' : 'VIGILANTE ONLINE'}
                  </span>
                </div>
              </div>
              <button onClick={() => setVoiceEnabled(!voiceEnabled)} className="zr-icon-button" style={{ marginRight: '8px', color: voiceEnabled ? 'var(--gold)' : 'var(--copy)' }}>
                <span className="material-symbols-outlined">{voiceEnabled ? 'volume_up' : 'volume_off'}</span>
              </button>
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
          </div>

          {/* Corpo */}
          <div ref={scrollRef} className="zr-chat" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {mode !== 'voice' ? (
              <>
                {messages.length === 0 && (
                  <div className="zr-empty" style={{ height: '100%', justifyContent: 'center' }}>
                    <img src={MASCOT_IMG} style={{ width: '80px', opacity: 0.5, marginBottom: '16px' }} alt="Kaze" onError={(e) => { e.currentTarget.src = MASCOT_FALLBACK; }} />
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
                  <div className={`transition-all duration-1000 ${isLive ? '' : ''}`} style={{ position: 'absolute', inset: '-20px', background: 'var(--gold)', borderRadius: '50%', filter: 'blur(30px)', opacity: isLive ? 0.3 : 0.1 }} />
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
          </div>

          {/* Input */}
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
      )}

      {/* Botão flutuante */}
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
          <span style={{ position: 'absolute', bottom: '8px', right: '8px', width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} className="" />
        )}
      </button>
    </div>
  );
};

export default KazeMascot;
