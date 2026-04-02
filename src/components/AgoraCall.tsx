// =============================================================================
// MOTOGO AI v3.0 — AgoraCall.tsx
// Chamadas de voz VoIP entre motorista e passageiro via Agora.io
// Versão WEB (agora-rtc-sdk-ng) — NÃO é React Native
//
// Uso:
//   <AgoraCall corridaId={ride.rideId!} userId={dbUser.id} onEndCall={() => {}} />
//
// Requer:
//   npm install agora-rtc-sdk-ng
//   Edge Function: supabase/functions/agora-token/index.ts
//   Secrets Supabase: AGORA_APP_ID, AGORA_APP_CERT
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import AgoraRTC, {
  IAgoraRTCClient,
  IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import { supabase } from '../lib/supabase';

interface AgoraCallProps {
  corridaId: string;
  userId:    string;
  onEndCall?: () => void;
  /** Nome do outro utilizador para exibir no UI */
  peerName?: string;
}

type CallState = 'idle' | 'connecting' | 'active' | 'ended' | 'error';

const AgoraCall: React.FC<AgoraCallProps> = ({ corridaId, userId, onEndCall, peerName }) => {
  const [callState,   setCallState]   = useState<CallState>('idle');
  const [isMuted,     setIsMuted]     = useState(false);
  const [duration,    setDuration]    = useState(0);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);
  const [peerJoined,  setPeerJoined]  = useState(false);

  const clientRef   = useRef<IAgoraRTCClient | null>(null);
  const audioRef    = useRef<IMicrophoneAudioTrack | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const channelName = `corrida_${corridaId}`;

  // Limpar ao desmontar
  useEffect(() => {
    return () => {
      endCall(false);
    };
  }, []);

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

    try {
      // 1. Buscar token seguro da Edge Function
      const { data, error } = await supabase.functions.invoke('agora-token', {
        body: { channelName, uid: userId },
      });

      if (error || !data?.token) {
        throw new Error(error?.message ?? 'Erro ao obter token de chamada.');
      }

      const { token, appId } = data as { token: string; appId: string };

      // 2. Criar cliente Agora (voz apenas)
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      // 3. Event listeners
      client.on('user-joined', () => setPeerJoined(true));
      client.on('user-left',   () => setPeerJoined(false));
      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'audio') user.audioTrack?.play();
      });
      client.on('connection-state-change', (state) => {
        if (state === 'DISCONNECTED') setCallState('ended');
      });

      // 4. Entrar no canal
      const uid = parseInt(userId.replace(/-/g, '').slice(0, 8), 16) % 100000;
      await client.join(appId, channelName, token, uid);

      // 5. Capturar microfone
      const micTrack = await AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: 'speech_low_quality', // optimizado para voz em Angola
      });
      audioRef.current = micTrack;
      await client.publish([micTrack]);

      setCallState('active');

    } catch (e: any) {
      setErrorMsg(e.message ?? 'Erro desconhecido na chamada.');
      setCallState('error');
      await endCall(false);
    }
  };

  const endCall = async (notify = true) => {
    try {
      audioRef.current?.stop();
      audioRef.current?.close();
      audioRef.current = null;

      if (clientRef.current) {
        await clientRef.current.leave();
        clientRef.current = null;
      }
    } catch { /* já desconectado */ }

    setCallState('ended');
    setDuration(0);
    setPeerJoined(false);
    if (notify) onEndCall?.();
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

  const formatDuration = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // ------------------------------------------------------------------
  // IDLE — botão para iniciar
  if (callState === 'idle' || callState === 'ended') {
    return (
      <button
        onClick={startCall}
        className="flex items-center gap-3 golden-gradient px-6 py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-glow gold-box-glow active:scale-95 luxury-transition w-full justify-center"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>call</span>
        📞 Ligar para {peerName ?? 'o utilizador'}
      </button>
    );
  }

  // CONNECTING
  if (callState === 'connecting') {
    return (
      <div className="bg-surface-container-low border border-primary/20 rounded-2xl p-6 flex items-center gap-4">
        <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <div>
          <p className="font-black text-on-surface text-sm">A ligar...</p>
          <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-widest">A estabelecer ligação segura</p>
        </div>
      </div>
    );
  }

  // ERROR
  if (callState === 'error') {
    return (
      <div className="bg-error-container/20 border border-error/30 rounded-2xl p-5 space-y-3">
        <p className="text-error font-black text-sm">Erro na chamada</p>
        <p className="text-[11px] text-on-surface-variant font-bold">{errorMsg}</p>
        <button
          onClick={() => setCallState('idle')}
          className="text-primary font-black text-[10px] uppercase tracking-widest"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // ACTIVE — interface de chamada em curso
  return (
    <div className="bg-surface-container-lowest rounded-[2.5rem] overflow-hidden vault-shadow border border-primary/20 animate-in zoom-in-95 duration-400">

      {/* Status bar */}
      <div className="bg-[#0A0A0A] px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="w-2.5 h-2.5 rounded-full bg-primary block" />
            <span className="w-2.5 h-2.5 rounded-full bg-primary absolute inset-0 animate-ping opacity-50" />
          </div>
          <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em]">
            {peerJoined ? 'EM CHAMADA' : 'A AGUARDAR...'}
          </span>
        </div>
        <span className="font-headline text-primary font-bold text-lg">
          {formatDuration(duration)}
        </span>
      </div>

      {/* Avatar */}
      <div className="py-10 flex flex-col items-center gap-4">
        <div className="relative">
          <div className={`w-24 h-24 rounded-full golden-gradient flex items-center justify-center text-3xl font-headline font-bold vault-shadow ${peerJoined ? 'animate-pulse-gold' : ''}`}>
            {(peerName ?? 'U').charAt(0).toUpperCase()}
          </div>
          {/* Ondas de áudio */}
          {peerJoined && (
            <div className="absolute -inset-3 rounded-full border border-primary/30 animate-ping" />
          )}
        </div>
        <div className="text-center">
          <p className="font-headline font-bold text-on-surface text-xl italic">
            {peerName ?? 'Utilizador'}
          </p>
          <p className="text-[9px] text-on-surface-variant font-label uppercase tracking-widest mt-1">
            {peerJoined ? 'Ligado via VoIP MotoGo' : 'A aguardar ligação...'}
          </p>
        </div>
      </div>

      {/* Controlos */}
      <div className="px-8 pb-8 flex justify-center gap-6">

        {/* Mute */}
        <button
          onClick={toggleMute}
          className={`w-16 h-16 rounded-full flex items-center justify-center luxury-transition ${
            isMuted
              ? 'bg-error/20 border border-error/40 text-error'
              : 'bg-surface-container border border-primary/20 text-on-surface-variant hover:text-primary'
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: isMuted ? "'FILL' 1" : "'FILL' 0" }}>
            {isMuted ? 'mic_off' : 'mic'}
          </span>
        </button>

        {/* Terminar */}
        <button
          onClick={() => endCall(true)}
          className="w-20 h-20 rounded-full bg-error/80 hover:bg-error text-white flex items-center justify-center vault-shadow luxury-transition active:scale-95"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>
            call_end
          </span>
        </button>

        {/* Speaker (placeholder) */}
        <button className="w-16 h-16 rounded-full bg-surface-container border border-primary/20 text-on-surface-variant hover:text-primary flex items-center justify-center luxury-transition">
          <span className="material-symbols-outlined">volume_up</span>
        </button>
      </div>

      {/* Aviso de privacidade */}
      <div className="px-6 pb-6 text-center">
        <p className="text-[8px] text-on-surface-variant/40 font-label uppercase tracking-wider">
          Chamada encriptada ponta-a-ponta via MotoGo VoIP
        </p>
      </div>
    </div>
  );
};

export default AgoraCall;
