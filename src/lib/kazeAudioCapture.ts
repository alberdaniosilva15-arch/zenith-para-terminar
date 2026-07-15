import { LOCAL_KAZE_URL, getAiModelSettings } from './aiModelSettings';

type CaptureOptions = {
  maxMs?: number;
  silenceMs?: number;
};

function getAudioContextCtor() {
  return window.AudioContext || (window as any).webkitAudioContext;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function audioBufferToWav(buffer: AudioBuffer) {
  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const wav = new ArrayBuffer(44 + length * 2);
  const view = new DataView(wav);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * 2, true);

  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    let sample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      sample += channels[channel]?.[i] || 0;
    }
    sample = Math.max(-1, Math.min(1, sample / Math.max(1, channelCount)));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([wav], { type: 'audio/wav' });
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

async function blobToTranscriptionPayload(blob: Blob) {
  const AudioContextCtor = getAudioContextCtor();
  if (AudioContextCtor) {
    const context = new AudioContextCtor();
    try {
      const sourceBuffer = await blob.arrayBuffer();
      const decoded = await context.decodeAudioData(sourceBuffer.slice(0));
      const wav = audioBufferToWav(decoded);
      return {
        mimeType: 'audio/wav',
        audioBase64: arrayBufferToBase64(await wav.arrayBuffer()),
      };
    } catch (error) {
      console.warn('[KAZE Audio] Conversao WAV falhou, usando audio original:', error);
    } finally {
      await context.close?.();
    }
  }

  return {
    mimeType: blob.type?.split(';')[0] || 'audio/webm',
    audioBase64: arrayBufferToBase64(await blob.arrayBuffer()),
  };
}

async function transcribeAudioBlob(blob: Blob) {
  const payload = await blobToTranscriptionPayload(blob);
  const aiSettings = getAiModelSettings();
  const transcriptionPayload = {
    ...payload,
    apiKey: aiSettings.provider === 'google' && aiSettings.apiKey ? aiSettings.apiKey : undefined,
    model: aiSettings.provider === 'google' && aiSettings.model ? aiSettings.model : undefined,
  };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);

  let res: Response;
  try {
    res = await fetch(`${LOCAL_KAZE_URL}/transcribe-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transcriptionPayload),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.text) {
    const errorMsg = data?.error || '';
    if (errorMsg.includes('Maximo 20 pedidos')) {
      throw new Error('Estás a enviar comandos muito rápido. Aguarda 1 minuto para o sistema respirar.');
    }
    if (errorMsg.includes('quota') || res.status === 429) {
      throw new Error('A quota gratuita do Gemini esgotou. Adiciona uma API Key paga ou aguarda.');
    }
    throw new Error(errorMsg || `Transcrição local falhou (${res.status})`);
  }

  return String(data.text).trim();
}

function webSpeechTranscribe(timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      reject(new Error('Web Speech API nao disponivel neste browser.'));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-PT';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const timer = window.setTimeout(() => {
      recognition.stop();
      reject(new Error('Tempo de escuta expirou.'));
    }, timeoutMs);

    recognition.onresult = (event: any) => {
      window.clearTimeout(timer);
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      resolve(transcript.trim());
    };
    recognition.onerror = (event: any) => {
      window.clearTimeout(timer);
      reject(new Error(`Web Speech erro: ${event.error}`));
    };
    recognition.onend = () => {
      window.clearTimeout(timer);
    };
    recognition.start();
  });
}

function describeError(error: unknown) {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isBrowserPermissionError(error: unknown) {
  const message = describeError(error).toLowerCase();
  return message.includes('notallowederror')
    || message.includes('permission denied')
    || message.includes('permiss')
    || message.includes('denied')
    || message.includes('not allowed');
}

async function listenWithWindowsFallback(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), Math.max(5000, timeoutMs + 4000));

  let res: Response;
  try {
    res = await fetch(`${LOCAL_KAZE_URL}/listen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeoutMs }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.text) {
    throw new Error(data?.error || `Escuta local falhou (${res.status})`);
  }

  return String(data.text).trim();
}

function chooseRecorderMimeType() {
  const preferred = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
  ];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

async function recordBrowserAudio({ maxMs = 9000, silenceMs = 1300 }: CaptureOptions) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder indisponivel neste browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioContextCtor = getAudioContextCtor();
  const audioContext = AudioContextCtor ? new AudioContextCtor() : null;
  const analyser = audioContext?.createAnalyser();
  const source = audioContext && analyser ? audioContext.createMediaStreamSource(stream) : null;
  if (analyser && source) {
    analyser.fftSize = 1024;
    source.connect(analyser);
  }

  const recorder = new MediaRecorder(stream, chooseRecorderMimeType() ? { mimeType: chooseRecorderMimeType() } : undefined);
  const chunks: BlobPart[] = [];
  const levels = analyser ? new Uint8Array(analyser.fftSize) : null;
  let hardStop: ReturnType<typeof setTimeout> | null = null;
  let levelTimer: ReturnType<typeof setInterval> | null = null;
  let soundSeen = false;
  let lastSoundAt = Date.now();
  const startedAt = Date.now();

  return new Promise<Blob>((resolve, reject) => {
    const cleanup = async () => {
      (window as any).__kazeStopAudio = null;
      if (hardStop) clearTimeout(hardStop);
      if (levelTimer) clearInterval(levelTimer);
      stream.getTracks().forEach((track) => track.stop());
      try { await audioContext?.close?.(); } catch { /* ignorado */ }
    };

    const stop = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    (window as any).__kazeStopAudio = stop;

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = (event: any) => {
      void cleanup();
      reject(new Error(event?.error?.message || 'Falha ao gravar microfone.'));
    };
    recorder.onstop = () => {
      void cleanup();
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1200) {
        reject(new Error('Sem audio suficiente do microfone.'));
        return;
      }
      resolve(blob);
    };

    recorder.start(250);
    hardStop = setTimeout(stop, maxMs);

    if (analyser && levels) {
      levelTimer = setInterval(() => {
        analyser.getByteTimeDomainData(levels);
        let sum = 0;
        for (const value of levels) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / levels.length);
        const now = Date.now();
        if (rms > 0.035) {
          soundSeen = true;
          lastSoundAt = now;
        }
        if (soundSeen && now - lastSoundAt > silenceMs && now - startedAt > 1400) {
          stop();
        }
      }, 120);
    }
  });
}

export async function captureKazeSpeech(options: CaptureOptions = {}) {
  try {
    const blob = await recordBrowserAudio(options);
    const text = await transcribeAudioBlob(blob);
    if (text) return text;
    throw new Error('Transcricao vazia — fala mais alto ou mais perto do microfone.');
  } catch (browserError) {
    if (isBrowserPermissionError(browserError)) {
      throw new Error(
        'Microfone bloqueado pelo browser. Clica no ícone do cadeado na barra de endereço e permite o microfone.'
      );
    }
    
    // Se o erro já foi uma excepção limpa da nossa parte (ex: Quota)
    if (browserError instanceof Error && browserError.message.includes('quota')) {
      throw browserError;
    }

    // Dar mensagem clara
    console.warn('[KAZE Audio] Captura falhou:', describeError(browserError));
    throw new Error(
      `Não consegui ouvir: ${describeError(browserError)}. Verifica se o microfone está ligado e permitido.`
    );
  }
}
