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
import { kazeSpeak, unlockNativeTTS, setKazeLiveVoiceActive } from '../lib/kazeVoice';
import { kazeDiag } from '../lib/kazeVoiceDiag';
import { UserRole, RideStatus, LatLng } from '../types';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';
import { transcribeAudioWithGemini, AudioTranscribeResult } from '../lib/kazeAudioTranscribe';
import { normalizeAngolanSpeech } from '../lib/angolaSpeechNormalizer';
import { mapService } from '../services/mapService';
import {
  KazeAudioCapture,
  getAvailableMicrophones,
  AudioInputDevice,
} from '../lib/kazeAudioRecorder';
import { startKazeLiveSession, KazeLiveSession, KazeAudioStats } from '../lib/kazeLiveClient';

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

/**
 * Motor de voz do Kaze.
 *   • 'gemini' — Gemini Live API (áudio-para-áudio, voz natural). Novo; é o
 *                motor por defeito, mas nada do motor antigo foi removido.
 *   • 'native' — Web Speech API + TTS do browser. Motor antigo, mantido
 *                intacto para quem preferir ou se o Live não estiver disponível.
 */
type KazeVoiceEngine = 'gemini' | 'native';

/**
 * Rótulos humanos das ferramentas que o Kaze pode executar durante uma
 * conversa por voz — usados no HUD "Kaze a executar: …".
 */
const KAZE_LIVE_TOOL_LABELS: Record<string, string> = {
  request_ride:        'pedido de corrida',
  schedule_ride:       'agendamento de viagem',
  create_contract:     'criação de contrato',
  check_balance:       'consulta de saldo',
  navigate_app:        'navegação no app',
  cancel_current_ride: 'cancelamento de corrida',
};

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

// ─── Contadores de diagnóstico (só leitura, não influenciam nada) ────────────
//  `montagens` > 1 significaria o componente montado duas vezes — e, com ele,
//  duas instâncias de estado a pedir voz ao mesmo tempo. `arranques` conta as
//  chamadas a `startGeminiLiveSession`, que é o que abre um WebSocket.
let kazeMontagens = 0;
let kazeArranquesLive = 0;

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
  //  Verdadeiro entre o toque em "Voz Ao Vivo" e a sessão estar pronta. Serve
  //  para o botão de arranque dizer "A ligar…" em vez de parecer parado — era
  //  esse silêncio visual que levava o utilizador a tocar outra vez e a abrir
  //  uma SEGUNDA sessão Live em paralelo com a primeira.
  const [liveConnecting,  setLiveConnecting]  = useState(false);
  const [voiceError,      setVoiceError]      = useState<string | null>(null);
  const [kazeOnline,      setKazeOnline]      = useState<boolean | null>(true);
  const [voiceEnabled,    setVoiceEnabled]    = useState(true);
  const [isListeningMic,  setIsListeningMic]  = useState(false);
  const [liveVolume,      setLiveVolume]      = useState(0);
  const [micDiagnostics,  setMicDiagnostics]  = useState<{
    title: string;
    details: string;
    type: 'warning' | 'error' | 'info';
    technical?: Record<string, any>;
  } | null>(null);
  const [showMicSettings, setShowMicSettings] = useState(false);
  const [availableMics,   setAvailableMics]   = useState<AudioInputDevice[]>([]);
  const [selectedMicId,   setSelectedMicId]   = useState<string>(() => {
    return localStorage.getItem('zenith_selected_mic') || '';
  });
  const [activeMicLabel,  setActiveMicLabel]  = useState<string>('Microfone Padrão');
  const [isTestingMic,    setIsTestingMic]    = useState(false);
  const [testMicVolume,   setTestMicVolume]   = useState(0);
  const [actionExecuting, setActionExecuting] = useState(false);
  const [pendingAction,   setPendingAction]   = useState<KazeProposedAction | null>(null);

  // ── Estado do Gemini Live (voz natural) ────────────────────────────────────
  //  Totalmente aditivo: nenhum destes estados interfere com o chat ou com o
  //  motor de voz antigo. Só são usados quando o modo 'voice' está activo.
  const [voiceEngine,  setVoiceEngine]  = useState<KazeVoiceEngine>('gemini');
  const [liveEngine,   setLiveEngine]   = useState<KazeVoiceEngine | null>(null);
  const [liveUserText, setLiveUserText] = useState('');
  const [liveKazeText, setLiveKazeText] = useState('');
  const [kazeSpeaking, setKazeSpeaking] = useState(false);
  const [liveToolHint, setLiveToolHint] = useState<string | null>(null);
  const [liveMicOn,    setLiveMicOn]    = useState(true);
  // Contadores da cadeia de áudio da voz (blocos recebidos, segundos, estado
  // do AudioContext). Sem isto, "o Kaze não fala" era uma caixa negra: não se
  // sabia se o servidor não mandou áudio ou se o browser o bloqueou.
  const [liveStats,    setLiveStats]    = useState<KazeAudioStats | null>(null);

  const [liveGpsCoords,   setLiveGpsCoords]   = useState<LatLng | null>(userLocation || null);
  const [liveGpsAddress,  setLiveGpsAddress]  = useState<string | null>(null);

  const liveSessionRef   = useRef<{ close: () => void } | null>(null);
  const kazeLiveRef      = useRef<KazeLiveSession | null>(null);
  //  Cadeado do arranque da Voz Ao Vivo. `kazeLiveRef` só recebe a sessão no
  //  FIM do arranque, por isso não serve de guarda durante ele: um segundo
  //  toque não encontrava nada para fechar e abria uma sessão a mais. Este
  //  cadeado fecha essa janela — enquanto for `true`, não se arranca outra.
  const arranqueLiveRef  = useRef(false);
  //  Geração do arranque. Sobe sempre que se fecha a sessão. Um arranque que
  //  resolva depois disso sabe que já não interessa e fecha o que criou, em vez
  //  de ficar vivo sem ninguém a apontar para ele.
  const arranqueGeracaoRef = useRef(0);

  // Espelhos das transcrições da voz. Existem para que os callbacks da sessão
  // Live (criados uma única vez) leiam sempre o valor mais recente — sem eles
  // haveria closures obsoletas a enviar turnos antigos para o histórico.
  const liveUserTextRef  = useRef('');
  const liveKazeTextRef  = useRef('');

  // Arranque da sessão: o Gemini Live não fala primeiro, por isso enviamos um
  // cumprimento curto. Este ref permite filtrar esse eco da transcrição para
  // não aparecer como se o utilizador o tivesse dito.
  const greetingEchoRef  = useRef<string | null>(null);

  // Callbacks da sessão Live são criados uma só vez. Estes dois refs dão-lhes
  // acesso ao estado mais recente (acção pendente + executor) sem obrigar a
  // recriar a sessão a cada render — que cortaria o áudio a meio da conversa.
  const pendingActionRef = useRef<KazeProposedAction | null>(null);
  const executeActionRef = useRef<((action: KazeProposedAction) => Promise<void>) | null>(null);
  const scrollRef        = useRef<HTMLDivElement>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCaptureRef  = useRef<KazeAudioCapture | null>(null);
  const testCaptureRef   = useRef<KazeAudioCapture | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const speechRecognizedTextRef = useRef<string>('');

  // Sincronizar localização precisa do utilizador (GPS + Bairro) em segundo plano
  useEffect(() => {
    let active = true;
    const fetchRealLocation = async () => {
      try {
        const coords = await mapService.getCurrentPosition();
        if (!active) return;
        setLiveGpsCoords(coords);
        const address = await mapService.reverseGeocode(coords);
        if (!active) return;
        setLiveGpsAddress(address);
      } catch (err) {
        console.warn('[KazeMascot] Não foi possível obter GPS inicial:', err);
      }
    };
    fetchRealLocation();
    return () => { active = false; };
  }, []);

  // Auto-scroll ao adicionar mensagens
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isThinking, pendingAction, isListeningMic, micDiagnostics]);

  useEffect(() => () => {
    kazeLiveRef.current?.close();
    kazeLiveRef.current = null;
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    if (audioCaptureRef.current) {
      audioCaptureRef.current.cancel();
    }
    if (testCaptureRef.current) {
      testCaptureRef.current.cancel();
    }
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }
  }, []);

  // Contagem de montagens — diagnóstico. Duas montagens dariam dois painéis,
  // cada um com o seu estado e a sua sessão de voz.
  useEffect(() => {
    kazeMontagens += 1;
    kazeDiag('mascote:montado', { origem: 'mascote', montagens: kazeMontagens });
    return () => {
      kazeMontagens -= 1;
      kazeDiag('mascote:desmontado', { origem: 'mascote', montagens: kazeMontagens });
    };
  }, []);

  // Mensagem de boas-vindas
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greeting = pickGreeting(getGreetingPool(role));
      const name = userName ? `, ${userName.split(' ')[0]}` : '';
      const text = `Olá${name}! ${greeting}`;
      setMessages([{
        role: 'model',
        text,
      }]);
      if (voiceEnabled) {
        void kazeSpeak(text);
      }
    }
  }, [isOpen, role, userName, messages.length, voiceEnabled]);

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
            // `null` significa "o motor de preços não respondeu" — passa-se
            // `undefined` para o PassengerHome recalcular o valor real em vez
            // de se arrastar um número inventado.
            d.priceKz ?? undefined,
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

  // Manter os refs da sessão Live apontados ao render mais recente.
  useEffect(() => { pendingActionRef.current = pendingAction; }, [pendingAction]);
  useEffect(() => { executeActionRef.current = executeAppAction; }, [executeAppAction]);

  // Diagnóstico da voz: com a sessão Live aberta, ler os contadores de áudio
  // uma vez por segundo. É o que permite dizer no ecrã de onde vem o silêncio:
  //   blocosRecebidos = 0                -> o servidor não mandou áudio;
  //   blocosRecebidos > 0, estado != run -> o browser bloqueou a saída;
  //   interrupcoes a subir               -> o barge-in está a cortar a fala.
  useEffect(() => {
    if (!isLive) {
      setLiveStats(null);
      return;
    }
    const id = window.setInterval(() => {
      setLiveStats(kazeLiveRef.current?.getAudioStats() ?? null);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLive]);

  // ── Envio de Texto / Comando ───────────────────────────────────────────────
  const handleSendText = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    unlockNativeTTS();
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
        // Obter GPS de forma ultra-rápida (sem bloquear 15s)
        let effectiveCoords = liveGpsCoords || userLocation || null;
        let effectiveAddress = liveGpsAddress || null;
        if (!effectiveCoords) {
          try {
            const gpsPromise = mapService.getCurrentPosition();
            const timeoutPromise = new Promise<null>(res => setTimeout(() => res(null), 1200));
            const freshGps = await Promise.race([gpsPromise, timeoutPromise]);
            if (freshGps) {
              effectiveCoords = freshGps;
              setLiveGpsCoords(freshGps);
              mapService.reverseGeocode(freshGps).then(addr => {
                if (addr) setLiveGpsAddress(addr);
              }).catch(() => {});
            }
          } catch { /* ignore */ }
        }

        if (!effectiveCoords) {
          // Não se inventa localização nenhuma. Se o GPS falhar, o bloco de
          // contexto diz ao Kaze que não a tem e proíbe-o de a inventar. Um
          // "estás em Luanda Centro" falso seria o mesmo erro que o bot do
          // WhatsApp fazia ao responder "Município do Belas" a um pin exacto.
          effectiveCoords = null;
          effectiveAddress = null;
        }

        // Passar pelo Kaze App Agent com protecção contra congelamento (máximo 6.5s)
        const agentPromise = kazeAppAgent.processUserMessage(userText, {
          userId,
          userName: userName || undefined,
          userRole: role,
          userLocation: effectiveCoords,
          userAddress: effectiveAddress || undefined,
          hasActiveRide: rideStatus !== RideStatus.IDLE,
          pendingAction,
        });

        const agentTimeoutPromise = new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('KAZE_TIMEOUT')), 6500)
        );

        const agentResult = await Promise.race([agentPromise, agentTimeoutPromise]);

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

  // ── Gestão e Teste de Microfones Disponíveis ──
  const openMicSettings = async () => {
    setShowMicSettings(true);
    const mics = await getAvailableMicrophones();
    setAvailableMics(mics);
  };

  const selectMicrophone = (deviceId: string) => {
    setSelectedMicId(deviceId);
    localStorage.setItem('zenith_selected_mic', deviceId);
  };

  const toggleTestMic = async () => {
    if (isTestingMic) {
      if (testCaptureRef.current) {
        await testCaptureRef.current.cancel();
        testCaptureRef.current = null;
      }
      setIsTestingMic(false);
      setTestMicVolume(0);
      return;
    }

    try {
      const capture = new KazeAudioCapture();
      testCaptureRef.current = capture;
      setIsTestingMic(true);
      await capture.start(selectedMicId || undefined, (vol) => {
        setTestMicVolume(vol);
      });
    } catch (err: any) {
      setIsTestingMic(false);
      setTestMicVolume(0);
      showToast(`Erro ao testar microfone: ${err?.message || err}`, 'error');
    }
  };

  // ── Reconhecimento de Fala pelo Microfone com Diagnóstico Transparente ──
  const stopAndProcessRecording = async () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    setIsListeningMic(false);
    setLiveVolume(0);

    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch {}
      speechRecognitionRef.current = null;
    }

    if (!audioCaptureRef.current || !audioCaptureRef.current.isRecording) return;

    // Se o reconhecimento nativo do navegador já captou a fala em português
    const recognizedLive = speechRecognizedTextRef.current?.trim();
    if (recognizedLive) {
      const normalizedLive = normalizeAngolanSpeech(recognizedLive);
      console.log('[KazeMascot] Fala reconhecida nativamente pelo navegador:', recognizedLive, '->', normalizedLive);
      try {
        await audioCaptureRef.current.stop();
      } catch {}
      setInputValue(normalizedLive);
      setMicDiagnostics(null);
      await handleSendText(undefined, normalizedLive);
      return;
    }

    try {
      const rec = await audioCaptureRef.current.stop();
      const { wavBlob, durationMs, peakVolume, avgVolume, deviceLabel, isTrackMuted } = rec;
      setActiveMicLabel(deviceLabel);

      // Se a gravação foi curtíssima e vazia
      if (durationMs < 400 && wavBlob.size < 500) {
        setMicDiagnostics({
          title: 'Gravação Muito Curta',
          details: 'Toca no microfone, fala o teu pedido e toca novamente para enviar.',
          type: 'info',
          technical: { durationMs, bytes: wavBlob.size, deviceLabel },
        });
        return;
      }

      // Se o microfone não captou som (mudo no Windows/teclado)
      if (peakVolume < 0.02 && avgVolume < 0.01) {
        setMicDiagnostics({
          title: 'Microfone Mudo ou Sem Sinal (0% Volume)',
          details: 'O áudio gravado está em silêncio absoluto. Verifica se o microfone não está mutado no teu teclado (tecla F4 / Fn+F4) ou aumenta o volume para 100% nas Definições de Som do Windows.',
          type: 'warning',
          technical: { durationMs, peakVolume: `${(peakVolume * 100).toFixed(1)}%`, deviceLabel },
        });
        setInputValue('');
        return;
      }

      // Enviar áudio captado para transcrição com Gemini
      setInputValue('🎙️ Kaze a transcrever voz...');
      setIsThinking(true);

      const aiRes = await transcribeAudioWithGemini(wavBlob);

      if (aiRes.status === 'success' && aiRes.text) {
        setInputValue(aiRes.text);
        setMicDiagnostics(null);
        await handleSendText(undefined, aiRes.text);
      } else if (aiRes.status === 'empty') {
        setMicDiagnostics({
          title: 'Voz Não Detectada',
          details: aiRes.errorMessage || 'Não conseguimos ouvir a tua fala com clareza. Podes tentar falar mais alto e perto do microfone, ou escrever a tua mensagem abaixo.',
          type: 'warning',
          technical: {
            duracaoMs: durationMs,
            tamanhoBytes: wavBlob.size,
            volumePico: `${(peakVolume * 100).toFixed(1)}%`,
            volumeMedio: `${(avgVolume * 100).toFixed(1)}%`,
            microfone: deviceLabel,
            respostaModelo: aiRes.rawText || '[VAZIO]',
          },
        });
        setInputValue('');
      } else {
        setMicDiagnostics({
          title: 'Erro na Transcrição de Áudio (Gemini)',
          details: aiRes.errorMessage || 'Ocorreu um erro ao comunicar com a API do Gemini.',
          type: 'error',
          technical: {
            httpStatus: aiRes.httpStatus || 'Erro de Rede/Cliente',
            erroReal: aiRes.errorMessage,
            respostaBruta: aiRes.rawText,
            tamanhoBytes: wavBlob.size,
            duracaoMs: durationMs,
            microfone: deviceLabel,
          },
        });
        setInputValue('');
      }
    } catch (recErr: any) {
      setMicDiagnostics({
        title: 'Erro no Processamento de Áudio',
        details: recErr?.message || String(recErr),
        type: 'error',
        technical: { error: String(recErr) },
      });
      setInputValue('');
    } finally {
      setIsThinking(false);
    }
  };

  const toggleMicListening = async () => {
    unlockNativeTTS();
    if (isListeningMic) {
      await stopAndProcessRecording();
      return;
    }

    // HTTPS check — navigator.mediaDevices is undefined on non-secure origins (except localhost)
    const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure) {
      setMicDiagnostics({
        title: 'Conexão Não Segura (HTTP)',
        details: 'O microfone só funciona em HTTPS ou localhost. Estás a aceder via HTTP. Para resolver, acede ao app via HTTPS ou usa localhost no computador.',
        type: 'error',
        technical: {
          protocol: location.protocol,
          hostname: location.hostname,
          isSecureContext: window.isSecureContext,
          solucao: 'No vite.config.ts, adiciona server: { https: true } ou acede pelo endereço localhost.',
        },
      });
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicDiagnostics({
        title: 'Navegador Sem Suporte de Áudio',
        details: 'O teu navegador não suporta a API de áudio navigator.mediaDevices.getUserMedia. Tenta usar o Chrome ou Edge.',
        type: 'error',
        technical: {
          mediaDevices: !!navigator.mediaDevices,
          getUserMedia: !!(navigator.mediaDevices?.getUserMedia),
          userAgent: navigator.userAgent,
        },
      });
      return;
    }

    setMicDiagnostics(null);
    console.log('[KazeMascot] A iniciar gravação de microfone...', { selectedMicId, isSecure, protocol: location.protocol });

    try {
      const capture = new KazeAudioCapture();
      audioCaptureRef.current = capture;

      const { deviceLabel } = await capture.start(selectedMicId || undefined, (vol) => {
        setLiveVolume(vol);
      });

      console.log('[KazeMascot] Microfone iniciado com sucesso:', deviceLabel);
      setActiveMicLabel(deviceLabel);
      setIsListeningMic(true);
      setInputValue('');

      // Iniciar reconhecimento nativo em tempo real no Edge/Chrome se disponível
      speechRecognizedTextRef.current = '';
      const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        try {
          const speechRec = new SpeechRecognitionClass();
          speechRec.lang = 'pt-PT';
          speechRec.continuous = true;
          speechRec.interimResults = true;
          speechRec.maxAlternatives = 3;
          speechRec.onresult = (event: any) => {
            let fullText = '';
            for (let i = 0; i < event.results.length; i++) {
              fullText += event.results[i][0].transcript + ' ';
            }
            const trimmed = fullText.trim();
            if (trimmed) {
              speechRecognizedTextRef.current = trimmed;
              setInputValue(trimmed);
            }
          };
          speechRec.onerror = (e: any) => {
            console.log('[KazeMascot] SpeechRecognition status:', e.error);
          };
          speechRec.start();
          speechRecognitionRef.current = speechRec;
        } catch (e) {
          console.warn('[KazeMascot] Falha ao iniciar SpeechRecognition nativo:', e);
        }
      }

      // Auto-stop após 20 segundos (tempo generoso para instruções completas em Luanda)
      autoStopTimerRef.current = setTimeout(() => {
        if (audioCaptureRef.current?.isRecording) {
          stopAndProcessRecording();
        }
      }, 20000);
    } catch (err: any) {
      console.error('[KazeMascot] Erro ao iniciar microfone:', err);
      setIsListeningMic(false);
      setLiveVolume(0);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicDiagnostics({
          title: 'Permissão de Microfone Negada',
          details: 'O navegador ou o sistema bloqueou o acesso ao microfone. Clica no ícone de cadeado na barra do navegador para permitir.',
          type: 'error',
          technical: { errorName: err.name, message: err.message },
        });
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setMicDiagnostics({
          title: 'Nenhum Microfone Encontrado',
          details: 'O navegador não encontrou nenhum microfone no teu dispositivo. Verifica se tens um microfone ligado.',
          type: 'error',
          technical: { errorName: err.name, message: err.message },
        });
      } else {
        setMicDiagnostics({
          title: 'Erro ao Aceder ao Microfone',
          details: `Não foi possível abrir o dispositivo: ${err.message || err}`,
          type: 'error',
          technical: { errorName: err.name, message: err.message, userAgent: navigator.userAgent },
        });
      }
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
        setLiveEngine('native');
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

  // ══════════════════════════════════════════════════════════════════════════
  //  GEMINI LIVE — voz bidirecional natural (áudio-para-áudio)
  //
  //  Aditivo: o motor 'native' acima continua exactamente como estava. Se o
  //  Live falhar, mostramos o erro e o Kaze responde só por escrito — não há
  //  salto automático para outra voz (decisão explícita do Dánio).
  // ══════════════════════════════════════════════════════════════════════════

  /** Encerra a sessão Live (ou a clássica) e limpa o estado do modo de voz. */
  const stopVoiceSession = useCallback(() => {
    // Subir a geração ANTES de fechar: se houver um arranque a meio (o
    // utilizador fechou o painel enquanto ligava), ele vai resolver depois
    // desta linha, ver que a geração mudou e fechar-se a si próprio. Sem isto,
    // essa sessão nasceria já sem ninguém a apontar para ela.
    arranqueGeracaoRef.current += 1;
    try { kazeLiveRef.current?.close(); } catch { /* já fechada */ }
    kazeLiveRef.current = null;
    try { liveSessionRef.current?.close(); } catch { /* já fechada */ }
    liveSessionRef.current = null;
    liveUserTextRef.current = '';
    liveKazeTextRef.current = '';
    greetingEchoRef.current = null;
    setLiveEngine(null);
    setIsLive(false);
    setLiveConnecting(false);
    setKazeSpeaking(false);
    setLiveMicOn(true);
    setLiveToolHint(null);
    setLiveUserText('');
    setLiveKazeText('');
    // `close()` acima já devia ter disparado o onClose, mas a voz é uma regra
    // demasiado fácil de deixar presa: repor aqui garante que o chat volta a
    // poder falar mesmo que o fecho falhe.
    setKazeLiveVoiceActive(false);
  }, []);

  /** Abre a sessão Gemini Live e liga as ferramentas do agente à voz. */
  const startGeminiLiveSession = useCallback(async () => {
    kazeArranquesLive += 1;

    // ── Cadeado: nunca duas sessões Live ao mesmo tempo ───────────────────────
    //  O `kazeLiveRef` só recebe a sessão no fim do arranque (token + SDK +
    //  handshake, segundos), por isso durante esse tempo ele está `null` e não
    //  serve de guarda. Sem este cadeado, tocar outra vez no botão — que fica
    //  visível e clicável precisamente nessa janela — abre uma segunda sessão
    //  que ninguém fecha: WebSocket próprio, microfone próprio e um segundo
    //  AudioContext de saída. O resultado ouve-se como a mesma resposta dita
    //  duas vezes. Reproduzido e medido em `.tmp-kaze-duas-sessoes.mjs`.
    if (arranqueLiveRef.current) {
      kazeDiag('mascote:arranque_recusado', {
        origem: 'mascote',
        motivo: 'ja_existe_sessao_ou_arranque_em_curso',
        isLive,
      });
      // Antes isto era um `return` seco. Se o arranque anterior tivesse ficado
      // pendurado, o botão parecia avariado e não havia nada no ecrã a dizê-lo.
      setVoiceError('A voz ainda está a ligar. Aguarda um instante e tenta outra vez.');
      return;
    }
    arranqueLiveRef.current = true;
    setLiveConnecting(true);
    const minhaGeracao = ++arranqueGeracaoRef.current;

    // O estado da referência AQUI mostra se havia algo para fechar. Com o
    // cadeado acima, um `false` já não significa "há uma sessão órfã".
    kazeDiag('mascote:arranque_live', {
      origem: 'mascote',
      arranque: kazeArranquesLive,
      refPreenchida: kazeLiveRef.current !== null,
      modoAtual: mode,
      isLive,
    });

    setMode('voice');
    setVoiceError(null);
    setLiveToolHint(null);
    setLiveUserText('');
    setLiveKazeText('');
    setKazeSpeaking(false);
    setLiveMicOn(true);
    setIsLive(false);
    liveUserTextRef.current = '';
    liveKazeTextRef.current = '';
    try { kazeLiveRef.current?.close(); } catch { /* já fechada */ }
    kazeLiveRef.current = null;

    // ── Localização: garantir ANTES de abrir a sessão ────────────────────────
    // ⚠️ A Voz Ao Vivo era o único caminho que não a garantia.
    //
    // O `useEffect` de arranque preenche `liveGpsAddress` de forma assíncrona
    // (GPS + reverse geocode). Quem toca no microfone logo a seguir apanha o
    // estado ainda a `null` — e o Kaze abre a conversa a dizer que não sabe
    // onde a pessoa está.
    //
    // E não se corrige depois: a `systemInstruction` do Live é fixada no
    // arranque da sessão. Um contexto vazio condena a conversa INTEIRA; só uma
    // sessão nova o apanha. Por isso espera-se aqui, com tecto, em vez de
    // aceitar o que estiver no estado neste instante.
    let effectiveCoords = liveGpsCoords || userLocation || null;
    let effectiveAddress = liveGpsAddress || null;

    if (!effectiveCoords) {
      try {
        const gps = await Promise.race([
          mapService.getCurrentPosition(),
          new Promise<null>((res) => setTimeout(() => res(null), 3000)),
        ]);
        if (gps) {
          effectiveCoords = gps;
          setLiveGpsCoords(gps);
        }
      } catch { /* sem GPS — segue sem coordenadas */ }
    }

    if (effectiveCoords && !effectiveAddress) {
      try {
        const morada = await Promise.race([
          mapService.reverseGeocode(effectiveCoords),
          new Promise<null>((res) => setTimeout(() => res(null), 2500)),
        ]);
        if (morada) {
          effectiveAddress = morada;
          setLiveGpsAddress(morada);
        }
      } catch { /* sem morada — o bloco de contexto usa as coordenadas */ }
    }

    // Não se inventa localização nenhuma. Se o GPS falhar, o bloco de contexto
    // diz ao Kaze que não a tem e proíbe-o de a inventar. Um "estás em Luanda
    // Centro" falso seria o mesmo erro que o bot do WhatsApp fazia ao responder
    // "Município do Belas" a um pin exacto.

    const toolContext = {
      userId,
      userRole: role,
      userName,
      userLocation: effectiveCoords,
      userAddress: effectiveAddress,
      hasActiveRide: rideStatus !== RideStatus.IDLE,
    };

    try {
      const session = await startKazeLiveSession({
        userId: userId || 'anonimo',
        userName,
        userAddress: effectiveAddress,
        userLocation: effectiveCoords,
        hasActiveRide: rideStatus !== RideStatus.IDLE,
        voiceName: 'Aoede',
        languageCode: 'pt-PT',
        callbacks: {
          onReady: () => {
            setIsLive(true);
            setLiveConnecting(false);
            setLiveEngine('gemini');
            setVoiceError(null);
            // O Live traz a voz do Kaze. Enquanto estiver activo, o TTS do
            // chat fica calado — senão ouvir-se-iam duas vozes em simultâneo.
            setKazeLiveVoiceActive(true);
          },

          onUserTranscript: (text) => {
            const clean = text.trim();
            if (!clean) return;
            // Filtrar o eco do cumprimento de arranque.
            const echo = greetingEchoRef.current;
            if (echo && (echo.startsWith(clean) || clean.startsWith(echo))) {
              if (clean.length >= echo.length) greetingEchoRef.current = null;
              return;
            }
            liveUserTextRef.current = clean;
            setLiveUserText(clean);
          },

          onKazeTranscript: (text) => {
            const clean = text.trim();
            if (!clean) return;
            liveKazeTextRef.current = clean;
            setLiveKazeText(clean);
          },

          onSpeakingChange: (speaking) => setKazeSpeaking(speaking),
          onInterrupted: () => setKazeSpeaking(false),

          // Fim de turno → arquivar a troca no histórico do chat, para o
          // utilizador poder reler a conversa de voz ao voltar ao chat.
          onTurnComplete: () => {
            const user = liveUserTextRef.current.trim();
            const kaze = liveKazeTextRef.current.trim();
            liveUserTextRef.current = '';
            liveKazeTextRef.current = '';
            greetingEchoRef.current = null;
            setLiveUserText('');
            setLiveKazeText('');
            if (!user && !kaze) return;
            setMessages((prev) => {
              const next = [...prev];
              if (user) next.push({ role: 'user', text: user });
              if (kaze) next.push({ role: 'model', text: kaze });
              return next;
            });
          },

          // Ponte de ferramentas: a voz executa acções reais no app através da
          // MESMA camada de resolução que o chat usa (sem duplicar lógica).
          onToolCall: async (call) => {
            const name = call.name ?? '';
            const args = (call.args ?? {}) as Record<string, unknown>;
            setLiveToolHint(`Kaze a executar: ${KAZE_LIVE_TOOL_LABELS[name] ?? name}`);
            try {
              const result = await kazeAppAgent.resolveToolCall(name, args, toolContext);
              const action = result?.action as KazeProposedAction | undefined;

              if (action && action.status === 'pending') {
                const alreadyPending = pendingActionRef.current;
                const isSameType = alreadyPending?.type === action.type;

                if (isSameType) {
                  // O modelo repetiu a chamada depois de o utilizador dizer
                  // "sim" → é uma confirmação explícita. Executar.
                  await executeActionRef.current?.({ ...action, status: 'confirmed' });
                  return {
                    ok: true,
                    actionStatus: 'confirmed',
                    summary: 'Acção confirmada e executada com sucesso.',
                    sayToUser: 'Confirmado! Já está feito.',
                  };
                }

                // Primeira proposta: guardar e pedir confirmação por voz.
                setPendingAction(action);
                setMessages((prev) => [
                  ...prev,
                  { role: 'model', text: result.text, action },
                ]);
                return {
                  ok: true,
                  actionStatus: 'pending',
                  summary: action.summary,
                  sayToUser: result.speakText ?? result.text,
                  instruction:
                    'Pede confirmação ao utilizador em voz alta. Se ele confirmar, chama exactamente a mesma ferramenta outra vez com os mesmos argumentos.',
                };
              }

              if (action && action.status === 'cancelled') {
                setPendingAction(null);
              }

              return {
                ok: true,
                actionStatus: action?.status ?? 'none',
                summary: result?.text ?? '',
                sayToUser: result?.speakText ?? result?.text ?? '',
              };
            } catch (err) {
              console.warn('[KazeMascot] Ferramenta de voz falhou:', name, err);
              return { ok: false, error: 'Não consegui completar essa acção agora.' };
            } finally {
              setLiveToolHint(null);
            }
          },

          onError: (message) => setVoiceError(message),

          onClose: () => {
            kazeLiveRef.current = null;
            setLiveEngine(null);
            setIsLive(false);
            setLiveConnecting(false);
            setKazeSpeaking(false);
            setLiveToolHint(null);
            // A voz volta a pertencer ao TTS do chat.
            setKazeLiveVoiceActive(false);
            // Libertar o cadeado: só a partir daqui é que se pode arrancar
            // outra sessão. Enquanto a sessão esteve viva, o cadeado esteve
            // fechado — é isso que impede uma segunda.
            arranqueLiveRef.current = false;
            kazeDiag('mascote:cadeado_aberto', { origem: 'mascote', motivo: 'sessao_fechada' });
          },
        },
      });

      // ── O arranque ainda interessa? ───────────────────────────────────────
      //  Entre o toque e este ponto passaram segundos. Se nesse tempo o painel
      //  foi fechado (`stopVoiceSession` sobe a geração), esta sessão já não
      //  serve ninguém: fechá-la AQUI é o que impede que fique viva sem
      //  ninguém a apontar para ela — com WebSocket, microfone e contexto de
      //  saída próprios, a falar por cima da sessão seguinte.
      if (minhaGeracao !== arranqueGeracaoRef.current) {
        kazeDiag('mascote:sessao_orfa_fechada', {
          origem: 'mascote',
          minhaGeracao,
          geracaoAtual: arranqueGeracaoRef.current,
        });
        try { session.close(); } catch { /* já fechada */ }
        return;
      }

      kazeLiveRef.current = session;
      kazeDiag('mascote:sessao_guardada', {
        origem: 'mascote',
        arranque: kazeArranquesLive,
        refPreenchida: true,
      });

      // O Live não toma a iniciativa de falar — sem um arranque, o Kaze ficava
      // calado à espera que o utilizador falasse primeiro. Enviado AQUI (e não
      // em `onReady`) porque só neste ponto o microfone já está ligado e a
      // referência existe; em `onReady` havia uma corrida com a captura de áudio.
      const opener = 'Olá Kaze!';
      greetingEchoRef.current = opener;
      try { session.sendText(opener); } catch { /* sessão pode já ter caído */ }
    } catch (err) {
      console.warn('[KazeMascot] Gemini Live indisponível:', err);
      kazeLiveRef.current = null;
      setLiveEngine(null);
      setIsLive(false);
      setKazeLiveVoiceActive(false);
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'A voz do Kaze está indisponível. Podes continuar a escrever no chat.',
      );
    } finally {
      // O arranque terminou (com sessão, com erro, ou cancelado). Abrir o
      // cadeado aqui — e não em `onClose` — garante que ele nunca fica preso,
      // que era o risco de o pôr só no caminho feliz.
      setLiveConnecting(false);
      arranqueLiveRef.current = false;
    }
  }, [userId, role, liveGpsAddress, liveGpsCoords, userLocation, rideStatus]);

  /** Sintoniza o motor de voz escolhido. */
  const startVoiceSession = async () => {
    if (voiceEngine === 'gemini') {
      await startGeminiLiveSession();
      return;
    }
    await startVoiceMode();
  };

  /** Silenciar/activar o microfone durante uma sessão Live (sem a fechar). */
  const toggleLiveMic = useCallback(() => {
    const session = kazeLiveRef.current;
    if (!session) return;
    const next = !session.isMicEnabled();
    session.setMicEnabled(next);
    setLiveMicOn(next);
  }, []);

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
          {/* Header — `zr-header--panel` tira o `position: sticky; top: 64px`
              da classe de página. Sem ele o cabeçalho descia ~65px, caía por
              cima da barra de tabs e o ✕ (z-index 10) engolia o clique na tab
              "Voz Ao Vivo" — tocar na tab fechava o painel. */}
          <div className="zr-header zr-header--panel" style={{ padding: '14px 16px', borderBottom: '1px solid var(--surface-3)', background: 'linear-gradient(90deg, rgba(230,195,100,0.15), transparent)' }}>
            <div className="zr-inline zr-inline--between" style={{ flexWrap: 'nowrap', width: '100%' }}>
              <div className="zr-inline" style={{ gap: '12px', flexWrap: 'nowrap', minWidth: 0, flex: 1 }}>
                <div style={{ width: '44px', height: '44px', flexShrink: 0, background: 'var(--surface-3)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--gold)', fontSize: '26px' }}>auto_awesome</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <h4 className="zr-section-title" style={{ fontSize: '13px', margin: 0, letterSpacing: '0.05em' }}>KAZE AGENT 3.0</h4>
                  <span className="zr-meta" style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: kazeOnline ? '#4ade80' : 'var(--gold)' }} />
                    {kazeOnline ? (isDriver ? 'MOTORISTA ONLINE' : 'AGENTE OPERACIONAL') : 'MODO LOCAL'}
                  </span>
                </div>
              </div>
              <div className="zr-inline" style={{ gap: '4px', flexWrap: 'nowrap', flexShrink: 0 }}>
                <button
                  onClick={openMicSettings}
                  className="zr-icon-button"
                  style={{ width: '36px', height: '36px', color: 'var(--gold)' }}
                  title="Configurar e Testar Microfone"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>tune</span>
                </button>
                <button
                  onClick={() => setVoiceEnabled(!voiceEnabled)}
                  className="zr-icon-button"
                  style={{ width: '36px', height: '36px', color: voiceEnabled ? 'var(--gold)' : 'var(--copy)' }}
                  title={voiceEnabled ? 'Voz activada' : 'Voz desativada'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{voiceEnabled ? 'volume_up' : 'volume_off'}</span>
                </button>
                <button
                  onClick={() => {
                    // Fechar o painel não pode deixar o microfone aberto.
                    if (mode === 'voice') stopVoiceSession();
                    setIsOpen(false);
                  }}
                  className="zr-icon-button"
                  style={{ width: '36px', height: '36px' }}
                >✕</button>
              </div>
            </div>
          </div>

          {/* Tabs de modo — flexShrink 0 para o painel nunca as comprimir a zero
              quando o conteúdo cresce (o corpo do chat tem flex: 1). */}
          <div style={{ padding: '0 16px', marginTop: '12px', flexShrink: 0 }}>
            <div className="zr-scroll-x" style={{ background: 'var(--surface-3)', borderRadius: '12px', padding: '4px' }}>
              {(['chat', 'explore', 'voice'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => {
                    if (m !== 'voice') { setMode(m); return; }
                    // Não reiniciar a sessão se já estamos em voz.
                    if (mode !== 'voice') void startVoiceSession();
                  }}
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
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', padding: '8px 0' }}>
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute', inset: '-20px', background: 'var(--gold)', borderRadius: '50%',
                      filter: 'blur(30px)',
                      opacity: isLive ? (kazeSpeaking ? 0.55 : 0.32) : 0.1,
                      transition: 'opacity 0.25s ease',
                    }}
                  />
                  <div style={{ width: '110px', height: '110px', borderRadius: '50%', background: 'var(--surface-3)', border: isLive ? '2px solid var(--gold)' : '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: '50px', color: 'var(--gold)',
                        transform: isLive ? (kazeSpeaking ? 'scale(1.18)' : 'scale(1.05)') : 'scale(0.9)',
                        transition: 'transform 0.4s',
                        opacity: isLive ? 1 : 0.6,
                      }}
                    >
                      {isLive ? (kazeSpeaking ? 'graphic_eq' : 'mic') : 'graphic_eq'}
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                  <p className="zr-section-title" style={{ fontSize: '13px', marginBottom: '6px' }}>SISTEMA VOZ KAZE</p>
                  <p className="zr-meta" style={{ margin: 0 }}>
                    {isLive
                      ? (liveEngine === 'gemini'
                          ? (kazeSpeaking ? 'Kaze a falar…' : 'Fala agora — estou a ouvir')
                          : 'Fale agora com o Kaze')
                      : 'Pronto para sintonizar'}
                  </p>
                </div>

                {/* Seletor de motor — só antes de ligar, e nunca a meio de um
                    arranque: trocar de motor enquanto uma sessão Live liga
                    deixaria a sessão antiga viva sem ninguém a fechar. */}
                {!isLive && !liveConnecting && (
                  <div style={{ display: 'flex', gap: '4px', background: 'var(--surface-3)', borderRadius: '10px', padding: '4px' }}>
                    {([
                      { id: 'gemini' as KazeVoiceEngine, label: 'Gemini Live' },
                      { id: 'native' as KazeVoiceEngine, label: 'Clássico' },
                    ]).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setVoiceEngine(opt.id)}
                        className={`zr-tab ${voiceEngine === opt.id ? 'is-active' : ''}`}
                        style={{ padding: '5px 12px', fontSize: '10px' }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Transcrições ao vivo dos dois lados */}
                {isLive && (liveUserText || liveKazeText) && (
                  <div style={{ width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {liveUserText && (
                      <p className="zr-meta" style={{ margin: 0, textAlign: 'right', color: 'var(--copy-muted)' }}>
                        🗣️ {liveUserText}
                      </p>
                    )}
                    {liveKazeText && (
                      <p className="zr-meta" style={{ margin: 0, color: 'var(--gold)' }}>
                        🤖 {liveKazeText}
                      </p>
                    )}
                  </div>
                )}

                {liveToolHint && (
                  <p className="zr-meta" style={{ margin: 0, color: 'var(--gold)' }}>{liveToolHint}…</p>
                )}

                {/* Diagnóstico da cadeia de voz. Diz de onde vem o silêncio:
                    0 blocos = o servidor não mandou áudio; blocos > 0 com a
                    saída bloqueada = o browser recusou tocar. */}
                {isLive && liveStats && (
                  <p
                    className="zr-meta"
                    style={{
                      margin: 0,
                      textAlign: 'center',
                      maxWidth: '320px',
                      color:
                        liveStats.blocosRecebidos === 0 || liveStats.estadoSaida !== 'running'
                          ? 'var(--danger)'
                          : 'var(--copy-muted)',
                    }}
                  >
                    {liveStats.blocosRecebidos === 0
                      ? 'Ainda sem áudio do servidor…'
                      : `🔊 ${liveStats.segundosRecebidos}s de fala recebidos`}
                    {liveStats.estadoSaida !== 'running' ? ' · ⚠️ saída bloqueada pelo browser' : ''}
                    {liveStats.interrupcoes > 0 ? ` · ${liveStats.interrupcoes} interrupções` : ''}
                  </p>
                )}

                {!isLive && (
                  <button
                    onClick={() => { void startVoiceSession(); }}
                    disabled={liveConnecting}
                    className="zr-button zr-button--block"
                    style={liveConnecting ? { opacity: 0.6, cursor: 'default' } : undefined}
                  >
                    {liveConnecting
                      ? 'A ligar o Kaze…'
                      : voiceEngine === 'gemini'
                        ? 'Sintonizar Kaze · Gemini Live'
                        : 'Sintonizar Kaze'}
                  </button>
                )}

                {isLive && (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {liveEngine === 'gemini' && (
                      <button
                        onClick={toggleLiveMic}
                        className="zr-button zr-button--secondary"
                        style={{ fontSize: '11px', padding: '8px 14px' }}
                      >
                        {liveMicOn ? '🎙️ Silenciar' : '🔇 Activar mic'}
                      </button>
                    )}
                    <button
                      onClick={stopVoiceSession}
                      className="zr-button zr-button--block"
                      style={{ fontSize: '11px', width: 'auto', padding: '8px 18px' }}
                    >
                      Terminar
                    </button>
                  </div>
                )}

                {voiceError && (
                  <p className="zr-meta" style={{ color: 'var(--danger)', textAlign: 'center', maxWidth: '300px', margin: 0 }}>
                    {voiceError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Barra de Input & Diagnóstico de Áudio */}
          {mode !== 'voice' && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--surface-3)', background: 'var(--surface-2)', position: 'relative', flexShrink: 0 }}>
              
              {/* MODAL / POPOVER DE CONFIGURAÇÃO DE MICROFONE */}
              {showMicSettings && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    right: 0,
                    background: 'rgba(15, 15, 20, 0.98)',
                    backdropFilter: 'blur(16px)',
                    borderTop: '1px solid var(--gold-soft)',
                    borderBottom: '1px solid var(--surface-3)',
                    padding: '16px',
                    zIndex: 700,
                    boxShadow: '0 -10px 30px rgba(0,0,0,0.8)',
                    maxHeight: '340px',
                    overflowY: 'auto',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="material-symbols-outlined" style={{ color: 'var(--gold)', fontSize: '20px' }}>tune</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>Definições de Microfone</span>
                    </div>
                    <button
                      onClick={() => {
                        setShowMicSettings(false);
                        if (isTestingMic && testCaptureRef.current) {
                          testCaptureRef.current.cancel();
                          setIsTestingMic(false);
                          setTestMicVolume(0);
                        }
                      }}
                      style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px' }}
                    >
                      ✕
                    </button>
                  </div>

                  <p style={{ fontSize: '11px', color: 'var(--copy-muted)', marginBottom: '10px' }}>
                    Microfone ativo no momento: <strong style={{ color: 'var(--gold)' }}>{activeMicLabel}</strong>
                  </p>

                  {/* Lista de microfones */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                    <label
                      onClick={() => selectMicrophone('')}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: !selectedMicId ? 'rgba(230,195,100,0.15)' : 'rgba(255,255,255,0.04)',
                        border: !selectedMicId ? '1px solid var(--gold)' : '1px solid transparent',
                        cursor: 'pointer',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <input type="radio" checked={!selectedMicId} readOnly />
                      <span>Padrão do Sistema (Windows Default)</span>
                    </label>

                    {availableMics.map((mic) => {
                      const isSelected = selectedMicId === mic.deviceId;
                      return (
                        <label
                          key={mic.deviceId}
                          onClick={() => selectMicrophone(mic.deviceId)}
                          style={{
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: isSelected ? 'rgba(230,195,100,0.15)' : 'rgba(255,255,255,0.04)',
                            border: isSelected ? '1px solid var(--gold)' : '1px solid transparent',
                            cursor: 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <input type="radio" checked={isSelected} readOnly />
                          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {mic.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {/* Teste em Tempo Real */}
                  <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '10px', padding: '10px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#fff' }}>Teste de Nível de Entrada:</span>
                      <button
                        type="button"
                        onClick={toggleTestMic}
                        className="zr-badge"
                        style={{
                          background: isTestingMic ? '#ef4444' : 'var(--gold)',
                          color: isTestingMic ? '#fff' : '#000',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '3px 8px',
                          fontSize: '10px',
                          fontWeight: 700,
                        }}
                      >
                        {isTestingMic ? 'Parar Teste' : 'Testar Entrada'}
                      </button>
                    </div>

                    <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${Math.min(100, testMicVolume * 100)}%`,
                          height: '100%',
                          background: testMicVolume > 0.6 ? '#ef4444' : testMicVolume > 0.05 ? 'var(--gold)' : '#555',
                          transition: 'width 0.08s ease',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '9px', color: '#888' }}>
                      <span>0 dB (Silêncio)</span>
                      <span>{(testMicVolume * 100).toFixed(0)}%</span>
                      <span>Pico Máximo</span>
                    </div>
                  </div>

                  <p style={{ fontSize: '10px', color: '#888', lineHeight: 1.35, margin: 0 }}>
                    💡 Dica: Se a barra não se mover enquanto falas, abre as Definições de Som do Windows e aumenta o volume do microfone para 100%.
                  </p>
                </div>
              )}

              {/* HUD VISUAL DE GRAVAÇÃO AO VIVO COM MEDIDOR DE VOLUME */}
              {isListeningMic && (
                <div
                  style={{
                    padding: '8px 12px',
                    marginBottom: '8px',
                    borderRadius: '12px',
                    background: 'rgba(20, 20, 26, 0.95)',
                    border: liveVolume > 0.05 ? '1px solid rgba(230, 195, 100, 0.6)' : '1px solid rgba(239, 68, 68, 0.5)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      className="material-symbols-outlined animate-pulse"
                      style={{ color: liveVolume > 0.05 ? 'var(--gold)' : '#ef4444', fontSize: '18px' }}
                    >
                      {liveVolume > 0.05 ? 'graphic_eq' : 'mic'}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#fff' }}>
                      {liveVolume > 0.05
                        ? `A detetar voz (${(liveVolume * 100).toFixed(0)}%)`
                        : '0% de volume — Fala agora ao microfone!'}
                    </span>
                  </div>

                  {/* Barras dinâmicas de frequência/volume */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '16px' }}>
                    {[0.05, 0.15, 0.3, 0.5, 0.7].map((threshold, idx) => {
                      const active = liveVolume >= threshold;
                      return (
                        <div
                          key={idx}
                          style={{
                            width: '3.5px',
                            height: active ? `${Math.min(16, 5 + idx * 2.5)}px` : '3.5px',
                            borderRadius: '2px',
                            background: active ? 'var(--gold)' : 'rgba(255,255,255,0.2)',
                            transition: 'height 0.08s ease, background 0.08s ease',
                          }}
                        />
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={toggleMicListening}
                    className="zr-badge"
                    style={{
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '3px 8px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                    }}
                  >
                    Concluir
                  </button>
                </div>
              )}

              {/* CARD DE DIAGNÓSTICO HONESTO E TRANSPARENTE DE ÁUDIO */}
              {micDiagnostics && (
                <div
                  style={{
                    padding: '12px 14px',
                    marginBottom: '10px',
                    borderRadius: '12px',
                    background: micDiagnostics.type === 'error' ? 'rgba(38, 12, 12, 0.95)' : 'rgba(30, 24, 10, 0.95)',
                    border: micDiagnostics.type === 'error' ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid rgba(230, 195, 100, 0.5)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: '20px', color: micDiagnostics.type === 'error' ? '#ef4444' : 'var(--gold)' }}
                      >
                        {micDiagnostics.type === 'error' ? 'error' : 'warning'}
                      </span>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#fff' }}>
                        {micDiagnostics.title}
                      </span>
                    </div>
                    <button
                      onClick={() => setMicDiagnostics(null)}
                      style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: '2px' }}
                    >
                      ✕
                    </button>
                  </div>

                  <p style={{ margin: '6px 0 8px 0', fontSize: '11.5px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>
                    {micDiagnostics.details}
                  </p>

                  {micDiagnostics.technical && (
                    <details style={{ marginTop: '4px', fontSize: '10.5px', color: 'rgba(255,255,255,0.6)' }}>
                      <summary style={{ cursor: 'pointer', outline: 'none', color: 'var(--gold)', fontWeight: 600 }}>
                        Ver Diagnóstico Técnico Detalhado
                      </summary>
                      <pre
                        style={{
                          marginTop: '6px',
                          padding: '8px',
                          background: 'rgba(0,0,0,0.5)',
                          borderRadius: '6px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          fontSize: '10px',
                          lineHeight: 1.35,
                          color: '#e2e8f0',
                        }}
                      >
                        {JSON.stringify(micDiagnostics.technical, null, 2)}
                      </pre>
                    </details>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setMicDiagnostics(null);
                        openMicSettings();
                      }}
                      className="zr-badge"
                      style={{
                        background: 'rgba(255,255,255,0.12)',
                        color: 'var(--gold)',
                        border: '1px solid rgba(230, 195, 100, 0.4)',
                        cursor: 'pointer',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      ⚙️ Escolher / Testar Microfone
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMicListening()}
                      className="zr-badge"
                      style={{
                        background: 'var(--gold)',
                        color: '#000',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      🎙️ Tentar Gravar Novamente
                    </button>
                  </div>
                </div>
              )}

              {/* FORMULÁRIO DE INPUT */}
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
                  title={isListeningMic ? 'Toca para concluir e transcrever' : 'Falar com o Kaze'}
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

      {/* Botão flutuante do Kaze Mascot (Jewel Bubble com Emblema Z) */}
      <button
        onClick={() => {
          unlockNativeTTS();
          setIsOpen(!isOpen);
        }}
        className="jewel-bubble-btn pointer-events-auto transition transform active:scale-95 shadow-2xl relative flex items-center justify-center"
        style={{
          width: '54px',
          height: '54px',
          borderRadius: '27px',
          zIndex: 601,
          border: '1px solid rgba(245, 215, 130, 0.7)',
        }}
        title="Abrir Kaze AI"
      >
        <div className="w-[46px] h-[46px] rounded-full bg-[#0E0D0A]/95 flex items-center justify-center border border-[#FBE096]/50 shadow-inner relative overflow-hidden">
          {/* Geometric Z Shield Emblem or Audio Wave when thinking */}
          {isThinking ? (
            <span className="material-symbols-outlined text-[#F5DE9E] text-2xl animate-pulse">graphic_eq</span>
          ) : (
            <svg
              className="w-6 h-6 text-[#F5DE9E] filter drop-shadow-[0_0_5px_rgba(245,222,158,0.75)] transition transform hover:scale-105"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              viewBox="0 0 24 24"
            >
              <polygon points="12 2 21.5 7.5 21.5 16.5 12 22 2.5 16.5 2.5 7.5 12 2" />
              <path d="M8.5 8.5h7l-7 7h7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.3" />
            </svg>
          )}

          {/* Online status indicator dot */}
          {kazeOnline === true && (
            <span
              className="absolute bottom-1 right-2 w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_6px_#22c55e]"
            />
          )}
        </div>
      </button>
    </div>
  );
};

export default KazeMascot;
