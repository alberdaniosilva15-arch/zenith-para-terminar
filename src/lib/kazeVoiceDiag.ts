// =============================================================================
// kazeVoiceDiag.ts — Registo de eventos da voz, só para diagnóstico
// =============================================================================
//
// Existe para responder a UMA pergunta com números em vez de opinião:
// **porque é que se ouve mais do que uma voz ao mesmo tempo?**
//
// O que este módulo NÃO faz:
//   · não decide nada — não bloqueia, não corta, não altera o áudio;
//   · não guarda referências a nós de áudio nem impede o garbage collector;
//   · não substitui o `console` nem intercepta nada globalmente.
//
// É um caderno de apontamentos. Cada ponto instrumentado escreve aqui uma linha
// e segue exactamente como seguia antes.
//
// Vocabulário dos campos, para as linhas poderem ser comparadas entre si:
//
//   sid        sessionId   — identifica UMA sessão Live. Duas sessões vivas com
//                            `sid` diferentes é a assinatura da duplicação.
//   turn       turnId      — um turno de conversa (a pergunta + a resposta).
//   resp       responseId  — um bloco de áudio dentro de um turno.
//   origem     origem      — quem produziu o som: 'live' ou 'tts'.
//   fontes     nº de fontes de áudio a tocar NAQUELE instante, por grafo.
//
// A leitura que interessa: se `fontes.tts > 0` E `fontes.live > 0` no mesmo
// instante, há duas vozes a tocar em simultâneo — é essa a prova.

export interface KazeDiagEvento {
  n: number;      // sequência global, para ordenar sem depender do relógio
  ms: number;     // milissegundos desde o início da recolha
  ev: string;     // nome do evento
  [campo: string]: unknown;
}

const LIMITE = 1200;
const eventos: KazeDiagEvento[] = [];
let seq = 0;
let t0 = Date.now();

/** Contadores acumulados. Números redondos são mais fáceis de comparar que logs. */
export const kazeDiagContadores = {
  /** Sessões Live cujo arranque começou (antes de se saber se ligam). */
  liveArranques: 0,
  /** Sessões Live que chegaram a abrir o WebSocket. */
  liveAbertas: 0,
  /** Sessões Live fechadas pelo `close()` do handle. */
  liveFechadas: 0,
  /** Arranques menos fechos — se for > 1 no fim, houve fuga. */
  liveVivas: 0,
  /** AudioContexts criados. O `kazeVoice` deve ter 1; cada Live cria 2. */
  audioCtxCriados: 0,
  /** Vezes que uma fala do chat (Gemini TTS) começou a tocar. */
  ttsReproducoes: 0,
  /** Blocos de áudio recebidos do Live. */
  liveBlocos: 0,
  /** functionCalls recebidas do modelo. */
  toolCalls: 0,
  /** functionResponses enviadas de volta. */
  toolResponses: 0,
  /** Vezes que o `kazeSpeak` foi travado por já haver Live a falar. */
  ttsTravadoPorLive: 0,
};

/** Escreve um evento. Devolve-o, para quem quiser encadear. */
export function kazeDiag(ev: string, dados: Record<string, unknown> = {}): KazeDiagEvento {
  const evento: KazeDiagEvento = { n: ++seq, ms: Date.now() - t0, ev, ...dados };
  eventos.push(evento);
  if (eventos.length > LIMITE) eventos.shift();
  try {
    console.log('[KAZE DIAG] ' + JSON.stringify(evento));
  } catch {
    // Um evento com um valor não serializável não pode derrubar a voz.
  }
  return evento;
}

/** Cópia da recolha. Cópia porque quem lê não deve poder alterar o registo. */
export function kazeDiagRecolha(): KazeDiagEvento[] {
  return eventos.slice();
}

/** Repõe a recolha. Útil para marcar o instante em que o teste começa. */
export function kazeDiagLimpar(): void {
  eventos.length = 0;
  seq = 0;
  t0 = Date.now();
}

/** Identificador curto e legível de sessão — cabe numa linha de log. */
export function kazeDiagNovoSessionId(): string {
  return 'S' + Math.random().toString(36).slice(2, 7);
}

/**
 * Fotografia do que está a tocar neste instante, nos dois grafos de áudio.
 *
 * Recebe os tamanhos por parâmetro em vez de os ir buscar: este módulo não
 * conhece (nem deve conhecer) os módulos de áudio, senão criava o ciclo
 * `kazeVoiceDiag → kazeVoice → kazeVoiceDiag`.
 */
export function kazeDiagFontes(tts: number, live: number): { tts: number; live: number; sobrepostas: boolean } {
  return { tts, live, sobrepostas: tts > 0 && live > 0 };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__kazeDiag = {
    recolha: kazeDiagRecolha,
    limpar: kazeDiagLimpar,
    contadores: kazeDiagContadores,
  };
}
