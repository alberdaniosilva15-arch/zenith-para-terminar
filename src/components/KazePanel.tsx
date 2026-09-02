/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import KazeOrb from './admin/KazeOrb';
import ErrorBoundary from './ErrorBoundary';
import { supabase } from '../lib/supabase';
import { geminiService } from '../services/geminiService';
import { kazeSpeakOnline } from '../lib/kazeVoice';

// ── Tipos auxiliares ────────────────────────────────────────────────────────
type AudioStats = {
  rawVolume: number;
  rawBass: number;
  rawMid: number;
  rawHigh: number;
  gatedVolume: number;
  gatedBass: number;
  gatedMid: number;
  gatedHigh: number;
  noiseFloor: number;
  frequencyHz: number | null;
  fft: number;
  frequencyBins: number[];
};

type AudioResources = {
  stream: MediaStream | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  dataArray: Uint8Array | null;
  interval: ReturnType<typeof setInterval> | null;
};

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

type KazeChat = ReturnType<typeof geminiService.createHermesKazeChat>;

async function transcribeDirectGroq(blob: Blob, apiKey: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, 'audio.webm');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'pt');
  formData.append('response_format', 'json');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const data = await res.json();
    return data.text || '';
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcribeDirectGemini(blob: Blob, apiKey: string): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const base64Audio = btoa(binary);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: 'Transcreve o áudio em português com máxima precisão. Retorna APENAS o texto falado.' },
              {
                inline_data: {
                  mime_type: blob.type || 'audio/webm',
                  data: base64Audio,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini áudio HTTP ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function transcribeAudioFlexible(blob: Blob): Promise<string> {
  const groqKey = import.meta.env.VITE_GROQ_API_KEY;
  if (groqKey) {
    try {
      const groqText = await transcribeDirectGroq(blob, groqKey);
      if (groqText) return groqText;
    } catch (e) {
      console.warn('[KazePanel] Groq falhou, a tentar Gemini:', e);
    }
  }

  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (geminiKey) {
    return await transcribeDirectGemini(blob, geminiKey);
  }

  throw new Error('Chave de IA para áudio indisponível.');
}

const CALIB_MS = 2500;
const GATE_RATIO = 2.5; // Reduzido para ouvir melhor a voz normal
const GATE_MIN = 0.10;

const INITIAL_METRICS = {
  activeRides: 0,
  activeDrivers: 0,
};

const DEFAULT_AUDIO_STATS: AudioStats = {
  rawVolume: 0,
  rawBass: 0,
  rawMid: 0,
  rawHigh: 0,
  gatedVolume: 0,
  gatedBass: 0,
  gatedMid: 0,
  gatedHigh: 0,
  noiseFloor: 0.06,
  frequencyHz: null,
  fft: 0,
  frequencyBins: [],
};

const SCREEN_CSS = `
  .kaze-admin-core-screen {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 600px;
    flex: 1;
    overflow: hidden;
    background: #000;
    color: #00d4ff;
    font-family: "Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    cursor: crosshair;
  }

  .kaze-activate-btn {
    position: absolute;
    bottom: 50%;
    left: 50%;
    transform: translate(-50%, 180px);
    z-index: 20;
    padding: 12px 32px;
    background: transparent;
    border: 1px solid #00d4ff;
    color: #00d4ff;
    font-family: Orbitron, "Share Tech Mono", ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.4em;
    text-transform: uppercase;
    cursor: pointer;
    pointer-events: all;
    transition: all 0.3s ease;
    box-shadow: 0 0 20px rgba(0,212,255,0.1), inset 0 0 20px rgba(0,212,255,0.05);
  }

  .kaze-activate-btn:hover {
    background: rgba(0,212,255,0.08);
    box-shadow: 0 0 30px rgba(0,212,255,0.3), inset 0 0 20px rgba(0,212,255,0.1);
  }

  .kaze-activate-btn.hidden {
    display: none;
  }

  .kaze-live-region {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    border: 0;
    padding: 0;
    clip: rect(0 0 0 0);
    overflow: hidden;
  }
`;

function averageBins(dataArray: Uint8Array, start: number, end: number): number {
  if (!dataArray?.length) return 0;
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(dataArray.length, end);
  if (safeEnd <= safeStart) return 0;
  let sum = 0;
  for (let i = safeStart; i < safeEnd; i += 1) {
    const v = dataArray[i];
    if (v !== undefined) sum += v;
  }
  return sum / (safeEnd - safeStart) / 128;
}

function computeAudioStats(dataArray: Uint8Array, audioCtx: AudioContext, noiseFloor: number): AudioStats {
  const len = dataArray.length || 1;
  let sum = 0;
  let maxValue = 0;
  let maxIndex = 0;

  for (let i = 0; i < dataArray.length; i += 1) {
    const value = dataArray[i] ?? 0;
    sum += value;
    if (value > maxValue) {
      maxValue = value;
      maxIndex = i;
    }
  }

  const rawVolume = sum / len / 128;
  const rawBass = averageBins(dataArray, 0, 8);
  const rawMid = averageBins(dataArray, 9, 40);
  const rawHigh = averageBins(dataArray, 41, 120);
  const span = Math.max(1 - noiseFloor, 0.01);
  const gatedVolume = rawVolume > noiseFloor ? Math.min(1, (rawVolume - noiseFloor) / span) : 0;
  const gatedBass = rawBass > noiseFloor ? Math.min(1, (rawBass - noiseFloor) / span) : 0;
  const gatedMid = rawMid > noiseFloor * 0.9 ? Math.min(1, (rawMid - noiseFloor * 0.9) / span) : 0;
  const gatedHigh = rawHigh > noiseFloor * 0.8 ? Math.min(1, (rawHigh - noiseFloor * 0.8) / span) : 0;
  const frequencyHz = audioCtx?.sampleRate
    ? Math.round(maxIndex * (audioCtx.sampleRate / 2) / len)
    : null;

  return {
    rawVolume,
    rawBass,
    rawMid,
    rawHigh,
    gatedVolume,
    gatedBass,
    gatedMid,
    gatedHigh,
    noiseFloor,
    frequencyHz,
    fft: len,
    frequencyBins: Array.from(dataArray.slice(0, 128)),
  };
}

export default function KazePanel() {
  const [metrics, setMetrics] = useState(INITIAL_METRICS);
  const [voiceState, setVoiceState] = useState('standby');
  const [sessionActive, setSessionActive] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState('ONLINE');
  const [audioStats, setAudioStats] = useState<AudioStats>(DEFAULT_AUDIO_STATS);
  const [buttonLabel, setButtonLabel] = useState('ACTIVATE VOICE');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [textInput, setTextInput] = useState('');
  const [draftText, setDraftText] = useState('');

  const chatRef = useRef<KazeChat | null>(null);
  const recognitionRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRunningRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const processingRef = useRef(false);
  const failCountRef = useRef(0);
  const voiceStateRef = useRef('standby');
  const finalTranscriptRef = useRef('');
  const draftTranscriptRef = useRef('');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noiseFloorRef = useRef(DEFAULT_AUDIO_STATS.noiseFloor);
  const audioSessionIdRef = useRef(0);
  const audioRef = useRef<AudioResources>({
    stream: null,
    audioCtx: null,
    analyser: null,
    dataArray: null,
    interval: null,
  });

  const modeLabel = useMemo(() => {
    if (voiceState === 'calibrating') return 'CALIBRATING';
    if (voiceState === 'listening' && audioStats.gatedVolume > 0.05) return 'ACTIVE';
    if (voiceState === 'listening') return 'LISTENING';
    if (voiceState === 'processing') return 'PROCESSING';
    if (voiceState === 'speaking') return 'SPEAKING';
    if (voiceState === 'error') return 'ERROR';
    return 'STANDBY';
  }, [audioStats.gatedVolume, voiceState]);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    const updateOnlineState = () => {
      setOnlineStatus(navigator.onLine ? 'ONLINE' : 'EMERGENCY');
    };
    updateOnlineState();
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useEffect(() => {
    const refreshMetrics = async () => {
      try {
        const [activeRes, driversRes] = await Promise.all([
          supabase
            .from('rides')
            .select('id', { count: 'exact', head: true })
            .in('status', ['searching', 'accepted', 'picking_up', 'in_progress']),
          supabase
            .from('driver_locations')
            .select('driver_id', { count: 'exact', head: true })
            .eq('status', 'available'),
        ]);

        setMetrics({
          activeRides: activeRes.count ?? 0,
          activeDrivers: driversRes.count ?? 0,
        });
      } catch (error) {
        console.warn('[KazePanel] metricas:', error);
      }
    };

    void refreshMetrics();
    const interval = window.setInterval(refreshMetrics, 45000);
    return () => window.clearInterval(interval);
  }, []);

  const stopAudioAnalyser = useCallback(() => {
    audioSessionIdRef.current += 1;
    const audio = audioRef.current;
    if (audio.interval) window.clearInterval(audio.interval);
    if (audio.stream) {
      try {
        audio.stream.getTracks().forEach((track) => track.stop());
      } catch { /* stream cleanup seguro */ }
    }
    if (audio.audioCtx) {
      try {
        void audio.audioCtx.close();
      } catch { /* audioCtx cleanup seguro */ }
    }
    audioRef.current = {
      stream: null,
      audioCtx: null,
      analyser: null,
      dataArray: null,
      interval: null,
    };
    setAudioStats((prev) => ({ ...DEFAULT_AUDIO_STATS, noiseFloor: prev.noiseFloor || DEFAULT_AUDIO_STATS.noiseFloor }));
  }, []);

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const recorder = recognitionRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* já inactivo */ }
      }
    }
    recognitionRef.current = null;
    recognitionRunningRef.current = false;
    finalTranscriptRef.current = '';
    draftTranscriptRef.current = '';
  }, []);

  const stopVoiceSession = useCallback(() => {
    sessionActiveRef.current = false;
    processingRef.current = false;
    failCountRef.current = 0;
    chatRef.current = null;
    setSessionActive(false);
    setVoiceState('standby');
    setButtonLabel('ACTIVATE VOICE');
    stopRecognition();
    stopAudioAnalyser();
  }, [stopAudioAnalyser, stopRecognition]);

  const speakAndResume = useCallback(async (text: string) => {
    if (!text?.trim()) return;
    setLastReply(text);
    setVoiceState('speaking');

    try {
      const elevenLabsKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
      await kazeSpeakOnline(text, elevenLabsKey);
    } catch (error) {
      console.warn('[KazePanel] fala online falhou:', error);
    } finally {
      processingRef.current = false;
      if (sessionActiveRef.current) {
        setVoiceState('listening');
        if (!recognitionRunningRef.current) {
          setTimeout(() => {
            if (sessionActiveRef.current && !recognitionRunningRef.current && !processingRef.current) {
              startRecognition();
            }
          }, 300);
        }
      } else {
        setVoiceState('standby');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTranscriptToHermes = useCallback(async (transcript: string) => {
    const clean = String(transcript || '').trim();
    if (!clean) return;

    if (processingRef.current) {
      console.warn('[KazePanel] processingRef preso, reset forçado antes de nova query.');
      processingRef.current = false;
    }

    processingRef.current = true;
    setLastTranscript(clean);
    setVoiceState('processing');

    try {
      const chat = chatRef.current ?? geminiService.createHermesKazeChat({
        source: 'admin-kaze-hermes-fullscreen',
        interface: 'voice',
      });
      chatRef.current = chat;

      // Safeguard: absolute maximum timeout for the UI state so it NEVER gets stuck
      const timeoutId = setTimeout(() => {
        if (processingRef.current) {
          console.error('[KazePanel] Timeout de segurança atingido.');
          processingRef.current = false;
          chatRef.current = null; // Reset chat stale para próxima tentativa
          setLastReply('A IA demorou. Fala de novo, chefe.');
          if (sessionActiveRef.current) {
            setVoiceState('listening');
            setTimeout(() => {
              if (!recognitionRunningRef.current) startRecognition();
            }, 800);
          } else {
            setVoiceState('standby');
          }
        }
      }, 30000);

      const response = await chat.sendMessage(clean, {
        metrics,
        voice: true,
        route: 'admin-fullscreen-core',
      });

      clearTimeout(timeoutId);

      // ── Side-effects: abrir URLs, copiar código, etc. ──
      const toolResult = response.toolResult?.result || response.toolResult;
      if (toolResult) {
        const toolName = response.toolName;
        // Abrir URL no browser (YouTube, pesquisa web, site externo)
        if (toolResult.url) {
          try {
            window.open(toolResult.url, '_blank');
          } catch (e) {
            console.warn('[KazePanel] Falha ao abrir URL:', e);
          }
        }
        // Copiar código gerado para clipboard
        if (toolName === 'generate_code' && toolResult.code) {
          try {
            await navigator.clipboard.writeText(toolResult.code);
          } catch (e) {
            console.warn('[KazePanel] Falha ao copiar código:', e);
          }
        }
        // Notificar criação de agente
        if (toolName === 'create_agent' && toolResult.agent) {
          console.log('[KazePanel] Agente criado:', toolResult.agent.name);
        }
      }

      setOnlineStatus(response.local ? 'EMERGENCY' : response.route === 'hermes-tool' ? 'HERMES' : 'ONLINE');
      await speakAndResume(response.text || 'Processamento concluido, mas sem resposta de texto.');
    } catch (error) {
      console.warn('[KazePanel] Kaze/Hermes falhou:', error);
      setOnlineStatus('EMERGENCY');
      await speakAndResume('Kaze/Hermes entrou em modo de emergencia porque a ligacao falhou.');
    } finally {
      processingRef.current = false;
    }
  }, [metrics, speakAndResume]);

  const startRecognition = useCallback(() => {
    const stream = audioRef.current.stream;
    if (!stream || !stream.active) {
      return false;
    }

    if (recognitionRunningRef.current || (recognitionRef.current && recognitionRef.current.state === 'recording')) {
      return true;
    }

    stopRecognition();
    audioChunksRef.current = [];
    finalTranscriptRef.current = '';
    draftTranscriptRef.current = '';

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      recognitionRunningRef.current = false;
      if (!sessionActiveRef.current || audioChunksRef.current.length === 0) return;

      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];

      if (!processingRef.current) {
        setDraftText('A processar áudio com IA...');
        try {
          const text = await transcribeAudioFlexible(audioBlob);
          if (text && text.trim() && text.trim().length > 1) {
            setDraftText('');
            void sendTranscriptToHermes(text.trim());
          } else {
            setDraftText('');
            if (sessionActiveRef.current && voiceStateRef.current !== 'speaking') {
              restartTimerRef.current = window.setTimeout(() => {
                if (!recognitionRunningRef.current && sessionActiveRef.current && !processingRef.current) startRecognition();
              }, 500);
            }
          }
        } catch (err: unknown) {
          console.warn('[KazePanel] Erro na transcrição de áudio:', err);
          const errMsg = err instanceof Error
            ? err.name === 'AbortError' ? 'A transcrição demorou demasiado tempo.' : err.message
            : 'Erro desconhecido';
          setDraftText('');
          setLastReply(`> KAZE: ${errMsg}`);
          setVoiceState('error');
          await speakAndResume(`Não consegui ouvir com clareza. Podes repetir, Comandante?`);
        }
      }
    };

    try {
      recorder.start();
      recognitionRef.current = recorder;
      recognitionRunningRef.current = true;
      failCountRef.current = 0;
      setVoiceState('listening');
      return true;
    } catch (err) {
      console.warn('[KazePanel] Falha a iniciar MediaRecorder:', err);
      failCountRef.current += 1;
      if (failCountRef.current >= 3) {
        setVoiceState('error');
        setLastReply('Microfone indisponível após 3 tentativas.');
      }
      return false;
    }
  }, [sendTranscriptToHermes, stopRecognition]);

  const startAudioAnalyser = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia indisponivel');
    }

    stopAudioAnalyser();
    const sessionId = audioSessionIdRef.current + 1;
    audioSessionIdRef.current = sessionId;

    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!AudioContextCtor) throw new Error('AudioContext indisponivel');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const audioCtx = new AudioContextCtor();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const calibrationBuffer: number[] = [];

    setVoiceState('calibrating');
    setAudioStats((prev) => ({ ...prev, fft: analyser.frequencyBinCount }));

    let silenceTicks = 0;
    let speakingTicks = 0;
    let totalTicks = 0; // Novo temporizador global

    const interval = window.setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      const currentNoiseFloor = noiseFloorRef.current;
      const stats = computeAudioStats(dataArray, audioCtx, currentNoiseFloor);
      if (voiceStateRef.current === 'calibrating') {
        calibrationBuffer.push(stats.rawVolume);
      } else if (voiceStateRef.current === 'listening' && recognitionRef.current?.state === 'recording') {
        totalTicks += 1; // Conta o tempo total de gravação (1 tick = 50ms)

        // Voice Activity Detection (VAD) — sensibilidade equilibrada para ouvir fala normal
        if (stats.gatedVolume > 0.15) {
          speakingTicks += 1;
          silenceTicks = 0;
        } else if (speakingTicks > 10) { // Falou por pelo menos 0.5s
          silenceTicks += 1;
          if (silenceTicks > 24) { // 1.2s de silêncio após fala real → parar imediatamente
            try { recognitionRef.current?.stop(); } catch { /* silêncio detectado */ }
            speakingTicks = 0;
            silenceTicks = 0;
            totalTicks = 0;
          }
        } else if (speakingTicks > 0 && speakingTicks <= 10) {
          silenceTicks += 1;
          if (silenceTicks > 10) {
            speakingTicks = 0;
            silenceTicks = 0;
          }
        }

        // LIMITE GLOBAL ABSOLUTO: 12 segundos (240 ticks).
        // Garante que tenta responder após 12s mesmo que o silêncio não seja detetado.
        if (totalTicks >= 240) {
          try { recognitionRef.current?.stop(); } catch { /* limite global */ }
          speakingTicks = 0;
          silenceTicks = 0;
          totalTicks = 0;
        }
      }
      setAudioStats(stats);
    }, 50);

    audioRef.current = {
      stream,
      audioCtx,
      analyser,
      dataArray,
      interval,
    };

    await new Promise((resolve) => window.setTimeout(resolve, CALIB_MS));
    if (audioSessionIdRef.current !== sessionId) return;

    const average = calibrationBuffer.reduce((sum, value) => sum + value, 0) / (calibrationBuffer.length || 1);
    const noiseFloor = Math.max(average * GATE_RATIO, GATE_MIN);
    noiseFloorRef.current = noiseFloor;
    setAudioStats((prev) => ({ ...prev, noiseFloor }));
  }, [stopAudioAnalyser]);

  const startVoiceSession = useCallback(async () => {
    if (sessionActiveRef.current || processingRef.current) return;

    setButtonLabel('CALIBRATING');
    sessionActiveRef.current = true;
    setSessionActive(true);
    setOnlineStatus(navigator.onLine ? 'ONLINE' : 'EMERGENCY');

    try {
      await startAudioAnalyser();
      if (!sessionActiveRef.current) return;
      setButtonLabel('ACTIVATE VOICE');
      setVoiceState('listening');
      startRecognition();
    } catch (error: unknown) {
      console.warn('[KazePanel] activar voz:', error);
      sessionActiveRef.current = false;
      setSessionActive(false);
      const errMsg = error instanceof Error ? (error.name || error.message) : 'ERRO DESCONHECIDO';
      setButtonLabel(`AUDIO: ${errMsg.toUpperCase().substring(0, 15)}`);
      setVoiceState('error');
      setOnlineStatus('EMERGENCY');
      stopAudioAnalyser();
    }
  }, [startAudioAnalyser, startRecognition, stopAudioAnalyser]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopVoiceSession();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  useEffect(() => {
    if (sessionActive && voiceState === 'listening' && !recognitionRunningRef.current && !processingRef.current && failCountRef.current < 3) {
      restartTimerRef.current = window.setTimeout(() => {
        if (sessionActiveRef.current && voiceStateRef.current === 'listening' && !recognitionRunningRef.current && !processingRef.current && failCountRef.current < 3) {
          startRecognition();
        }
      }, 500);
    }
  }, [sessionActive, startRecognition, voiceState]);

  return (
    <ErrorBoundary>
    <div className="kaze-admin-core-screen">
      <style>{SCREEN_CSS}</style>
      <KazeOrb
        isListening={voiceState === 'listening' || voiceState === 'calibrating'}
        isSpeaking={voiceState === 'speaking'}
        volume={audioStats.gatedVolume}
        modeLabel={modeLabel}
        onlineStatus={onlineStatus}
        audioStats={audioStats}
        systemStatus={{
          activeRides: metrics.activeRides,
          driversOnline: metrics.activeDrivers,
        }}
      />

      <button
        className={`kaze-activate-btn ${sessionActive ? 'hidden' : ''}`}
        type="button"
        onClick={() => void startVoiceSession()}
      >
        &#x2B21; {buttonLabel}
      </button>

      <div className="kaze-live-region" aria-live="polite">
        {draftText ? `A ouvir: ${draftText}` : (lastTranscript ? `Ultimo comando: ${lastTranscript}. ` : '')}
        {lastReply ? `Resposta: ${lastReply}` : ''}
      </div>

      <div style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 30, width: '100%', maxWidth: '500px' }} className="flex flex-col gap-3">
        {/* VISUAL FEEDBACK AREA */}
        {(draftText || lastTranscript || lastReply) && (
          <div className="bg-black/60 border border-[#00d4ff]/30 p-4 rounded-md">
            {draftText && (
              <div className="text-[#00ffcc] font-bold text-sm mb-1 animate-pulse">
                &gt; A ouvir: {draftText}
              </div>
            )}
            {!draftText && lastTranscript && (
              <div className="text-[#00d4ff] text-xs opacity-70 mb-2">
                &gt; TU: {lastTranscript}
              </div>
            )}
            {!draftText && lastReply && (
              <div className="text-[#f2ca50] text-sm">
                &gt; KAZE: {lastReply}
              </div>
            )}
          </div>
        )}

        <form onSubmit={(e) => {
          e.preventDefault();
          if (textInput.trim()) {
            sendTranscriptToHermes(textInput);
            setTextInput('');
          }
        }} className="flex gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Comando de texto..."
            className="flex-1 bg-black/50 border border-[#00d4ff] text-[#00d4ff] px-4 py-2 rounded-md font-[Orbitron] text-xs focus:outline-none focus:box-shadow-[0_0_10px_rgba(0,212,255,0.5)] placeholder:text-[#00d4ff]/30 backdrop-blur-md"
          />
          <button type="submit" className="bg-[#00d4ff]/20 border border-[#00d4ff] text-[#00d4ff] px-4 py-2 rounded-md font-[Orbitron] text-xs hover:bg-[#00d4ff]/40 transition-colors">
            EXEC
          </button>
        </form>
      </div>
    </div>
    </ErrorBoundary>
  );
}
