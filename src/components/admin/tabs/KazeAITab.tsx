import React, { useEffect, useRef, useState } from 'react';
import { geminiService } from '../../../services/geminiService';
import { kazeSpeak, setKazeVoicePreference } from '../../../lib/kazeVoice';
import { AutonomousCommand } from '../../../types';

const LISTENING_MAX_MS = 30000;

function getQuickLocalResponse(text: string): string {
  const t = text.toLowerCase();
  if (/ol[aá]|oi|bom dia|boa tarde|boa noite|hey|epa/i.test(t))
    return 'Ola! Sou o Kaze, o teu assistente no Zenith Ride. Como posso ajudar?';
  if (/pre[çc]o|quanto custa|custo|valor|tarifa/i.test(t))
    return 'Os precos no Zenith Ride sao fixos por zona. Consulta a tab "Precos por Zona" no menu.';
  if (/como.*funciona|ajuda|tutorial/i.test(t))
    return 'Escolhe origem e destino, ve o preco fixo, confirma e aguarda o motorista!';
  if (/kaze|quem.*[eé]s/i.test(t))
    return 'Sou o Kaze, assistente inteligente do Zenith Ride. Pergunta-me sobre precos, corridas ou Luanda!';
  if (/corrida|viagem|ir para|motorista|condutor/i.test(t))
    return 'Para pedir corrida: define origem, escreve destino, ve o preco e confirma. Simples!';
  return 'Estou em modo local (servidor IA indisponivel). Posso ajudar com precos, corridas e zonas de Luanda.';
}

export const KazeAITab: React.FC = () => {
  const [controlMode, setControlMode] = useState<'AUTO' | 'ASSISTED' | 'MANUAL'>('ASSISTED');
  const [directives, setDirectives] = useState<AutonomousCommand[]>([]);
  const [edgeStatus, setEdgeStatus] = useState<any>(null);
  const [agentOnline, setAgentOnline] = useState(false);
  const [edgeOnline, setEdgeOnline] = useState(false);
  const [kazeError, setKazeError] = useState<string | null>(null);
  const [kazeEdgeError, setKazeEdgeError] = useState<string | null>(null);
  const [kazeMode, setKazeMode] = useState<'ONLINE' | 'LOCAL'>('LOCAL');
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([
    { role: 'kaze', content: 'INICIAR NUCLEO KAZE... OK' },
    { role: 'kaze', content: 'SINCRONIZAR CLUSTER LUANDA... 24MS' },
  ]);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const recognitionRef = useRef<any>(null);
  const chatRef = useRef<ReturnType<typeof geminiService.createKazeChat> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(text: string) => Promise<void>>(async () => { });
  const listeningActiveRef = useRef(false);
  const listeningManualStopRef = useRef(false);
  const listeningFinalizingRef = useRef(false);
  const listeningTranscriptRef = useRef('');
  const listeningRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRunningRef = useRef(false);
  const audioFallbackRunningRef = useRef(false);

  if (!chatRef.current) {
    chatRef.current = geminiService.createKazeChat();
  }

  const clearListeningTimers = () => {
    if (listeningRestartTimerRef.current) {
      clearTimeout(listeningRestartTimerRef.current);
      listeningRestartTimerRef.current = null;
    }
    if (listeningSilenceTimerRef.current) {
      clearTimeout(listeningSilenceTimerRef.current);
      listeningSilenceTimerRef.current = null;
    }
    if (listeningTimeoutRef.current) {
      clearTimeout(listeningTimeoutRef.current);
      listeningTimeoutRef.current = null;
    }
  };

  const stopListeningSession = (manual = false) => {
    listeningActiveRef.current = false;
    listeningManualStopRef.current = manual;
    listeningFinalizingRef.current = false;
    listeningTranscriptRef.current = '';
    clearListeningTimers();
    setIsListening(false);
  };

  const stopRecognitionBeforeReply = () => {
    if (!recognitionRef.current || !listeningActiveRef.current) return;
    listeningManualStopRef.current = true;
    listeningActiveRef.current = false;
    clearListeningTimers();
    recognitionRef.current.stop?.();
    setIsListening(false);
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setAgentOnline(kazeMode === 'ONLINE');
    setEdgeOnline(kazeMode === 'ONLINE');
    setKazeError(kazeMode === 'LOCAL' ? 'Modo local ativo - agente local opcional' : null);
    setKazeEdgeError(kazeMode === 'LOCAL' ? 'Opcional - conversa funciona sem Edge' : null);
    setEdgeStatus(kazeMode === 'LOCAL' ? { running: false, optional: true } : null);
  }, [kazeMode]);

  useEffect(() => {
    const fetchDirectives = async () => {
      try {
        const data = await geminiService.getAutonomousDecisions({ role: 'admin', activeRideStatus: 'idle', multiplier: 1 });
        setDirectives(data);
      } catch (e) {
        console.warn('Erro ao obter diretivas:', e);
      }
    };

    void fetchDirectives();
    const interval = setInterval(fetchDirectives, 300000);
    return () => clearInterval(interval);
  }, []);

  const startAudioFallbackListening = async () => {
    if (audioFallbackRunningRef.current || isSpeaking) return;
    setMessages((prev) => [
      ...prev,
      { role: 'kaze', content: '[SISTEMA] Voz nativa indisponivel. Usa o campo de texto para comunicar com o Kaze.' },
    ]);
    stopListeningSession();
  };

  useEffect(() => {
    if (!window.isSecureContext) {
      setMessages((prev) => [
        ...prev,
        { role: 'kaze', content: '[SISTEMA] Voz nativa indisponivel. Usa o campo de texto para comunicar com o Kaze.' },
      ]);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((prev) => [
        ...prev,
        { role: 'kaze', content: '[SISTEMA] Voz nativa indisponivel. Usa o campo de texto para comunicar com o Kaze.' },
      ]);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-PT';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const armSessionTimeout = () => {
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
      listeningTimeoutRef.current = setTimeout(() => {
        if (!listeningActiveRef.current || !recognitionRef.current) return;
        listeningFinalizingRef.current = true;
        recognitionRef.current.stop?.();
      }, LISTENING_MAX_MS);
    };

    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setIsListening(true);
      armSessionTimeout();
    };

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results ?? [])
        .map((result: any) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();
      const finalTranscript = Array.from(event.results ?? [])
        .filter((result: any) => result.isFinal)
        .map((result: any) => result?.[0]?.transcript || '')
        .join(' ')
        .trim();

      if (!transcript) return;
      if (finalTranscript) {
        listeningTranscriptRef.current = finalTranscript;
        listeningFinalizingRef.current = true;
        recognitionRef.current?.stop?.();
      }
      armSessionTimeout();
    };

    recognition.onerror = (event: any) => {
      const errCode = String(event?.error || 'unknown');

      if (errCode === 'aborted' && (listeningManualStopRef.current || listeningFinalizingRef.current)) {
        return;
      }

      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'no-speech'].includes(errCode)) {
        stopListeningSession();
        void startAudioFallbackListening();
        return;
      }

      if (!['no-speech', 'aborted', 'network'].includes(errCode)) {
        setMessages((prev) => [...prev, { role: 'kaze', content: `[SISTEMA] Erro de voz: ${errCode}` }]);
      }

      if (listeningActiveRef.current) {
        stopListeningSession();
      }
    };

    recognition.onend = () => {
      recognitionRunningRef.current = false;
      const finalText = listeningTranscriptRef.current.trim();

      if (listeningManualStopRef.current) {
        stopListeningSession();
        return;
      }

      if (listeningActiveRef.current && finalText) {
        stopListeningSession();
        void handleSendRef.current(finalText);
        return;
      }

      if (listeningActiveRef.current && listeningFinalizingRef.current) {
        stopListeningSession();
        return;
      }

      if (listeningActiveRef.current) {
        stopListeningSession();
        return;
      }

      stopListeningSession();
    };

    recognitionRef.current = recognition;

    return () => {
      clearListeningTimers();
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop?.();
      }
      listeningActiveRef.current = false;
      listeningManualStopRef.current = true;
      recognitionRunningRef.current = false;
      listeningFinalizingRef.current = false;
      listeningTranscriptRef.current = '';
      recognitionRef.current = null;
    };
  }, []);

  const handleSend = async (text: string) => {
    const clean = text.trim();
    if (!clean) return;

    setInput('');
    try { stopRecognitionBeforeReply(); } catch { /* silenciado */ }
    setMessages((prev) => [...prev, { role: 'user', content: clean }]);

    let replyText = '';

    try {
      const response = await chatRef.current!.sendMessage(clean);
      replyText = response.text;
      setKazeMode(response.local ? 'LOCAL' : 'ONLINE');

      // ── Side-effects: abrir URLs, copiar código, etc. ──
      const toolResult = (response as any).toolResult?.result || (response as any).toolResult;
      if (toolResult) {
        const toolName = (response as any).toolName;
        // Abrir URL no browser
        if (toolResult.url) {
          try {
            window.open(toolResult.url, '_blank');
          } catch (e) {
            console.warn('[KazeAITab] Falha ao abrir URL:', e);
          }
        }
        // Copiar código gerado para clipboard
        if (toolName === 'generate_code' && toolResult.code) {
          try {
            await navigator.clipboard.writeText(toolResult.code);
            replyText += '\n\n[CÓDIGO COPIADO PARA A ÁREA DE TRANSFERÊNCIA]';
          } catch (e) {
            console.warn('[KazeAITab] Falha ao copiar código:', e);
          }
        }
        // Notificar criação de agente
        if (toolName === 'create_agent' && toolResult.agent) {
          replyText += `\n\n[AGENTE "${toolResult.agent.name}" CRIADO]`;
        }
      }
    } catch (e: any) {
      console.warn('[KazeAITab.handleSend] Erro:', e?.message);
      replyText = getQuickLocalResponse(clean);
      setKazeMode('LOCAL');
    }

    setMessages((prev) => [...prev, { role: 'kaze', content: replyText }]);

    try {
      setIsSpeaking(true);
      setKazeVoicePreference('pt-BR-AntonioNeural');
      await kazeSpeak(replyText, null);
    } catch (voiceErr: any) {
      console.warn('[KazeAITab] Voz indisponivel:', voiceErr?.message || voiceErr);
    } finally {
      setIsSpeaking(false);
    }
  };

  handleSendRef.current = handleSend;

  const toggleListen = () => {
    if (isSpeaking) return;
    if (!recognitionRef.current) {
      void startAudioFallbackListening();
      return;
    }

    if (listeningActiveRef.current) {
      listeningManualStopRef.current = true;
      listeningActiveRef.current = false;
      clearListeningTimers();
      try { recognitionRef.current.stop?.(); } catch { /* silenciado */ }
      setIsListening(false);
      return;
    }

    // If the browser recognition is still active (onend hasn't fired yet),
    // force-stop it first and let onend → scheduleRestart handle the new start
    if (recognitionRunningRef.current) {
      listeningActiveRef.current = false;
      listeningManualStopRef.current = true;
      listeningFinalizingRef.current = false;
      listeningTranscriptRef.current = '';
      clearListeningTimers();
      try { recognitionRef.current.stop?.(); } catch { /* silenciado */ }
      setIsListening(false);
      // onend will fire → sees listeningActiveRef=true, no text → scheduleRecognitionRestart
      return;
    }

    try {
      listeningActiveRef.current = true;
      listeningManualStopRef.current = false;
      listeningFinalizingRef.current = false;
      listeningTranscriptRef.current = '';
      clearListeningTimers();
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e: any) {
      if (e?.message?.includes('already started')) {
        // Recognition is running despite our tracking — reset state and let it continue
        listeningActiveRef.current = true;
        recognitionRunningRef.current = true;
        setIsListening(true);
        return;
      }
      listeningActiveRef.current = false;
      setIsListening(false);
      setMessages((prev) => [...prev, { role: 'kaze', content: `[ERRO MICROFONE] ${e.message}` }]);
    }
  };

  return (
    <div className="h-[calc(100vh-64px)] w-full flex flex-col md:flex-row relative bg-[#000000]">
      <section className="flex-1 relative overflow-hidden bg-[#000000] flex items-center justify-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(230,195,100,0.03)_0%,_rgba(0,0,0,1)_70%)] z-0"></div>

        <div
          onClick={toggleListen}
          className="relative z-10 flex items-center justify-center cursor-pointer"
          title="Clique para falar com o Kaze"
        >
          <div
            className={`absolute w-40 h-40 rounded-full transition-all duration-700 ease-in-out mix-blend-screen
            ${isSpeaking ? 'bg-primary/30 blur-[40px] scale-110 animate-[spin_3s_linear_infinite]' :
                isListening ? 'bg-primary/20 blur-[30px] scale-105 animate-pulse' :
                  'bg-primary/10 blur-[20px] scale-100'}`}
          ></div>

          <div
            className={`absolute rounded-full transition-all duration-500 ease-out flex items-center justify-center
            ${isSpeaking ? 'w-32 h-32 bg-[radial-gradient(circle,_rgba(255,255,255,0.9)_0%,_rgba(242,202,80,0.8)_40%,_transparent_100%)] shadow-[0_0_30px_rgba(242,202,80,0.6)] animate-[pulse_1s_ease-in-out_infinite]' :
                isListening ? 'w-28 h-28 bg-[radial-gradient(circle,_rgba(255,255,255,0.8)_0%,_rgba(242,202,80,0.6)_50%,_transparent_100%)] shadow-[0_0_20px_rgba(242,202,80,0.4)]' :
                  'w-24 h-24 bg-[radial-gradient(circle,_rgba(230,195,100,0.4)_0%,_rgba(230,195,100,0.1)_70%,_transparent_100%)] hover:scale-105 shadow-[0_0_15px_rgba(230,195,100,0.2)]'}`}
          >
            <div
              className={`rounded-full bg-white transition-all duration-300
              ${isSpeaking ? 'w-8 h-8 opacity-100' : isListening ? 'w-4 h-4 opacity-80' : 'w-2 h-2 opacity-50'}`}
            />
          </div>
        </div>

        <div className="absolute bottom-20 text-center z-10 w-full opacity-70 pointer-events-none">
          <p className="font-headline-lg text-primary tracking-[0.3em] uppercase text-sm">
            {isSpeaking ? 'A TRANSMITIR' : isListening ? 'A OUVIR' : 'KAZE PRONTO'}
          </p>
        </div>
      </section>

      <section className="w-full md:w-[420px] bg-[#050505] border-l border-primary/15 flex flex-col z-30 h-full relative">
        <div className="p-lg border-b border-primary/15 bg-surface-container/50 backdrop-blur-md">
          <div className="flex justify-between items-center mb-md">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
              <h1 className="font-headline-lg text-primary tracking-tight">Nucleo KAZE AI</h1>
            </div>
            <div className="flex items-center gap-xs bg-surface-variant px-sm py-1 rounded-full border border-primary/15">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
              <span className="font-label-sm text-primary">{kazeMode === 'ONLINE' ? 'LIVE' : 'LOCAL'}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-label-sm text-on-surface-variant uppercase tracking-widest">Estado do Sistema</span>
            <div className="flex justify-between items-end">
              <div>
                <span className={`font-display-lg leading-none ${agentOnline ? 'text-on-surface' : 'text-error'}`}>
                  {kazeMode === 'ONLINE' ? 'OTIMIZAR' : 'MODO LOCAL'}
                </span>
                {!agentOnline && kazeError && (
                  <p className="text-xs font-mono text-red-400/60 mt-1">{kazeError}</p>
                )}
              </div>
              <div className="text-right flex flex-col items-end">
                <span className="font-label-md text-primary bg-primary/10 px-2 py-1 rounded">
                  {edgeOnline ? 'KAZE EDGE ATIVO' : 'SEM KAZE EDGE'}
                </span>
                {!edgeOnline && kazeEdgeError && (
                  <p className="text-xs font-mono text-red-400/60 mt-1">{kazeEdgeError}</p>
                )}
              </div>
            </div>
            {edgeStatus?.remoteStatus?.repoPath && (
              <p className="text-[10px] font-mono text-on-surface-variant/70 mt-2">
                Edge repo: {edgeStatus.remoteStatus.repoPath}
              </p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-lg flex flex-col gap-xl">
          <div className="flex flex-col gap-sm">
            <span className="font-label-sm text-on-surface-variant uppercase tracking-widest">Modo de Controlo</span>
            <div className="flex bg-surface-container-high rounded-md p-1 border border-primary/15">
              {(['AUTO', 'ASSISTIDO', 'MANUAL'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setControlMode(mode === 'ASSISTIDO' ? 'ASSISTED' : mode)}
                  className={`flex-1 py-2 font-label-md transition-all rounded text-center uppercase ${(controlMode === mode || (controlMode === 'ASSISTED' && mode === 'ASSISTIDO'))
                      ? 'text-primary bg-surface border border-primary/15 shadow-[0_0_15px_rgba(233,195,73,0.3)]'
                      : 'text-on-surface hover:text-primary'
                    }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-md">
            <div className="flex justify-between items-center">
              <span className="font-label-sm text-on-surface-variant uppercase tracking-widest">Diretivas Ativas</span>
              <button
                type="button"
                onClick={() => void geminiService.getAutonomousDecisions({ role: 'admin', activeRideStatus: 'idle', multiplier: 1 }).then(setDirectives).catch((error) => console.warn('Erro ao actualizar diretivas:', error))}
                className="material-symbols-outlined text-on-surface-variant text-sm cursor-pointer hover:text-primary transition-colors"
                title="Actualizar diretivas"
              >
                refresh
              </button>
            </div>

            {directives.length === 0 ? (
              <div className="text-center p-6 border border-outline-variant/20 rounded-lg">
                <span className="font-label-sm text-on-surface-variant uppercase">Sem novas diretivas</span>
              </div>
            ) : (
              directives.map((dir) => (
                <div key={dir.id} className="bg-surface/80 border border-primary/15 p-md rounded-lg flex flex-col gap-md shadow-sm">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-sm">
                      <span className="material-symbols-outlined text-secondary text-lg">
                        {dir.type === 'REALLOCATE' ? 'route' : dir.type === 'SURGE_PRICE' ? 'payments' : 'security'}
                      </span>
                      <span className="font-body-sm text-on-surface font-medium">{dir.target}</span>
                    </div>
                  </div>
                  <p className="font-body-sm text-on-surface-variant text-sm">{dir.reason}</p>
                  <div className="flex gap-sm mt-sm">
                    <button className="flex-1 bg-primary text-[#000000] font-label-md py-2 rounded hover:bg-primary-fixed transition-colors font-bold">EXECUTAR</button>
                    <button className="flex-1 bg-transparent border border-primary/15 text-primary font-label-md py-2 rounded hover:bg-primary/10 transition-colors font-bold">IGNORAR</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-sm mt-auto pb-4">
            <span className="font-label-sm text-on-surface-variant uppercase tracking-widest">Terminal Kaze Edge</span>
            <div className="bg-surface-container-lowest border border-primary/15 p-sm rounded-lg h-40 overflow-y-auto font-mono text-[10px] leading-relaxed text-outline-variant shadow-inner flex flex-col gap-1">
              {messages.map((message, index) => (
                <div key={index} className={message.role === 'kaze' ? 'text-primary' : 'text-on-surface-variant ml-4'}>
                  &gt; {message.role === 'kaze' ? '' : 'UTILIZADOR: '}{message.content}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSend(input);
                }}
                placeholder="Introduza comando de override..."
                className="flex-1 bg-surface-container-lowest border border-primary/15 text-on-surface font-mono text-xs rounded px-2 py-1 focus:border-primary focus:outline-none"
              />
              <button
                onClick={() => void handleSend(input)}
                className="bg-primary/20 text-primary border border-primary/30 px-3 rounded hover:bg-primary hover:text-on-primary transition-colors font-bold text-xs"
              >
                EXEC
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

