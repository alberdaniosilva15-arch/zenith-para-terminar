// =============================================================================
// ZENITH RIDE — kazeAudioTranscribe.ts
// Utilitário de transcrição de áudio resiliente com suporte multi-provider:
//   1º) Groq Whisper (modelo dedicado de transcrição — MUITO mais preciso)
//   2º) Gemini (generativo, com prompt fortemente condicionado)
// Inclui detecção por magic bytes e fallback de modelos.
// =============================================================================

import { normalizeAngolanSpeech } from './angolaSpeechNormalizer';
// A transcrição passa pelo servidor. A chave do Groq nunca chega ao browser.
import { transcreverAudioNoServidor } from '../services/geminiService';

export interface AudioTranscribeResult {
  text: string;
  rawText: string;
  isEmpty: boolean;
  status: 'success' | 'empty' | 'error';
  errorMessage?: string;
  httpStatus?: number;
  modelUsed?: string;
  provider?: 'groq' | 'gemini';
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

/**
 * Converte um Blob de áudio em Base64
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Detecta o MIME type real através dos Magic Bytes do container de áudio
 */
async function detectAudioMimeType(blob: Blob): Promise<string> {
  try {
    const headerBuffer = await blob.slice(0, 16).arrayBuffer();
    const bytes = new Uint8Array(headerBuffer);
    if (bytes.length >= 4) {
      // EBML / WebM: 1A 45 DF A3
      if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        return 'audio/webm';
      }
      // WAV / RIFF: 52 49 46 46
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        return 'audio/wav';
      }
      // Ogg: 4F 67 67 53
      if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
        return 'audio/ogg';
      }
      // MP4 / M4A: ftyp at offset 4
      if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        return 'audio/mp4';
      }
      // MP3: FF FB, FF F3, FF F2 (MPEG-1/2 Layer III)
      if (bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2)) {
        return 'audio/mpeg';
      }
      // MP3: ID3 tag
      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        return 'audio/mpeg';
      }
    }
  } catch {}

  const rawType = (blob.type || '').toLowerCase();
  if (rawType.includes('webm')) return 'audio/webm';
  if (rawType.includes('mp4') || rawType.includes('m4a')) return 'audio/mp4';
  if (rawType.includes('ogg')) return 'audio/ogg';
  if (rawType.includes('wav')) return 'audio/wav';
  if (rawType.includes('mpeg') || rawType.includes('mp3')) return 'audio/mpeg';
  return 'audio/webm';
}

// ── Vocabulário de Luanda para o Whisper ───────────────────────────────────
//
// ⚠️ LIMITE MEDIDO CONTRA A API REAL (22/09/2026): o Groq conta o `prompt` em
// BYTES UTF-8 e recusa acima de 896. NÃO são caracteres — são bytes.
// "Quarteirão" tem 10 caracteres mas 11 bytes, "táxi" tem 4 mas 5. A lista
// anterior somava 903 caracteres = **924 bytes**, e o Groq respondia:
//
//   HTTP 400 invalid_prompt:
//   "prompt length must be 896 characters or fewer, but provided prompt
//    contains 924 characters"
//
// O efeito era o pior possível: a transcrição falhava SEMPRE, e o erro só
// existia no servidor — no telemóvel o Kaze dizia apenas "não consegui ouvir
// com clareza", o que fazia parecer problema de microfone. A lista tinha
// crescido até partir o limite sem que ninguém reparasse.
//
// Regra: MEDIR, nunca estimar. O valor abaixo é 880 e não 800 porque a lista
// completa ocupa 870 bytes — com um tecto de 800 o corte caía a meio e perdia
// justamente os comandos ("leva-me ao", "pede um táxi"), que são a parte mais
// útil. 880 deixa 16 bytes de folga sob o limite do fornecedor e deixa o corte
// ser o que deve ser: uma rede de segurança para quando a lista crescer, não
// uma tesoura a cortar vocabulário bom.
export const KAZE_WHISPER_PROMPT_MAX_BYTES = 880;

/** Corta o texto no último separador antes de `maxBytes` (contados em UTF-8). */
export function truncarPorBytes(texto: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(texto).length <= maxBytes) return texto;
  let cortado = texto;
  while (cortado.length > 0 && encoder.encode(cortado).length > maxBytes) {
    const separador = Math.max(cortado.lastIndexOf(', '), cortado.lastIndexOf(' '));
    cortado = separador > 0 ? cortado.slice(0, separador) : cortado.slice(0, -1);
  }
  return cortado.trim().replace(/[,;]\s*$/, '');
}

/**
 * Vocabulário que vai ao Whisper como `prompt`. Sem ele o Whisper escreve
 * "Kilamba" de várias maneiras diferentes.
 *
 * Construído a partir de uma lista (e não de uma string concatenada à mão) para
 * que o limite de bytes seja uma conta verificável em vez de um acto de fé.
 */
export const KAZE_WHISPER_PROMPT = truncarPorBytes(
  [
    'Zenith Ride, táxi, corrida, Luanda, Angola.',
    'Centralidade do Kilamba, Quarteirão A, Quarteirão B, Quarteirão C, Quarteirão D',
    'Quarteirão E, Quarteirão F, Quarteirão G, Quarteirão H, Quarteirão I, Quarteirão J',
    'Quarteirão K, Quarteirão L, Quarteirão M, Quarteirão N, Quarteirão O, Quarteirão P',
    'KK 5000, Golf 2, Golf 1, Nova Vida, Zona A, Zona B, Zona C, Zona D',
    'Mercado dos Correios, Talatona, Lar do Patriota, Belas Shopping',
    'Cidade Financeira, Morro Bento, Benfica, Camama, Cidade Universitária',
    'Viana, Estalagem, Capalanga, Kikuxi, Zango 1, Zango 2, Zango 3, Vida Pacífica',
    'Cazenga, Tala Hady, Hoji Ya Henda, Cuca, Cacuaco, Sequele, Kikolo, Panguila',
    'Mutamba, Kinaxixi, Maculusso, Maianga, Alvalade, Prenda, Sambizanga',
    'Bairro Operário, Ilha do Cabo, Aeroporto 4 de Fevereiro',
    'Comandos: quero ir para, leva-me ao, pede um táxi, chama um carro, quanto custa.',
  ].join(' '),
  KAZE_WHISPER_PROMPT_MAX_BYTES,
);

// ─── Provedor 1: Groq Whisper (MODELO DEDICADO DE TRANSCRIÇÃO) ──────────────
// Whisper é treinado ESPECIFICAMENTE para transcrição de fala → Muito mais preciso
// que modelos generativos como Gemini para esta tarefa.
//
// ⚠️ A chamada já NÃO sai daqui para a API do Groq. O áudio vai para a Edge
// Function `gemini-proxy` (acção `kaze_transcribe`), que tem a chave nos secrets
// do servidor. Antes, esta função recebia a chave por parâmetro — vinda de
// `VITE_GROQ_API_KEY`, inlined no bundle.

async function transcribeWithGroq(
  blob: Blob,
  mimeType: string,
): Promise<AudioTranscribeResult> {
  // ⚠️ Antes daqui saía um `fetch` directo para `api.groq.com` com a chave do
  // browser. Agora o áudio vai para a Edge Function `gemini-proxy`
  // (acção `kaze_transcribe`), que já tem a chave nos secrets do servidor.
  //
  // O `FormData` que aqui se montava existia só para transportar o prompt de
  // vocabulário até esta linha. Foi removido: o prompt é agora a constante
  // `KAZE_WHISPER_PROMPT` (acima), já cortada por bytes — que é o que o Groq
  // mede. Montar um FormData para o voltar a ler era um rodeio que escondia
  // precisamente o número que estava errado.
  try {
    const audioBase64 = await blobToBase64(blob);
    const rawText = (await transcreverAudioNoServidor(audioBase64, mimeType, KAZE_WHISPER_PROMPT)).trim();

    // Whisper retorna string vazia quando não há fala
    if (!rawText || rawText.length < 2) {
      return {
        text: '', rawText, isEmpty: true, status: 'empty',
        errorMessage: 'Nenhuma fala detectada pelo Whisper.',
        modelUsed: 'whisper-large-v3-turbo',
        provider: 'groq',
      };
    }

    // Filtrar artefactos comuns do Whisper (legendas genéricas de música/silêncio)
    const whisperArtifacts = [
      /^\[.*\]$/,                                         // [Música], [Silêncio], etc.
      /^(?:obrigad[oa]? por assistir|subscribe)/i,       // Artefactos de YouTube
      /^(?:legendas? por|subtitles? by)/i,
      /^♪/,                                               // Notas musicais
    ];
    if (whisperArtifacts.some(regex => regex.test(rawText))) {
      return {
        text: '', rawText, isEmpty: true, status: 'empty',
        errorMessage: 'Whisper detectou apenas ruído/música, sem fala humana.',
        modelUsed: 'whisper-large-v3-turbo',
        provider: 'groq',
      };
    }

    const normalizedText = normalizeAngolanSpeech(rawText);
    console.log('[kazeAudioTranscribe] ✅ Groq/Whisper transcreveu:', rawText, '->', normalizedText);

    return {
      text: normalizedText,
      rawText,
      isEmpty: false,
      status: 'success',
      modelUsed: 'whisper-large-v3-turbo',
      provider: 'groq',
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        text: '', rawText: '', isEmpty: false, status: 'error',
        errorMessage: 'Transcrição no servidor excedeu o tempo (>30s).',
        provider: 'groq',
      };
    }
    return {
      text: '', rawText: '', isEmpty: false, status: 'error',
      errorMessage: `Transcrição no servidor: ${err?.message || err}`,
      provider: 'groq',
    };
  }
}

// ─── Provedor 2: Google directo — DESLIGADO (removido) ─────────────────────
//
// ⚠️ Aqui vivia um caminho completo de transcricao directa ao Google: um
// `fetch` para `generativelanguage.googleapis.com/...?key=${key}`, com a chave
// lida de `import.meta.env.VITE_IA_API_KEY`. Foi REMOVIDO, nao comentado:
//
//   1. a chave era do OpenRouter (`sk-or-...`) e o filtro exigia `AIza`
//      (Google) — logo aquela chave NUNCA era usada para nada. Era exposicao
//      pura, sem contrapartida;
//   2. qualquer `?key=` no cliente e mais uma chave dentro do bundle que o
//      browser descarrega;
//   3. a transcricao real corre no servidor: accao `kaze_transcribe` do
//      `gemini-proxy`, com Groq/Whisper e a chave so do lado do servidor.
//
// Se um dia for preciso um fallback Google, acrescenta-se uma accao ao
// `gemini-proxy`. NUNCA se repoe uma chave no browser.

function fallbackGoogleDesligado(): AudioTranscribeResult {
  return {
    text: '', rawText: '', isEmpty: false, status: 'error',
    errorMessage:
      'Fallback Google desligado. A transcricao corre no servidor (kaze_transcribe) — ' +
      'se falhou, ver o erro do Groq/Whisper acima.',
    provider: 'gemini',
  };
}

// ─── Função Principal: Cascata de Provedores ────────────────────────────────

/**
 * Transcreve áudio de voz.
 *
 * Caminho único: `kaze_transcribe` na Edge Function `gemini-proxy` (Groq/Whisper
 * com `whisper-large-v3-turbo`, vocabulário angolano no `prompt`). O cliente não
 * tem — nem precisa — de ter chave nenhuma.
 *
 * O antigo fallback Google directo foi REMOVIDO: exigia uma chave no browser e,
 * na prática, nunca funcionava (ver o bloco "Provedor 2" abaixo).
 */
export async function transcribeAudioWithGemini(blob: Blob): Promise<AudioTranscribeResult> {
  // ── Validação básica ──
  //
  // ⚠️ O limiar era 300 bytes e estava baixo de mais: o `MediaRecorder` do
  // Chrome emite o CABEÇALHO WebM (EBML) no instante em que arranca, antes de
  // existir som. Uma gravação cortada cedo demais ficava com ~400 bytes —
  // passava este teste, era enviada, e o Groq respondia
  // `400 invalid_media_file: could not process file - is it a valid media file?`
  // Um ficheiro só-cabeçalho não tem fala nenhuma: mais vale identificar isso
  // aqui, onde ainda se sabe explicar, do que no servidor.
  const MIN_BYTES_COM_FALA = 800;
  if (!blob || blob.size < MIN_BYTES_COM_FALA) {
    return {
      text: '', rawText: '', isEmpty: true, status: 'empty',
      errorMessage:
        `Áudio demasiado curto (${blob?.size || 0} bytes, mínimo ${MIN_BYTES_COM_FALA}). ` +
        'O microfone não chegou a captar fala.',
    };
  }

  const mimeType = await detectAudioMimeType(blob);
  console.log(`[kazeAudioTranscribe] Áudio: ${blob.size} bytes, MIME: ${mimeType}`);

  // ── 1º Tentar Groq/Whisper (transcrição dedicada, MUITO mais precisa) ──
  //
  // ⚠️ Deixou de haver um teste à existência da chave. A chave já não está no
  // cliente (ver `src/lib/kazeKey.ts`): quem a tem é a Edge Function
  // `gemini-proxy`. Se o servidor não a tiver configurada, devolve 503 e cai-se
  // no Gemini abaixo — que é o comportamento certo.
  {
    const groqResult = await transcribeWithGroq(blob, mimeType);
    // Se deu sucesso ou vazio confirmado, retornar
    if (groqResult.status === 'success' || groqResult.status === 'empty') {
      return groqResult;
    }
    // Se falhou (rate-limit, erro), tentar Gemini como fallback
    console.warn('[kazeAudioTranscribe] Groq falhou, a tentar Gemini:', groqResult.errorMessage);
  }

  // ── 2º Fallback Google directo — DESLIGADO ──
  //
  // Antes convertia-se o áudio para Base64 e tentava-se o Google com uma chave
  // vinda do cliente. Isso acabou (ver o bloco "Provedor 2" acima). A conversão
  // para Base64 também sai daqui: não faz sentido pagar esse custo para devolver
  // logo um erro.
  return fallbackGoogleDesligado();
}

/**
 * Versão simplificada que retorna apenas o texto (para compatibilidade com KazePanel)
 */
export async function transcribeAudioFlexible(blob: Blob): Promise<string> {
  const result = await transcribeAudioWithGemini(blob);
  if (result.status === 'success') return result.text;
  if (result.status === 'empty') return '';
  throw new Error(result.errorMessage || 'Falha na transcrição de áudio.');
}
