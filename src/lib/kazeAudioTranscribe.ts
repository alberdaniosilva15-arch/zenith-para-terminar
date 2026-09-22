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

/**
 * Obtém a extensão de ficheiro correspondente ao MIME type
 */
function mimeToExtension(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'webm';
}

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
  const ext = mimeToExtension(mimeType);
  const formData = new FormData();
  formData.append('file', blob, `recording.${ext}`);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'pt');
  formData.append('response_format', 'verbose_json');
  // Prompt de contexto expandido para Whisper com vocabulário rico de Angola
  formData.append('prompt',
    'Zenith Ride, táxi, corrida, Luanda, Angola. ' +
    'Centralidade do Kilamba, Quarteirão A, Quarteirão B, Quarteirão C, Quarteirão D, ' +
    'Quarteirão E, Quarteirão F, Quarteirão G, Quarteirão H, Quarteirão I, Quarteirão J, ' +
    'Quarteirão K, Quarteirão L, Quarteirão M, Quarteirão N, Quarteirão O, Quarteirão P, ' +
    'KK 5000, Golf 2, Golf 1, Nova Vida, Zona A, Zona B, Zona C, Zona D, Mercado dos Correios, ' +
    'Talatona, Lar do Patriota, Belas Shopping, Cidade Financeira, Morro Bento, Benfica, ' +
    'Camama, Cidade Universitária, Viana, Estalagem, Capalanga, Kikuxi, Zango 1, Zango 2, Zango 3, ' +
    'Vida Pacífica, Cazenga, Tala Hady, Hoji Ya Henda, Cuca, Cacuaco, Sequele, Kikolo, Panguila, ' +
    'Mutamba, Kinaxixi, Maculusso, Maianga, Alvalade, Prenda, Sambizanga, Bairro Operário, ' +
    'Ilha do Cabo, Aeroporto 4 de Fevereiro, Benguela, Lobito, Huambo, Lubango, Cabinda. ' +
    'Comandos: quero ir para, leva-me ao, pede um táxi, chama um carro, quanto custa.'
  );

  // ⚠️ Antes daqui saía um `fetch` directo para `api.groq.com` com a chave do
  // browser. Agora o áudio vai para a Edge Function `gemini-proxy`
  // (acção `kaze_transcribe`), que já tem a chave nos secrets do servidor.
  //
  // O `formData` continua a ser montado só para o prompt de vocabulário; lê-se
  // de volta em vez de se duplicar a lista de quarteirões numa segunda string.
  try {
    const promptUsado = String(formData.get('prompt') ?? '');
    const audioBase64 = await blobToBase64(blob);
    const rawText = (await transcreverAudioNoServidor(audioBase64, mimeType, promptUsado)).trim();

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
  if (!blob || blob.size < 300) {
    return {
      text: '', rawText: '', isEmpty: true, status: 'empty',
      errorMessage: `Áudio muito curto ou vazio (${blob?.size || 0} bytes). O microfone não captou sinal sonoro.`,
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
