// =============================================================================
// ZENITH RIDE — sos-escalation / logica.ts
//
// As REGRAS da escada de segurança. Este ficheiro é puro de propósito:
//   - não fala com a base de dados,
//   - não fala com o WhatsApp,
//   - não lê o relógio do sistema (o "agora" entra sempre por parâmetro).
//
// Assim consegue-se provar o comportamento com um relógio controlado, sem
// esperar 12 minutos reais para ver a escada subir os três degraus.
//
// PRINCÍPIO: o Postgres guarda estado; quem pensa é este ficheiro.
// =============================================================================

// ── Regras ───────────────────────────────────────────────────────────────────

/** Uma corrida é "longa" quando passa 1,5× a duração prevista. */
export const FACTOR_CORRIDA_LONGA = 1.5;

/**
 * Algumas corridas antigas não têm `duration_min` gravado. Sem previsão não há
 * ×1,5 que valha — usa-se uma previsão conservadora de 45 min (corrida típica
 * em Luanda), o que dá um aviso aos 67,5 min. Melhor avisar tarde do que nunca.
 */
export const DURACAO_PREVISTA_FALLBACK_MIN = 45;

/** Quanto tempo o passageiro tem para responder "está tudo bem?". */
export const ESPERA_RESPOSTA_MS = 2 * 60 * 1000;

/** Depois do aviso ao admin, quanto se espera antes de envolver o contacto. */
export const ESPERA_WHATSAPP_MS = 10 * 60 * 1000;

/**
 * Se o passageiro respondeu que NÃO está bem, esperar 10 minutos é demasiado.
 * Dois minutos é o tempo de o admin pegar no telefone.
 */
export const ESPERA_WHATSAPP_RESPOSTA_NEGATIVA_MS = 2 * 60 * 1000;

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface CorridaParaVigiar {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  origin_address: string | null;
  dest_address: string | null;
  started_at: string | null;
  duration_min: number | null;
  origin_lat: number | null;
  origin_lng: number | null;
}

export type EstadoEscada =
  | 'pergunta'
  | 'estou_bem'
  | 'alerta_admin'
  | 'whatsapp_enviado'
  | 'fechado';

/** Degraus em que a escada ainda está a decorrer. */
export const ESTADOS_ABERTOS: readonly EstadoEscada[] = [
  'pergunta',
  'alerta_admin',
  'whatsapp_enviado',
];

export function estaAberta(estado: EstadoEscada): boolean {
  return ESTADOS_ABERTOS.includes(estado);
}

export interface Escada {
  id: string;
  ride_id: string;
  passenger_id: string;
  driver_id: string | null;
  estado: EstadoEscada;
  asked_at: string;
  answer_deadline: string;
  answered_at: string | null;
  answer: string | null;
  admin_alerted_at: string | null;
  admin_alert_id: string | null;
  whatsapp_deadline: string | null;
  whatsapp_sent_at: string | null;
}

export interface DadosDaMensagem {
  nomePassageiro: string;
  telefonePassageiro: string | null;
  nomeMotorista: string;
  marcaModelo: string | null;
  cor: string | null;
  matricula: string | null;
  origem: string | null;
  destino: string | null;
  horaPartida: string | null;
  duracaoPrevistaMin: number;
  minutosDecorridos: number;
  lat: number | null;
  lng: number | null;
  horaDoPonto: string | null;
  motivo: 'sem_resposta' | 'respondeu_nao';
}

export interface AvisoAdmin {
  user_id: string;
  ride_id: string;
  driver_name: string | null;
  severity: 'high' | 'critical';
  lat: number | null;
  lng: number | null;
  motivo: 'sem_resposta' | 'respondeu_nao';
}

/**
 * O que o painel de admin vê. A severidade sobe quando o passageiro respondeu
 * que não está bem — nesse caso não é um alarme de silêncio, é uma pessoa a
 * dizer que precisa de ajuda.
 */
export function montarAvisoAdmin(
  escada: Pick<Escada, 'ride_id' | 'passenger_id'>,
  motivo: 'sem_resposta' | 'respondeu_nao',
  nomeMotorista: string | null,
  ponto: { lat: number; lng: number } | null,
): AvisoAdmin {
  return {
    user_id: escada.passenger_id,
    ride_id: escada.ride_id,
    driver_name: nomeMotorista,
    severity: motivo === 'respondeu_nao' ? 'critical' : 'high',
    lat: ponto?.lat ?? null,
    lng: ponto?.lng ?? null,
    motivo,
  };
}

// ── Decisões ─────────────────────────────────────────────────────────────────

/**
 * Em que instante é que esta corrida deixa de ser "normal"?
 * Devolve `null` quando não há `started_at` — sem início não há como medir, e
 * inventar um início seria pior do que não vigiar.
 */
export function momentoDaPergunta(
  corrida: Pick<CorridaParaVigiar, 'started_at' | 'duration_min'>,
): number | null {
  if (!corrida.started_at) return null;

  const inicio = Date.parse(corrida.started_at);
  if (!Number.isFinite(inicio)) return null;

  const previsto =
    typeof corrida.duration_min === 'number' && corrida.duration_min > 0
      ? corrida.duration_min
      : DURACAO_PREVISTA_FALLBACK_MIN;

  return inicio + Math.round(previsto * FACTOR_CORRIDA_LONGA * 60_000);
}

export function duracaoPrevistaUsada(
  corrida: Pick<CorridaParaVigiar, 'duration_min'>,
): number {
  return typeof corrida.duration_min === 'number' && corrida.duration_min > 0
    ? corrida.duration_min
    : DURACAO_PREVISTA_FALLBACK_MIN;
}

/**
 * Depois de o passageiro confirmar que está bem, NÃO se volta a perguntar de
 * imediato. Se o fizéssemos, uma corrida longa tornava-se um interrogatório:
 * pergunta -> "estou bem" -> três minutos depois pergunta outra vez -> e ao fim
 * de duas voltas o admin recebia um alerta por causa de alguém que já tinha
 * dito duas vezes que estava bem. (Foi o harness que apanhou isto.)
 *
 * Volta-se a perguntar apenas quando a corrida já continuou, DEPOIS da
 * confirmação, outro período equivalente ao que era considerado normal. Quem
 * está bem há 20 minutos pode não estar aos 50.
 */
export function podeAbrirPergunta(
  corrida: Pick<CorridaParaVigiar, 'started_at' | 'duration_min'>,
  ultima: Pick<Escada, 'estado' | 'answered_at'> | null,
  agoraMs: number,
): boolean {
  const momento = momentoDaPergunta(corrida);
  if (momento === null) return false;
  if (agoraMs < momento) return false;

  if (!ultima) return true;

  // Ainda há uma escada a decorrer: não se abre outra por cima.
  if (estaAberta(ultima.estado)) return false;

  // Já houve uma confirmação. Espera-se outro período completo.
  if (ultima.estado === 'estou_bem' && ultima.answered_at) {
    const confirmadoEm = Date.parse(ultima.answered_at);
    if (Number.isFinite(confirmadoEm)) {
      const espera = Math.round(duracaoPrevistaUsada(corrida) * FACTOR_CORRIDA_LONGA * 60_000);
      return agoraMs >= confirmadoEm + espera;
    }
  }

  // Qualquer outro caso (por exemplo 'fechado'): a corrida ainda está em curso
  // e não há nada aberto, portanto volta a vigiar-se.
  return true;
}

export type AccaoEscada =
  | { accao: 'escalar_admin'; esperaWhatsAppMs: number; motivo: 'sem_resposta' | 'respondeu_nao' }
  | { accao: 'enviar_whatsapp'; motivo: 'sem_resposta' | 'respondeu_nao' }
  | { accao: 'fechar' }
  | { accao: 'nada' };

/**
 * O degrau seguinte desta escada, dado o relógio.
 * Uma escada só sobe; nunca desce, e nunca repete um degrau já dado.
 */
export function decidirEscada(escada: Escada, agoraMs: number): AccaoEscada {
  switch (escada.estado) {
    case 'pergunta': {
      const prazo = Date.parse(escada.answer_deadline);
      if (!Number.isFinite(prazo) || agoraMs < prazo) return { accao: 'nada' };
      // Ninguém respondeu dentro dos 2 minutos.
      return { accao: 'escalar_admin', esperaWhatsAppMs: ESPERA_WHATSAPP_MS, motivo: 'sem_resposta' };
    }

    case 'alerta_admin': {
      // Ainda falta avisar o admin (típico de uma resposta negativa, que salta
      // o degrau do silêncio e cai aqui directamente).
      if (escada.admin_alerted_at === null) {
        const motivo = escada.answer === 'nao_estou_bem' ? 'respondeu_nao' : 'sem_resposta';
        return {
          accao: 'escalar_admin',
          esperaWhatsAppMs:
            motivo === 'respondeu_nao'
              ? ESPERA_WHATSAPP_RESPOSTA_NEGATIVA_MS
              : ESPERA_WHATSAPP_MS,
          motivo,
        };
      }

      if (escada.whatsapp_sent_at !== null) return { accao: 'nada' };

      const motivo = escada.answer === 'nao_estou_bem' ? 'respondeu_nao' : 'sem_resposta';

      // Rede de segurança: o admin foi avisado mas o prazo do WhatsApp ficou
      // por gravar (por exemplo, se a gravação falhou a meio). Não deixar a
      // escada presa para sempre.
      if (!escada.whatsapp_deadline) {
        return { accao: 'escalar_admin', esperaWhatsAppMs: ESPERA_WHATSAPP_MS, motivo };
      }

      const prazo = Date.parse(escada.whatsapp_deadline);
      if (!Number.isFinite(prazo) || agoraMs < prazo) return { accao: 'nada' };

      return { accao: 'enviar_whatsapp', motivo };
    }

    default:
      return { accao: 'nada' };
  }
}

// ── Telefone ─────────────────────────────────────────────────────────────────

/**
 * Angola: 9 dígitos locais, com indicativo 244. Aceita "+244 923 111 222",
 * "00244923111222", "923111222".
 */
export function normalizarTelefone(valor: string): string {
  const digitos = valor.replace(/\D/g, '').replace(/^00/, '');
  return digitos.startsWith('244') ? digitos : `244${digitos}`;
}

// ── Mensagem ─────────────────────────────────────────────────────────────────

function hora(iso: string | null): string {
  if (!iso) return 'hora desconhecida';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'hora desconhecida';
  return d.toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' });
}

/**
 * A mensagem que o contacto de emergência recebe. É deliberadamente concreta:
 * quem a lê tem de conseguir perceber onde está o carro e quem o conduz, sem
 * ter de abrir mais nada.
 */
export function montarMensagemWhatsApp(dados: DadosDaMensagem): string {
  const viatura = [dados.marcaModelo, dados.cor].filter(Boolean).join(' · ');
  const identificacao = [viatura, dados.matricula].filter(Boolean).join(' · ');

  const mapa =
    typeof dados.lat === 'number' && typeof dados.lng === 'number'
      ? `https://www.google.com/maps?q=${dados.lat.toFixed(5)},${dados.lng.toFixed(5)}`
      : null;

  const contexto =
    dados.motivo === 'respondeu_nao'
      ? 'O(A) passageiro(a) respondeu na aplicação que NÃO está tudo bem.'
      : 'O(A) passageiro(a) não respondeu ao aviso de segurança da aplicação.';

  const linhas: string[] = [
    '🚨 ALERTA DE SEGURANÇA — ZENITH RIDE',
    '',
    `O(A) ${dados.nomePassageiro} entrou numa corrida que já devia ter terminado.`,
    '',
    `Partida: ${hora(dados.horaPartida)} — ${dados.origem ?? 'origem não registada'}`,
    `Destino previsto: ${dados.destino ?? 'não registado'}`,
    `Duração prevista: ${dados.duracaoPrevistaMin} min · já passaram ${dados.minutosDecorridos} min`,
    '',
    `Motorista: ${dados.nomeMotorista}`,
  ];

  if (identificacao) {
    linhas.push(`Viatura: ${identificacao}`);
  }

  linhas.push('');

  if (mapa) {
    linhas.push('📍 Última posição conhecida do carro:');
    linhas.push(mapa);
    if (dados.horaDoPonto) {
      linhas.push(`(actualizada às ${hora(dados.horaDoPonto)})`);
    }
  } else {
    linhas.push('📍 Não há posição recente do carro registada.');
  }

  linhas.push('', contexto, 'Por favor, ligue para saber se está tudo bem.');

  if (dados.telefonePassageiro) {
    linhas.push(`📞 ${dados.telefonePassageiro}`);
  }

  linhas.push('', '— Enviado automaticamente pelo sistema de segurança Zenith Ride');

  return linhas.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// ALERTAS DE PÂNICO — o áudio do grito tem de chegar ao contacto
// ═════════════════════════════════════════════════════════════════════════════
// Isto é independente da escada das corridas longas. A escada pergunta "está
// tudo bem?" a quem se atrasou; isto trata do que já é um grito ou um botão de
// pânico carregado. São dois caminhos com o mesmo destino: avisar quem pode
// ajudar.
//
// O `PanicButton` grava 30 segundos de áudio e carrega-o para o bucket privado
// `panic-audio`. O upload acontece no `onstop` do MediaRecorder — ou seja, uns
// 30 segundos DEPOIS de o alerta existir. Se avisássemos o contacto no instante
// do alerta, o link do áudio ainda não existiria.
//
// Daí `ESPERA_PARA_ANEXAR_AUDIO_MS`: damos tempo a que a gravação acabe e suba.
// Se ao fim disso não houver áudio, avisamos na mesma — um aviso sem áudio é
// muito melhor do que aviso nenhum.

/** Tentativas antes de desistir. Número errado não pode gerar ciclo infinito. */
export const MAX_TENTATIVAS_CONTACTO = 3;

/**
 * Quanto esperar, desde a criação do alerta, para dar tempo ao cliente de
 * gravar (30 s) e carregar o áudio. Com folga: 45 s.
 */
export const ESPERA_PARA_ANEXAR_AUDIO_MS = 45 * 1000;

/** Só olhamos para alertas recentes. Um alerta de ontem já não se avisa hoje. */
export const JANELA_ALERTAS_MS = 30 * 60 * 1000;

export interface AlertaParaNotificar {
  id: string;
  user_id: string;
  ride_id: string | null;
  severity: string;
  source: string;
  created_at: string;
  lat: number | null;
  lng: number | null;
  driver_name: string | null;
  audio_storage_path: string | null;
  contact_phone: string | null;
  contact_notified_at: string | null;
  contact_attempts: number;
}

/**
 * Decide se um alerta de pânico já deve ser levado ao contacto de emergência.
 *
 * Regras, por ordem:
 *   1. já avisado            -> não
 *   2. tentativas esgotadas  -> não (desistimos; fica nota para o admin)
 *   3. demasiado antigo      -> não
 *   4. ainda sem tempo de ter áudio -> espera mais um pouco
 */
export function alertaPrecisaDeAviso(
  alerta: AlertaParaNotificar,
  agoraMs: number,
): boolean {
  if (alerta.contact_notified_at !== null) return false;
  if (alerta.contact_attempts >= MAX_TENTATIVAS_CONTACTO) return false;

  const criadoMs = Date.parse(alerta.created_at);
  if (!Number.isFinite(criadoMs)) return false;

  const idade = agoraMs - criadoMs;
  if (idade > JANELA_ALERTAS_MS) return false;

  // Ainda dentro da janela de gravação e ainda sem áudio: esperar. Assim o
  // primeiro aviso já leva o link, em vez de sair sem ele.
  if (idade < ESPERA_PARA_ANEXAR_AUDIO_MS && !alerta.audio_storage_path) {
    return false;
  }

  return true;
}

export interface DadosDaMensagemDePanico {
  nomePassageiro: string | null;
  nomeMotorista: string | null;
  origem: string | null;
  destino: string | null;
  lat: number | null;
  lng: number | null;
  /** Link assinado do áudio. `null` se ainda não houver gravação. */
  linkDoAudio: string | null;
  /** true quando foi um grito ou a palavra "socorro", sem o passageiro tocar. */
  foiAutomatico: boolean;
  telefonePassageiro: string | null;
}

export function montarMensagemDePanico(dados: DadosDaMensagemDePanico): string {
  const mapa =
    typeof dados.lat === 'number' && typeof dados.lng === 'number'
      ? `https://www.google.com/maps?q=${dados.lat.toFixed(5)},${dados.lng.toFixed(5)}`
      : null;

  const linhas: string[] = ['🚨 PEDIDO DE AJUDA — ZENITH RIDE', ''];

  if (dados.foiAutomatico) {
    linhas.push(
      `O sistema detectou um grito ou um pedido de ajuda no telemóvel de ${dados.nomePassageiro ?? 'um passageiro'} durante uma corrida.`,
      'Não houve confirmação do passageiro — o alerta foi automático.',
    );
  } else {
    linhas.push(
      `${dados.nomePassageiro ?? 'O(A) passageiro(a)'} accionou o botão de emergência durante uma corrida.`,
    );
  }

  linhas.push('');

  if (dados.origem || dados.destino) {
    linhas.push(
      `Trajecto: ${dados.origem ?? 'origem não registada'} → ${dados.destino ?? 'destino não registado'}`,
    );
  }
  if (dados.nomeMotorista) {
    linhas.push(`Motorista: ${dados.nomeMotorista}`);
  }

  linhas.push('');

  if (mapa) {
    linhas.push('📍 Onde estava no momento do alerta:', mapa);
  } else {
    linhas.push('📍 Não foi possível obter a localização no momento do alerta.');
  }

  linhas.push('');

  if (dados.linkDoAudio) {
    linhas.push(
      '🎧 Ouça o que se estava a passar (gravação de 30 segundos):',
      dados.linkDoAudio,
      '(O link expira. Guarde o áudio se precisar dele.)',
    );
  } else {
    linhas.push('🎧 Não há gravação disponível para este alerta.');
  }

  linhas.push('', 'Por favor, ligue para saber se está tudo bem.');

  if (dados.telefonePassageiro) {
    linhas.push(`📞 ${dados.telefonePassageiro}`);
  }

  linhas.push('', '— Enviado automaticamente pelo sistema de segurança Zenith Ride');

  return linhas.join('\n');
}
