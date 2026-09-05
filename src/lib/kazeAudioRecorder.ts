// =============================================================================
// ZENITH RIDE — kazeAudioRecorder.ts
// Gravador de áudio em tempo real com captura PCM, medidor de volume e exportação WAV
// =============================================================================

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface AudioRecordingResult {
  wavBlob: Blob;
  durationMs: number;
  peakVolume: number;    // 0.0 a 1.0
  avgVolume: number;     // 0.0 a 1.0
  deviceLabel: string;
  isTrackMuted: boolean;
  sampleRate: number;
  totalSamples: number;
}

/**
 * Lista todos os microfones disponíveis no sistema
 */
export async function getAvailableMicrophones(): Promise<AudioInputDevice[]> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microfone ${index + 1}`,
      }));
    return mics;
  } catch (err) {
    console.warn('[kazeAudioRecorder] Erro ao listar microfones:', err);
    return [];
  }
}

/**
 * Codifica amostras de áudio PCM Float32Array num ficheiro WAV standard de 16-bit
 */
export function encodeWAV(samples: Float32Array, sampleRate: number = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // RIFF chunk length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 = PCM)
  view.setUint16(20, 1, true);
  // channel count (1 = mono)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length * 2, true);

  // Escrever as amostras PCM 16-bit
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const rawVal = samples[i] ?? 0;
    const s = Math.max(-1, Math.min(1, rawVal));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Gestor de captura de microfone com MediaRecorder nativo e monitorização por AnalyserNode
 */
export class KazeAudioCapture {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeTimer: number | null = null;
  private startTime: number = 0;
  private peakVolume: number = 0;
  private sumVolume: number = 0;
  private volumeReadingsCount: number = 0;
  private onVolumeChange?: (vol: number) => void;
  private activeDeviceLabel: string = 'Microfone';

  public isRecording: boolean = false;

  async start(
    deviceId?: string,
    onVolumeChange?: (vol: number) => void
  ): Promise<{ deviceLabel: string }> {
    if (this.isRecording) {
      await this.cancel();
    }

    this.onVolumeChange = onVolumeChange;
    this.recordedChunks = [];
    this.peakVolume = 0;
    this.sumVolume = 0;
    this.volumeReadingsCount = 0;

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
    } catch (firstErr) {
      if (deviceId) {
        console.warn('[kazeAudioRecorder] Microfone específico falhou, a usar padrão:', firstErr);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
          video: false,
        });
      } else {
        throw firstErr;
      }
    }

    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    this.activeDeviceLabel = track?.label || 'Microfone do Sistema';

    // 1. Iniciar MediaRecorder nativo diretamente no stream do hardware
    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined') {
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
      ];
      for (const cand of candidates) {
        if (MediaRecorder.isTypeSupported(cand)) {
          mimeType = cand;
          break;
        }
      }
      this.mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      this.recordedChunks = [];
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      this.mediaRecorder.start(100);
    }

    // 2. Medir volume em tempo real via AnalyserNode (sem ligar à destination para não mutar)
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const audioCtx = new AudioContextClass();
        this.audioCtx = audioCtx;
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        this.analyser = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        this.volumeTimer = window.setInterval(() => {
          if (!this.isRecording) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] ?? 0;
          }
          const avg = sum / dataArray.length;
          const normalizedVol = Math.min(1, (avg / 128) * 3);

          if (normalizedVol > this.peakVolume) {
            this.peakVolume = normalizedVol;
          }
          this.sumVolume += normalizedVol;
          this.volumeReadingsCount++;

          if (this.onVolumeChange) {
            this.onVolumeChange(normalizedVol);
          }
        }, 50);
      }
    } catch (analyserErr) {
      console.warn('[kazeAudioRecorder] AnalyserNode falhou, a continuar apenas com gravação:', analyserErr);
    }

    this.isRecording = true;
    this.startTime = Date.now();

    return { deviceLabel: this.activeDeviceLabel };
  }

  async stop(): Promise<AudioRecordingResult> {
    this.isRecording = false;
    const durationMs = Date.now() - this.startTime;

    if (this.volumeTimer) {
      clearInterval(this.volumeTimer);
      this.volumeTimer = null;
    }

    // 1. Parar MediaRecorder e obter o Blob completo com os dados gravados
    let audioBlob: Blob;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        if (!this.mediaRecorder) return resolve();
        this.mediaRecorder.onstop = () => resolve();
        this.mediaRecorder.stop();
      });
      const mime = this.recordedChunks[0]?.type || this.mediaRecorder.mimeType || 'audio/webm';
      audioBlob = new Blob(this.recordedChunks, { type: mime });
    } else {
      audioBlob = new Blob([], { type: 'audio/webm' });
    }

    // 2. Encerrar o AudioContext
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }

    // 3. Parar tracks do stream de hardware
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    const avgVolume =
      this.volumeReadingsCount > 0 ? this.sumVolume / this.volumeReadingsCount : 0;

    return {
      wavBlob: audioBlob,
      durationMs,
      peakVolume: this.peakVolume,
      avgVolume,
      deviceLabel: this.activeDeviceLabel,
      isTrackMuted: false,
      sampleRate: 16000,
      totalSamples: audioBlob.size,
    };
  }

  async cancel(): Promise<void> {
    this.isRecording = false;
    if (this.volumeTimer) {
      clearInterval(this.volumeTimer);
      this.volumeTimer = null;
    }
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.recordedChunks = [];
  }
}

/**
 * Downsampler linear de áudio
 */
function downsampleBuffer(
  buffer: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (targetRate >= sourceRate) return buffer;
  const ratio = sourceRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const resultBuffer = new ArrayBuffer(newLength * 4);
  const result = new Float32Array(resultBuffer);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i] ?? 0;
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}
