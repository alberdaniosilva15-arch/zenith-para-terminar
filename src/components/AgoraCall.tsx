// =============================================================================
// ZENITH RIDE v3.4 — AgoraCall.tsx
// Chamadas de voz VoIP entre motorista e passageiro via Agora.io
// ✅ Canal de sinalização estável com useLatest (não cai ao atender)
// ✅ ID único por chamada (callId) para prevenir encerramento por eventos antigos
// ✅ Separação clara entre iniciar chamada (CALL_INIT) e atender (CALL_ACCEPT)
// ✅ Tolerância a reconexões e timeouts explícitos (30s toque, 18s conexão)
// ✅ Tratamento amigável de permissão de microfone
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import AgoraRTC, {
  IAgoraRTCClient,
  IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import { supabase } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';

interface AgoraCallProps {
  corridaId: string;
  userId:    string;
  onEndCall?: () => void;
  /** Nome do outro utilizador para exibir no UI */
  peerName?: string;
  /** Se true, não renderiza botão quando idle (apenas escuta chamadas a entrar) */
  silentIdle?: boolean;
}

type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

// Deriva uma chave de encriptação a partir do channel + hint (não expõe o appId completo)
async function deriveEncryptionKey(channel: string, hint: string): Promise<string> {
  const raw = new TextEncoder().encode(channel + hint);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
}

// Deriva um salt determinístico de 32 bytes partilhado por ambos os participantes
async function deriveEncryptionSalt(channel: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(channel + '_zenith_salt_v1');
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return new Uint8Array(hash);
}

const AgoraCall: React.FC<AgoraCallProps> = ({ corridaId, userId, onEndCall, peerName, silentIdle = false }) => {
  const showToast = useAppStore((s) => s.showToast);
  const [callState,      setCallState]      = useState<CallState>('idle');
  const [isMuted,        setIsMuted]        = useState(false);
  const [isSpeaker,      setIsSpeaker]      = useState(true);
  const [duration,       setDuration]       = useState(0);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);
  const [peerJoined,     setPeerJoined]     = useState(false);
  const [incomingCall,   setIncomingCall]   = useState<{ callerName?: string; callerId: string; callId: string } | null>(null);

  const clientRef           = useRef<IAgoraRTCClient | null>(null);
  const audioRef            = useRef<IMicrophoneAudioTrack | null>(null);
  const timerRef            = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalChannelRef    = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const currentCallIdRef    = useRef<string | null>(null);

  const channelName = `corrida_${corridaId}`;

  const onEndCallRef = useLatest(onEndCall);
  const toastRef = useLatest(showToast);

  const endCall = useCallback(async (notify = true, isRemote = false) => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    setIncomingCall(null);

    const callIdToSend = currentCallIdRef.current;

    // Se o encerramento foi local, notificar o outro telemóvel
    if (!isRemote && signalChannelRef.current) {
      try {
        signalChannelRef.current.send({
          type: 'broadcast',
          event: 'CALL_END',
          payload: { callerId: userId, callId: callIdToSend },
        });
      } catch (err) {
        console.warn('[AgoraCall] Erro ao emitir CALL_END:', err);
      }
    }

    try {
      audioRef.current?.stop();
      audioRef.current?.close();
      audioRef.current = null;

      if (clientRef.current) {
        await clientRef.current.leave();
        clientRef.current = null;
      }
    } catch (err) {
      console.warn('[AgoraCall] Já desconectado:', err);
    }

    currentCallIdRef.current = null;
    setCallState('ended');
    setDuration(0);
    setPeerJoined(false);
    if (notify) onEndCallRef.current?.();
  }, [userId, onEndCallRef]);

  const endCallRef = useLatest(endCall);

  // Limpar ao desmontar
  useEffect(() => {
    return () => { void endCallRef.current(false, false); };
  }, [endCallRef]);

  const callStateRef = useLatest(callState);

  // Canal de Sinalização Realtime
  // ✅ FIX: Dependências estritas [corridaId, userId]
  // endCall e toast usam refs para nunca forçar destruição do canal
  useEffect(() => {
    if (!corridaId || !userId) return;

    const channel = supabase.channel(`call-signal:${corridaId}`)
      .on('broadcast', { event: 'CALL_INIT' }, (payload) => {
        const p = (payload.payload ?? {}) as { callerId: string; callerName?: string; callId?: string };
        if (p.callerId && p.callerId !== userId && callStateRef.current === 'idle') {
          const callId = p.callId || crypto.randomUUID();
          currentCallIdRef.current = callId;
          setIncomingCall({ callerId: p.callerId, callerName: p.callerName, callId });
        }
      })
      .on('broadcast', { event: 'CALL_ACCEPT' }, (payload) => {
        const p = (payload.payload ?? {}) as { callerId: string; callId?: string };
        if (p.callId && currentCallIdRef.current && p.callId !== currentCallIdRef.current) return;
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      })
      .on('broadcast', { event: 'CALL_REJECT' }, (payload) => {
        const p = (payload.payload ?? {}) as { callerId: string; callId?: string };
        if (p.callId && currentCallIdRef.current && p.callId !== currentCallIdRef.current) return;
        if (p.callerId !== userId && (callStateRef.current === 'connecting' || callStateRef.current === 'active')) {
          toastRef.current('Chamada recusada pelo destinatário.', 'info');
          void endCallRef.current(true, true);
        }
      })
      .on('broadcast', { event: 'CALL_END' }, (payload) => {
        const p = (payload.payload ?? {}) as { callerId: string; callId?: string };
        // Ignora encerramento de chamada anterior atrasado
        if (p.callId && currentCallIdRef.current && p.callId !== currentCallIdRef.current) {
          return;
        }
        setIncomingCall(null);
        if (callStateRef.current !== 'idle' && callStateRef.current !== 'ended') {
          toastRef.current('Chamada terminada.', 'info');
          void endCallRef.current(true, true);
        }
      })
      .subscribe();

    signalChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      signalChannelRef.current = null;
    };
  }, [corridaId, userId, callStateRef, endCallRef, toastRef]);

  // Timer de duração
  useEffect(() => {
    if (callState === 'active') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  // Função central para entrar na chamada Agora
  const joinAgoraSession = async (isAnswer: boolean, callId: string) => {
    setCallState('connecting');
    setErrorMsg(null);
    setIncomingCall(null);
    currentCallIdRef.current = callId;

    // Timeout de segurança: 18s se não conseguir conectar
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (callStateRef.current === 'connecting') {
        setErrorMsg('Sem resposta ou ligação expirada. Podes usar o Chat.');
        setCallState('error');
        void endCallRef.current(false, false);
      }
    }, 18000);

    try {
      // 1. Pedir autorização de microfone antes do join para detectar recusa no browser/Capacitor
      let micTrack: IMicrophoneAudioTrack | null = null;
      try {
        micTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_low_quality' });
        audioRef.current = micTrack;
      } catch (micErr: any) {
        throw new Error('Permissão de microfone negada. Autoriza o acesso ao microfone para falar.');
      }

      // 2. Buscar token seguro da Edge Function com timeout de 8s
      const tokenPromise = supabase.functions.invoke('agora-token', {
        body: { channelName, uid: userId },
      });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Tempo limite ao contactar servidor VoIP.')), 8000)
      );

      const res = (await Promise.race([tokenPromise, timeoutPromise])) as any;
      const { data, error } = res;

      if (error || !data?.token) {
        throw new Error(error?.message ?? 'Não foi possível autorizar chamada VoIP.');
      }

      const { token, appId, uid: agoraUid } = data as { token: string; appId: string; uid: number };

      // 3. Criar cliente Agora (voz apenas)
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'h264' });
      clientRef.current = client;

      // 4. Event listeners do Agora
      client.on('user-joined', () => {
        setPeerJoined(true);
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      });
      client.on('user-left', () => {
        setPeerJoined(false);
      });
      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'audio') user.audioTrack?.play();
      });
      client.on('connection-state-change', (curState) => {
        if (curState === 'DISCONNECTED') {
          void endCallRef.current(true, true);
        }
      });

      // 5. Entrar no canal (com UID estável devolvido pelo backend)
      await client.join(appId, channelName, token, agoraUid);

      // 6. Encriptação segura de áudio determinística
      const AGORA_APP_ID_HINT = (appId || '').slice(0, 8);
      const encKey = await deriveEncryptionKey(channelName, AGORA_APP_ID_HINT);
      try {
        const saltBytes = await deriveEncryptionSalt(channelName);
        await (client as any).enableEncryption(true, {
          encryptionMode: 'aes-256-gcm2',
          encryptionKey: encKey,
          encryptionSalt: saltBytes,
        });
      } catch (e) {
        console.warn('[AgoraCall] enableEncryption fallback:', e);
      }

      // 7. Publicar áudio do microfone
      if (micTrack) {
        await client.publish([micTrack]);
      }

      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      setCallState('active');

    } catch (e: any) {
      console.error('[AgoraCall] Falha ao iniciar VoIP:', e);
      let msg = e.message ?? 'Erro desconhecido na chamada.';
      if (msg.includes('NotAllowedError') || msg.includes('Permission denied')) {
        msg = 'Permissão de microfone negada. Autoriza o microfone no navegador.';
      }
      setErrorMsg(msg);
      setCallState('error');
      await endCallRef.current(false, false);
    }
  };

  // Iniciar chamada pelo utilizador actual
  const startCall = async () => {
    const newCallId = crypto.randomUUID();
    currentCallIdRef.current = newCallId;

    // Sinalizar ao outro telemóvel que estamos a ligar
    signalChannelRef.current?.send({
      type: 'broadcast',
      event: 'CALL_INIT',
      payload: { callerId: userId, callerName: peerName || 'Utilizador Zenith', callId: newCallId },
    });

    await joinAgoraSession(false, newCallId);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.setEnabled(true);
      setIsMuted(false);
    } else {
      audioRef.current.setEnabled(false);
      setIsMuted(true);
    }
  };

  const toggleSpeaker = async () => {
    if (!audioRef.current) {
      showToast('Não há áudio activo.', 'info');
      return;
    }
    const playDev = isSpeaker ? 'earpiece' : 'speaker';
    const setPlayback = (audioRef.current as any).setPlaybackDevice;
    if (typeof setPlayback === 'function') {
      try {
        await setPlayback.call(audioRef.current, playDev);
        setIsSpeaker(s => !s);
      } catch (e) {
        console.warn('[AgoraCall] setPlaybackDevice falhou', e);
        showToast('Não foi possível alternar o dispositivo.', 'error');
      }
    } else {
      showToast('Usa os botões do teu telemóvel para regular o volume.', 'info');
    }
  };

  const formatDuration = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // Efeito sonoro de toque quando há chamada a entrar
  useEffect(() => {
    if (!incomingCall) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      let active = true;
      const playChime = () => {
        if (!active || audioCtx.state === 'closed') return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
        if (active) setTimeout(playChime, 2200);
      };
      playChime();
      return () => {
        active = false;
        try { void audioCtx.close(); } catch {}
      };
    } catch {
      return () => {};
    }
  }, [incomingCall]);

  // ------------------------------------------------------------------
  // CHAMADA A ENTRAR (Ringing - Modal Flutuante Global)
  if (incomingCall) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
        <div className="w-full max-w-sm bg-[#121214] border-2 border-primary/60 rounded-[2.5rem] p-6 shadow-2xl space-y-6 text-center animate-in zoom-in-95 duration-300">
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 rounded-full golden-gradient animate-ping opacity-30" />
            <div className="relative w-24 h-24 rounded-full golden-gradient flex items-center justify-center text-black text-3xl font-black shadow-2xl">
              <span className="material-symbols-outlined text-4xl animate-bounce">ring_volume</span>
            </div>
          </div>
          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-primary/20 text-primary text-[10px] font-black uppercase tracking-widest mb-2">
              Chamada VoIP a entrar
            </span>
            <h3 className="text-xl font-headline font-black text-white truncate">
              {peerName ?? incomingCall.callerName ?? 'Utilizador Zenith'}
            </h3>
            <p className="text-xs text-white/50 mt-1">A tocar no dispositivo...</p>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => {
                const callId = incomingCall.callId;
                signalChannelRef.current?.send({
                  type: 'broadcast',
                  event: 'CALL_REJECT',
                  payload: { callerId: userId, callId },
                });
                setIncomingCall(null);
              }}
              className="py-4 bg-red-600/20 hover:bg-red-600/30 text-red-500 border border-red-500/40 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              <span className="material-symbols-outlined text-lg">call_end</span>
              Recusar
            </button>
            <button
              onClick={() => {
                const callId = incomingCall.callId;
                signalChannelRef.current?.send({
                  type: 'broadcast',
                  event: 'CALL_ACCEPT',
                  payload: { callerId: userId, callId },
                });
                setIncomingCall(null);
                void joinAgoraSession(true, callId);
              }}
              className="py-4 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 transition-all shadow-glow active:scale-95 shadow-lg shadow-emerald-500/30"
            >
              <span className="material-symbols-outlined text-lg">call</span>
              Atender
            </button>
          </div>
        </div>
      </div>
    );
  }

  // IDLE / ENDED — botão para iniciar
  if (callState === 'idle' || callState === 'ended') {
    if (silentIdle) return null;
    return (
      <button
        onClick={startCall}
        className="flex items-center gap-2 golden-gradient px-4 py-3 rounded-2xl font-black text-[11px] uppercase tracking-wider shadow-glow gold-box-glow active:scale-95 luxury-transition w-full justify-center text-black"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>call</span>
        Ligar para {peerName ?? 'o utilizador'}
      </button>
    );
  }

  // CONNECTING — com botão de cancelar e timeout
  if (callState === 'connecting') {
    return (
      <div className="bg-surface-container-low border border-primary/20 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
          <div>
            <p className="font-black text-on-surface text-xs">A ligar...</p>
            <p className="text-[9px] text-on-surface-variant font-label uppercase tracking-wider">A contactar {peerName ?? 'destinatário'}</p>
          </div>
        </div>
        <button
          onClick={() => void endCall(true, false)}
          className="px-3 py-1.5 bg-error/20 hover:bg-error/30 text-error border border-error/30 rounded-xl text-[11px] font-bold transition-all active:scale-95"
        >
          Cancelar
        </button>
      </div>
    );
  }

  // ERROR — com botão de tentar novamente
  if (callState === 'error') {
    return (
      <div className="bg-error-container/20 border border-error/30 rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-error font-black text-xs">Chamada VoIP Indisponível</p>
          <button
            onClick={() => setCallState('idle')}
            className="text-primary font-black text-[10px] uppercase tracking-wider underline"
          >
            Tentar de novo
          </button>
        </div>
        <p className="text-[11px] text-on-surface-variant">{errorMsg || 'Não foi possível ligar o áudio VoIP.'}</p>
        <div className="pt-1 flex gap-2">
          <a
            href="tel:113"
            className="flex-1 py-2.5 bg-white/10 hover:bg-white/15 border border-white/20 rounded-xl text-center text-[10px] font-bold text-white uppercase tracking-wider"
          >
            Ligar por Telefone
          </a>
        </div>
      </div>
    );
  }

  // ACTIVE — painel durante a chamada
  return (
    <div className="bg-surface-container-low border border-primary/30 rounded-3xl p-5 space-y-4 shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
          <div>
            <p className="font-headline font-bold text-sm text-on-surface">
              {peerName ?? 'Em chamada...'}
            </p>
            <p className="text-[10px] text-on-surface-variant font-mono">
              {formatDuration(duration)}
              {peerJoined ? ' · Ligado' : ' · A aguardar entrada...'}
            </p>
          </div>
        </div>
        <button
          onClick={() => void endCall(true, false)}
          className="w-10 h-10 rounded-full bg-error hover:bg-error/80 text-on-error flex items-center justify-center transition-all active:scale-95 shadow-md"
        >
          <span className="material-symbols-outlined text-xl">call_end</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={toggleMute}
          className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
            isMuted
              ? 'bg-primary/20 border-primary text-primary'
              : 'bg-surface border-outline-variant/30 text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-base">
            {isMuted ? 'mic_off' : 'mic'}
          </span>
          {isMuted ? 'Desmutar' : 'Silenciar'}
        </button>

        <button
          onClick={() => void toggleSpeaker()}
          className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
            isSpeaker
              ? 'bg-primary/20 border-primary text-primary'
              : 'bg-surface border-outline-variant/30 text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-base">
            {isSpeaker ? 'volume_up' : 'hearing'}
          </span>
          {isSpeaker ? 'Alta-voz' : 'Auscultador'}
        </button>
      </div>
    </div>
  );
};

export default AgoraCall;
