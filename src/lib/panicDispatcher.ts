// =============================================================================
// panicDispatcher.ts — o disparo do SOS, num sítio só
// =============================================================================
// Antes vivia dentro do `PanicButton`, que só existe quando há corrida aceite.
// O grito tem de funcionar sem corrida nenhuma, por isso o disparo saiu de lá.
//
// A ORDEM importa — é o coração da correcção do F1:
//
//   1. O ALERTA NASCE JÁ, sem coordenadas. É ele que existe, que aparece no
//      painel de admin e que o motor de escalonamento lê. Esperar pelo GPS
//      antes de criar o alerta custava até 10 s (o timeout do browser) — num
//      SOS isso não se aceita.
//   2. A GRAVAÇÃO liga-se ao id que acabou de nascer.
//   3. AS COORDENADAS entram quando chegarem, com tecto de 3 s. São escritas
//      na própria linha do alerta, que o motor volta a ler de qualquer forma.
//
// ⚠️ Nota de RLS (20/09/2026): este ficheiro só funciona porque a migração
// `20260921000000_sos_canais_do_alerta.sql` deu ao dono política de SELECT e
// de UPDATE em `panic_alerts`. Sem ela, o `insert().select('id')` é recusado
// (42501) e o alerta nunca chega a existir — que é exactamente o que se
// passava antes, em silêncio.
// =============================================================================
import { supabase } from './supabase';

export type PanicSource = 'botao_panico' | 'grito' | 'escada_corrida';

export interface PedidoDePanico {
  userId: string;
  rideId?: string;
  emergencyPhone?: string;
  driverName?: string;
  source: PanicSource;
  severity?: 'high' | 'critical';
}

export interface Posicao {
  latitude?: number;
  longitude?: number;
}

export interface ResultadoDoPanico {
  alertaId: string | null;
  /** Resolve sempre em <= 3 s, com ou sem coordenadas. Nunca rejeita. */
  posicao: Promise<Posicao>;
  /** Preenchido quando o alerta NÃO foi criado. Já não se engole. */
  erro: string | null;
}

const SEM_POSICAO: Posicao = { latitude: undefined, longitude: undefined };

/**
 * Posição do telemóvel, com TECTO DUPLO.
 *
 * O `timeout` das opções do browser **não é de confiança**: se o pedido ficar
 * pendurado, pode nunca disparar. O `Promise.race` garante que seguimos de
 * qualquer maneira — quem grita não pode ficar à espera do satélite.
 */
export function obterPosicao(tectoMs = 3000): Promise<Posicao> {
  return Promise.race([
    new Promise<Posicao>((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(SEM_POSICAO);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => resolve(SEM_POSICAO),
        { enableHighAccuracy: true, timeout: tectoMs, maximumAge: 15000 },
      );
    }),
    new Promise<Posicao>((resolve) => setTimeout(() => resolve(SEM_POSICAO), tectoMs)),
  ]);
}

/**
 * Cria o alerta de pânico e devolve o id **imediatamente**.
 * As coordenadas chegam depois e são escritas na própria linha.
 */
export async function dispararPanico(p: PedidoDePanico): Promise<ResultadoDoPanico> {
  const payload: Record<string, unknown> = {
    user_id: p.userId,
    ride_id: p.rideId ?? null,
    driver_name: p.driverName ?? null,
    severity: p.severity ?? 'high',
    source: p.source,
    created_at: new Date().toISOString(),
  };

  // Retrato do contacto no momento do alerta. O perfil pode mudar depois; o
  // que interessa ao motor é para quem se estava a ligar naquela hora.
  if (p.emergencyPhone) {
    payload.contact_phone = p.emergencyPhone;
  }

  // ⚠️ `error` TEM de ser lido. Era aqui que o SOS morria em silêncio: o
  // INSERT falhava (sem política de SELECT, o RETURNING é recusado) e o código
  // — que só desestruturava `data` — seguia como se tivesse corrido bem.
  const { data, error } = await supabase
    .from('panic_alerts')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    console.error('[panicDispatcher] O alerta NAO foi criado:', error);
    return { alertaId: null, posicao: Promise.resolve(SEM_POSICAO), erro: error.message };
  }

  const alertaId: string | null = (data as { id?: string } | null)?.id ?? null;

  if (!alertaId) {
    console.error('[panicDispatcher] O alerta foi criado mas sem id de volta.');
    return {
      alertaId: null,
      posicao: Promise.resolve(SEM_POSICAO),
      erro: 'alerta criado sem id',
    };
  }

  try {
    await supabase.channel('panic_alerts_live').send({
      type: 'broadcast',
      event: 'panic_triggered',
      payload: { id: alertaId, ...payload },
    });
  } catch (e) {
    console.warn('[panicDispatcher] Broadcast SOS falhou:', e);
  }

  // As coordenadas não bloqueiam nada nem ninguém: entram quando chegarem.
  const posicao = obterPosicao().then(async (pos) => {
    if (pos.latitude != null && pos.longitude != null) {
      const { error: erroGps } = await supabase
        .from('panic_alerts')
        .update({ lat: pos.latitude, lng: pos.longitude })
        .eq('id', alertaId);
      if (erroGps) {
        console.warn('[panicDispatcher] Nao consegui escrever as coordenadas:', erroGps);
      }
    }
    return pos;
  });

  return { alertaId, posicao, erro: null };
}
