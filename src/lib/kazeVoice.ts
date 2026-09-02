import { supabase, edgeFunctionUrl } from './supabase';

const ELEVENLABS_MODEL = 'eleven_multilingual_v2';
const LOCAL_TTS_URL = 'http://127.0.0.1:3848/tts';
const KAZE_VOICE_STORAGE_KEY = 'kaze_voice_preference';
const LS_ELEVENLABS_KEY = 'zenith_elevenlabs_api_key';
const LS_ELEVENLABS_VOICE = 'zenith_elevenlabs_voice_id';

function getElevenLabsConfig() {
  const key = typeof window !== 'undefined' ? localStorage.getItem(LS_ELEVENLABS_KEY) : null;
  const voice = typeof window !== 'undefined' ? localStorage.getItem(LS_ELEVENLABS_VOICE) : null;
  const envKey = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_ELEVENLABS_API_KEY : null;
  const envVoice = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_ELEVENLABS_VOICE_ID : null;
  return {
    apiKey: key || envKey || null,
    voiceId: voice || envVoice || 'TxGEqnHWrfWFTfGW9XjX',
  };
}

export const KAZE_VOICE_OPTIONS = [
  {
    id: 'pt-BR-AntonioNeural',
    label: 'Kaze Core BR',
    subtitle: 'Antonio Neural · masculino',
    locale: 'pt-BR',
  },
  {
    id: 'pt-PT-DuarteNeural',
    label: 'Kaze Core PT',
    subtitle: 'Duarte Neural · masculino',
    locale: 'pt-PT',
  },
] as const;

const DEFAULT_VOICE = KAZE_VOICE_OPTIONS[1].id;
const MALE_VOICE_HINTS = ['antonio', 'duarte', 'male', 'masc', 'homem', 'portuguese', 'portugal'];

function resolveStoredVoicePreference(): string {
  if (typeof window === 'undefined') return DEFAULT_VOICE;
  const stored = window.localStorage.getItem(KAZE_VOICE_STORAGE_KEY);
  return KAZE_VOICE_OPTIONS.some((voice) => voice.id === stored) ? (stored ?? DEFAULT_VOICE) : DEFAULT_VOICE;
}

function normalizeVoiceText(value: string | null | undefined) {
  return String(value || '').toLowerCase().trim();
}

function scoreSystemVoice(
  voice: SpeechSynthesisVoice,
  preferredVoice: string,
  preferredLocale: string,
) {
  const name = normalizeVoiceText(voice.name);
  const uri = normalizeVoiceText(voice.voiceURI);
  const lang = normalizeVoiceText(voice.lang);
  let score = 0;

  if (name.includes(normalizeVoiceText(preferredVoice)) || uri.includes(normalizeVoiceText(preferredVoice))) {
    score += 120;
  }

  if (lang === preferredLocale.toLowerCase()) score += 60;
  else if (lang.startsWith('pt')) score += 30;

  // Boost for common Windows Portuguese voices
  if (name.includes('daniel')) score += 150;
  if (name.includes('heloisa') || name.includes('maria') || name.includes('francisca')) score += 140;

  for (const hint of MALE_VOICE_HINTS) {
    if (name.includes(hint) || uri.includes(hint)) score += 12;
  }

  if (voice.default) score += 4;
  return score;
}

function selectSystemVoice(voices: SpeechSynthesisVoice[], preferredVoice: string) {
  const preferredMeta = KAZE_VOICE_OPTIONS.find((voice) => voice.id === preferredVoice) ?? KAZE_VOICE_OPTIONS[0];
  const rankedVoices = voices
    .map((voice) => ({
      voice,
      score: scoreSystemVoice(voice, preferredMeta.id, preferredMeta.locale),
    }))
    .sort((left, right) => right.score - left.score);

  return rankedVoices[0]?.voice ?? null;
}

function isLikelyMaleSystemVoice(voice: SpeechSynthesisVoice | null) {
  if (!voice) return false;
  const haystack = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  return MALE_VOICE_HINTS.some((hint) => haystack.includes(hint));
}

function waitForSystemVoices(timeoutMs = 700): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(window.speechSynthesis.getVoices());
    };

    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

function waitForAudioEnd(audio: HTMLAudioElement, cleanup: () => void) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    // eslint-disable-next-line prefer-const
    let safetyTimeout: ReturnType<typeof setTimeout>;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimeout);
      audio.onended = null;
      audio.onerror = null;
      cleanup();
      callback();
    };

    audio.onended = () => finish(resolve);
    audio.onerror = () => finish(() => reject(new Error('Falha ao reproduzir o audio do Kaze.')));

    safetyTimeout = setTimeout(() => {
      if (!settled) {
        console.warn('[KAZE Voice] Audio timeout, forçando fim.');
        finish(resolve);
      }
    }, 15000);

    const playback = audio.play();
    if (playback?.catch) {
      playback.catch((error) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
    }
  });
}

async function speakLocalTTS(text: string, voice: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  let res;
  try {
    res = await fetch(LOCAL_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Local TTS ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await waitForAudioEnd(audio, () => URL.revokeObjectURL(url));
  return { source: 'local_python' as const };
}

async function speakElevenLabs(text: string, apiKey: string) {
  const config = getElevenLabsConfig();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}/stream`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: { stability: 0.42, similarity_boost: 0.82 },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  await waitForAudioEnd(audio, () => URL.revokeObjectURL(url));
  return { source: 'elevenlabs' as const };
}

async function getFreshAdminToken() {
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  
  try {
    const refreshed = await Promise.race([
      supabase.auth.refreshSession(),
      timeoutPromise
    ]) as any;
    if (refreshed && refreshed.data?.session?.access_token) return refreshed.data.session.access_token;
  } catch (error) {
    console.warn('[KAZE Voice] refreshSession falhou:', error);
  }

  try {
    const sessionRes = await Promise.race([
      supabase.auth.getSession(),
      timeoutPromise
    ]) as any;
    return sessionRes?.data?.session?.access_token ?? null;
  } catch (error) {
    return null;
  }
}

async function speakAdminEdgeTTS(text: string) {
  const token = await getFreshAdminToken();
  if (!token) throw new Error('Sem sessao admin para TTS online.');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(edgeFunctionUrl('admin-ai-proxy'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'tts', text }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let message = `Admin TTS ${res.status}`;
    try {
      const body = await res.json();
      message = body?.message ?? body?.error ?? message;
    } catch { /* erro ignorado */ }
    throw new Error(message);
  }

  const data = await res.json();
  if (!data?.audioContent) throw new Error('Admin TTS sem audio.');

  const audio = new Audio(`data:${data.mimeType || 'audio/mpeg'};base64,${data.audioContent}`);
  await waitForAudioEnd(audio, () => {});
  return { source: 'admin_edge_tts' as const };
}

async function speakWindowsFallback(text: string, preferredVoice = resolveStoredVoicePreference()) {
  if (!('speechSynthesis' in window)) {
    return Promise.resolve({ source: 'none' as const });
  }

  // Chrome warm-up hack
  try {
    const warmup = new SpeechSynthesisUtterance('');
    if (warmup.text.length === 0) {
      window.speechSynthesis.speak(warmup);
      window.speechSynthesis.cancel();
    }
  } catch { /* aquecimento ignorado */ }

  const utterance = new SpeechSynthesisUtterance(text);
  const voices = await waitForSystemVoices();
  const selectedVoice = selectSystemVoice(voices, preferredVoice);
  const preferredMeta = KAZE_VOICE_OPTIONS.find((voice) => voice.id === preferredVoice) ?? KAZE_VOICE_OPTIONS[0];

  console.log(`[KAZE Voice TTS] Usando voz: ${selectedVoice?.name || 'default'}, lang: ${selectedVoice?.lang || preferredMeta.locale}`);

  utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || preferredMeta.locale;
  utterance.rate = 1.0;
  utterance.pitch = 0.9;
  utterance.volume = 1.0;

  return new Promise<{ source: 'windows_sapi' | 'none' }>((resolve, reject) => {
    let settled = false;
    const finish = (result: any) => {
      if (settled) return;
      settled = true;
      if (result.error) reject(new Error(result.error));
      else resolve({ source: result.source });
    };

    utterance.onend = () => finish({ source: 'windows_sapi' });
    utterance.onerror = (event) => finish({ error: event?.error || 'Falha no Windows SAPI.' });
    
    // Safety timeout for SpeechSynthesis (known to hang on some browsers)
    const timeoutDuration = Math.max(10000, text.length * 150); // 150ms per char, min 10s
    setTimeout(() => {
      if (!settled) {
        console.warn('[KAZE Voice] Windows SAPI Timeout, forçando libertação.');
        window.speechSynthesis.cancel();
        finish({ source: 'windows_sapi' }); // Resolve smoothly to unblock
      }
    }, timeoutDuration);

    window.speechSynthesis.speak(utterance);
  });
}

function pcm24kToWavBlob(base64Pcm: string, sampleRate = 24000): Blob {
  const binaryString = atob(base64Pcm);
  const len = binaryString.length;
  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);

  // "RIFF"
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + len, true);
  // "WAVE"
  view.setUint32(8, 0x57415645, false);
  // "fmt "
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16-bit
  // "data"
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, len, true);

  const pcmBytes = new Uint8Array(buffer, 44);
  for (let i = 0; i < len; i++) {
    pcmBytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function speakGoogleGenAIVoice(text: string, voiceName: 'Charon' | 'Puck' | 'Fenrir' = 'Charon') {
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY não configurada.');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Google GenAI TTS HTTP ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    throw new Error('Sem áudio na resposta do Google GenAI');
  }

  const wavBlob = pcm24kToWavBlob(inlineData.data, 24000);
  const audioUrl = URL.createObjectURL(wavBlob);
  const audio = new Audio(audioUrl);

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(audioUrl);
      reject(e);
    };
    audio.play().catch(reject);
  });

  return { source: 'google_genai_voice' as const };
}

export function getKazeVoicePreference() {
  return resolveStoredVoicePreference();
}

export function setKazeVoicePreference(voiceId: string) {
  if (typeof window === 'undefined') return DEFAULT_VOICE;
  const safeVoice = KAZE_VOICE_OPTIONS.some((voice) => voice.id === voiceId) ? voiceId : DEFAULT_VOICE;
  window.localStorage.setItem(KAZE_VOICE_STORAGE_KEY, safeVoice);
  return safeVoice;
}

export async function kazeSpeak(text: string, elevenLabsApiKey: string | null = null) {
  if (!text?.trim()) return;

  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#`[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .substring(0, 500);

  // 1. Google GenAI Real-Time Neural Voice (JARVIS - Charon Voice) — PRIORIDADE #1
  try {
    return await speakGoogleGenAIVoice(clean, 'Charon');
  } catch (genaiErr: any) {
    console.warn('[KAZE Voice] Google GenAI TTS falhou:', genaiErr?.message || genaiErr);
  }

  // 2. ElevenLabs se configurado
  if (elevenLabsApiKey) {
    try {
      return await speakElevenLabs(clean, elevenLabsApiKey);
    } catch (elevenErr: any) {
      console.warn('[KAZE Voice] ElevenLabs falhou:', elevenErr?.message || elevenErr);
    }
  }

  // 3. Fallback browser SAPI se offline
  try {
    const sapiResult = await speakWindowsFallback(clean);
    if (sapiResult.source !== 'none') return sapiResult;
  } catch (sapiErr: any) {
    console.warn('[KAZE Voice] Windows SAPI falhou:', sapiErr?.message || sapiErr);
  }

  return { source: 'none' as const };
}

export async function kazeSpeakOnline(text: string, elevenLabsApiKey: string | null = null) {
  if (!text?.trim()) return;

  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#`[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .substring(0, 700);

  // 1. Google GenAI Real-Time Neural Voice (JARVIS - Charon Voice) — PRIORIDADE #1
  try {
    return await speakGoogleGenAIVoice(clean, 'Charon');
  } catch (genaiErr: any) {
    console.warn('[KAZE Voice] Google GenAI TTS falhou, tentando fallback:', genaiErr?.message || genaiErr);
  }

  // 2. ElevenLabs se chave presente
  const elevenLabsKey = elevenLabsApiKey || getElevenLabsConfig().apiKey;
  if (elevenLabsKey) {
    try {
      return await speakElevenLabs(clean, elevenLabsKey);
    } catch (elevenErr: any) {
      console.warn('[KAZE Voice] ElevenLabs falhou:', elevenErr?.message || elevenErr);
    }
  }

  // 3. Local TTS
  try {
    return await speakLocalTTS(clean, resolveStoredVoicePreference());
  } catch (localErr: any) {
    // Silencioso
  }

  // 4. Fallback browser SAPI se offline
  try {
    const sapiResult = await speakWindowsFallback(clean);
    if (sapiResult.source !== 'none') return sapiResult;
  } catch (sapiErr: any) {
    console.warn('[KAZE Voice] Windows SAPI falhou:', sapiErr?.message || sapiErr);
  }

  return { source: 'none' as const };
}
