// ──────────────────────────────────────────────────────────────────────────────
// NativeTTSService — Voz do Kaze via SpeechSynthesis nativo do telemóvel
// ──────────────────────────────────────────────────────────────────────────────
// Utiliza APENAS a voz instalada no dispositivo do utilizador (iOS AVSpeech /
// Android TTS / Windows SAPI). Sem APIs externas, sem modelos pesados, sem
// servidores. A voz é selecionada automaticamente 1× e guardada em cache
// (localStorage) para sempre — nunca mais volta a pedir.
// ──────────────────────────────────────────────────────────────────────────────

const VOICE_CACHE_KEY = 'kaze_native_voice_uri';
const VOICE_READY_KEY = 'kaze_voice_ready';        // flag: autorização já concedida
const KAZE_VOICE_PREF_KEY = 'kaze_voice_preference';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface NativeTTSSpeakResult {
  source: 'native_tts' | 'none';
}

// ─── Singleton State ─────────────────────────────────────────────────────────

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;

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

// ─── Utilitários internos ────────────────────────────────────────────────────

function ls(key: string): string | null {
  try { return typeof window !== 'undefined' ? localStorage.getItem(key) : null; }
  catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { if (typeof window !== 'undefined') localStorage.setItem(key, value); }
  catch { /* quota / private mode – ignorar */ }
}

/**
 * Aguarda que o browser carregue a lista de vozes do sistema.
 * Em Chrome/Android, as vozes são carregadas async via evento `voiceschanged`.
 * Em Safari/iOS, já vêm preenchidas na 1ª chamada.
 */
function waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([]);
  }

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
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Pontuação para selecção automática de voz portuguesa.
 * Prioridade: pt-AO > pt-PT > pt-BR > qualquer pt > outras línguas.
 */
function scoreVoice(voice: SpeechSynthesisVoice): number {
  const lang = (voice.lang || '').toLowerCase();
  const name = (voice.name || '').toLowerCase();
  let score = 0;

  // ── Idioma ──
  if (lang === 'pt-ao')      score += 300;   // Angola — máximo
  else if (lang === 'pt-pt') score += 250;
  else if (lang === 'pt-br') score += 200;
  else if (lang.startsWith('pt')) score += 150;
  else return -1000;                          // não-português — excluir

  // ── Qualidade ──
  if (name.includes('enhanced') || name.includes('premium') || name.includes('neural')) score += 50;
  if (voice.localService) score += 20;   // vozes locais = menos latência
  if (voice.default) score += 5;

  // ── Preferência masculina (Kaze é masculino) ──
  const maleHints = ['daniel', 'duarte', 'antonio', 'rafael', 'tiago', 'male', 'masc'];
  for (const hint of maleHints) {
    if (name.includes(hint)) { score += 30; break; }
  }

  return score;
}

/**
 * Selecciona a melhor voz portuguesa do dispositivo.
 * Se já existe uma voz em cache (localStorage), devolve essa imediatamente.
 */
async function resolveBestVoice(): Promise<SpeechSynthesisVoice | null> {
  // 1) Cache em memória
  if (cachedVoice && voicesLoaded) return cachedVoice;

  const voices = await waitForVoices();
  voicesLoaded = true;

  if (voices.length === 0) return null;

  // 2) Tentar restaurar do localStorage (cache persistente)
  const savedUri = ls(VOICE_CACHE_KEY);
  if (savedUri) {
    const match = voices.find((v) => v.voiceURI === savedUri);
    if (match) {
      cachedVoice = match;
      return match;
    }
    // Voz removida do sistema — escolher outra
  }

  // 3) Seleccionar automaticamente a melhor voz portuguesa
  const ranked = voices
    .map((v) => ({ voice: v, score: scoreVoice(v) }))
    .filter((v) => v.score > -500)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.voice ?? null;

  if (best) {
    cachedVoice = best;
    lsSet(VOICE_CACHE_KEY, best.voiceURI);
    lsSet(VOICE_READY_KEY, '1');
    console.log(`[KAZE NativeTTS] Voz selecionada: "${best.name}" (${best.lang})`);
  }

  return best;
}

// ─── Limpar texto para fala ──────────────────────────────────────────────────

function cleanTextForSpeech(raw: string, maxLen = 500): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')         // blocos de código
    .replace(/[*_#`[\]()]/g, '')            // markdown
    .replace(/https?:\/\/\S+/g, '')         // URLs
    .replace(/\s+/g, ' ')                   // espaços múltiplos
    .trim()
    .substring(0, maxLen);
}

// ─── API Pública ─────────────────────────────────────────────────────────────

/**
 * Para a fala actual imediatamente.
 */
export function kazeStop(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  currentUtterance = null;
}

/**
 * Verifica se o Kaze está a falar neste momento.
 */
export function kazeIsSpeaking(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  return window.speechSynthesis.speaking;
}

/**
 * Fala o texto usando a voz nativa do telemóvel.
 * - Selecciona a melhor voz portuguesa automaticamente (1ª vez).
 * - Guarda em cache para sempre (localStorage).
 * - Cancela qualquer fala anterior antes de iniciar nova.
 */
export async function kazeSpeak(
  text: string,
  _elevenLabsApiKey: string | null = null,   // ignorado — mantém assinatura para compatibilidade
): Promise<NativeTTSSpeakResult | undefined> {
  if (!text?.trim()) return;

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    console.warn('[KAZE NativeTTS] speechSynthesis não disponível neste browser.');
    return { source: 'none' };
  }

  const clean = cleanTextForSpeech(text, 500);
  if (!clean) return;

  // Cancelar fala anterior
  kazeStop();

  const voice = await resolveBestVoice();

  // Chrome warm-up hack (previne 1ª fala silenciosa)
  try {
    const warmup = new SpeechSynthesisUtterance('');
    window.speechSynthesis.speak(warmup);
    window.speechSynthesis.cancel();
  } catch { /* ignorar */ }

  const utterance = new SpeechSynthesisUtterance(clean);
  currentUtterance = utterance;

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = 'pt-PT';   // fallback se não encontrou voz portuguesa
  }

  utterance.rate = 1.0;
  utterance.pitch = 0.95;
  utterance.volume = 1.0;

  return new Promise<NativeTTSSpeakResult>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      currentUtterance = null;
      resolve({ source: 'native_tts' });
    };

    utterance.onend = finish;
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') {
        // Cancelamento deliberado (kazeStop) — não é erro
        finish();
        return;
      }
      console.warn('[KAZE NativeTTS] Erro:', event.error);
      finish();
    };

    // Safety timeout — alguns browsers bloqueiam em textos longos
    const timeout = Math.max(12000, clean.length * 120);
    setTimeout(() => {
      if (!settled) {
        console.warn('[KAZE NativeTTS] Timeout — a forçar fim.');
        window.speechSynthesis.cancel();
        finish();
      }
    }, timeout);

    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Alias de kazeSpeak — mantém compatibilidade com importações existentes.
 * Antes, kazeSpeakOnline usava APIs externas. Agora usa a mesma voz nativa.
 */
export async function kazeSpeakOnline(
  text: string,
  _elevenLabsApiKey: string | null = null,
): Promise<NativeTTSSpeakResult | undefined> {
  return kazeSpeak(text);
}

// ─── Preferências (compatibilidade) ─────────────────────────────────────────

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
 * Devolve a lista de vozes portuguesas disponíveis no dispositivo.
 * Útil para permitir ao utilizador escolher manualmente.
 */
export async function getAvailablePortugueseVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = await waitForVoices();
  return voices
    .filter((v) => (v.lang || '').toLowerCase().startsWith('pt'))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

/**
 * Define manualmente uma voz por voiceURI. Guarda em cache permanente.
 */
export function setNativeVoice(voiceURI: string): void {
  lsSet(VOICE_CACHE_KEY, voiceURI);
  lsSet(VOICE_READY_KEY, '1');
  cachedVoice = null;        // forçar re-resolução na próxima fala
  voicesLoaded = false;
}

/**
 * Verifica se a voz já foi configurada (autorização concedida).
 */
export function isVoiceReady(): boolean {
  return ls(VOICE_READY_KEY) === '1';
}
