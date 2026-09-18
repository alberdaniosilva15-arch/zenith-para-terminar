// =============================================================================
// ZENITH RIDE — src/services/fareQuote.ts
//
// O ÚNICO sítio onde se pede um preço.
//
// A FÓRMULA NÃO VIVE AQUI. Não vive em TypeScript nenhum. Vive na função
// Postgres `calculate_fare_engine_pro`, que lê a tabela `pricing_config`.
// Escrever constantes de tarifa em TypeScript é um erro já cometido e corrigido
// duas vezes — e, quando isso chegou ao prompt do Kaze, a IA passou a dizer
// preços inventados em voz alta ao passageiro.
//
// Este ficheiro só garante a ORDEM DE PRIORIDADE, que é a mesma em todo o lado:
//
//   1. `zone_prices` — tarifa fixa do par de zonas, quando as duas zonas são
//                      detectadas nos endereços e são diferentes.
//   2. `calculate_fare_engine_pro_with_rate_limit` — todo o resto.
//
// Se nenhuma responder, devolve `precoKz: null`. NUNCA inventa um valor:
// um preço inventado é pior do que nenhum, porque o passageiro decide com base
// nele. Quem não tem preço diz que o preço aparece no ecrã.
// =============================================================================

import { supabase } from '../lib/supabase';
import { applyScoreDiscount, zonePriceService } from './zonePrice';
import type { LatLng, ScoreDiscount } from '../types';

export type FonteDoPreco = 'zona' | 'motor';

export interface Cotacao {
  /** Preço final em Kwanzas, ou `null` se não foi possível saber. */
  precoKz: number | null;
  /** De onde veio o número. `null` quando não há número. */
  fonte: FonteDoPreco | null;
  /** Preço antes do desconto de score, quando existe. */
  precoBaseKz: number | null;
  desconto: ScoreDiscount | null;
  /** Explicação curta quando não há preço — para nunca falhar em silêncio. */
  motivo: string | null;
}

export interface PedidoDeCotacao {
  origemNome: string;
  destinoNome: string;
  origemCoords: LatLng;
  destinoCoords: LatLng;
  distanciaKm: number;
  duracaoMin: number;
  tipoVeiculo?: 'standard' | 'moto' | 'comfort' | 'xl';
  supplyCount?: number;
  demandaCount?: number;
  trafficFactor?: number;
  scoreDoPassageiro?: number | null;
  /**
   * Quanto tempo se espera pela tabela de zonas antes de passar ao motor.
   * A voz tem um orçamento apertado (2,5 s para toda a ferramenta), por isso
   * aqui usa-se um valor curto.
   */
  prazoZonaMs?: number;
}

const AEROPORTO_LAT = -8.8577;
const AEROPORTO_LNG = 13.2312;

/**
 * 1 grau ≈ 111 km. Serve só para decidir se o destino é o aeroporto — a
 * distância que entra no preço vem sempre da rota real, não daqui.
 */
function distanciaAoAeroportoKm(coords: LatLng): number {
  return (
    Math.sqrt(
      Math.pow(coords.lat - AEROPORTO_LAT, 2) + Math.pow(coords.lng - AEROPORTO_LNG, 2),
    ) * 111
  );
}

function comPrazo<T>(tarefa: Promise<T>, ms: number): Promise<T | null> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((res) => {
    temporizador = setTimeout(() => res(null), ms);
  });

  return Promise.race([tarefa, prazo]).finally(() => {
    if (temporizador) clearTimeout(temporizador);
  });
}

export async function cotarPreco(pedido: PedidoDeCotacao): Promise<Cotacao> {
  const tipo = pedido.tipoVeiculo ?? 'standard';

  // ── 1. Tarifa fixa do par de zonas ────────────────────────────────────────
  try {
    const zona = await comPrazo(
      zonePriceService.getZonePrice(pedido.origemNome, pedido.destinoNome),
      pedido.prazoZonaMs ?? 1500,
    );

    const valorZona = Number(zona?.price_kz);
    if (zona && Number.isFinite(valorZona) && valorZona > 0) {
      return {
        precoKz: valorZona,
        fonte: 'zona',
        precoBaseKz: valorZona,
        desconto: null,
        motivo: null,
      };
    }
  } catch {
    // A tabela de zonas não respondeu — segue-se para o motor, que é a fonte
    // principal. Não é motivo para desistir do preço.
  }

  // ── 2. Motor de tarifação ─────────────────────────────────────────────────
  const hora = new Date().getHours();
  const isNight = hora >= 22 || hora < 6;
  const isAirport = distanciaAoAeroportoKm(pedido.destinoCoords) < 1.0;

  try {
    const { data, error } = await supabase.rpc('calculate_fare_engine_pro_with_rate_limit', {
      p_distance_km: pedido.distanciaKm,
      p_duration_min: pedido.duracaoMin,
      p_origin_lat: pedido.origemCoords.lat,
      p_origin_lng: pedido.origemCoords.lng,
      p_dest_lat: pedido.destinoCoords.lat,
      p_dest_lng: pedido.destinoCoords.lng,
      p_service_tier: tipo,
      p_supply_count: pedido.supplyCount ?? 5,
      p_demand_count: pedido.demandaCount ?? 5,
      p_is_night: isNight,
      p_is_airport: isAirport,
      p_traffic_factor: pedido.trafficFactor ?? 1.2,
    });

    if (error) {
      return {
        precoKz: null,
        fonte: null,
        precoBaseKz: null,
        desconto: null,
        motivo: `o motor de preços não respondeu (${error.message})`,
      };
    }

    const resposta = data as { fare_kz?: number; error?: string } | null;

    if (resposta?.error) {
      return {
        precoKz: null,
        fonte: null,
        precoBaseKz: null,
        desconto: null,
        motivo: resposta.error,
      };
    }

    const base = Number(resposta?.fare_kz);
    if (!Number.isFinite(base) || base <= 0) {
      return {
        precoKz: null,
        fonte: null,
        precoBaseKz: null,
        desconto: null,
        motivo: 'o motor de preços não devolveu um valor válido',
      };
    }

    const desconto = applyScoreDiscount(base, pedido.scoreDoPassageiro ?? null);

    return {
      precoKz: desconto.final_price,
      fonte: 'motor',
      precoBaseKz: base,
      desconto,
      motivo: null,
    };
  } catch (e) {
    return {
      precoKz: null,
      fonte: null,
      precoBaseKz: null,
      desconto: null,
      motivo: e instanceof Error ? e.message : 'falha ao pedir o preço',
    };
  }
}

/**
 * Como se diz um preço em voz alta sem mentir.
 * Sem número, a frase empurra para o ecrã em vez de inventar.
 */
export function fraseDoPreco(cotacao: Cotacao, destino: string): string {
  if (cotacao.precoKz == null) {
    return `O preço exacto para ${destino} aparece no ecrã quando confirmares — não te vou dizer um número de cabeça.`;
  }

  const valor = Math.round(cotacao.precoKz).toLocaleString('pt-AO');
  const sufixo =
    cotacao.fonte === 'zona' ? ' (tarifa fixa desta zona)' : '';

  return `fica por cerca de ${valor} Kwanzas${sufixo}`;
}
