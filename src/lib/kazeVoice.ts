// ──────────────────────────────────────────────────────────────────────────────
// NativeTTSService — Voz do Kaze via SpeechSynthesis nativo do telemóvel
// ──────────────────────────────────────────────────────────────────────────────
// Utiliza APENAS a síntese de voz nativa do dispositivo (iOS AVSpeech /
// Android TTS / Windows SAPI). Sem APIs externas, sem modelos pesados, sem
// servidores. A voz é selecionada automaticamente e memorizada em cache
// (localStorage) para sempre.
// ──────────────────────────────────────────────────────────────────────────────

const VOICE_CACHE_KEY = 'kaze_native_voice_uri';
const VOICE_READY_KEY = 'kaze_voice_ready';
const KAZE_VOICE_PREF_KEY = 'kaze_voice_preference';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface NativeTTSSpeakResult {
  source: 'native_tts' | 'none';
}

// ─── Singleton State ─────────────────────────────────────────────────────────

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;
const activeUtterances = new Set<SpeechSynthesisUtterance>();
let audioUnlocked = false;

// ─── Voice Options (mantém compatibilidade com importações existentes) ───────

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

// ─── Utilitários de Storage ──────────────────────────────────────────────────

function ls(key: string): string | null {
  try { return typeof window !== 'undefined' ? localStorage.getItem(key) : null; }
  catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { if (typeof window !== 'undefined') localStorage.setItem(key, value); }
  catch { /* quota / modo anónimo */ }
}

// ─── Desbloqueio de Áudio em Dispositivos Móveis ─────────────────────────────

/**
 * Desbloqueia a síntese de voz no primeiro gesto do utilizador (toque/clique).
 * Essencial para iOS Safari e Android Chrome onde o autoplay de áudio é bloqueado.
 */
export function unlockNativeTTS(): void {
  if (audioUnlocked || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    const dummy = new SpeechSynthesisUtterance(' ');
    dummy.volume = 0.01;
    dummy.rate = 10;
    window.speechSynthesis.speak(dummy);
    audioUnlocked = true;
    lsSet(VOICE_READY_KEY, '1');
  } catch {
    // Ignorar se o browser recusar
  }
}

// Auto-desbloqueio no primeiro clique/toque em qualquer ponto da janela
if (typeof window !== 'undefined') {
  const onFirstInteraction = () => {
    unlockNativeTTS();
    window.removeEventListener('click', onFirstInteraction, true);
    window.removeEventListener('touchstart', onFirstInteraction, true);
    window.removeEventListener('keydown', onFirstInteraction, true);
  };
  window.addEventListener('click', onFirstInteraction, { capture: true, once: true });
  window.addEventListener('touchstart', onFirstInteraction, { capture: true, once: true });
  window.addEventListener('keydown', onFirstInteraction, { capture: true, once: true });
}

// ─── Carregamento de Vozes ───────────────────────────────────────────────────

/**
 * Aguarda que o browser carregue a lista de vozes do sistema.
 * Chrome/Android disparam 'voiceschanged' de forma assíncrona.
 */
function waitForVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([]);
  }

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { window.speechSynthesis.removeEventListener('voiceschanged', finish); } catch {}
      resolve(window.speechSynthesis.getVoices());
    };

    try {
      window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    } catch {
      // Fallback para browsers antigos
    }
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Pontuação para selecção da melhor voz disponível.
 * Prioridade: pt-AO > pt-PT > pt-BR > qualquer pt > vozes do sistema.
 */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  const lang = (voice.lang || '').toLowerCase().replace('_', '-');
  const name = (voice.name || '').toLowerCase();
  let score = 0;

  // Idioma
  if (lang === 'pt-ao' || lang.startsWith('pt-ao') || name.includes('angola')) score += 400;
  else if (lang === 'pt-pt' || lang.startsWith('pt-pt') || name.includes('portugal')) score += 300;
  else if (lang === 'pt-br' || lang.startsWith('pt-br') || name.includes('brazil') || name.includes('brasil')) score += 200;
  else if (lang.startsWith('pt') || name.includes('portuguese') || name.includes('português')) score += 150;
  else score += 10; // Outras línguas (fallback se o telefone não tiver português instalado)

  // Qualidade / Tipo
  if (name.includes('enhanced') || name.includes('premium') || name.includes('natural') || name.includes('neural')) score += 50;
  if (voice.localService) score += 30; // vozes locais têm menor latência
  if (voice.default) score += 20;

  // Preferência masculina (Kaze)
  const maleHints = ['daniel', 'duarte', 'antonio', 'antónio', 'rafael', 'tiago', 'male', 'masc', 'homem'];
  for (const hint of maleHints) {
    if (name.includes(hint)) { score += 25; break; }
  }

  return score;
}

/**
 * Selecciona a melhor voz para o Kaze.
 * Se houver uma voz gravada em cache, utiliza-a.
 * Caso contrário, escolhe a melhor voz portuguesa (ou a default do sistema se nenhuma pt existir).
 */
async function resolveBestVoice(): Promise<SpeechSynthesisVoice | null> {
  if (cachedVoice && voicesLoaded) return cachedVoice;

  const voices = await waitForVoices();
  if (voices.length > 0) {
    voicesLoaded = true;
  }

  if (voices.length === 0) return null;

  // 1) Verificar voz guardada no localStorage
  const savedUri = ls(VOICE_CACHE_KEY);
  if (savedUri) {
    const match = voices.find((v) => v.voiceURI === savedUri);
    if (match) {
      cachedVoice = match;
      return match;
    }
  }

  // 2) Procurar a melhor voz por pontuação
  const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));

  // Priorizar qualquer voz que tenha idioma ou nome português
  const ptVoice = ranked.find((v) => {
    const l = (v.lang || '').toLowerCase();
    const n = (v.name || '').toLowerCase();
    return l.startsWith('pt') || n.includes('portuguese') || n.includes('português');
  });

  const best = ptVoice || ranked.find((v) => v.default) || ranked[0] || null;

  if (best) {
    cachedVoice = best;
    lsSet(VOICE_CACHE_KEY, best.voiceURI);
    lsSet(VOICE_READY_KEY, '1');
    console.log(`[KAZE NativeTTS] Voz selecionada: "${best.name}" (${best.lang})`);
  }

  return best;
}

// ─── Limpeza de Texto para Fala ──────────────────────────────────────────────

function cleanTextForSpeech(raw: string, maxLen = 600): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')         // blocos de código
    .replace(/[*_#`[\]()~]/g, '')           // markdown
    .replace(/https?:\/\/\S+/g, '')         // links
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '') // emojis
    .replace(/\s+/g, ' ')                   // espaços múltiplos
    .trim()
    .substring(0, maxLen);
}

// ─── API Pública de Fala ─────────────────────────────────────────────────────

/**
 * Pára a fala actual imediatamente e limpa a fila.
 */
export function kazeStop(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  currentUtterance = null;
  activeUtterances.clear();
}

/**
 * Verifica se o Kaze está a falar neste momento.
 */
export function kazeIsSpeaking(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  return window.speechSynthesis.speaking;
}

/**
 * Fala o texto usando a voz nativa do dispositivo.
 * - Desbloqueia automaticamente o áudio se necessário.
 * - Prioriza vozes portuguesas (pt-AO > pt-PT > pt-BR).
 * - Tem fallback seguro para o sintetizador padrão se não houver voz pt no telemóvel.
 * - Protege contra o bug de pausa dos 14 segundos do Chromium.
 */
export async function kazeSpeak(
  text: string,
  _elevenLabsApiKey: string | null = null,
): Promise<NativeTTSSpeakResult | undefined> {
  if (!text?.trim()) return;

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('[KAZE NativeTTS] speechSynthesis não suportado neste browser.');
    return { source: 'none' };
  }

  const clean = cleanTextForSpeech(text, 600);
  if (!clean) return;

  // Cancelar fala anterior se estiver a falar e dar uma pequena pausa para o browser processar
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
    await new Promise((r) => setTimeout(r, 60));
  }

  // Garantir que não está pausado
  if (window.speechSynthesis.paused) {
    try { window.speechSynthesis.resume(); } catch {}
  }

  const voice = await resolveBestVoice();
  const utterance = new SpeechSynthesisUtterance(clean);
  currentUtterance = utterance;
  activeUtterances.add(utterance);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || 'pt-PT';
  } else {
    utterance.lang = 'pt-PT';
  }

  utterance.rate = 1.0;
  utterance.pitch = 0.95;
  utterance.volume = 1.0;

  return new Promise<NativeTTSSpeakResult>((resolve) => {
    let settled = false;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (safetyTimer) clearTimeout(safetyTimer);
      activeUtterances.delete(utterance);
      if (currentUtterance === utterance) currentUtterance = null;
      resolve({ source: 'native_tts' });
    };

    utterance.onend = cleanup;
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        console.warn('[KAZE NativeTTS] Erro de síntese:', event.error);
      }
      cleanup();
    };

    // Bugfix do Chrome: sínteses longas pausam aos 14 segundos se não forem reanimadas
    keepAliveTimer = setInterval(() => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        } else {
          cleanup();
        }
      }
    }, 4500);

    // Timeout de segurança absoluto
    const maxDurationMs = Math.max(15000, clean.length * 150);
    safetyTimer = setTimeout(() => {
      if (!settled) {
        kazeStop();
        cleanup();
      }
    }, maxDurationMs);

    try {
      window.speechSynthesis.speak(utterance);
      // Forçar retoma imediata caso o browser tenha colocado em pausa
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (speakErr) {
      console.warn('[KAZE NativeTTS] Falha ao invocar speak():', speakErr);
      cleanup();
    }
  });
}

/**
 * Alias de compatibilidade com kazeSpeakOnline.
 */
export async function kazeSpeakOnline(
  text: string,
  _elevenLabsApiKey: string | null = null,
): Promise<NativeTTSSpeakResult | undefined> {
  return kazeSpeak(text);
}

// ─── Preferências e Vozes do Dispositivo ─────────────────────────────────────

export function getKazeVoicePreference(): string {
  return ls(KAZE_VOICE_PREF_KEY) ?? KAZE_VOICE_OPTIONS[1].id;
}

export function setKazeVoicePreference(voiceId: string): string {
  const safe = KAZE_VOICE_OPTIONS.some((v) => v.id === voiceId)
    ? voiceId
    : KAZE_VOICE_OPTIONS[1].id;
  lsSet(KAZE_VOICE_PREF_KEY, safe);
  return safe;
}

/**
 * Retorna as vozes portuguesas disponíveis no dispositivo (ou todas as vozes caso não haja pt).
 */
export async function getAvailablePortugueseVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = await waitForVoices();
  const ptVoices = voices
    .filter((v) => {
      const l = (v.lang || '').toLowerCase();
      const n = (v.name || '').toLowerCase();
      return l.startsWith('pt') || n.includes('portuguese') || n.includes('português');
    })
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));

  if (ptVoices.length > 0) return ptVoices;

  // Se o dispositivo não tem vozes portuguesas, devolver as vozes do sistema para permitir teste
  return voices;
}

/**
 * Define manualmente uma voz por voiceURI e guarda em cache permanente.
 */
export function setNativeVoice(voiceURI: string): void {
  lsSet(VOICE_CACHE_KEY, voiceURI);
  lsSet(VOICE_READY_KEY, '1');
  cachedVoice = null;
  voicesLoaded = false;
}

/**
 * Verifica se a autorização de voz já foi registada.
 */
export function isVoiceReady(): boolean {
  return ls(VOICE_READY_KEY) === '1';
}
