// =============================================================================
// screamDetector.ts — Detecta gritos (Web Audio API) e Wake-Word "Socorro" (SpeechRecognition)
// =============================================================================

const SCREAM_THRESHOLD = 0.85;    // 0-1 normalizado, 0.85 = muito alto
const SCREAM_DURATION_MS = 800;   // Deve manter-se alto por 800ms para confirmar
const COOLDOWN_MS = 30_000;       // Após detectar, espera 30s antes de detectar novamente

type ScreamCallback = () => void;

interface ScreamDetectorHandle {
  stop: () => void;
}

export function startScreamDetection(onScream: ScreamCallback): ScreamDetectorHandle | null {
  let active = true;
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let animFrameId: number | null = null;
  let screamStartTime: number | null = null;
  let lastTriggerTime = 0;
  let recognition: any = null;

  const trigger = (reason: string) => {
    const now = Date.now();
    if (now - lastTriggerTime >= COOLDOWN_MS) {
      lastTriggerTime = now;
      console.warn(`[ScreamDetector] 🆘 ${reason} DETECTADO`);
      onScream();
    }
  };

  const initAudio = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }

      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const detect = () => {
        if (!active) return;
        analyser.getByteTimeDomainData(dataArray);

        let maxAmplitude = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const sample = dataArray[i];
          if (sample === undefined) continue;
          const amplitude = Math.abs(sample - 128) / 128;
          if (amplitude > maxAmplitude) maxAmplitude = amplitude;
        }

        const now = Date.now();
        if (maxAmplitude >= SCREAM_THRESHOLD) {
          if (screamStartTime === null) {
            screamStartTime = now;
          } else if (now - screamStartTime >= SCREAM_DURATION_MS) {
            trigger(`GRITO (Amplitude: ${maxAmplitude.toFixed(2)})`);
            screamStartTime = null;
          }
        } else {
          screamStartTime = null;
        }

        animFrameId = requestAnimationFrame(detect);
      };

      detect();
    } catch (err) {
      console.warn('[ScreamDetector] Sem acesso ao microfone (Web Audio):', err);
    }
  };

  const initSpeech = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-PT';

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript.trim().toLowerCase();
        if (transcript.includes('socorro') || transcript.includes('ajuda') || transcript.includes('emergência') || transcript.includes('polícia') || transcript.includes('help')) {
          trigger(`WAKE-WORD "${transcript}"`);
        }
      }
    };

    recognition.onend = () => {
      if (active) {
        setTimeout(() => {
          try { recognition.start(); } catch (e) {}
        }, 1000);
      }
    };

    try { recognition.start(); } catch (e) {}
  };

  initAudio();
  initSpeech();

  return {
    stop: () => {
      active = false;
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
      if (recognition) {
        recognition.onend = null;
        recognition.stop();
      }
    },
  };
}
