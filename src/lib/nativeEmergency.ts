// =============================================================================
// nativeEmergency.ts — o que sai do telemóvel do passageiro
// =============================================================================
// Duas famílias de coisas, e vale a pena separá-las:
//
//   • CONSTRUIR  — a mensagem e os links (`wa.me`, `sms:`). Puro, sem efeitos.
//   • ABRIR      — levar o passageiro até ao WhatsApp/SMS. É aqui que mora o
//                  problema do F2: o browser bloqueia `window.open` quando já
//                  se perdeu o gesto do utilizador.
//
// ⚠️ O QUE NÃO SE FAZ AQUI, e porquê (aprendido à força):
//   • `window.location.href` — sai da app E aborta o `MediaRecorder`. A
//     gravação é a única prova do que se passou; navegar para fora mata-a.
//   • `window.open` depois de um `await` — bloqueado em silêncio.
//   A saída é `abrirAbaParaOWhatsApp()`, chamada SINCRONAMENTE dentro do
//   gesto, e só depois `levarAbaPara()` com o link já pronto.
//
// ⚠️ A mensagem daqui e a do servidor (`montarMensagemDePanico`, no
// `sos-escalation`) têm de dizer o mesmo. São duas cópias — está por unificar
// num módulo partilhado.
// =============================================================================
import { Capacitor } from '@capacitor/core';

/** Só dígitos, com o indicativo de Angola à frente. */
export function normalizarTelefone(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');
  return digitos.startsWith('244') ? digitos : `244${digitos}`;
}

export interface DadosDaMensagem {
  nomePassageiro?: string | null;
  nomeMotorista?: string | null;
  matricula?: string | null;
  marcaECor?: string | null;
  origem?: string | null;
  destino?: string | null;
  lat?: number | null;
  lng?: number | null;
  linkDoAudio?: string | null;
  /** O contacto deve poder ligar de volta: é isso que resolve a emergência. */
  telefonePassageiro?: string | null;
}

/**
 * A mensagem que o contacto de emergência recebe.
 * ⚠️ Gémea de `montarMensagemDePanico` (servidor). Se mudares uma, muda a outra.
 */
export function construirMensagemDeEmergencia(d: DadosDaMensagem): string {
  const linhas: string[] = [
    '🆘 ALERTA DE EMERGÊNCIA — ZENITH RIDE',
    '',
    'Preciso de ajuda urgente.',
    '',
  ];

  if (d.nomePassageiro) linhas.push(`👤 Passageiro: ${d.nomePassageiro}`);

  if (d.nomeMotorista) {
    const carro = [d.marcaECor, d.matricula].filter(Boolean).join(' · ');
    linhas.push(`🚗 Motorista: ${d.nomeMotorista}${carro ? ` (${carro})` : ''}`);
  } else if (d.matricula || d.marcaECor) {
    linhas.push(`🚗 Viatura: ${[d.marcaECor, d.matricula].filter(Boolean).join(' · ')}`);
  }

  if (d.origem || d.destino) {
    linhas.push(`📍 Rota: ${d.origem ?? '?'} → ${d.destino ?? '?'}`);
  }

  if (d.lat != null && d.lng != null) {
    linhas.push(`🗺️ https://maps.google.com/?q=${d.lat},${d.lng}`);
  } else {
    // Dizer que não há localização é melhor do que deixar o contacto a pensar
    // que o link se perdeu. Quem lê sabe que tem de ligar para saber onde está.
    linhas.push('🗺️ (sem localização — liga para saber onde estou)');
  }

  if (d.linkDoAudio) {
    linhas.push('', `🎧 Áudio do momento: ${d.linkDoAudio}`);
  }

  if (d.telefonePassageiro) {
    linhas.push('', `📞 LIGA-ME: ${d.telefonePassageiro}`);
  }

  linhas.push('', `⏰ ${new Date().toLocaleTimeString('pt-AO')}`);
  linhas.push('_Enviado automaticamente pelo Zenith Ride_');

  return linhas.join('\n');
}

export function linkDoWhatsApp(telefone: string, mensagem: string): string {
  return `https://wa.me/${normalizarTelefone(telefone)}?text=${encodeURIComponent(mensagem)}`;
}

export function linkDoSms(telefone: string, mensagem: string): string {
  return `sms:+${normalizarTelefone(telefone)}?body=${encodeURIComponent(mensagem)}`;
}

/**
 * Abre uma aba VAZIA para o WhatsApp.
 *
 * ⚠️ Tem de ser chamada **sincronamente, dentro do gesto do utilizador** (o
 * `onClick`), antes de qualquer `await`. Uma aba aberta durante um gesto fica
 * autorizada para sempre — é isso que permite dar-lhe o endereço mais tarde,
 * quando o link já existir.
 *
 * Devolve `null` quando o browser bloqueia popups de todo. Nesse caso o
 * chamador tem de mostrar o botão `<a href>` — que nunca é bloqueado.
 */
export function abrirAbaParaOWhatsApp(): Window | null {
  const janela = window.open('', '_blank');

  // ⚠️ `noopener` NÃO pode ir no `window.open` que queremos referenciar: com
  // `noopener` o retorno é `null` e perdemos a aba. Corta-se o `opener` à mão,
  // que dá o mesmo efeito de segurança sem perder a referência.
  if (janela) {
    try {
      janela.opener = null;
    } catch {
      /* cross-origin — ignorado */
    }
  }

  return janela;
}

/** Leva a aba pré-aberta até ao link. Devolve `false` se não havia aba. */
export function levarAbaPara(janela: Window | null, url: string): boolean {
  if (!janela || janela.closed) return false;
  try {
    janela.location.replace(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * SMS pelo telemóvel, sem internet.
 *
 * ⚠️ Isto só envia sozinho numa app empacotada (Capacitor). **No browser não
 * existe forma de mandar um SMS sozinho** — o melhor possível é abrir a app de
 * SMS com o texto escrito, e quem carrega em enviar é a pessoa. Num telemóvel
 * com o ecrã bloqueado, nem isso.
 *
 * Devolve `true` só quando o SMS saiu mesmo.
 */
export async function enviarSmsNativo(params: {
  telefone: string;
  mensagem: string;
}): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const smsPlugin = (window as unknown as { SMS?: { send?: Function } }).SMS;
    if (!smsPlugin?.send) return false;

    await new Promise<void>((resolve, reject) => {
      smsPlugin.send!(
        `+${normalizarTelefone(params.telefone)}`,
        params.mensagem,
        { replaceLineBreaks: true, android: { intent: '' } },
        () => resolve(),
        (err: unknown) => reject(err),
      );
    });

    return true;
  } catch (err) {
    console.warn('[nativeEmergency] SMS nativo falhou:', err);
    return false;
  }
}

/**
 * Chamada automática para o contacto de emergência.
 * ⚠️ Já não escolhe horas: era 18h–5h e num assalto de manhã o contacto
 * recebia texto e não uma chamada.
 */
export function makeEmergencyCall(telefone: string): void {
  if (!telefone) return;
  window.open(`tel:+${normalizarTelefone(telefone)}`, '_system');
}
