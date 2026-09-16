// =============================================================================
// ZENITH RIDE — src/services/rideTrack.ts
//
// O traço real de uma corrida: onde o carro andou, ponto a ponto.
//
// PORQUE EXISTE
//   O `rideService.updateDriverLocation` faz UPSERT por `driver_id`. Cada envio
//   substitui o anterior — no fim de uma corrida só sobra a última posição.
//   Esta camada escreve em `ride_track_points`, que ACUMULA em vez de
//   substituir, e é o que permite:
//     • desenhar a rota que o carro fez mesmo (não a que o mapa sugeriu);
//     • o SOS dizer onde o carro andou;
//     • provar o percurso numa disputa.
//
// DECISÕES DO DÁNIO (16/09/2026)
//   • Um ponto a cada 20 s.
//   • Retenção de 90 dias (tratada na migration, por `purge_ride_track_points`).
//
// REGRA DE OURO DESTE FICHEIRO
//   Gravar o traço é secundário. Se falhar, a corrida TEM de continuar. Por
//   isso nada aqui lança para fora: qualquer erro é engolido e registado. Um
//   problema de rede não pode parar um motorista a meio de uma viagem.
// =============================================================================

import { supabase } from '../lib/supabase';
import type { LatLng } from '../types';

/** Intervalo entre pontos. Combinado com o Dánio: 20 s. */
const INTERVALO_MS = 20_000;

/**
 * Distância mínima para valer a pena gravar um ponto, mesmo fora do intervalo.
 * Sem isto, um carro parado num semáforo durante 3 minutos enche o traço com
 * dezenas de pontos iguais, que não desenham nada e só ocupam espaço.
 */
const MOVIMENTO_MINIMO_M = 15;

export interface PontoDoTraco {
  lat: number;
  lng: number;
  heading: number | null;
  speed_kmh: number | null;
  accuracy_m: number | null;
  recorded_at: string;
}

/** Distância aproximada entre dois pontos, em metros (Haversine). */
function metrosEntre(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ─── Estado do traço em curso ────────────────────────────────────────────────
//  Vive em módulo, não em React: o traço pertence à corrida, não a um ecrã.
//  O motorista pode mudar de ecrã sem que o traço se perca.
let corridaActual: string | null = null;
let driverActual: string | null = null;
let ultimoEnvioMs = 0;
let ultimoPonto: LatLng | null = null;
let ultimoPontoTempoMs = 0;

export const rideTrackService = {
  /**
   * Liga o traço a uma corrida. `null` desliga.
   *
   * O `driverId` é guardado aqui de propósito: a RLS exige
   * `driver_id = auth.uid()`, e o `driver_id` é `NOT NULL`. Ir buscá-lo com
   * `auth.getUser()` a cada ponto seria um pedido de rede por ponto — e
   * devolveria `null` se a sessão tivesse expirado, falhando o insert.
   *
   * Ao ligar, o relógio é reposto para zero de propósito: o PRIMEIRO ponto de
   * uma corrida tem de ser gravado imediatamente, senão o traço começaria
   * sempre 20 s depois da partida — e o início da rota perder-se-ia.
   */
  definirCorrida(rideId: string | null, driverId: string | null = null): void {
    if (corridaActual === rideId && driverActual === driverId) return;
    corridaActual = rideId;
    driverActual = rideId ? driverId : null;
    ultimoEnvioMs = 0;
    ultimoPonto = null;
    ultimoPontoTempoMs = 0;
  },

  /** A corrida a que o traço está ligado agora (ou `null`). */
  corridaActual(): string | null {
    return corridaActual;
  },

  /**
   * Regista um ponto, se for altura disso.
   *
   * @param forcar  Ignora o intervalo e o filtro de movimento. Usar no fim da
   *                corrida, para o último ponto ficar gravado.
   * @returns `true` se gravou mesmo.
   */
  async registar(
    coords: LatLng,
    heading: number | null = null,
    accuracyM: number | null = null,
    forcar = false,
  ): Promise<boolean> {
    const rideId = corridaActual;
    if (!rideId) return false;

    const driverId = driverActual;
    if (!driverId) {
      // Sem motorista não há como satisfazer a RLS nem o NOT NULL. Acontece se
      // alguém ligar o traço sem dizer quem conduz — é um erro de chamada, não
      // um erro de rede, por isso fica no console e não se tenta gravar.
      console.warn('[rideTrack] Traço ligado sem driverId — nada será gravado.');
      return false;
    }

    const agora = Date.now();
    const decorrido = agora - ultimoEnvioMs;

    if (!forcar) {
      if (ultimoEnvioMs !== 0 && decorrido < INTERVALO_MS) return false;

      // Fora do intervalo mas parado: não vale um ponto. Só se aplica depois de
      // já haver um ponto — o primeiro grava-se sempre.
      if (ultimoPonto && metrosEntre(ultimoPonto, coords) < MOVIMENTO_MINIMO_M) {
        // Mesmo sem gravar, adiar o relógio evita reavaliar a cada actualização
        // do GPS (que chega a cada segundo).
        ultimoEnvioMs = agora;
        return false;
      }
    }

    // Velocidade calculada a partir do ponto anterior. O GPS do browser nem
    // sempre traz `speed`, e uma média entre dois pontos é suficiente para o
    // que isto serve (média da corrida no recibo).
    let speedKmh: number | null = null;
    if (ultimoPonto && ultimoPontoTempoMs) {
      const segundos = (agora - ultimoPontoTempoMs) / 1000;
      if (segundos > 1) {
        speedKmh = Math.round(((metrosEntre(ultimoPonto, coords) / segundos) * 3.6) * 10) / 10;
      }
    }

    // Actualizar o estado ANTES do `await`: se o envio falhar, o throttle não
    // pode ficar aberto e disparar em rajada a seguir.
    ultimoEnvioMs = agora;
    ultimoPonto = coords;
    ultimoPontoTempoMs = agora;

    try {
      const { error } = await supabase.from('ride_track_points').insert({
        ride_id: rideId,
        driver_id: driverId,
        lat: coords.lat,
        lng: coords.lng,
        heading,
        speed_kmh: speedKmh,
        accuracy_m: accuracyM,
      });

      if (error) {
        console.warn('[rideTrack] Ponto não gravado:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      // Deliberadamente silencioso: o traço nunca pode parar a corrida.
      console.warn('[rideTrack] Falha ao gravar ponto:', err);
      return false;
    }
  },

  /**
   * Lê o traço de uma corrida, por ordem cronológica.
   *
   * A RLS garante que só o passageiro, o motorista ou um admin conseguem ler.
   * Devolve `[]` em qualquer erro — quem desenha o recibo trata a ausência.
   */
  async lerTraco(rideId: string): Promise<PontoDoTraco[]> {
    try {
      const { data, error } = await supabase
        .from('ride_track_points')
        .select('lat, lng, heading, speed_kmh, accuracy_m, recorded_at')
        .eq('ride_id', rideId)
        .order('recorded_at', { ascending: true });

      if (error) {
        console.warn('[rideTrack] Leitura do traço falhou:', error.message);
        return [];
      }
      return (data ?? []) as PontoDoTraco[];
    } catch (err) {
      console.warn('[rideTrack] Leitura do traço falhou:', err);
      return [];
    }
  },

  /** Quantos pontos uma corrida tem. Barato: não traz o traço. */
  async contarPontos(rideId: string): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('ride_track_count', { p_ride_id: rideId });
      if (error) return 0;
      return typeof data === 'number' ? data : 0;
    } catch {
      return 0;
    }
  },
};
