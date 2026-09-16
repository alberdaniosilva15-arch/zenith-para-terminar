// ──────────────────────────────────────────────────────────────────────────────
// Voz do Kaze — motor de fala
// ──────────────────────────────────────────────────────────────────────────────
// A voz do Kaze vem do Gemini (voz "Aoede", a MESMA da sessão Live), pedida ao
// gemini-proxy pela acção `kaze_tts` e reproduzida com a Web Audio API.
//
// Antes isto usava a `speechSynthesis` do browser — ou seja, o sintetizador do
// SISTEMA (SAPI no Windows, TTS do Android, AVSpeech no iOS). Essa voz não é a
// do Kaze: é a do aparelho, soa a robot e muda de telemóvel para telemóvel. Foi
// substituída por completo, e não há fallback para ela — sem voz do Gemini o
// Kaze fica calado, que é preferível a falar com a voz errada.
//
// Este módulo continua a expor os utilitários de vozes do sistema
// (getAvailablePortugueseVoices, setNativeVoice, …) porque a página de
// definições do admin ainda os usa para listar o que existe no aparelho. Nada
// nesta fala depende deles.
// ──────────────────────────────────────────────────────────────────────────────

import { kazeTts, type KazeTtsResposta } from './kazeGeminiTts';

const VOICE_CACHE_KEY = 'kaze_native_voice_uri';
const VOICE_READY_KEY = 'kaze_voice_ready';
const KAZE_VOICE_PREF_KEY = 'kaze_voice_preference';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface NativeTTSSpeakResult {
  /** `gemini_tts` = voz do Gemini. `none` = não se falou (falha ou Live activo).
   *  `native_tts` mantém-se no tipo por compatibilidade — já não é produzido. */
  source: 'gemini_tts' | 'native_tts' | 'none';
}

// ─── Estado do motor de fala ─────────────────────────────────────────────────

/** Taxa do PCM que o servidor devolve (16 bits, mono). */
const TTS_SAMPLE_RATE = 24000;

let audioCtx: AudioContext | null = null;
const fontesActivas = new Set<AudioBufferSourceNode>();
let aFalar = false;
/** Muda a cada pedido novo: uma síntese que chega atrasada é descartada. */
let pedidoAtual = 0;
/** Uma sessão Live já traz a voz do Kaze — falar por cima daria duas vozes. */
let liveVoiceAtivo = false;

// ─── Singleton State ─────────────────────────────────────────────────────────

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;
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

/** Devolve o AudioContext partilhado, criando-o à primeira utilização. */
function obterContexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    try { audioCtx = new Ctor({ sampleRate: TTS_SAMPLE_RATE }); }
    catch { audioCtx = null; }
  }
  return audioCtx;
}

/**
 * Desbloqueia a reprodução de áudio no primeiro gesto do utilizador
 * (toque/clique). Essencial para iOS Safari e Android Chrome, onde o autoplay
 * é bloqueado: um AudioContext criado fora de um gesto fica `suspended`.
 *
 * O nome mantém-se porque é o que o KazeMascot importa — o que faz é agora
 * desbloquear a Web Audio, não a `speechSynthesis`.
 */
export function unlockNativeTTS(): void {
  if (typeof window === 'undefined') return;

  const ctx = obterContexto();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});

    // Reproduzir um buffer de 1 amostra dentro do gesto marca o contexto como
    // autorizado. Sem isto o primeiro som real pode ser descartado pelo
    // sistema — e, em iOS, todos os seguintes também. É inaudível.
    const unlock = ctx.createBufferSource();
    unlock.buffer = ctx.createBuffer(1, 1, TTS_SAMPLE_RATE);
    unlock.connect(ctx.destination);
    unlock.start(0);

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
 * Pára a fala actual imediatamente.
 *
 * Também invalida qualquer síntese ainda em viagem (o `pedidoAtual` sobe), para
 * que uma resposta atrasada do servidor não comece a tocar depois de o
 * utilizador já ter pedido silêncio.
 *
 * Não toca na sessão Live: essa tem o seu próprio ciclo de vida.
 */
export function kazeStop(): void {
  pedidoAtual += 1;
  for (const fonte of fontesActivas) {
    try { fonte.stop(); } catch { /* já terminou */ }
  }
  fontesActivas.clear();
  aFalar = false;
}

/**
 * Verifica se o Kaze está a falar neste momento.
 */
export function kazeIsSpeaking(): boolean {
  return aFalar;
}

/**
 * Informa este módulo de que uma sessão Live está (ou deixou de estar) a correr.
 *
 * Enquanto estiver activa, `kazeSpeak` não faz nada: o Live já traz a voz do
 * Kaze, e sintetizar por cima daria duas vozes em simultâneo. A regra vive aqui,
 * num só sítio, para nenhum ponto de chamada a poder esquecer.
 */
export function setKazeLiveVoiceActive(ativo: boolean): void {
  liveVoiceAtivo = ativo;
  if (ativo) kazeStop();
}

// ─── Reprodução do PCM devolvido pelo servidor ───────────────────────────────

/**
 * Converte o áudio em base64 do servidor (PCM 16 bits little-endian, mono) numa
 * série de amostras float — que é o formato que a Web Audio API consome.
 *
 * Devolve um array vazio se a entrada estiver vazia ou malformada, para o
 * chamador poder desistir sem tratar de excepções.
 */
function pcmBase64ParaAmostras(base64: string): Float32Array {
  if (!base64) return new Float32Array(0);

  let binario: string;
  try {
    binario = atob(base64);
  } catch {
    console.warn('[KAZE TTS] Áudio em base64 inválido.');
    return new Float32Array(0);
  }

  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);

  const total = bytes.length >> 1;   // 2 bytes por amostra
  const vista = new DataView(bytes.buffer);
  const amostras = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    amostras[i] = vista.getInt16(i * 2, true) / 32768;
  }
  return amostras;
}

/**
 * Reproduz as amostras e resolve quando acabarem.
 *
 * Devolve `false` quando a reprodução foi substituída ou interrompida por
 * `kazeStop` — comparando o número do pedido, porque `stop()` dispara `onended`
 * exactamente como o fim natural, e os dois casos não podem ser confundidos.
 */
async function reproduzir(
  ctx: AudioContext,
  amostras: Float32Array,
  taxa: number,
  meuPedido: number,
): Promise<boolean> {
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => { /* segue: o start pode ainda assim funcionar */ });
  }

  const buffer = ctx.createBuffer(1, amostras.length, taxa);
  // `getChannelData().set()` em vez de `copyToChannel()`: é equivalente e evita
  // a incompatibilidade de genéricos de ArrayBuffer/SharedArrayBuffer que o
  // `copyToChannel` arrasta nas versões recentes do TypeScript.
  buffer.getChannelData(0).set(amostras);

  const fonte = ctx.createBufferSource();
  fonte.buffer = buffer;
  fonte.connect(ctx.destination);
  fontesActivas.add(fonte);
  aFalar = true;

  return new Promise<boolean>((resolve) => {
    let concluida = false;
    const terminar = (completa: boolean) => {
      if (concluida) return;
      concluida = true;
      fontesActivas.delete(fonte);
      if (fontesActivas.size === 0) aFalar = false;
      resolve(completa);
    };

    fonte.onended = () => terminar(meuPedido === pedidoAtual);

    try {
      fonte.start(0);
    } catch (err) {
      console.warn('[KAZE TTS] Falha ao iniciar a reprodução:', err);
      terminar(false);
    }
  });
}

/**
 * Fala o texto com a voz do Kaze — Gemini, voz "Aoede", a mesma da sessão Live.
 *
 * Fluxo: limpa o texto → pede o áudio ao servidor → descodifica o PCM →
 * reproduz com a Web Audio API. A chave do Gemini nunca chega ao browser.
 *
 * Devolve `{ source: 'none' }` sem falar quando o texto fica vazio depois da
 * limpeza, quando há uma sessão Live activa (que já traz voz) ou quando a
 * síntese falha. Não há recurso à `speechSynthesis` do aparelho: era
 * precisamente essa voz que se quis deixar de usar, e falar com a voz errada é
 * pior do que ficar calado.
 */
export async function kazeSpeak(
  text: string,
  _elevenLabsApiKey: string | null = null,
): Promise<NativeTTSSpeakResult | undefined> {
  const clean = cleanTextForSpeech(text, 600);
  if (!clean) return { source: 'none' };

  // Uma sessão Live já tem a voz do Kaze a correr. Falar por cima daria duas
  // vozes em simultâneo — e a do Live é a que interessa.
  if (liveVoiceAtivo) return { source: 'none' };

  kazeStop();
  const meu = ++pedidoAtual;

  const ctx = obterContexto();
  if (!ctx) {
    console.warn('[KAZE TTS] Web Audio indisponível neste browser.');
    return { source: 'none' };
  }

  let resposta: KazeTtsResposta;
  try {
    resposta = await kazeTts(clean);
  } catch (err) {
    console.warn('[KAZE TTS] Voz do Gemini indisponível:', err);
    return { source: 'none' };
  }

  // Entretanto o utilizador pediu silêncio, ou começou outra fala. Sintetizar
  // não se desperdiça (o custo já foi pago), mas tocar sim: seria ouvir uma
  // resposta a uma pergunta que já passou.
  if (meu !== pedidoAtual) return { source: 'none' };

  const amostras = pcmBase64ParaAmostras(resposta.audio);
  if (!amostras.length) {
    console.warn('[KAZE TTS] O servidor devolveu áudio vazio.');
    return { source: 'none' };
  }

  const taxa = resposta.sample_rate || TTS_SAMPLE_RATE;
  const completa = await reproduzir(ctx, amostras, taxa, meu);
  return { source: completa ? 'gemini_tts' : 'none' };
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
