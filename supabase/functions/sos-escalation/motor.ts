// =============================================================================
// ZENITH RIDE — sos-escalation / motor.ts
//
// A escada de segurança, passo a passo. Toda a lógica está AQUI — o Postgres
// guarda estado e o pg_net toca a campainha, mas quem decide é este ficheiro.
//
// Recebe uma `Porta` (as operações de que precisa) em vez de falar directamente
// com o Supabase. Isso permite correr a escada inteira contra uma base de dados
// de mentira, com o relógio controlado, e ver os degraus a subir em segundos.
//
// Um ciclo completo (chamado de minuto a minuto):
//   1. Fechar as escadas de corridas que já terminaram.
//   2. Abrir a pergunta "está tudo bem?" nas corridas que passaram 1,5× o previsto.
//   3. Subir o degrau de quem já passou o prazo: avisar o admin, e depois o
//      contacto de emergência.
//   4. Levar os alertas de pânico (grito, "socorro", botão) ao contacto de
//      emergência, com o link do áudio gravado.
// =============================================================================

import {
  alertaExpirou,
  alertaPrecisaDeAviso,
  decidirEscada,
  duracaoPrevistaUsada,
  momentoDaPergunta,
  montarAvisoAdmin,
  montarMensagemDePanico,
  montarMensagemWhatsApp,
  normalizarTelefone,
  podeAbrirPergunta,
  ESPERA_RESPOSTA_MS,
  MAX_TENTATIVAS_CONTACTO,
  type AlertaParaNotificar,
  type CorridaParaVigiar,
  type Escada,
  type EstadoEscada,
} from './logica.ts';

// ── Porta (tudo o que o motor precisa do mundo exterior) ─────────────────────

export interface Perfil {
  user_id: string;
  name: string | null;
  phone: string | null;
  emergency_contact_phone: string | null;
}

export interface Viatura {
  car_brand: string | null;
  car_model: string | null;
  car_color: string | null;
  car_plate: string | null;
}

export interface Ponto {
  lat: number;
  lng: number;
  recorded_at: string;
}

export interface NovaEscada {
  ride_id: string;
  passenger_id: string;
  driver_id: string | null;
  estado: EstadoEscada;
  answer_deadline: string;
}

export interface MudancasEscada {
  estado?: EstadoEscada;
  admin_alerted_at?: string;
  admin_alert_id?: string | null;
  whatsapp_deadline?: string | null;
  whatsapp_sent_at?: string;
  last_lat?: number | null;
  last_lng?: number | null;
  nota?: string;
}

export interface Porta {
  listarCorridasEmCurso(): Promise<CorridaParaVigiar[]>;
  /**
   * TODAS as escadas abertas, de qualquer corrida — incluindo as de corridas
   * que já terminaram. É de propósito que não se filtra por corrida em curso:
   * se se filtrasse, uma escada cuja corrida acabou ficava aberta para sempre
   * e o passageiro continuava a ver a pergunta na app. (O harness apanhou isto.)
   */
  listarEscadasAbertas(): Promise<Escada[]>;
  /**
   * Todas as escadas (abertas OU já resolvidas) destas corridas, da mais
   * recente para a mais antiga. É preciso ver as resolvidas para saber se o
   * passageiro já confirmou que estava bem — sem isso voltar-se-ia a perguntar
   * logo a seguir a uma confirmação.
   */
  listarEscadasDasCorridas(rideIds: string[]): Promise<Escada[]>;
  lerPerfil(userId: string): Promise<Perfil | null>;
  lerViatura(driverId: string): Promise<Viatura | null>;
  lerUltimoPonto(rideId: string): Promise<Ponto | null>;
  criarEscada(linha: NovaEscada): Promise<void>;
  actualizarEscada(id: string, mudancas: MudancasEscada): Promise<void>;
  criarAvisoAdmin(aviso: ReturnType<typeof montarAvisoAdmin>): Promise<string | null>;
  enviarWhatsApp(telefone: string, texto: string): Promise<boolean>;

  // ── Alertas de pânico (passo 4) ──────────────────────────────────────────
  /** Alertas recentes ainda por avisar ao contacto. Já filtrados por idade. */
  listarAlertasPorAvisar(): Promise<AlertaParaNotificar[]>;
  /**
   * Alertas que já NÃO vão ser avisados: ou se esgotaram as tentativas, ou
   * passou a janela inteira. Servem para os fechar com nota, em vez de os
   * deixar a apodrecer no painel como `active` para sempre.
   */
  listarAlertasExpirados(): Promise<AlertaParaNotificar[]>;
  /** Dados da corrida para dar contexto à mensagem. */
  lerCorrida(rideId: string): Promise<{ origem: string | null; destino: string | null } | null>;
  /**
   * Link assinado e temporário para o áudio. O bucket `panic-audio` é privado,
   * logo um URL directo não abre — o contacto tem de receber um link assinado.
   * Devolve `null` se não houver áudio ou se a assinatura falhar.
   */
  criarLinkDoAudio(caminho: string): Promise<string | null>;
  actualizarAlerta(id: string, mudancas: MudancasAlerta): Promise<void>;
}

export interface MudancasAlerta {
  contact_phone?: string | null;
  contact_notified_at?: string | null;
  contact_attempts?: number;
  contact_last_error?: string | null;
  /**
   * ⚠️ Existe para o FECHO dos alertas que já não vão ser avisados. Só se
   * escreve `'expired'` — os outros estados são do admin ou do próprio fluxo.
   */
  status?: 'expired';
}

export interface Relatorio {
  corridasEmCurso: number;
  semInicio: number;
  perguntasAbertas: number;
  escalados: number;
  whatsappsEnviados: number;
  semContacto: number;
  whatsappsFalhados: number;
  fechados: number;
  /** Passo 4 — alertas de pânico. */
  alertasVistos: number;
  alertasNotificados: number;
  alertasSemContacto: number;
  alertasFalhados: number;
  alertasComAudio: number;
  /** Passo 5 — alertas que já não vão ser avisados e foram fechados. */
  alertasExpirados: number;
  erros: string[];
}

function relatorioVazio(): Relatorio {
  return {
    corridasEmCurso: 0,
    semInicio: 0,
    perguntasAbertas: 0,
    escalados: 0,
    whatsappsEnviados: 0,
    semContacto: 0,
    whatsappsFalhados: 0,
    fechados: 0,
    alertasVistos: 0,
    alertasNotificados: 0,
    alertasSemContacto: 0,
    alertasFalhados: 0,
    alertasComAudio: 0,
    alertasExpirados: 0,
    erros: [],
  };
}

// ── O ciclo ──────────────────────────────────────────────────────────────────

export async function correrEscada(porta: Porta, agoraMs: number): Promise<Relatorio> {
  const rel = relatorioVazio();

  const emCurso = await porta.listarCorridasEmCurso();
  rel.corridasEmCurso = emCurso.length;

  const idsEmCurso = new Set(emCurso.map((c) => c.id));
  const porRideId = new Map(emCurso.map((c) => [c.id, c]));

  // Todas as escadas abertas, mesmo as de corridas que já terminaram — senão
  // nunca haveria quem as fechasse.
  const abertas = await porta.listarEscadasAbertas();

  // A escada mais recente de cada corrida EM CURSO (mesmo que já esteja
  // resolvida) — é o que diz se o passageiro já confirmou que estava bem.
  const dasCorridas =
    idsEmCurso.size > 0 ? await porta.listarEscadasDasCorridas([...idsEmCurso]) : [];

  const ultimaPorCorrida = new Map<string, Escada>();
  for (const escada of dasCorridas) {
    if (!ultimaPorCorrida.has(escada.ride_id)) ultimaPorCorrida.set(escada.ride_id, escada);
  }

  // ── Passo 1: fechar o que já não interessa ────────────────────────────────
  // Uma escada só faz sentido enquanto a corrida está em curso. Se a corrida
  // terminou, a pergunta desaparece da app e ninguém deve ser incomodado.
  const aindaAbertas: Escada[] = [];

  for (const escada of abertas) {
    if (idsEmCurso.has(escada.ride_id)) {
      aindaAbertas.push(escada);
      continue;
    }

    try {
      await porta.actualizarEscada(escada.id, {
        estado: 'fechado',
        nota: 'corrida terminou sem incidente registado',
      });
      rel.fechados++;
    } catch (e) {
      rel.erros.push(`fechar ${escada.id}: ${mensagemDeErro(e)}`);
    }
  }

  // ── Passo 2: abrir a pergunta nas corridas longas ────────────────────────
  for (const corrida of emCurso) {
    if (momentoDaPergunta(corrida) === null) {
      // Sem `started_at` não há como medir. Conta-se para ser visível, em vez
      // de se inventar um início.
      rel.semInicio++;
      continue;
    }

    // Já existe uma escada aberta nesta corrida: não se abre outra por cima.
    if (abertas.some((e) => e.ride_id === corrida.id)) continue;

    if (!podeAbrirPergunta(corrida, ultimaPorCorrida.get(corrida.id) ?? null, agoraMs)) {
      continue;
    }

    try {
      await porta.criarEscada({
        ride_id: corrida.id,
        passenger_id: corrida.passenger_id,
        driver_id: corrida.driver_id,
        estado: 'pergunta',
        answer_deadline: new Date(agoraMs + ESPERA_RESPOSTA_MS).toISOString(),
      });
      rel.perguntasAbertas++;
    } catch (e) {
      rel.erros.push(`abrir pergunta em ${corrida.id}: ${mensagemDeErro(e)}`);
    }
  }

  // ── Passo 3: subir o degrau de quem já passou o prazo ────────────────────
  for (const escada of aindaAbertas) {
    const decisao = decidirEscada(escada, agoraMs);
    if (decisao.accao === 'nada') continue;

    const corrida = porRideId.get(escada.ride_id);
    if (!corrida) continue;

    const ponto = await porta.lerUltimoPonto(escada.ride_id).catch(() => null);

    if (decisao.accao === 'escalar_admin') {
      try {
        const motorista = escada.driver_id ? await porta.lerPerfil(escada.driver_id).catch(() => null) : null;

        const alertId = await porta.criarAvisoAdmin(
          montarAvisoAdmin(escada, decisao.motivo, motorista?.name ?? null, ponto),
        );

        await porta.actualizarEscada(escada.id, {
          estado: 'alerta_admin',
          admin_alerted_at: new Date(agoraMs).toISOString(),
          admin_alert_id: alertId,
          whatsapp_deadline: new Date(agoraMs + decisao.esperaWhatsAppMs).toISOString(),
          last_lat: ponto?.lat ?? null,
          last_lng: ponto?.lng ?? null,
          nota:
            decisao.motivo === 'respondeu_nao'
              ? 'passageiro respondeu que nao esta bem'
              : 'sem resposta ao aviso de seguranca',
        });
        rel.escalados++;
      } catch (e) {
        rel.erros.push(`escalar ${escada.id}: ${mensagemDeErro(e)}`);
      }
      continue;
    }

    if (decisao.accao === 'enviar_whatsapp') {
      await enviarParaContacto(porta, escada, corrida, ponto, decisao.motivo, rel, agoraMs);
    }
  }

  // ── Passo 4: levar os alertas de pânico ao contacto ──────────────────────
  // Este passo é independente dos outros três. Um grito não espera que a
  // corrida seja longa: é um alerta imediato, e o áudio gravado é a única
  // prova real do que se passa. Até aqui esse áudio ficava parado no storage.
  await notificarContactos(porta, agoraMs, rel);

  // ── Passo 5: fechar o que já não vai ser avisado ─────────────────────────
  // ⚠️ Existe por causa do F6. A fila tinha prazo de 30 minutos e as três
  // tentativas gastavam-se em três — um alerta cuja primeira tentativa falhasse
  // (por exemplo, com a janela da Meta fechada) saía da fila em meia hora
  // **sem nota, sem aviso e sem nunca ser fechado**. Ficava `active` para
  // sempre a poluir o painel. Agora é fechado e diz porquê.
  await fecharAlertasExpirados(porta, agoraMs, rel);

  return rel;
}

/**
 * Fecha, com nota, os alertas que já não vão ser levados a ninguém.
 *
 * ⚠️ `expired` e **não** `false_alarm`: um alerta que não chegou ao contacto
 * não é um falso alarme — é um socorro que falhou. Marcá-lo de falso alarme
 * seria mentir no registo, e é esse registo que um dia pode valer num tribunal.
 */
async function fecharAlertasExpirados(
  porta: Porta,
  agoraMs: number,
  rel: Relatorio,
): Promise<void> {
  let alertas: AlertaParaNotificar[] = [];

  try {
    alertas = await porta.listarAlertasExpirados();
  } catch (e) {
    rel.erros.push(`listar alertas expirados: ${mensagemDeErro(e)}`);
    return;
  }

  for (const alerta of alertas) {
    if (!alertaExpirou(alerta, agoraMs)) continue;

    try {
      await porta.actualizarAlerta(alerta.id, {
        status: 'expired',
        contact_last_error:
          alerta.contact_attempts >= MAX_TENTATIVAS_CONTACTO
            ? `desistimos apos ${alerta.contact_attempts} tentativas`
            : 'fila expirada sem entrega',
      });
      rel.alertasExpirados++;
    } catch (e) {
      rel.erros.push(`fechar alerta expirado ${alerta.id}: ${mensagemDeErro(e)}`);
    }
  }
}

/**
 * Leva cada alerta de pânico recente ao contacto de emergência, com o link
 * assinado do áudio.
 *
 * Decisões importantes:
 *   • Um alerta já avisado nunca se repete — `alertaPrecisaDeAviso` trata disso.
 *   • Se o WhatsApp falhar, a tentativa CONTA e o alerta fica por avisar para o
 *     minuto seguinte. Ao fim de 3 tentativas desistimos e deixamos nota, em vez
 *     de tentar para sempre de minuto a minuto.
 *   • Sem contacto de emergência definido, marcamos como avisado com nota: não
 *     faz sentido arrastar o alerta eternamente.
 */
async function notificarContactos(
  porta: Porta,
  agoraMs: number,
  rel: Relatorio,
): Promise<void> {
  let alertas: AlertaParaNotificar[] = [];

  try {
    alertas = await porta.listarAlertasPorAvisar();
  } catch (e) {
    rel.erros.push(`listar alertas: ${mensagemDeErro(e)}`);
    return;
  }

  rel.alertasVistos = alertas.length;

  for (const alerta of alertas) {
    if (!alertaPrecisaDeAviso(alerta, agoraMs)) continue;

    let passageiro: Perfil | null = null;
    try {
      passageiro = await porta.lerPerfil(alerta.user_id);
    } catch (e) {
      rel.erros.push(`perfil ${alerta.user_id}: ${mensagemDeErro(e)}`);
    }

    // O número gravado no alerta ganha: é o retrato do momento. Só se não
    // houver nenhum é que vamos buscar o do perfil.
    //
    // ⚠️ `||` e não `??`: um `contact_phone` em branco (string vazia, que o
    // cliente pode gravar) é "não tenho número", não "tenho um número vazio".
    // Com `??` a string vazia ganhava e nunca se chegava ao perfil.
    const contacto =
      alerta.contact_phone?.trim() || passageiro?.emergency_contact_phone?.trim() || null;

    if (!contacto) {
      try {
        await porta.actualizarAlerta(alerta.id, {
          contact_notified_at: new Date(agoraMs).toISOString(),
          contact_last_error: 'sem contacto de emergencia definido',
        });
        rel.alertasSemContacto++;
      } catch (e) {
        rel.erros.push(`fechar alerta sem contacto ${alerta.id}: ${mensagemDeErro(e)}`);
      }
      continue;
    }

    // Link assinado do áudio, se já existir gravação.
    let linkDoAudio: string | null = null;
    if (alerta.audio_storage_path) {
      try {
        linkDoAudio = await porta.criarLinkDoAudio(alerta.audio_storage_path);
      } catch (e) {
        // Falhar a assinar o áudio NÃO impede o aviso — segue sem link.
        rel.erros.push(`assinar audio ${alerta.id}: ${mensagemDeErro(e)}`);
      }
      if (linkDoAudio) rel.alertasComAudio++;
    }

    let corrida: { origem: string | null; destino: string | null } | null = null;
    if (alerta.ride_id) {
      corrida = await porta.lerCorrida(alerta.ride_id).catch(() => null);
    }

    const texto = montarMensagemDePanico({
      nomePassageiro: passageiro?.name ?? null,
      telefonePassageiro: passageiro?.phone ?? null,
      nomeMotorista: alerta.driver_name,
      origem: corrida?.origem ?? null,
      destino: corrida?.destino ?? null,
      lat: alerta.lat,
      lng: alerta.lng,
      linkDoAudio,
      // 'grito' e 'escada_corrida' são automáticos; 'botao_panico' é o
      // passageiro a carregar. A distinção muda o texto: um diz "accionou o
      // botão", o outro diz "detectámos automaticamente".
      foiAutomatico: alerta.source !== 'botao_panico',
    });

    let enviado = false;
    try {
      enviado = await porta.enviarWhatsApp(normalizarTelefone(contacto), texto);
    } catch (e) {
      rel.erros.push(`whatsapp alerta ${alerta.id}: ${mensagemDeErro(e)}`);
    }

    const tentativas = alerta.contact_attempts + 1;

    try {
      if (enviado) {
        await porta.actualizarAlerta(alerta.id, {
          contact_phone: contacto,
          contact_notified_at: new Date(agoraMs).toISOString(),
          contact_attempts: tentativas,
          contact_last_error: null,
        });
        rel.alertasNotificados++;
      } else {
        // Não marcar como avisado: volta a tentar no minuto seguinte. Só o
        // contador sobe, para não ficar preso para sempre.
        await porta.actualizarAlerta(alerta.id, {
          contact_phone: contacto,
          contact_attempts: tentativas,
          contact_last_error:
            tentativas >= MAX_TENTATIVAS_CONTACTO
              ? 'desisti apos 3 tentativas'
              : 'envio falhou — nova tentativa no proximo minuto',
        });
        rel.alertasFalhados++;
      }
    } catch (e) {
      rel.erros.push(`actualizar alerta ${alerta.id}: ${mensagemDeErro(e)}`);
    }
  }
}

async function enviarParaContacto(
  porta: Porta,
  escada: Escada,
  corrida: CorridaParaVigiar,
  ponto: Ponto | null,
  motivo: 'sem_resposta' | 'respondeu_nao',
  rel: Relatorio,
  agoraMs: number,
): Promise<void> {
  let passageiro: Perfil | null = null;

  try {
    passageiro = await porta.lerPerfil(escada.passenger_id);
  } catch (e) {
    rel.erros.push(`perfil ${escada.passenger_id}: ${mensagemDeErro(e)}`);
  }

  const contacto = passageiro?.emergency_contact_phone ?? null;

  // Sem contacto de emergência não há mensagem possível. Fechar o degrau com
  // nota é melhor do que tentar para sempre de minuto a minuto.
  if (!contacto) {
    try {
      await porta.actualizarEscada(escada.id, {
        estado: 'whatsapp_enviado',
        whatsapp_sent_at: new Date(agoraMs).toISOString(),
        nota: 'sem contacto de emergencia definido — nada a enviar',
      });
      rel.semContacto++;
    } catch (e) {
      rel.erros.push(`fechar sem contacto ${escada.id}: ${mensagemDeErro(e)}`);
    }
    return;
  }

  let motorista: Perfil | null = null;
  let viatura: Viatura | null = null;

  if (escada.driver_id) {
    motorista = await porta.lerPerfil(escada.driver_id).catch(() => null);
    viatura = await porta.lerViatura(escada.driver_id).catch(() => null);
  }

  const inicioMs = corrida.started_at ? Date.parse(corrida.started_at) : NaN;

  const texto = montarMensagemWhatsApp({
    nomePassageiro: passageiro?.name ?? 'Passageiro Zenith',
    telefonePassageiro: passageiro?.phone ?? null,
    nomeMotorista: motorista?.name ?? 'Motorista',
    marcaModelo:
      [viatura?.car_brand, viatura?.car_model].filter(Boolean).join(' ') || null,
    cor: viatura?.car_color ?? null,
    matricula: viatura?.car_plate ?? null,
    origem: corrida.origin_address,
    destino: corrida.dest_address,
    horaPartida: corrida.started_at,
    duracaoPrevistaMin: duracaoPrevistaUsada(corrida),
    minutosDecorridos: Number.isFinite(inicioMs)
      ? Math.max(0, Math.round((agoraMs - inicioMs) / 60_000))
      : 0,
    lat: ponto?.lat ?? escada.last_lat ?? null,
    lng: ponto?.lng ?? escada.last_lng ?? null,
    horaDoPonto: ponto?.recorded_at ?? null,
    motivo,
  });

  let enviado = false;

  try {
    enviado = await porta.enviarWhatsApp(normalizarTelefone(contacto), texto);
  } catch (e) {
    rel.erros.push(`whatsapp ${escada.id}: ${mensagemDeErro(e)}`);
  }

  // Se o envio falhar, NÃO se marca como enviado: a passagem seguinte tenta
  // outra vez. Uma escada de segurança que desiste em silêncio não serve.
  if (!enviado) {
    rel.whatsappsFalhados++;
    await porta
      .actualizarEscada(escada.id, { nota: 'tentativa de whatsapp falhou — sera repetida' })
      .catch(() => {});
    return;
  }

  try {
    await porta.actualizarEscada(escada.id, {
      estado: 'whatsapp_enviado',
      whatsapp_sent_at: new Date(agoraMs).toISOString(),
      nota: `contacto de emergencia avisado (${motivo})`,
    });
    rel.whatsappsEnviados++;
  } catch (e) {
    rel.erros.push(`registar whatsapp ${escada.id}: ${mensagemDeErro(e)}`);
  }
}

function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
