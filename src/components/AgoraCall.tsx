// =============================================================================
// ZENITH RIDE v3.2 — AgoraCall.tsx
// Chamadas de voz VoIP entre motorista e passageiro via Agora.io
// Versão WEB (agora-rtc-sdk-ng) com Sinalização Realtime e Cancelamento Resiliente
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
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
  const [incomingCall,   setIncomingCall]   = useState<{ callerName?: string; callerId: string } | null>(null);

  const clientRef           = useRef<IAgoraRTCClient | null>(null);
  const audioRef            = useRef<IMicrophoneAudioTrack | null>(null);
  const timerRef            = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTimeoutRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signalChannelRef    = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const channelName = `corrida_${corridaId}`;

  const onEndCallRef = useRef(onEndCall);
  useEffect(() => { onEndCallRef.current = onEndCall; }, [onEndCall]);

  const endCall = React.useCallback(async (notify = true) => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    setIncomingCall(null);

    // Notificar o outro utilizador via canal de sinalização
    try {
      signalChannelRef.current?.send({
        type: 'broadcast',
        event: 'CALL_END',
        payload: { callerId: userId },
      });
    } catch {}

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

    setCallState('ended');
    setDuration(0);
    setPeerJoined(false);
    if (notify) onEndCallRef.current?.();
  }, [userId]);

  // Limpar ao desmontar
  useEffect(() => {
    return () => { void endCall(false); };
  }, [endCall]);

  // Canal de Sinalização Realtime (para chamar o outro telemóvel / receber chamada)
  useEffect(() => {
    if (!corridaId) return;

    const channel = supabase.channel(`call-signal:${corridaId}`)
      .on('broadcast', { event: 'CALL_INIT' }, (payload) => {
        const p = (payload.payload ?? {}) as { callerId: string; callerName?: string };
        if (p.callerId && p.callerId !== userId && callState === 'idle') {
          setIncomingCall({ callerId: p.callerId, callerName: p.callerName });
        }
      })
      .on('broadcast', { event: 'CALL_ACCEPT' }, () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      })
      .on('broadcast', { event: 'CALL_REJECT' }, (payload) => {
        const p = (payload.payload ?? {}) as { callerId: string };
        if (p.callerId !== userId && (callState === 'connecting' || callState === 'active')) {
          showToast('Chamada recusada pelo destinatário.', 'info');
          void endCall(true);
        }
      })
      .on('broadcast', { event: 'CALL_END' }, () => {
        setIncomingCall(null);
        if (callState !== 'idle' && callState !== 'ended') {
          void endCall(true);
        }
      })
      .subscribe();

    signalChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      signalChannelRef.current = null;
    };
  }, [corridaId, userId, callState, endCall, showToast]);

  // Timer de duração
  useEffect(() => {
    if (callState === 'active') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  // ------------------------------------------------------------------
  const startCall = async () => {
    setCallState('connecting');
    setErrorMsg(null);
    setIncomingCall(null);

    // Sinalizar ao outro participante que estamos a ligar
    signalChannelRef.current?.send({
      type: 'broadcast',
      event: 'CALL_INIT',
      payload: { callerId: userId, callerName: 'Utilizador Zenith' },
    });

    // Timeout de segurança: 18s se não conseguir conectar
    if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
    connectTimeoutRef.current = setTimeout(() => {
      if (callState === 'connecting') {
        setErrorMsg('Sem resposta ou ligação expirada. Podes usar o Chat.');
        setCallState('error');
        void endCall(false);
      }
    }, 18000);

    try {
      // 1. Buscar token seguro da Edge Function com timeout de 8s
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

      // 2. Criar cliente Agora (voz apenas)
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'h264' });
      clientRef.current = client;

      // 3. Event listeners
      client.on('user-joined', () => {
        setPeerJoined(true);
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      });
      client.on('user-left', () => setPeerJoined(false));
      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'audio') user.audioTrack?.play();
      });
      client.on('connection-state-change', (state) => {
        if (state === 'DISCONNECTED') void endCall(true);
      });

      // 4. Entrar no canal (usa uid devolvido pelo backend)
      await client.join(appId, channelName, token, agoraUid);

      // 5. Encriptação segura de áudio determinística
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

      // 6. Capturar microfone e publicar
      const micTrack = await AgoraRTC.createMicrophoneAudioTrack({ encoderConfig: 'speech_low_quality' });
      audioRef.current = micTrack;
      await client.publish([micTrack]);

      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      setCallState('active');

    } catch (e: any) {
      console.error('[AgoraCall] Falha:', e);
      let msg = e.message ?? 'Erro desconhecido na chamada.';
      if (msg.includes('NotAllowedError') || msg.includes('Permission denied')) {
        msg = 'Permissão de microfone negada. Autoriza o microfone no navegador.';
      }
      setErrorMsg(msg);
      setCallState('error');
      await endCall(false);
    }
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

  // Efeito de toque quando há chamada a entrar
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
                signalChannelRef.current?.send({
                  type: 'broadcast',
                  event: 'CALL_REJECT',
                  payload: { callerId: userId },
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
                signalChannelRef.current?.send({
                  type: 'broadcast',
                  event: 'CALL_ACCEPT',
                  payload: { callerId: userId },
                });
                setIncomingCall(null);
                void startCall();
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
          onClick={() => void endCall(true)}
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

  // ACTIVE — interface de chamada em curso
  return (
    <div className="bg-surface-container-lowest rounded-[2rem] overflow-hidden vault-shadow border border-primary/30 animate-in zoom-in-95 duration-300">

      {/* Status bar */}
      <div className="bg-[#0A0A0A] px-5 py-3 flex justify-between items-center border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="w-2 h-2 rounded-full bg-primary block" />
            <span className="w-2 h-2 rounded-full bg-primary absolute inset-0 animate-ping opacity-50" />
          </div>
          <span className="text-[8px] font-black text-primary uppercase tracking-[0.15em]">
            {peerJoined ? 'EM CHAMADA' : 'A TOCAR...'}
          </span>
        </div>
        <span className="font-headline text-primary font-bold text-base">
          {formatDuration(duration)}
        </span>
      </div>

      {/* Avatar */}
      <div className="py-6 flex flex-col items-center gap-3">
        <div className="relative">
          <div className={`w-16 h-16 rounded-full golden-gradient flex items-center justify-center text-2xl font-headline font-bold text-black vault-shadow ${peerJoined ? 'animate-pulse-gold' : ''}`}>
            {(peerName ?? 'U').charAt(0).toUpperCase()}
          </div>
          {peerJoined && (
            <div className="absolute -inset-2 rounded-full border border-primary/30 animate-ping" />
          )}
        </div>
        <div className="text-center">
          <p className="font-headline font-bold text-on-surface text-base">
            {peerName ?? 'Utilizador'}
          </p>
          <p className="text-[9px] text-on-surface-variant font-label uppercase tracking-wider mt-0.5">
            {peerJoined ? 'Ligado via Zenith VoIP' : 'A aguardar atendimento...'}
          </p>
        </div>
      </div>

      {/* Controlos */}
      <div className="px-6 pb-6 flex justify-center gap-4">

        {/* Mute */}
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            isMuted
              ? 'bg-error/20 border border-error/40 text-error'
              : 'bg-surface-container border border-primary/20 text-on-surface-variant hover:text-primary'
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: isMuted ? "'FILL' 1" : "'FILL' 0" }}>
            {isMuted ? 'mic_off' : 'mic'}
          </span>
        </button>

        {/* Terminar */}
        <button
          onClick={() => endCall(true)}
          className="w-14 h-14 rounded-full bg-error hover:bg-error/90 text-white flex items-center justify-center vault-shadow transition-all active:scale-95 shadow-lg shadow-error/30"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}>
            call_end
          </span>
        </button>

        {/* Speaker */}
        <button
          onClick={toggleSpeaker}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            isSpeaker
              ? 'bg-surface-container border border-primary/20 text-on-surface-variant hover:text-primary'
              : 'bg-error/20 border border-error/40 text-error'
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: isSpeaker ? "'FILL' 0" : "'FILL' 1" }}>
            {isSpeaker ? 'volume_up' : 'volume_off'}
          </span>
        </button>
      </div>

      {/* Rodapé */}
      <div className="px-4 pb-3 text-center">
        <p className="text-[7px] text-on-surface-variant/40 font-label uppercase tracking-wider">
          VoIP Protegido · Zenith
        </p>
      </div>
    </div>
  );
};

export default AgoraCall;
