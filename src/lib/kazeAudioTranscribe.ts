// =============================================================================
// ZENITH RIDE — kazeAudioTranscribe.ts
// Utilitário de transcrição de áudio resiliente com suporte multi-provider:
//   1º) Groq Whisper (modelo dedicado de transcrição — MUITO mais preciso)
//   2º) Gemini (generativo, com prompt fortemente condicionado)
// Inclui detecção por magic bytes e fallback de modelos.
// =============================================================================

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

async function transcribeWithGroq(
  blob: Blob,
  apiKey: string,
  mimeType: string,
): Promise<AudioTranscribeResult> {
  const ext = mimeToExtension(mimeType);
  const formData = new FormData();
  formData.append('file', blob, `recording.${ext}`);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'pt');
  formData.append('response_format', 'verbose_json');
  // Prompt de contexto para Whisper — ajuda a ancorar nomes de bairros angolanos
  formData.append('prompt',
    'Zenith Ride, táxi, corrida, Luanda, Angola. ' +
    'Bairros: Camama, Viana, Cacuaco, Talatona, Benfica, Morro Bento, ' +
    'Maianga, Kinaxixi, Belas Shopping, Alvalade, Rangel, Samba, ' +
    'Kilamba, Zango, Cazenga, Ingombota, Mutamba, Rocha Pinto, ' +
    'Mundo Verde, Golf 2, Nova Vida, Patriota, Ilha de Luanda, ' +
    'Aeroporto 4 de Fevereiro, Largo do Ambiente, Largo da Independência.'
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });

    if (res.status === 429 || res.status === 503) {
      return {
        text: '', rawText: '', isEmpty: false, status: 'error',
        httpStatus: res.status,
        errorMessage: `Groq rate-limited (HTTP ${res.status}). A tentar outro provedor...`,
        provider: 'groq',
      };
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        text: '', rawText: '', isEmpty: false, status: 'error',
        httpStatus: res.status,
        errorMessage: `Groq HTTP ${res.status}: ${errBody.slice(0, 200)}`,
        provider: 'groq',
      };
    }

    const data = await res.json();
    const rawText = (data.text || '').trim();

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

    console.log('[kazeAudioTranscribe] ✅ Groq/Whisper transcreveu:', rawText);

    return {
      text: rawText,
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
        errorMessage: 'Groq/Whisper timeout (>15s).',
        provider: 'groq',
      };
    }
    return {
      text: '', rawText: '', isEmpty: false, status: 'error',
      errorMessage: `Groq/Whisper: ${err?.message || err}`,
      provider: 'groq',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Provedor 2: Gemini (modelo generativo — fallback) ──────────────────────
// Usa prompt fortemente condicionado com contexto angolano para minimizar alucinações

function getGeminiApiKeys(): string[] {
  const envKeys: (string | undefined)[] = [
    import.meta.env.VITE_GEMINI_API_KEY,
    import.meta.env.VITE_IA_API_KEY,
  ];
  // Filtrar chaves válidas de ambiente
  return Array.from(new Set(
    envKeys.filter((k): k is string => Boolean(k && k.trim() && k.startsWith('AIza')))
  ));
}

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
];

// Prompt optimizado: muito mais restritivo, com exemplos concretos de Angola
const GEMINI_TRANSCRIPTION_PROMPT = `TAREFA: Transcrever este áudio de voz falada em português.

CONTEXTO: O utilizador está dentro da app Zenith Ride (serviço de táxi/mobilidade em Luanda, Angola).
Ele pode estar a pedir corridas, indicar destinos, ou dar comandos de voz ao assistente.

VOCABULÁRIO ESPERADO (nomes de bairros de Luanda e comandos comuns):
- Bairros: Camama, Viana, Cacuaco, Talatona, Benfica, Morro Bento, Maianga, Kinaxixi, Kilamba, Zango, Cazenga, Ingombota, Mutamba, Rocha Pinto, Alvalade, Rangel, Samba, Golf 2, Nova Vida, Patriota, Ilha de Luanda, Mundo Verde, Belas Shopping, Largo do Ambiente, Largo da Independência, Aeroporto, Morro da Cruz, São Paulo, Prenda
- Comandos: "pede um táxi para...", "quero ir para...", "quanto custa...", "confirma", "cancela", "sim", "não", "histórico", "saldo", "ajuda"

REGRAS ABSOLUTAS:
1. Retorna APENAS e EXCLUSIVAMENTE o texto falado. Nada mais.
2. NÃO inventes texto. Se não consegues perceber, responde: [VAZIO]
3. NÃO incluas timestamps (00:00), aspas, prefixos ou explicações.
4. NÃO traduzas — mantém exactamente o que foi dito.
5. Se o áudio tiver ruído mas houver voz, transcreve a voz.
6. Se for APENAS ruído/silêncio sem voz humana, responde: [VAZIO]`;

async function transcribeWithGemini(
  blob: Blob,
  base64Audio: string,
  mimeType: string,
): Promise<AudioTranscribeResult> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    return {
      text: '', rawText: '', isEmpty: false, status: 'error',
      errorMessage: 'Nenhuma chave Gemini (AIza...) configurada.',
      provider: 'gemini',
    };
  }

  let lastError = '';
  let lastHttpStatus: number | undefined;
  let lastRawText = '';

  for (const model of CANDIDATE_MODELS) {
    for (const key of keys) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: GEMINI_TRANSCRIPTION_PROMPT },
                    {
                      inline_data: {
                        mime_type: mimeType,
                        data: base64Audio,
                      },
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.0,
                maxOutputTokens: 200,
                topP: 1.0,
                topK: 1,
              },
            }),
          }
        );

        clearTimeout(timeoutId);
        lastHttpStatus = res.status;

        if (res.status === 429 || res.status === 503) {
          console.warn(`[kazeAudioTranscribe] Gemini ${model} key ${key.slice(0, 8)}... → HTTP ${res.status}`);
          continue;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `HTTP ${res.status}: ${errText.slice(0, 250)}`;
          continue;
        }

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        lastRawText = rawText;

        const cleaned = rawText
          .replace(/\[?\d{1,2}:\d{2}(?::\d{2})?\]?/g, '')
          .replace(/^(?:A transcrição é|O áudio diz|Transcrição|O utilizador disse|A pessoa disse|O texto falado é):?\s*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        const isExplicitlyEmpty =
          !cleaned ||
          /^\[?(?:vazio|sil[eê]ncio|ru[ií]do|sem[ _]voz)\]?$/i.test(cleaned) ||
          /^(?:não há fala|nenhuma voz detectada|apenas ruído|não foi possível)/i.test(cleaned);

        if (isExplicitlyEmpty) {
          return {
            text: '', rawText, isEmpty: true, status: 'empty',
            errorMessage: 'Nenhuma fala humana audível detectada no áudio.',
            modelUsed: model, provider: 'gemini',
          };
        }

        console.log(`[kazeAudioTranscribe] ✅ Gemini/${model} transcreveu:`, cleaned);

        return {
          text: cleaned, rawText, isEmpty: false,
          status: 'success', modelUsed: model, provider: 'gemini',
        };
      } catch (fetchErr: any) {
        if (fetchErr?.name === 'AbortError') {
          lastError = `Gemini/${model} timeout (>20s)`;
        } else {
          lastError = fetchErr?.message || String(fetchErr);
        }
      }
    }
  }

  return {
    text: '', rawText: lastRawText, isEmpty: false, status: 'error',
    httpStatus: lastHttpStatus,
    errorMessage: lastError || 'Não foi possível transcrever após tentar todas as chaves e modelos.',
    provider: 'gemini',
  };
}

// ─── Função Principal: Cascata de Provedores ────────────────────────────────

/**
 * Transcreve áudio com cascata inteligente de provedores:
 *   1º) Groq/Whisper (se VITE_GROQ_API_KEY estiver configurada)
 *   2º) Gemini (fallback com prompt condicionado)
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
  const { getResolvedKazeGroqKey } = await import('./kazeKey');
  const groqKey = getResolvedKazeGroqKey();
  if (groqKey) {
    const groqResult = await transcribeWithGroq(blob, groqKey, mimeType);
    // Se deu sucesso ou vazio confirmado, retornar
    if (groqResult.status === 'success' || groqResult.status === 'empty') {
      return groqResult;
    }
    // Se falhou (rate-limit, erro), tentar Gemini como fallback
    console.warn('[kazeAudioTranscribe] Groq falhou, a tentar Gemini:', groqResult.errorMessage);
  }

  // ── 2º Tentar Gemini (fallback generativo) ──
  let base64Audio = '';
  try {
    base64Audio = await blobToBase64(blob);
  } catch (convErr: any) {
    return {
      text: '', rawText: '', isEmpty: false, status: 'error',
      errorMessage: `Falha ao converter áudio para Base64: ${convErr?.message || convErr}`,
    };
  }

  return await transcribeWithGemini(blob, base64Audio, mimeType);
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
