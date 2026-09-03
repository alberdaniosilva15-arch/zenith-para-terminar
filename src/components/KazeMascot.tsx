// =============================================================================
// ZENITH RIDE v3.9 — KazeMascot.tsx
// KAZE OPERACIONAL — AGENTE EXECUTIVO NO APP
// Capacidades:
//   1. Microfone com reconhecimento de fala em tempo real (Web Speech API com transcrição ao vivo)
//   2. Pedir / criar corrida por voz e texto com rotas e preços corretos em Luanda
//   3. Agendar corridas futuras (grava em scheduled_rides)
//   4. Criar contratos (escolar/familiar/corporativo)
//   5. Consultar saldo da carteira e navegar entre telas (/wallet, /rides, /contrato)
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { geminiService, getLocalKazeResponse } from '../services/geminiService';
import { kazeAppAgent, KazeProposedAction } from '../services/kazeAppAgent';
import { kazeSpeak } from '../lib/kazeVoice';
import { UserRole, RideStatus, LatLng } from '../types';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';

interface KazeMascotProps {
  role:            UserRole;
  rideStatus:      RideStatus;
  dataSaver:       boolean;
  userName?:       string;
  userId?:         string;
  onRequestRide?:  (
    pickup: string,
    pickupCoords: LatLng,
    dest: string,
    destCoords: LatLng,
    proposedPrice?: number,
    distanceKm?: number,
    durationMin?: number,
    vehicleType?: 'standard' | 'moto' | 'comfort' | 'xl'
  ) => Promise<void>;
  onCancelRide?:   (reason?: string) => Promise<void>;
  onNavigate?:     (path: string) => void;
  userLocation?:   LatLng | null;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  sources?: any[];
  action?: KazeProposedAction;
}

type SupportedKazeGreetingRole = UserRole.PASSENGER | UserRole.DRIVER;

const KAZE_GREETINGS: Record<SupportedKazeGreetingRole, readonly string[]> = {
  passenger: [
    'Olá! Sou o Kaze. Podes falar comigo pelo microfone ou escrever: "pede um táxi para o Belas Shopping", agendar viagens ou ver o teu saldo!',
    'Pronto para sair em Luanda? Toca no microfone e diz-me para onde queres ir!',
    'Bem-vindo ao Zenith Ride! Posso pedir a tua corrida, agendar ou ver o teu saldo em segundos.',
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

const KazeMascot: React.FC<KazeMascotProps> = ({
  role,
  rideStatus,
  dataSaver,
  userName,
  userId,
  onRequestRide,
  onCancelRide,
  onNavigate,
  userLocation,
}) => {
  const showToast = useAppStore((s) => s.showToast);
  const [isOpen,          setIsOpen]          = useState(false);
  const [mode,            setMode]            = useState<'chat' | 'voice' | 'explore'>('chat');
  const [messages,        setMessages]        = useState<ChatMessage[]>([]);
  const [inputValue,      setInputValue]      = useState('');
  const [isThinking,      setIsThinking]      = useState(false);
  const [thought,         setThought]         = useState<string | null>(null);
  const [isLive,          setIsLive]          = useState(false);
  const [voiceError,      setVoiceError]      = useState<string | null>(null);
  const [kazeOnline,      setKazeOnline]      = useState<boolean | null>(true);
  const [voiceEnabled,    setVoiceEnabled]    = useState(true);
  const [isListeningMic,  setIsListeningMic]  = useState(false);
  const [actionExecuting, setActionExecuting] = useState(false);
  const [pendingAction,   setPendingAction]   = useState<KazeProposedAction | null>(null);

  const liveSessionRef   = useRef<{ close: () => void } | null>(null);
  const scrollRef        = useRef<HTMLDivElement>(null);
  const recognitionRef   = useRef<any>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll ao adicionar mensagens
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isThinking, pendingAction, isListeningMic]);

  useEffect(() => () => {
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
  }, []);

  // Mensagem de boas-vindas
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting = pickGreeting(getGreetingPool(role));
      const name = userName ? `, ${userName.split(' ')[0]}` : '';
      setMessages([{
        role: 'model',
        text: `Olá${name}! ${greeting}`,
      }]);
    }
  }, [isOpen, role, userName, messages.length]);

  // Pensamentos espontâneos
  useEffect(() => {
    if (dataSaver || rideStatus === RideStatus.IDLE) return;
    if (!isOpen) return;

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
        console.warn('[KazeMascot] insight:', err);
      }
    };

    const timer    = setTimeout(generate, 5000);
    const interval = setInterval(generate, 120000);
    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [rideStatus, dataSaver, role, userName, isOpen]);

  // ── Executar Acção no App (Disparada pelo utilizador ou confirmada pela IA) ─
  const executeAppAction = useCallback(async (action: KazeProposedAction) => {
    setActionExecuting(true);
    try {
      switch (action.type) {
        case 'REQUEST_RIDE': {
          if (!onRequestRide) {
            showToast('Pedido de corrida indisponível nesta tela.', 'error');
            return;
          }
          const d = action.data;
          await onRequestRide(
            d.origin,
            d.originCoords,
            d.destination,
            d.destCoords,
            d.priceKz,
            d.distanceKm,
            d.durationMin,
            d.vehicleType
          );
          setPendingAction(null);
          setMessages(prev => [
            ...prev,
            {
              role: 'model',
              text: `✅ **Corrida solicitada com sucesso!**\nA procurar motoristas próximos em Luanda... 🚗💨`,
            },
          ]);
          if (voiceEnabled) await kazeSpeak('Corrida solicitada com sucesso! A procurar motoristas.');
          showToast('Corrida solicitada pelo Kaze!', 'success');
          setTimeout(() => setIsOpen(false), 2500);
          break;
        }

        case 'SCHEDULE_RIDE': {
          if (!userId) {
            showToast('Inicia sessão para agendar uma corrida.', 'info');
            return;
          }
          const s = action.data;
          const { error: dbError } = await supabase.from('scheduled_rides').insert({
            user_id:        userId,
            pickup_address: s.origin,
            pickup_lat:     s.originCoords.lat,
            pickup_lng:     s.originCoords.lng,
            dest_address:   s.destination,
            dest_lat:       s.destCoords.lat,
            dest_lng:       s.destCoords.lng,
            scheduled_at:   s.scheduledAt,
            status:         'pending',
          });

          if (dbError) {
            showToast(`Erro ao agendar: ${dbError.message}`, 'error');
            return;
          }

          setPendingAction(null);
          setMessages(prev => [
            ...prev,
            {
              role: 'model',
              text: `📅 **Viagem agendada com sucesso!**\nData: ${s.date} às ${s.time}\nDestino: ${s.destination}\n\nPodes consultar a qualquer momento nos teus agendamentos.`,
            },
          ]);
          if (voiceEnabled) await kazeSpeak(`Viagem agendada para ${s.date} às ${s.time}.`);
          showToast('Viagem agendada com sucesso!', 'success');
          break;
        }

        case 'CREATE_CONTRACT': {
          if (!userId) {
            showToast('Inicia sessão para criar um contrato.', 'info');
            return;
          }
          const c = action.data;
          const { error: dbError } = await supabase.from('contracts').insert({
            user_id:       userId,
            contract_type: c.contractType,
            title:         c.title,
            address:       c.address,
            dest_lat:      c.destLat,
            dest_lng:      c.destLng,
            time_start:    c.timeStart,
            time_end:      c.timeEnd,
            active:        true,
          });

          if (dbError) {
            showToast(`Erro ao criar contrato: ${dbError.message}`, 'error');
            return;
          }

          setPendingAction(null);
          setMessages(prev => [
            ...prev,
            {
              role: 'model',
              text: `🎓 **${c.title} activado com sucesso!**\nHorário: ${c.timeStart} - ${c.timeEnd}\nDestino: ${c.destinationAddress}\n\nPodes gerir o teu contrato na aba Contratos.`,
            },
          ]);
          if (voiceEnabled) await kazeSpeak('Contrato criado com sucesso!');
          showToast('Contrato criado!', 'success');
          break;
        }

        case 'NAVIGATE_APP': {
          if (onNavigate) {
            const screenMap: Record<string, string> = {
              wallet:   '/wallet',
              rides:    '/rides',
              contrato: '/contrato',
              precos:   '/precos',
              profile:  '/profile',
              home:     '/',
            };
            const target = screenMap[action.data.screen] || `/${action.data.screen}`;
            onNavigate(target);
            setPendingAction(null);
            setIsOpen(false);
          }
          break;
        }

        case 'CANCEL_RIDE': {
          if (onCancelRide) {
            await onCancelRide(action.data?.reason || 'Cancelado pelo passageiro via Kaze');
            setPendingAction(null);
            setMessages(prev => [
              ...prev,
              { role: 'model', text: 'Corrida cancelada com sucesso.' },
            ]);
            if (voiceEnabled) await kazeSpeak('Corrida cancelada com sucesso.');
          }
          break;
        }
      }
    } catch (err: any) {
      console.error('[KazeMascot] Erro ao executar acção:', err);
      showToast('Ocorreu um erro ao processar a acção.', 'error');
    } finally {
      setActionExecuting(false);
    }
  }, [onRequestRide, onCancelRide, onNavigate, userId, voiceEnabled, showToast]);

  // ── Envio de Texto / Comando ───────────────────────────────────────────────
  const handleSendText = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const userText = (customText || inputValue).trim();
    if (!userText || isThinking) return;

    setInputValue('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsThinking(true);

    try {
      if (mode === 'explore') {
        const result = await geminiService.exploreLuanda(userText);
        setMessages(prev => [...prev, { role: 'model', text: result.text, sources: result.sources }]);
        if (voiceEnabled) await kazeSpeak(result.text);
      } else {
        // Passar pelo Kaze App Agent operacional com localização actual de Luanda
        const agentResult = await kazeAppAgent.processUserMessage(userText, {
          userId,
          userRole: role,
          userLocation,
          hasActiveRide: rideStatus !== RideStatus.IDLE,
          pendingAction,
        });

        // Se o utilizador confirmou por texto/voz
        if (agentResult.action && agentResult.action.status === 'confirmed') {
          setMessages(prev => [...prev, { role: 'model', text: agentResult.text }]);
          if (voiceEnabled && agentResult.speakText) await kazeSpeak(agentResult.speakText);
          await executeAppAction(agentResult.action);
          return;
        }

        // Se cancelou
        if (agentResult.action && agentResult.action.status === 'cancelled') {
          setPendingAction(null);
          setMessages(prev => [...prev, { role: 'model', text: agentResult.text }]);
          if (voiceEnabled && agentResult.speakText) await kazeSpeak(agentResult.speakText);
          return;
        }

        // Se uma nova acção foi proposta
        if (agentResult.action && agentResult.action.status === 'pending') {
          setPendingAction(agentResult.action);
          setMessages(prev => [
            ...prev,
            {
              role: 'model',
              text: agentResult.text,
              action: agentResult.action,
            },
          ]);
          if (voiceEnabled && agentResult.speakText) await kazeSpeak(agentResult.speakText);
          return;
        }

        // Conversa padrão
        setMessages(prev => [...prev, { role: 'model', text: agentResult.text }]);
        if (voiceEnabled && agentResult.speakText) await kazeSpeak(agentResult.speakText);
      }
    } catch (err: any) {
      console.warn('[KazeMascot] Erro ao enviar:', err);
      const fallbackText = getLocalKazeResponse(userText);
      setMessages(prev => [...prev, { role: 'model', text: fallbackText }]);
      if (voiceEnabled) await kazeSpeak(fallbackText);
    } finally {
      setIsThinking(false);
    }
  };

  // ── Reconhecimento de Fala pelo Microfone com Feedback em Tempo Real ─────────
  const toggleMicListening = async () => {
    // 1. Se já está a ouvir, parar
    if (isListeningMic) {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
      setIsListeningMic(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showToast('O teu navegador não suporta reconhecimento de voz. Usa o Chrome ou digita no teclado!', 'info');
      return;
    }

    try {
      // Pedir permissão de microfone se necessário (mostra o popup do browser)
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
        } catch (permErr: any) {
          if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
            showToast('Permissão de microfone negada. Permite o microfone no navegador.', 'error');
            return;
          }
        }
      }

      const recognition = new SpeechRecognition();
      // Usar idioma do sistema ou português
      const sysLang = navigator.language || 'pt-PT';
      recognition.lang = sysLang.startsWith('pt') ? sysLang : 'pt-PT';
      recognition.continuous = false;
      recognition.interimResults = true; // Transcrição ao vivo na tela!
      recognition.maxAlternatives = 1;

      let capturedText = '';

      recognition.onstart = () => {
        setIsListeningMic(true);
        setInputValue('');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            capturedText += trans;
          } else {
            interim += trans;
          }
        }

        const liveText = (capturedText || interim).trim();
        if (liveText) {
          setInputValue(liveText);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[KazeMascot] Speech recognition error:', event.error);
        setIsListeningMic(false);

        if (event.error === 'not-allowed') {
          showToast('Permissão de microfone negada.', 'error');
        } else if (event.error === 'no-speech') {
          if (capturedText.trim().length > 1) {
            void handleSendText(undefined, capturedText.trim());
            return;
          }
          showToast('Não ouvi nenhuma voz. Toca no microfone e fala mais alto.', 'info');
        }
      };

      recognition.onend = () => {
        setIsListeningMic(false);
        const textToSend = (capturedText || inputValue).trim();
        if (textToSend.length > 1) {
          void handleSendText(undefined, textToSend);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();

      // Parar automaticamente após 10 segundos
      autoStopTimerRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch { /* ignore */ }
        }
      }, 10000);
    } catch (err: any) {
      console.warn('[KazeMascot] Erro ao iniciar voz:', err);
      setIsListeningMic(false);
      showToast('Erro ao activar o microfone. Podes escrever no teclado!', 'info');
    }
  };

  const startVoiceMode = async () => {
    setMode('voice');
    setIsLive(false);
    setVoiceError(null);
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    try {
      const session = await geminiService.connectKazeLive({
        onmessage: () => {},
        onclose: () => {
          setIsLive(false);
          liveSessionRef.current = null;
        },
      });
      if (session) {
        liveSessionRef.current = session;
        setIsLive(true);
        setVoiceError(null);
      } else {
        setIsLive(false);
        setVoiceError('Modo de voz temporariamente indisponível.');
      }
    } catch (err) {
      console.warn('[KazeMascot] voice:', err);
      setIsLive(false);
      setVoiceError(err instanceof Error ? err.message : 'Falha ao iniciar o modo de voz.');
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
            <p className="zr-meta" style={{ color: 'var(--gold)' }}>Kaze · Zenith Ride</p>
          </div>
          <p className="zr-copy" style={{ fontStyle: 'italic', fontWeight: 'bold' }}>"{thought}"</p>
        </div>
      )}

      {/* Painel principal */}
      {isOpen && (
        <div className="zr-card" style={{ marginBottom: '16px', width: '92vw', maxWidth: '400px', height: '65vh', maxHeight: '540px', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', pointerEvents: 'auto', border: '1px solid var(--gold-soft)', boxShadow: '0 20px 40px rgba(0,0,0,0.85)' }}>

          {/* Header */}
          <div className="zr-header" style={{ padding: '14px 16px', borderBottom: '1px solid var(--surface-3)', background: 'linear-gradient(90deg, rgba(230,195,100,0.15), transparent)' }}>
            <div className="zr-inline zr-inline--between">
              <div className="zr-inline" style={{ gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', background: 'var(--surface-3)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--gold)', fontSize: '26px' }}>auto_awesome</span>
                </div>
                <div>
                  <h4 className="zr-section-title" style={{ fontSize: '13px', margin: 0, letterSpacing: '0.05em' }}>KAZE AGENT 3.0</h4>
                  <span className="zr-meta" style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: kazeOnline ? '#4ade80' : 'var(--gold)' }} />
                    {kazeOnline ? (isDriver ? 'MOTORISTA ONLINE' : 'AGENTE OPERACIONAL') : 'MODO LOCAL'}
                  </span>
                </div>
              </div>
              <div className="zr-inline" style={{ gap: '4px' }}>
                <button
                  onClick={() => setVoiceEnabled(!voiceEnabled)}
                  className="zr-icon-button"
                  style={{ width: '36px', height: '36px', color: voiceEnabled ? 'var(--gold)' : 'var(--copy)' }}
                  title={voiceEnabled ? 'Voz activada' : 'Voz desativada'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{voiceEnabled ? 'volume_up' : 'volume_off'}</span>
                </button>
                <button onClick={() => setIsOpen(false)} className="zr-icon-button" style={{ width: '36px', height: '36px' }}>✕</button>
              </div>
            </div>
          </div>

          {/* Tabs de modo */}
          <div style={{ padding: '0 16px', marginTop: '12px' }}>
            <div className="zr-scroll-x" style={{ background: 'var(--surface-3)', borderRadius: '12px', padding: '4px' }}>
              {(['chat', 'explore', 'voice'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => m === 'voice' ? startVoiceMode() : setMode(m)}
                  className={`zr-tab ${mode === m ? 'is-active' : ''}`}
                  style={{ flex: 1, padding: '6px', fontSize: '10px' }}
                >
                  {m === 'chat' ? 'Comandos & Chat' : m === 'explore' ? 'Trânsito Luanda' : 'Voz Ao Vivo'}
                </button>
              ))}
            </div>
          </div>

          {/* Corpo do Chat */}
          <div ref={scrollRef} className="zr-chat" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {mode !== 'voice' ? (
              <>
                {messages.length === 0 && (
                  <div className="zr-empty" style={{ height: '100%', justifyContent: 'center' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '56px', color: 'var(--gold)', opacity: 0.3, marginBottom: '12px' }}>auto_awesome</span>
                    <p className="zr-meta" style={{ textAlign: 'center', maxWidth: '220px', fontSize: '11px' }}>
                      "Kaze, pede um táxi para o Belas Shopping"<br/>
                      "Kaze, agenda para amanhã às 8h"<br/>
                      "Kaze, qual é o meu saldo?"
                    </p>
                  </div>
                )}

                {messages.map((m, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className={`zr-bubble ${m.role === 'user' ? 'zr-bubble--self' : 'zr-bubble--other'}`}>
                      <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>

                      {/* Fontes do Explore */}
                      {m.sources && m.sources.length > 0 && (
                        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--surface-3)' }}>
                          <p className="zr-meta" style={{ marginBottom: '6px' }}>Fontes:</p>
                          <div className="zr-stack" style={{ gap: '6px' }}>
                            {m.sources.map((s: any, si: number) => (
                              <a key={si} href={s.uri} target="_blank" rel="noreferrer" className="zr-chip" style={{ justifyContent: 'flex-start' }}>
                                <span className="material-symbols-outlined" style={{fontSize: 'inherit', verticalAlign: 'middle'}}>location_on</span>
                                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{s.title}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── CARTÃO INTERATIVO DE AÇÃO PROPOSTA ──────────────────── */}
                    {m.action && pendingAction?.id === m.action.id && pendingAction.status === 'pending' && (
                      <div
                        className="rounded-2xl p-4 border space-y-3 vault-shadow animate-fade-in"
                        style={{
                          background: 'linear-gradient(135deg, rgba(230,195,100,0.12), rgba(0,0,0,0.6))',
                          borderColor: 'var(--gold, #e6c364)',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-xl" style={{ color: 'var(--gold)' }}>
                            {m.action.type === 'REQUEST_RIDE' ? 'local_taxi' :
                             m.action.type === 'SCHEDULE_RIDE' ? 'calendar_month' :
                             m.action.type === 'CREATE_CONTRACT' ? 'school' :
                             m.action.type === 'NAVIGATE_APP' ? 'open_in_new' : 'warning'}
                          </span>
                          <span className="text-xs font-black uppercase tracking-wider text-on-surface">
                            {m.action.title}
                          </span>
                        </div>

                        <p className="text-xs text-on-surface-variant font-medium">
                          {m.action.summary}
                        </p>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            onClick={() => executeAppAction(m.action!)}
                            disabled={actionExecuting}
                            className="zr-button zr-button--block font-bold text-xs"
                            style={{
                              padding: '10px 8px',
                              background: 'var(--gold, #e6c364)',
                              color: '#000',
                              border: 'none',
                              borderRadius: '10px',
                            }}
                          >
                            {actionExecuting ? 'A processar...' : '✓ Confirmar'}
                          </button>
                          <button
                            onClick={() => {
                              setPendingAction(null);
                              setMessages(prev => [...prev, { role: 'model', text: 'Ação cancelada.' }]);
                            }}
                            disabled={actionExecuting}
                            className="zr-button zr-button--secondary zr-button--block text-xs"
                            style={{
                              padding: '10px 8px',
                              borderColor: 'rgba(239, 68, 68, 0.4)',
                              color: 'var(--danger-soft, #ef4444)',
                              borderRadius: '10px',
                            }}
                          >
                            ✕ Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {isListeningMic && (
                  <div className="zr-bubble zr-bubble--other" style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #ef4444' }}>
                    <span className="w-2.5 h-2.5 rounded-full animate-ping" style={{ backgroundColor: '#ef4444' }} />
                    <span className="zr-meta" style={{ margin: 0, color: '#ef4444', fontWeight: 'bold' }}>
                      A ouvir... Fala o teu pedido!
                    </span>
                  </div>
                )}

                {isThinking && (
                  <div className="zr-bubble zr-bubble--other" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="zr-loading-dots"><span></span><span></span><span></span></div>
                    <span className="zr-meta" style={{ margin: 0, color: 'var(--gold)' }}>Kaze a calcular rota e valores...</span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '28px' }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: '-20px', background: 'var(--gold)', borderRadius: '50%', filter: 'blur(30px)', opacity: isLive ? 0.35 : 0.1 }} />
                  <div style={{ width: '110px', height: '110px', borderRadius: '50%', background: 'var(--surface-3)', border: isLive ? '2px solid var(--gold)' : '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '50px', color: 'var(--gold)', transform: isLive ? 'scale(1.1)' : 'scale(0.9)', transition: 'transform 0.5s', opacity: isLive ? 1 : 0.6 }}>graphic_eq</span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p className="zr-section-title" style={{ fontSize: '13px', marginBottom: '6px' }}>SISTEMA VOZ KAZE</p>
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

          {/* Barra de Input */}
          {mode !== 'voice' && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--surface-3)', background: 'var(--surface-2)' }}>
              <form onSubmit={e => handleSendText(e)} className="zr-inline" style={{ gap: '8px' }}>
                <input
                  className="zr-input"
                  style={{ flex: 1, fontSize: '13px', padding: '10px 14px' }}
                  placeholder={
                    isListeningMic ? '🎙️ A ouvir... Fala agora!' :
                    mode === 'explore' ? 'Onde há trânsito agora?' :
                    'Ex: "Pede um táxi para o Belas Shopping"...'
                  }
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  disabled={isThinking}
                />

                {/* Botão de Microfone em Tempo Real */}
                <button
                  type="button"
                  onClick={toggleMicListening}
                  className="zr-icon-button"
                  style={{
                    background: isListeningMic ? '#ef4444' : 'var(--surface-3)',
                    color: isListeningMic ? '#fff' : 'var(--gold)',
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    border: isListeningMic ? '2px solid #ef4444' : '1px solid var(--surface-1)',
                    boxShadow: isListeningMic ? '0 0 16px rgba(239, 68, 68, 0.7)' : 'none',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                  }}
                  title={isListeningMic ? 'Toca para parar' : 'Falar com o Kaze'}
                >
                  <span className={`material-symbols-outlined ${isListeningMic ? 'animate-pulse' : ''}`} style={{ fontSize: '20px' }}>
                    {isListeningMic ? 'mic' : 'mic_none'}
                  </span>
                  {isListeningMic && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '-4px',
                        right: '-4px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#ef4444',
                        boxShadow: '0 0 8px #ef4444',
                      }}
                      className="animate-ping"
                    />
                  )}
                </button>

                {/* Botão de Enviar */}
                <button
                  type="submit"
                  disabled={!inputValue.trim() || isThinking}
                  className="zr-icon-button"
                  style={{
                    background: 'var(--gold)',
                    color: '#000',
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    opacity: (!inputValue.trim() || isThinking) ? 0.4 : 1,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>send</span>
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Botão flutuante do Kaze Mascot */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="zr-icon-button"
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '28px',
          pointerEvents: 'auto',
          zIndex: 601,
          background: isOpen ? 'var(--gold)' : 'var(--surface-3)',
          border: isOpen ? 'none' : '2px solid var(--surface-1)',
          boxShadow: isOpen ? '0 10px 30px rgba(230,195,100,0.4)' : '0 10px 20px rgba(0,0,0,0.5)',
          position: 'relative',
        }}
        title="Abrir Kaze"
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: '28px',
            color: isOpen ? '#000' : 'var(--gold)',
            transform: (isOpen || isThinking) ? 'scale(1.1)' : 'none',
            transition: 'transform 0.3s',
          }}
        >
          {isThinking ? 'graphic_eq' : 'auto_awesome'}
        </span>
        {kazeOnline === true && (
          <span
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: 'var(--success, #22c55e)',
              boxShadow: '0 0 8px var(--success, #22c55e)',
            }}
          />
        )}
      </button>
    </div>
  );
};

export default KazeMascot;
