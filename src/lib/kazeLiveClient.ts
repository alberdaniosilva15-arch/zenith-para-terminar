// =============================================================================
// ZENITH RIDE v3.3 — src/lib/kazeLiveClient.ts
//
// Voz bidirecional do Kaze via **Gemini Live API** (áudio-para-áudio).
//
// MODELO: gemini-3.8-live (vem do servidor, ver `gemini-proxy`)
//   • entrada  PCM 16-bit, 16 kHz, little-endian
//   • saída    PCM 16-bit, 24 kHz, little-endian
//   • protocolo WebSocket stateful (gerido pelo SDK @google/genai)
//
// ⚠️ O nome do modelo vem do servidor (`gemini-proxy`, action `get_live_token`).
// O valor escrito aqui é só recurso para o caso de o servidor não o enviar.
// Tem de ser um modelo que exista mesmo na conta e que suporte
// `bidiGenerateContent`, senão o Kaze fica mudo sem dar erro.
//
// PORQUE ESTE FICHEIRO MUDOU (16/09)
//   O servidor SEMPRE devolveu áudio — confirmado com o mesmo SDK em Node,
//   sem browser: 180 480 bytes (~3,8 s) num único turno. O silêncio estava
//   todo do lado do browser:
//     1. os AudioContext nasciam depois de dois `await` (SDK + rede), fora do
//        gesto do utilizador — em Safari o de saída ficava `suspended` para
//        sempre, e o erro era engolido por um `.catch(() => {})`;
//     2. o `interrupted` do servidor (barge-in) era aceite mesmo quando era
//        apenas o microfone a ouvir o altifalante, cortando a fala no arranque.
//   Ambos estão corrigidos abaixo, e `getAudioStats()` passa a tornar a cadeia
//   observável — "não se ouve nada" deixou de ser uma caixa negra.
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
import { KAZE_APP_TOOLS, KAZE_AGENT_SYSTEM_PROMPT, blocoDeContexto } from '../services/kazeAppAgent';
import type { LatLng } from '../types';
import { kazeDiag, kazeDiagContadores, kazeDiagFontes, kazeDiagNovoSessionId } from './kazeVoiceDiag';

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

/**
 * Tecto para o `ai.live.connect`.
 *
 * O pedido do token já está limitado a 8 s pelo `callProxy`, mas o handshake do
 * WebSocket não tinha limite NENHUM. Se ele nunca abrir, esta promessa nunca
 * resolve — e o `finally` do mascote nunca corre. O cadeado `arranqueLiveRef`
 * fica então fechado PARA SEMPRE: o botão prende em "A ligar o Kaze…" e todos
 * os toques seguintes são recusados em silêncio. A voz parece avariada até se
 * recarregar a página, sem um único erro no ecrã.
 */
const CONNECT_TIMEOUT_MS = 20_000;

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
  /**
   * Nome de quem está a falar. Sem isto o Kaze conversa sem saber com quem —
   * cumprimentava pelo nome no arranque e depois esquecia-o, porque o nome
   * nunca chegava ao contexto do modelo. Ver `blocoDeContexto`.
   */
  userName?: string | null;
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
  /**
   * Contadores de diagnóstico da cadeia de voz.
   *
   * Existe porque "o Kaze não fala" pode ser três coisas diferentes — o
   * servidor não mandou áudio, o browser bloqueou a saída, ou o barge-in cortou
   * tudo — e sem números as três são indistinguíveis do lado de fora.
   */
  getAudioStats(): KazeAudioStats;
}

export interface KazeAudioStats {
  /** Blocos de áudio que chegaram do servidor. */
  blocosRecebidos: number;
  /** Bytes de PCM recebidos (24 kHz, 16-bit mono → 48000 B/s). */
  bytesRecebidos: number;
  /** Blocos efectivamente agendados para reprodução. */
  blocosReproduzidos: number;
  /** Segundos de fala recebidos do servidor. */
  segundosRecebidos: number;
  /** Interrupções de barge-in aceites. */
  interrupcoes: number;
  /** Interrupções descartadas por serem eco do altifalante. */
  interrupcoesIgnoradas: number;
  /** `true` se o contexto de saída esteve suspenso em algum momento. */
  contextoSuspenso: boolean;
  /** Estado actual do AudioContext de saída. */
  estadoSaida: string;
  /** Último aviso relevante ('' se não houve). */
  ultimoAviso: string;
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
    userName,
    userAddress,
    userLocation,
    hasActiveRide,
    voiceName = 'Aoede',
    languageCode = 'pt-PT',
    callbacks,
  } = options;

  // ── Identidade da sessão (diagnóstico) ────────────────────────────────────
  //  Cada arranque recebe um `sid`. Se em qualquer momento existirem dois `sid`
  //  vivos, há duas sessões Live a falar ao mesmo tempo — é essa a assinatura
  //  da duplicação. Os contadores dizem-no sem ser preciso ler mais nada.
  const sid = kazeDiagNovoSessionId();
  kazeDiagContadores.liveArranques += 1;
  kazeDiagContadores.liveVivas += 1;
  kazeDiag('live:arranque', {
    sid,
    origem: 'live',
    arranques: kazeDiagContadores.liveArranques,
    vivas: kazeDiagContadores.liveVivas,
    voz: voiceName,
  });

  // ── 0. Pré-condições do browser ───────────────────────────────────────────
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    kazeDiagContadores.liveVivas -= 1;
    kazeDiag('live:arranque_falhou', { sid, origem: 'live', motivo: 'sem getUserMedia' });
    throw new Error('Este dispositivo não suporta captura de microfone.');
  }

  // ── 0b. Contextos de áudio — criados JÁ, antes de qualquer await ─────────
  //  A política de autoplay dos browsers só deixa criar/retomar um AudioContext
  //  durante um gesto do utilizador. `startKazeLiveSession` é chamada a partir
  //  de um clique, mas o `await import(...)` do SDK (~400 kB) e o pedido do
  //  token à rede levam segundos — em Safari o gesto expira pelo caminho e o
  //  contexto de SAÍDA ficava `suspended` para sempre.
  //
  //  Sintoma exacto: o servidor envia o áudio, o browser aceita os pacotes,
  //  a transcrição aparece no ecrã — e não se ouve nada, sem um único erro na
  //  consola. Criar os contextos aqui, de forma síncrona, é o que garante que
  //  nascem dentro do gesto.
  //
  //  Entrada: 16 kHz para o formato exigido pela Live API.
  //  Saída:   24 kHz para reproduzir o que o modelo devolve.
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Este browser não suporta processamento de áudio.');
  }

  const inputCtx = new AudioContextClass({ sampleRate: INPUT_SAMPLE_RATE });
  const outputCtx = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });
  kazeDiagContadores.audioCtxCriados += 2;
  kazeDiag('live:audioctx_criados', {
    sid,
    origem: 'live',
    quantos: 2,
    total_acumulado: kazeDiagContadores.audioCtxCriados,
    entrada: inputCtx.state,
    saida: outputCtx.state,
  });

  const actualInputRate = inputCtx.sampleRate;

  // Ganho mestre a 1. Existe para o caminho fonte -> ganho -> destino estar
  // sempre montado num único sítio (e para um mudo futuro ser uma linha).
  const masterGain = outputCtx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(outputCtx.destination);

  /** Retoma os dois contextos e diz se o de SAÍDA ficou mesmo a correr. */
  const garantirAudioActivo = async (): Promise<boolean> => {
    if (inputCtx.state === 'suspended') await inputCtx.resume().catch(() => {});
    if (outputCtx.state === 'suspended') await outputCtx.resume().catch(() => {});
    return outputCtx.state === 'running';
  };

  // Desbloqueio clássico para iOS: reproduzir um buffer de 1 amostra dentro do
  // gesto marca o contexto como autorizado. Sem isto o primeiro som real pode
  // ser descartado pelo sistema, e os seguintes também.
  try {
    const unlock = outputCtx.createBufferSource();
    unlock.buffer = outputCtx.createBuffer(1, 1, OUTPUT_SAMPLE_RATE);
    unlock.connect(masterGain);
    unlock.start(0);
  } catch { /* cosmético — não pode impedir a sessão */ }

  const audioLibertado = await garantirAudioActivo();
  if (!audioLibertado) {
    // Não desistimos: `enqueueAudio` volta a tentar retomar no primeiro bloco.
    // Registar aqui é o que permite distinguir este caso nos diagnósticos.
    console.warn(
      '[kazeLiveClient] Saída de áudio suspensa logo no arranque — retomada tentada no primeiro bloco.',
    );
  }

  // ── 0c. Carregar o SDK só agora ───────────────────────────────────────────
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
    model = (res as { model?: string }).model ?? 'gemini-3.8-live';
    if (!token) throw new Error('O servidor não devolveu um token de voz.');
  } catch (err) {
    // Os contextos já existem — fechá-los antes de desistir.
    void inputCtx.close().catch(() => {});
    void outputCtx.close().catch(() => {});
    const msg = err instanceof Error ? err.message : 'Serviço de voz indisponível.';
    throw new Error(`Não foi possível iniciar a voz do Kaze. ${msg}`);
  }

  // ── 3. Estado da sessão ───────────────────────────────────────────────────
  let closed = false;
  let micEnabled = true;
  let resumptionHandle: string | null = null;

  // Reprodução: fila sequencial + controlo de barge-in
  let nextPlayTime = 0;
  const activeSources = new Set<AudioBufferSourceNode>();
  let speaking = false;

  // ── Identificadores para o diagnóstico ────────────────────────────────────
  //  `turn` conta os turnos de conversa desta sessão; `resp` conta os blocos de
  //  áudio. Se um turno trouxer blocos com `resp` a recomeçar do 1, é sinal de
  //  que o mesmo turno foi processado duas vezes.
  let turn = 0;
  let resp = 0;

  // ── Diagnóstico ───────────────────────────────────────────────────────────
  //  Sem isto, "não se ouve nada" é indistinguível entre: o servidor não mandou
  //  áudio, o browser bloqueou a saída, ou o barge-in cortou tudo. Estes
  //  números são expostos por `getAudioStats()` e mostrados na interface.
  const stats = {
    blocosRecebidos: 0,
    bytesRecebidos: 0,
    blocosReproduzidos: 0,
    interrupcoes: 0,
    interrupcoesIgnoradas: 0,
    contextoSuspenso: false,
    ultimoAviso: '' as string,
  };
  let jaAvisouBloqueio = false;
  let inicioFalaAtual = 0;

  /** Instante em que a fala actual começou (0 = não está a falar). */
  const registarInicioFala = () => {
    if (inicioFalaAtual === 0) inicioFalaAtual = Date.now();
  };

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
    inicioFalaAtual = 0;
    setSpeaking(false);
  };

  /**
   * O `interrupted` do servidor é barge-in a sério, ou é o microfone a ouvir o
   * próprio altifalante?
   *
   * O `echoCancellation` do browser ajuda, mas em telemóvel com o volume alto
   * não chega: o Kaze começa a falar, o mic capta a voz dele, o servidor conclui
   * "o utilizador interrompeu" e o cliente corta o áudio. Repetido a cada turno,
   * o resultado é um Kaze sempre mudo que responde só por escrito — exactamente
   * o sintoma reportado.
   *
   * Uma interrupção nos primeiros 400 ms de fala é eco, não intenção: ninguém
   * interrompe antes de ter ouvido o que quer que seja.
   */
  const interrupcaoEhEco = (): boolean =>
    inicioFalaAtual > 0 && Date.now() - inicioFalaAtual < 400;

  /** Descarrega e agenda um bloco de PCM 24 kHz vindo do modelo. */
  const enqueueAudio = (base64: string) => {
    if (closed) return;
    try {
      const bytes = base64ToBytes(base64);
      stats.blocosRecebidos += 1;
      stats.bytesRecebidos += bytes.byteLength;

      // O buffer pode ter comprimento ímpar se houver padding; truncar é seguro.
      const usable = bytes.byteLength - (bytes.byteLength % 2);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);

      const floats = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) floats[i] = (pcm[i] ?? 0) / 32768;

      const buffer = outputCtx.createBuffer(1, floats.length, OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(floats, 0);

      const src = outputCtx.createBufferSource();
      src.buffer = buffer;
      // Pelo ganho mestre, não directo ao destino: assim há um só ponto onde o
      // caminho pode ser quebrado (ou silenciado), e é fácil de inspeccionar.
      src.connect(masterGain);
      src.onended = () => {
        activeSources.delete(src);
        if (activeSources.size === 0) {
          setSpeaking(false);
          inicioFalaAtual = 0;
        }
        kazeDiag('live:fonte_terminada', {
          sid,
          origem: 'live',
          turn,
          resp,
          fontes: kazeDiagFontes(0, activeSources.size).live,
        });
      };

      // Agenda em sequência para não haver sobreposição nem buracos.
      const startAt = Math.max(outputCtx.currentTime, nextPlayTime);
      src.start(startAt);
      nextPlayTime = startAt + buffer.duration;
      activeSources.add(src);
      stats.blocosReproduzidos += 1;
      registarInicioFala();
      setSpeaking(true);

      resp += 1;
      kazeDiagContadores.liveBlocos += 1;
      kazeDiag('live:audio_bloco', {
        sid,
        origem: 'live',
        turn,
        resp,
        bytes: bytes.byteLength,
        duracao_s: Number(buffer.duration.toFixed(2)),
        fontes_live: activeSources.size,
        // Se o TTS do chat estiver a tocar ao mesmo tempo que isto, é aqui que
        // se vê: `sobrepostas` só é verdadeiro quando os dois grafos tocam juntos.
        ...kazeDiagFontes(0, activeSources.size),
      });

      // Aviso único: chegou áudio mas o browser não o vai tocar. É a única
      // falha desta cadeia que é silenciosa por natureza — por isso é a única
      // que vale a pena reportar ao utilizador.
      if (outputCtx.state !== 'running' && !jaAvisouBloqueio) {
        stats.contextoSuspenso = true;
        stats.ultimoAviso = 'O browser bloqueou a saída de áudio.';
        jaAvisouBloqueio = true;
        void garantirAudioActivo().then((activo) => {
          if (!activo) callbacks.onError?.(stats.ultimoAviso);
        });
      }
    } catch (err) {
      console.warn('[kazeLiveClient] Falha ao enfileirar áudio:', err);
      stats.ultimoAviso = 'Falha ao processar o áudio recebido.';
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

  // Bloco de contexto real (nome + localização + corrida activa). Vive em
  // kazeAppAgent para que os três caminhos do Kaze — voz, Gemini texto e
  // OpenAI-compatible texto — enviem exactamente a mesma informação. Antes
  // estava duplicado aqui e nos outros dois, e um deles esquecia o bloco da
  // corrida activa.
  const contextoReal = blocoDeContexto({ userName, userAddress, userLocation, hasActiveRide });

  const conexao = ai.live.connect({
    model,
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: {
        parts: [{ text: `${KAZE_AGENT_SYSTEM_PROMPT}${contextoReal}` }],
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
        kazeDiagContadores.liveAbertas += 1;
        kazeDiag('live:ws_aberto', {
          sid,
          origem: 'live',
          abertas: kazeDiagContadores.liveAbertas,
          vivas: kazeDiagContadores.liveVivas,
        });
        // O socket abriu — vale a pena voltar a confirmar que a SAÍDA está
        // viva. Se o browser a tiver suspenso entretanto, é aqui que se
        // recupera, antes de chegar o primeiro bloco de áudio.
        void garantirAudioActivo().then((activo) => {
          stats.contextoSuspenso = !activo;
          if (!activo) {
            stats.ultimoAviso = 'O browser bloqueou a saída de áudio.';
            console.warn('[kazeLiveClient] Contexto de saída suspenso no arranque da sessão.');
          }
        });
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
          kazeDiagContadores.toolCalls += toolCalls.length;
          kazeDiag('live:toolcalls_recebidas', {
            sid,
            origem: 'live',
            turn,
            quantas: toolCalls.length,
            nomes: toolCalls.map((c) => c.name).join(','),
            ids: toolCalls.map((c) => c.id).join(','),
            total: kazeDiagContadores.toolCalls,
          });
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
              kazeDiagContadores.toolResponses += responses.length;
              kazeDiag('live:toolresponses_enviadas', {
                sid,
                origem: 'live',
                turn,
                quantas: responses.length,
                ids: responses.map((r) => r.id).join(','),
                total: kazeDiagContadores.toolResponses,
              });
            } catch (err) {
              console.warn('[kazeLiveClient] Falha ao devolver tool response:', err);
            }
          })();
        }

        // ── Conteúdo do servidor ──────────────────────────────────────────
        const content = message.serverContent;
        if (!content) return;

        // Barge-in: o utilizador falou por cima → cortar imediatamente.
        // A não ser que seja eco do altifalante — cortar aí é o que deixava o
        // Kaze mudo (ver `interrupcaoEhEco`).
        if (content.interrupted) {
          if (interrupcaoEhEco()) {
            stats.interrupcoesIgnoradas += 1;
            console.info('[kazeLiveClient] Interrupção ignorada: eco nos primeiros 400 ms.');
          } else {
            stats.interrupcoes += 1;
            flushPlayback();
            callbacks.onInterrupted?.();
          }
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
          turn += 1;
          kazeDiag('live:turno_completo', {
            sid,
            origem: 'live',
            turn,
            blocos_no_turno: resp,
            fontes_live: activeSources.size,
          });
          resp = 0;
          callbacks.onTurnComplete?.();
        }
      },

      onerror: (e) => {
        if (closed) return;
        console.warn('[kazeLiveClient] Erro no WebSocket:', e);
        kazeDiag('live:ws_erro', { sid, origem: 'live', erro: String(e).slice(0, 160) });
        callbacks.onError?.('A ligação de voz teve um problema.');
      },

      onclose: (e) => {
        if (closed) return;
        // 1000 = fecho normal; qualquer outro código é anómalo.
        if (e?.code && e.code !== 1000) {
          console.warn('[kazeLiveClient] Sessão fechada pelo servidor:', e.code, e.reason);
        }
        kazeDiag('live:ws_fechado', {
          sid,
          origem: 'live',
          codigo: e?.code ?? null,
          ctxEntrada: inputCtx.state,
          ctxSaida: outputCtx.state,
          fontes_por_tocar: activeSources.size,
          vivas: kazeDiagContadores.liveVivas,
        });
        flushPlayback();
        // ── Limpeza que faltava ─────────────────────────────────────────────
        //  Quando é o SERVIDOR a fechar (fim do tempo de vida da sessão, rede a
        //  cair, erro), este caminho corria sem fechar os AudioContext — só o
        //  `close()` do handle o fazia, e ninguém o chama porque a sessão
        //  deixou de estar na ref. Cada fecho destes deixava 2 contextos
        //  abertos. Os browsers limitam o número de AudioContexts por página
        //  (~6 no Chrome): ao fim de poucas sessões o áudio deixa de funcionar
        //  por completo, sem erro que o explique.
        //
        //  ⚠️ Não chamar `stopMic()` aqui: está declarado DEPOIS do
        //  `await ai.live.connect(...)`, por isso um fecho que chegue durante
        //  esse `await` encontrá-lo-ia ainda por inicializar e rebentava com
        //  um ReferenceError. `micStream` é declarado antes, e é o que basta.
        try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* já parado */ }
        micStream = null;
        micProcessor = null;
        micSource = null;
        micMute = null;
        void inputCtx.close().catch(() => {});
        void outputCtx.close().catch(() => {});
        kazeDiagContadores.liveVivas -= 1;
        closed = true;
        callbacks.onClose?.();
      },
    },
  });

  // ── 4b. Esperar pela sessão COM prazo ─────────────────────────────────────
  //  Sem isto, um handshake que não completa deixava o arranque pendurado para
  //  sempre (ver `CONNECT_TIMEOUT_MS`). Se o prazo estourar, fechamos os dois
  //  contextos e lançamos — assim o mascote mostra o erro e abre o cadeado.
  let expirou = false;
  const session = await (async () => {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        conexao,
        new Promise<never>((_, reject) => {
          temporizador = setTimeout(() => {
            expirou = true;
            reject(new Error(
              'O servidor de voz não respondeu a tempo. Verifica a ligação e tenta outra vez.',
            ));
          }, CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      void inputCtx.close().catch(() => {});
      void outputCtx.close().catch(() => {});
      throw err;
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  })();

  // Uma ligação que chegue DEPOIS de termos desistido não pode ficar viva sem
  // ninguém a apontar para ela — microfone e contexto próprios, a falar por
  // cima da tentativa seguinte.
  void conexao
    .then((s) => {
      if (expirou) {
        kazeDiag('live:conexao_tardia_fechada', { sid, origem: 'live' });
        try { s.close(); } catch { /* já fechada */ }
      }
    })
    .catch(() => { /* o erro já foi tratado acima */ });

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
      if (closed) {
        kazeDiag('live:close_repetido', { sid, origem: 'live' });
        return;
      }
      closed = true;
      kazeDiagContadores.liveFechadas += 1;
      kazeDiagContadores.liveVivas -= 1;
      kazeDiag('live:close', {
        sid,
        origem: 'live',
        turn,
        fontes_por_tocar: activeSources.size,
        fechadas: kazeDiagContadores.liveFechadas,
        vivas: kazeDiagContadores.liveVivas,
      });
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

    getAudioStats(): KazeAudioStats {
      return {
        blocosRecebidos: stats.blocosRecebidos,
        bytesRecebidos: stats.bytesRecebidos,
        blocosReproduzidos: stats.blocosReproduzidos,
        // 24 kHz, 16-bit mono = 48 000 bytes por segundo.
        segundosRecebidos: Number((stats.bytesRecebidos / 48_000).toFixed(2)),
        interrupcoes: stats.interrupcoes,
        interrupcoesIgnoradas: stats.interrupcoesIgnoradas,
        contextoSuspenso: stats.contextoSuspenso,
        estadoSaida: outputCtx.state,
        ultimoAviso: stats.ultimoAviso,
      };
    },
  };
}
