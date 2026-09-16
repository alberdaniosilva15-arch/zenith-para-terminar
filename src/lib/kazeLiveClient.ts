// =============================================================================
// ZENITH RIDE v3.3 — src/lib/kazeLiveClient.ts
//
// Voz bidirecional do Kaze via **Gemini Live API** (áudio-para-áudio).
//
// MODELO: gemini-2.5-flash-native-audio-latest
//   • entrada  PCM 16-bit, 16 kHz, little-endian
//   • saída    PCM 16-bit, 24 kHz, little-endian
//   • protocolo WebSocket stateful (gerido pelo SDK @google/genai)
//
// ⚠️ O nome do modelo vem do servidor (`gemini-proxy`, action `get_live_token`).
// O valor escrito aqui é só recurso para o caso de o servidor não o enviar.
// Tem de ser um modelo que exista mesmo na conta e que suporte
// `bidiGenerateContent`, senão o Kaze fica mudo sem dar erro.
//
// SEGURANÇA
//   A GEMINI_API_KEY nunca chega ao browser. Pedimos um *ephemeral token* ao
//   Edge Function `gemini-proxy` (action `get_live_token`), que já vem travado
//   ao modelo e a responseModalities=AUDIO. O token é de uso único e expira em
//   minutos — se for extraído, não dá acesso à conta.
//
// ADITIVO POR DESIGN
//   Este ficheiro é novo e autónomo. Não altera nenhum fluxo existente: se
//   `startKazeLiveSession` falhar, a app continua exactamente como antes.
//   Não há voz de recurso — se o Live não estiver disponível, o Kaze responde
//   só por escrito (decisão do Dánio).
//
// NOTA TÉCNICA
//   A captura usa ScriptProcessorNode, que está deprecado mas continua
//   suportado em todos os browsers actuais. Fica isolado em `_startMic` para
//   ser substituível por AudioWorklet sem tocar no resto do ficheiro.
// =============================================================================

// O SDK do Gemini é pesado (~400 kB). Importamos apenas os TIPOS aqui e
// carregamos o código a sério só quando o utilizador liga a voz (import
// dinâmico dentro de `startKazeLiveSession`) — o bundle inicial não paga nada
// por uma funcionalidade que a maioria das sessões nunca abre.
import type { FunctionDeclaration, ToolListUnion, Type as GeminiSchemaType } from '@google/genai';
import { geminiService } from '../services/geminiService';
import { KAZE_APP_TOOLS, KAZE_AGENT_SYSTEM_PROMPT } from '../services/kazeAppAgent';
import type { LatLng } from '../types';

// ─── Adaptador de ferramentas ─────────────────────────────────────────────────
//
// `KAZE_APP_TOOLS` está em formato REST cru (`function_declarations`, tipos como
// a string 'STRING') porque é enviado tal-e-qual por `fetch` à API REST do
// Gemini e à Groq. O SDK espera `functionDeclarations` com o enum `Type`.
//
// Os VALORES são idênticos — `Type.STRING === 'STRING'`, `Type.OBJECT === 'OBJECT'`
// — por isso a conversão é puramente de forma/tipos, sem risco de tradução
// errada. Mantemos um único array como fonte de verdade: nada é duplicado.

// Os literais do enum `Type` do SDK são exactamente estes. Mantê-los aqui
// evita importar o SDK só para validar um schema — o import dinâmico fica
// assim confinado a `startKazeLiveSession`.
const SCHEMA_TYPE_VALUES: ReadonlySet<string> = new Set([
  'TYPE_UNSPECIFIED',
  'STRING',
  'NUMBER',
  'INTEGER',
  'BOOLEAN',
  'ARRAY',
  'OBJECT',
  'NULL',
]);

/** Converte recursivamente um schema REST para a forma tipada do SDK. */
function toSdkSchema(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  // Os VALORES são idênticos aos do REST — só o nome do campo muda de sítio.
  if (typeof out.type === 'string') {
    out.type = (SCHEMA_TYPE_VALUES.has(out.type)
      ? out.type
      : 'TYPE_UNSPECIFIED') as GeminiSchemaType;
  }

  // `properties` é um mapa nome → schema; converter cada valor em profundidade.
  if (out.properties && typeof out.properties === 'object') {
    const props = out.properties as Record<string, unknown>;
    out.properties = Object.fromEntries(
      Object.entries(props).map(([key, value]) => [key, toSdkSchema(value)]),
    );
  }

  // `items` só existe em schemas de array.
  if (out.items) out.items = toSdkSchema(out.items);

  return out;
}

/** Converte `KAZE_APP_TOOLS` (REST) para o formato tipado aceite por `live.connect`. */
function toSdkTools(rawTools: readonly unknown[]): ToolListUnion {
  const declarations: FunctionDeclaration[] = [];

  for (const entry of rawTools) {
    const list = (entry as { function_declarations?: unknown[] })?.function_declarations ?? [];
    for (const item of list) {
      const decl = item as { name?: string; description?: string; parameters?: unknown };
      if (!decl?.name) continue;
      declarations.push({
        name: decl.name,
        description: decl.description ?? '',
        parameters: toSdkSchema(decl.parameters) as FunctionDeclaration['parameters'],
      });
    }
  }

  return declarations.length ? [{ functionDeclarations: declarations }] : [];
}

// ─── Constantes de áudio ──────────────────────────────────────────────────────
const INPUT_SAMPLE_RATE = 16_000;  // exigido pela Live API
const OUTPUT_SAMPLE_RATE = 24_000; // devolvido pela Live API
const MIC_BUFFER_FRAMES = 2048;    // ~128 ms a 16 kHz — equilíbrio latência/custo

// ─── API pública ──────────────────────────────────────────────────────────────

export interface KazeLiveToolCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

export interface KazeLiveCallbacks {
  /** Sessão pronta — o Kaze já pode ouvir. */
  onReady?: () => void;
  /** O utilizador falou (transcrição incremental). */
  onUserTranscript?: (text: string, finished: boolean) => void;
  /** O Kaze falou (transcrição incremental). */
  onKazeTranscript?: (text: string, finished: boolean) => void;
  /** Fim de turno do modelo. */
  onTurnComplete?: () => void;
  /** O Kaze começou/parou de falar — útil para animar o mascote. */
  onSpeakingChange?: (speaking: boolean) => void;
  /** O utilizador interrompeu o Kaze (barge-in). */
  onInterrupted?: () => void;
  /**
   * O modelo quer executar uma ferramenta. O retorno é enviado de volta ao
   * Live para ele continuar a conversa. Se devolveres `undefined`, o Live
   * recebe um `{ ok: true }` genérico.
   */
  onToolCall?: (call: KazeLiveToolCall) => Promise<unknown> | unknown;
  /** Erro recuperável — a sessão pode continuar ou não. */
  onError?: (message: string) => void;
  /** Sessão fechada (por nós ou pelo servidor). */
  onClose?: () => void;
}

export interface KazeLiveOptions {
  /**
   * Identificador do utilizador. Reservado para atribuição/telemetria futura
   * no servidor — a sessão Live em si não precisa dele, porque a autorização
   * já é feita pelo token efémero.
   */
  userId?: string;
  userAddress?: string | null;
  userLocation?: LatLng | null;
  hasActiveRide?: boolean;
  /** Nome da voz prebuilt do Gemini. Default: 'Aoede'. */
  voiceName?: string;
  /** Código ISO 639-1 para a síntese. Default: 'pt-PT'. */
  languageCode?: string;
  callbacks: KazeLiveCallbacks;
}

export interface KazeLiveSession {
  /** Fecha a sessão e liberta microfone + contexto de áudio. */
  close(): void;
  /** Envia texto como se fosse fala do utilizador (útil para o chat). */
  sendText(text: string): void;
  /** Liga/desliga o microfone sem fechar a sessão. */
  setMicEnabled(enabled: boolean): void;
  /** Estado actual do microfone. */
  isMicEnabled(): boolean;
  /** Handle de resumption actual (para reconexão transparente). */
  getResumptionHandle(): string | null;
}

// ─── Utilitários de áudio ─────────────────────────────────────────────────────

/** Float32 [-1,1] → PCM 16-bit little-endian. */
function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Int16Array → base64 (para o campo `data` do SDK). */
function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return bytesToBase64(bytes);
}

/** bytes → base64, em blocos para não estourar a stack com áudio longo. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice) as unknown as number[]);
  }
  return btoa(binary);
}

/** base64 → Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Reamostragem linear simples. Só é usada quando o AudioContext do browser não
 * honra os 16 kHz pedidos (acontece em alguns Safari). Para voz é suficiente —
 * não introduz artefactos audíveis.
 */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

// ─── Sessão Live ──────────────────────────────────────────────────────────────

/**
 * Abre uma sessão de voz bidirecional com o Kaze.
 *
 * Lança se o token não puder ser obtido ou se o browser não suportar captura
 * de áudio — cabe ao chamador decidir o que mostrar ao utilizador.
 */
export async function startKazeLiveSession(options: KazeLiveOptions): Promise<KazeLiveSession> {
  const {
    userAddress,
    userLocation,
    hasActiveRide,
    voiceName = 'Aoede',
    languageCode = 'pt-PT',
    callbacks,
  } = options;

  // ── 0. Pré-condições do browser ───────────────────────────────────────────
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este dispositivo não suporta captura de microfone.');
  }

  // ── 0b. Carregar o SDK só agora ───────────────────────────────────────────
  //  Só depois de sabermos que o browser consegue capturar áudio é que vale a
  //  pena descarregar ~400 kB de SDK. Se falhar aqui, nada foi gasto.
  const { GoogleGenAI, Modality } = await import('@google/genai');

  // ── 1. Token efémero (a API key fica no servidor) ─────────────────────────
  let token: string;
  let model: string;
  try {
    const res = await geminiService.getKazeLiveToken();
    token = (res as { ephemeral_token?: string; token?: string }).ephemeral_token
      ?? (res as { token?: string }).token
      ?? '';
    model = (res as { model?: string }).model ?? 'gemini-2.5-flash-native-audio-latest';
    if (!token) throw new Error('O servidor não devolveu um token de voz.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Serviço de voz indisponível.';
    throw new Error(`Não foi possível iniciar a voz do Kaze. ${msg}`);
  }

  // ── 2. Contextos de áudio ─────────────────────────────────────────────────
  //  Entrada: 16 kHz para o formato exigido pela Live API.
  //  Saída:   24 kHz para reproduzir o que o modelo devolve.
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Este browser não suporta processamento de áudio.');
  }

  const inputCtx = new AudioContextClass({ sampleRate: INPUT_SAMPLE_RATE });
  const outputCtx = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });

  // Autoplay policy: sem isto o primeiro som pode ser bloqueado.
  if (inputCtx.state === 'suspended') await inputCtx.resume().catch(() => {});
  if (outputCtx.state === 'suspended') await outputCtx.resume().catch(() => {});

  const actualInputRate = inputCtx.sampleRate;

  // ── 3. Estado da sessão ───────────────────────────────────────────────────
  let closed = false;
  let micEnabled = true;
  let resumptionHandle: string | null = null;

  // Reprodução: fila sequencial + controlo de barge-in
  let nextPlayTime = 0;
  const activeSources = new Set<AudioBufferSourceNode>();
  let speaking = false;

  let micStream: MediaStream | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let micProcessor: ScriptProcessorNode | null = null;
  let micMute: GainNode | null = null;

  const setSpeaking = (value: boolean) => {
    if (speaking === value) return;
    speaking = value;
    callbacks.onSpeakingChange?.(value);
  };

  /** Corta a fala imediatamente — usado no barge-in. */
  const flushPlayback = () => {
    activeSources.forEach((src) => {
      try { src.stop(); } catch { /* já parado */ }
    });
    activeSources.clear();
    nextPlayTime = 0;
    setSpeaking(false);
  };

  /** Descarrega e agenda um bloco de PCM 24 kHz vindo do modelo. */
  const enqueueAudio = (base64: string) => {
    if (closed) return;
    try {
      const bytes = base64ToBytes(base64);
      // O buffer pode ter comprimento ímpar se houver padding; truncar é seguro.
      const usable = bytes.byteLength - (bytes.byteLength % 2);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);

      const floats = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) floats[i] = (pcm[i] ?? 0) / 32768;

      const buffer = outputCtx.createBuffer(1, floats.length, OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(floats, 0);

      const src = outputCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(outputCtx.destination);
      src.onended = () => {
        activeSources.delete(src);
        if (activeSources.size === 0) setSpeaking(false);
      };

      // Agenda em sequência para não haver sobreposição nem buracos.
      const startAt = Math.max(outputCtx.currentTime, nextPlayTime);
      src.start(startAt);
      nextPlayTime = startAt + buffer.duration;
      activeSources.add(src);
      setSpeaking(true);
    } catch (err) {
      console.warn('[kazeLiveClient] Falha ao enfileirar áudio:', err);
    }
  };

  // ── 4. Ligar à Live API ───────────────────────────────────────────────────
  // O token efémero é usado como se fosse a API key.
  //
  // ⚠️ v1alpha é OBRIGATÓRIO — não é preferência, é requisito do SDK. Com
  //    v1beta a ligação até abre, mas o SDK avisa:
  //      "The SDK's ephemeral token support is in v1alpha only."
  //    Verificado contra a API real: v1alpha abre sem aviso e devolve áudio.
  const ai = new GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: 'v1alpha' },
  });

  const locationHint = userAddress
    ? `\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: "${userAddress}"]`
    : userLocation
      ? `\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: GPS (${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})]`
      : '';

  const rideHint = hasActiveRide ? '\n[O passageiro tem uma corrida activa neste momento.]' : '';

  const session = await ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: `${KAZE_AGENT_SYSTEM_PROMPT}${locationHint}${rideHint}` }],
      },
      speechConfig: {
        languageCode,
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
      // Transcrever os dois lados permite mostrar a conversa no ecrã.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Permite retomar a sessão depois do corte automático (~10 min).
      sessionResumption: {},
      tools: toSdkTools(KAZE_APP_TOOLS),
    },
    callbacks: {
      onopen: () => {
        if (closed) return;
        callbacks.onReady?.();
      },

      onmessage: (message) => {
        if (closed) return;

        // ── Resumption: guardar o handle para reconectar ──────────────────
        const update = message.sessionResumptionUpdate;
        if (update?.newHandle) {
          resumptionHandle = update.newHandle;
        }

        // ── Pedido de execução de ferramenta ──────────────────────────────
        const toolCalls = message.toolCall?.functionCalls;
        if (toolCalls?.length) {
          void (async () => {
            const responses = [];
            for (const call of toolCalls) {
              let payload: unknown = { ok: true };
              try {
                const result = await callbacks.onToolCall?.({
                  id: call.id,
                  name: call.name,
                  args: call.args as Record<string, unknown> | undefined,
                });
                if (result !== undefined) payload = result;
              } catch (err) {
                console.warn('[kazeLiveClient] Tool call falhou:', call.name, err);
                payload = { ok: false, error: 'A ferramenta falhou.' };
              }
              responses.push({
                id: call.id,
                name: call.name,
                response: payload as Record<string, unknown>,
              });
            }
            // O Live 3.1 só suporta function calling síncrono — responder
            // rapidamente é o que mantém a conversa fluida.
            try {
              session.sendToolResponse({ functionResponses: responses });
            } catch (err) {
              console.warn('[kazeLiveClient] Falha ao devolver tool response:', err);
            }
          })();
        }

        // ── Conteúdo do servidor ──────────────────────────────────────────
        const content = message.serverContent;
        if (!content) return;

        // Barge-in: o utilizador falou por cima → cortar imediatamente.
        if (content.interrupted) {
          flushPlayback();
          callbacks.onInterrupted?.();
        }

        // Transcrição do utilizador
        if (content.inputTranscription?.text) {
          callbacks.onUserTranscript?.(
            content.inputTranscription.text,
            content.inputTranscription.finished ?? false,
          );
        }

        // Transcrição do Kaze
        if (content.outputTranscription?.text) {
          callbacks.onKazeTranscript?.(
            content.outputTranscription.text,
            content.outputTranscription.finished ?? false,
          );
        }

        // Turno do modelo: um evento pode trazer VÁRIOS parts (áudio + texto).
        // Iterar todos é obrigatório no 3.1 — ler só o primeiro perde conteúdo.
        const parts = content.modelTurn?.parts ?? [];
        for (const part of parts) {
          const inline = part.inlineData;
          if (inline?.data) {
            enqueueAudio(inline.data);
          }
        }

        if (content.turnComplete) {
          callbacks.onTurnComplete?.();
        }
      },

      onerror: (e) => {
        if (closed) return;
        console.warn('[kazeLiveClient] Erro no WebSocket:', e);
        callbacks.onError?.('A ligação de voz teve um problema.');
      },

      onclose: (e) => {
        if (closed) return;
        // 1000 = fecho normal; qualquer outro código é anómalo.
        if (e?.code && e.code !== 1000) {
          console.warn('[kazeLiveClient] Sessão fechada pelo servidor:', e.code, e.reason);
        }
        flushPlayback();
        closed = true;
        callbacks.onClose?.();
      },
    },
  });

  // ── 5. Captura de microfone ───────────────────────────────────────────────
  const startMic = async () => {
    if (micStream) return;

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // evita que o Kaze se ouça a si próprio
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    micSource = inputCtx.createMediaStreamSource(micStream);
    // Deprecado mas universal. Substituível por AudioWorklet sem tocar no resto.
    micProcessor = inputCtx.createScriptProcessor(MIC_BUFFER_FRAMES, 1, 1);

    micProcessor.onaudioprocess = (event) => {
      if (closed || !micEnabled) return;
      const channel = event.inputBuffer.getChannelData(0);
      const at16k = resampleLinear(channel, actualInputRate, INPUT_SAMPLE_RATE);
      const pcm = floatTo16BitPCM(at16k);
      try {
        session.sendRealtimeInput({
          audio: {
            data: int16ToBase64(pcm),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        });
      } catch (err) {
        // Não vale a pena inundar a consola: acontece ao fechar a sessão.
        if (!closed) console.warn('[kazeLiveClient] Falha ao enviar áudio:', err);
      }
    };

    micSource.connect(micProcessor);

    // O ScriptProcessor só dispara se estiver ligado a um destino. Passamos por
    // um gain a 0 para o microfone NÃO se ouvir a si próprio (evita eco).
    micMute = inputCtx.createGain();
    micMute.gain.value = 0;
    micProcessor.connect(micMute);
    micMute.connect(inputCtx.destination);
  };

  const stopMic = () => {
    try { micProcessor?.disconnect(); } catch { /* já desligado */ }
    try { micSource?.disconnect(); } catch { /* já desligado */ }
    try { micMute?.disconnect(); } catch { /* já desligado */ }
    micProcessor = null;
    micSource = null;
    micMute = null;
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
  };

  try {
    await startMic();
  } catch (err) {
    // Sem microfone não há voz — limpar tudo e reportar.
    session.close();
    stopMic();
    void inputCtx.close();
    void outputCtx.close();
    closed = true;
    const msg = err instanceof Error && err.name === 'NotAllowedError'
      ? 'Permissão de microfone negada. Autoriza o acesso para falar com o Kaze.'
      : 'Não foi possível aceder ao microfone.';
    throw new Error(msg);
  }

  // ── 6. Controlo exposto ao chamador ───────────────────────────────────────
  return {
    close() {
      if (closed) return;
      closed = true;
      stopMic();
      flushPlayback();
      try { session.close(); } catch { /* já fechada */ }
      void inputCtx.close().catch(() => {});
      void outputCtx.close().catch(() => {});
      callbacks.onClose?.();
    },

    sendText(text: string) {
      if (closed || !text.trim()) return;
      try {
        session.sendRealtimeInput({ text: text.trim() });
      } catch (err) {
        console.warn('[kazeLiveClient] Falha ao enviar texto:', err);
      }
    },

    setMicEnabled(enabled: boolean) {
      micEnabled = enabled;
      // Avisar o servidor de que a fala parou melhora a detecção de turno.
      if (!enabled) {
        try { session.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* ignorar */ }
      }
    },

    isMicEnabled() {
      return micEnabled;
    },

    getResumptionHandle() {
      return resumptionHandle;
    },
  };
}
