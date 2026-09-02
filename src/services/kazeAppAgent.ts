// =============================================================================
// ZENITH RIDE — kazeAppAgent.ts
// Agente Operacional do Kaze para o App do Utilizador
// Suporta:
//   1. Function Calling via Gemini (request_ride, schedule_ride, create_contract, etc.)
//   2. Fallback local inteligente com NLP e limpeza de linguagem natural luandense
//   3. Validação geográfica estrita de Luanda (previne rotas absurdas de Benguela ou IP)
//   4. Proposta de Ações com confirmação de segurança (cartão interativo no chat)
// =============================================================================

import { mapService, LUANDA_STATIC_LOCATIONS } from './mapService';
import { zonePriceService } from './zonePrice';
import { supabase } from '../lib/supabase';
import type { LatLng } from '../types';

export type KazeActionType =
  | 'REQUEST_RIDE'
  | 'SCHEDULE_RIDE'
  | 'CREATE_CONTRACT'
  | 'CHECK_BALANCE'
  | 'NAVIGATE_APP'
  | 'CANCEL_RIDE';

export interface KazeProposedRide {
  origin: string;
  originCoords: LatLng;
  destination: string;
  destCoords: LatLng;
  priceKz: number;
  distanceKm: number;
  durationMin: number;
  vehicleType: 'standard' | 'moto' | 'comfort' | 'xl';
}

export interface KazeProposedSchedule {
  origin: string;
  originCoords: LatLng;
  destination: string;
  destCoords: LatLng;
  date: string;        // YYYY-MM-DD
  time: string;        // HH:MM
  scheduledAt: string; // ISO String
  vehicleType: 'standard' | 'moto' | 'comfort' | 'xl';
}

export interface KazeProposedContract {
  contractType: 'school' | 'family' | 'corporate';
  title: string;
  address: string;
  destinationAddress: string;
  destLat: number;
  destLng: number;
  timeStart: string;
  timeEnd: string;
}

export interface KazeProposedAction {
  id: string;
  type: KazeActionType;
  title: string;
  summary: string;
  data: any;
  status: 'pending' | 'confirmed' | 'cancelled' | 'executed';
}

export interface KazeAgentResult {
  text: string;
  action?: KazeProposedAction;
  speakText?: string;
  isConfirmationQuery?: boolean;
}

const FRONTEND_GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

// Centro de Luanda (Mutamba / Baixa)
const LUANDA_CENTER: LatLng = { lat: -8.8390, lng: 13.2343 };

/**
 * Validação rigorosa: A Zenith Ride opera na Província de Luanda.
 * Se o GPS ou IP do utilizador reportar fora de Luanda (ex: Benguela, Huambo, etc.),
 * restringimos para Luanda Centro para evitar rotas de 400km e 100.000 Kz.
 */
export function isWithinLuanda(coords: LatLng): boolean {
  return coords.lat >= -9.5 && coords.lat <= -8.3 && coords.lng >= 12.9 && coords.lng <= 13.9;
}

/**
 * Sanitizador de linguagem natural para destinos e origens.
 * Remove vícios de fala como "pede para mim uma corrida para", "mais próximo de mim", etc.
 */
export function cleanDestinationQuery(raw: string): string {
  let q = String(raw || '').trim();

  // Remover prefixos comuns de comando de fala
  q = q.replace(/^(?:por favor|kaze|podes|pede|chama|quero|preciso de|marca|levar|leva[- ]me|ir)\s+/i, '');
  q = q.replace(/^(?:para mim|pra mim)\s+/i, '');
  q = q.replace(/^(?:uma corrida|um táxi|um taxi|um carro|uma viagem|um motogo)\s+/i, '');
  q = q.replace(/^(?:para|pra|ao|à|a|ate|até)\s+/i, '');
  q = q.replace(/^(?:o|a|os|as)\s+/i, '');

  // Remover sufixos de proximidade
  q = q.replace(/\s+(?:mais pr[oó]ximo(?: de mim)?|mais perto(?: de mim)?|por perto|aqui perto)$/i, '');
  q = q.replace(/\s+(?:de mim|onde estou)$/i, '');

  // Normalização de marcos famosos de Luanda
  if (/bela[s]?\s*shopping/i.test(q)) return 'Belas Shopping';
  if (/xyami\s*kilamba/i.test(q)) return 'Xyami Shopping Kilamba';
  if (/xyami/i.test(q)) return 'Xyami Shopping';
  if (/aeroporto/i.test(q)) return 'Aeroporto 4 de Fevereiro';
  if (/ilha\s*do\s*cabo|ilha/i.test(q) && !/maianga|talatona/i.test(q)) return 'Ilha do Cabo';
  if (/mutamba/i.test(q)) return 'Mutamba — Baixa de Luanda';
  if (/kinaxixi/i.test(q)) return 'Kinaxixi';
  if (/talatona/i.test(q)) return 'Talatona';
  if (/kilamba/i.test(q)) return 'Kilamba';
  if (/viana/i.test(q)) return 'Viana — Centro';
  if (/cacuaco/i.test(q)) return 'Cacuaco — Centro';
  if (/morro\s*bento/i.test(q)) return 'Morro Bento';
  if (/benfica/i.test(q)) return 'Benfica';
  if (/camama/i.test(q)) return 'Camama';
  if (/alvalade/i.test(q)) return 'Alvalade';
  if (/maianga/i.test(q)) return 'Maianga';
  if (/cazenga/i.test(q)) return 'Cazenga';
  if (/samba/i.test(q)) return 'Samba';

  return q.trim();
}

// ── Definição das Ferramentas para o Gemini ───────────────────────────────────
const KAZE_APP_TOOLS = [
  {
    function_declarations: [
      {
        name: 'request_ride',
        description: 'Prepara e solicita uma corrida no app para o passageiro em Luanda, Angola.',
        parameters: {
          type: 'OBJECT',
          properties: {
            origin: {
              type: 'STRING',
              description: 'Local de partida em Luanda (ex: Kinaxixi, Talatona, Viana, ou vazio para localização actual do passageiro)',
            },
            destination: {
              type: 'STRING',
              description: 'Nome limpo do destino em Luanda (ex: Belas Shopping, Aeroporto 4 de Fevereiro, Talatona)',
            },
            vehicle_type: {
              type: 'STRING',
              enum: ['standard', 'moto', 'comfort', 'xl'],
              description: 'Tipo de viatura: standard (táxi normal), moto (MotoGo), comfort ou xl',
            },
          },
          required: ['destination'],
        },
      },
      {
        name: 'schedule_ride',
        description: 'Agenda uma corrida futura para uma data e horário específicos em Luanda.',
        parameters: {
          type: 'OBJECT',
          properties: {
            origin: { type: 'STRING', description: 'Local de partida em Luanda' },
            destination: { type: 'STRING', description: 'Local de destino em Luanda' },
            date: { type: 'STRING', description: 'Data no formato YYYY-MM-DD ou "hoje" / "amanhã"' },
            time: { type: 'STRING', description: 'Hora no formato HH:MM (ex: 08:00, 14:30)' },
            vehicle_type: { type: 'STRING', enum: ['standard', 'moto', 'comfort', 'xl'] },
          },
          required: ['destination', 'time'],
        },
      },
      {
        name: 'create_contract',
        description: 'Cria um contrato de transporte frequente (escolar, familiar ou corporativo).',
        parameters: {
          type: 'OBJECT',
          properties: {
            contract_type: { type: 'STRING', enum: ['school', 'family', 'corporate'] },
            title: { type: 'STRING', description: 'Título do contrato (ex: Escola Portuguesa, Trabalho)' },
            destination_address: { type: 'STRING', description: 'Endereço de destino' },
            time_start: { type: 'STRING', description: 'Hora de ida no formato HH:MM (ex: 07:30)' },
            time_end: { type: 'STRING', description: 'Hora de regresso no formato HH:MM (ex: 13:00)' },
          },
          required: ['contract_type', 'destination_address', 'time_start', 'time_end'],
        },
      },
      {
        name: 'check_balance',
        description: 'Consulta o saldo actual da carteira do utilizador.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'navigate_app',
        description: 'Navega para uma tela específica dentro do app.',
        parameters: {
          type: 'OBJECT',
          properties: {
            screen: {
              type: 'STRING',
              enum: ['wallet', 'rides', 'contrato', 'precos', 'profile', 'home'],
              description: 'Tela de destino: wallet (carteira), rides (histórico), contrato (contratos), precos (tabela), profile (perfil)',
            },
          },
          required: ['screen'],
        },
      },
      {
        name: 'cancel_current_ride',
        description: 'Cancela a corrida actualmente activa.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason: { type: 'STRING', description: 'Motivo do cancelamento' },
          },
        },
      },
    ],
  },
];

const KAZE_AGENT_SYSTEM_PROMPT = `Tu és o KAZE, o assistente inteligente, ágil e executivo da Zenith Ride em Luanda, Angola.
Tens capacidade directa de operar e controlar o aplicativo do passageiro e do motorista!

A Zenith Ride opera EXCLUSIVAMENTE em Luanda, Angola.
Todos os locais são zonas de Luanda (Talatona, Belas Shopping, Mutamba, Kinaxixi, Kilamba, Viana, Cacuaco, Aeroporto, Ilha do Cabo, Maianga, etc.).

QUANDO O UTILIZADOR PEDIR UMA AÇÃO:
1. Pedir corrida: Se o utilizador disser "pede para mim uma corrida para o Belas Shopping", chama a ferramenta "request_ride" com destination="Belas Shopping".
   - Remove do campo destination palavras como "pede para mim", "mais próximo de mim", "uma corrida para". Extrai apenas o nome do local limpo!
2. Agendar corrida: Se pedir para agendar para amanhã ou para uma hora específica, chama "schedule_ride".
3. Criar contrato: Se falar em contrato escolar, transporte de filhos ou trabalho regular, chama "create_contract".
4. Carteira / Saldo: Se perguntar quanto tem de dinheiro ou pedir para abrir a carteira, chama "check_balance" ou "navigate_app".
5. Histórico: Se pedir para ver corridas passadas, chama "navigate_app" com screen="rides".
6. Cancelar corrida: Se pedir para cancelar a corrida actual, chama "cancel_current_ride".

Responde sempre com entusiasmo, clareza e elegância executiva!`;

export class KazeAppAgent {
  /**
   * Processa a mensagem do utilizador e determina se há acção para executar no app
   */
  async processUserMessage(
    message: string,
    context: {
      userId?: string;
      userRole?: string;
      userLocation?: LatLng | null;
      hasActiveRide?: boolean;
      pendingAction?: KazeProposedAction | null;
    }
  ): Promise<KazeAgentResult> {
    const trimmed = message.trim();

    // ── 1. Verificar se é uma resposta de confirmação de acção pendente ──────
    if (context.pendingAction && context.pendingAction.status === 'pending') {
      const isAffirmative = /^(sim|confirma|pode pedir|pedir|bora|avan[cç]a|ok|positivo|confirmar|agendar|ativar)/i.test(trimmed);
      const isNegative = /^(n[aã]o|cancela|esquece|deixa|agora n[aã]o|cancelar)/i.test(trimmed);

      if (isAffirmative) {
        return {
          text: `Perfeito! A confirmar ${context.pendingAction.title.toLowerCase()} agora mesmo... 🚀`,
          action: { ...context.pendingAction, status: 'confirmed' },
          speakText: 'Confirmado! A processar o teu pedido.',
        };
      }

      if (isNegative) {
        return {
          text: `Sem problemas, mano! Cancelei a acção. Se precisares de outra coisa, é só dizer. 👍`,
          action: { ...context.pendingAction, status: 'cancelled' },
          speakText: 'Cancelado. Qualquer coisa avisa.',
        };
      }
    }

    // ── 2. Tentar via Gemini Function Calling (IA Nativa) ─────────────────────
    if (FRONTEND_GEMINI_KEY) {
      try {
        const aiResult = await this._callGeminiWithTools(trimmed, context);
        if (aiResult) return aiResult;
      } catch (err) {
        console.warn('[KazeAppAgent] Gemini tool call falhou, usando analisador local:', err);
      }
    }

    // ── 3. Fallback Local Inteligente (Regex & NLP local sem rede) ───────────
    return await this._processLocalIntent(trimmed, context);
  }

  /**
   * Chamada directa à API do Gemini com declarações de ferramentas (tools)
   */
  private async _callGeminiWithTools(
    message: string,
    context: {
      userId?: string;
      userLocation?: LatLng | null;
      hasActiveRide?: boolean;
    }
  ): Promise<KazeAgentResult | null> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${FRONTEND_GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: KAZE_AGENT_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: message }] }],
          tools: KAZE_APP_TOOLS,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 600,
          },
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini status ${res.status}`);
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Procurar se houve chamada de função
    const toolCall = parts.find((p: any) => p.functionCall);
    const textPart = parts.find((p: any) => p.text)?.text || '';

    if (toolCall) {
      const { name, args } = toolCall.functionCall;
      return await this._resolveToolAction(name, args || {}, textPart, context);
    }

    if (textPart) {
      return {
        text: textPart,
        speakText: textPart,
      };
    }

    return null;
  }

  /**
   * Resolve a ferramenta solicitada, geocodifica pontos e cria o cartão de acção
   */
  private async _resolveToolAction(
    toolName: string,
    args: any,
    fallbackText: string,
    context: { userId?: string; userLocation?: LatLng | null; hasActiveRide?: boolean }
  ): Promise<KazeAgentResult> {
    switch (toolName) {
      case 'request_ride': {
        const rawDest = args.destination;
        if (!rawDest) return { text: 'Para onde gostarias de ir em Luanda, mano?' };

        // 1. Limpar o destino de frases conversacionais
        let destStr = cleanDestinationQuery(rawDest);

        // 2. Origem: se não indicada ou 'aqui', usa GPS actual
        let originStr = args.origin ? cleanDestinationQuery(args.origin) : 'Minha localização actual';
        let originCoords: LatLng | null = context.userLocation || null;

        if (args.origin && !/aqui|onde estou|minha localiza|minha posi/i.test(args.origin)) {
          originCoords = await mapService.geocodeAddress(originStr);
        }

        // Se não tiver origem ainda, tenta GPS ou localização padrão de Luanda
        if (!originCoords) {
          try {
            const gps = await mapService.getCurrentPosition();
            // VALIDAÇÃO CRUCIAL: Se o GPS for fora de Luanda (ex: Benguela/erro de IP), usar Luanda Centro
            if (isWithinLuanda(gps)) {
              originCoords = gps;
              originStr = await mapService.reverseGeocode(originCoords);
            } else {
              originCoords = LUANDA_CENTER;
              originStr = 'Luanda (Mutamba)';
            }
          } catch {
            originCoords = LUANDA_CENTER;
            originStr = 'Luanda (Mutamba)';
          }
        } else if (!isWithinLuanda(originCoords)) {
          // Garantir que a origem está dentro de Luanda
          originCoords = LUANDA_CENTER;
          originStr = 'Luanda (Mutamba)';
        }

        // 3. Destino: Geocodificar com mapa e base local de Luanda
        let destCoords: LatLng | null = await mapService.geocodeAddress(destStr);
        if (!destCoords) {
          const search = await mapService.searchPlaces(destStr, originCoords);
          if (search.length > 0 && search[0]?.coords) {
            destCoords = search[0].coords;
            destStr = search[0].name; // ✅ CORRETO: actualiza destStr com o nome encontrado
          } else {
            // Verificar busca fuzzy na lista estática de Luanda
            const staticMatch = LUANDA_STATIC_LOCATIONS.find(loc =>
              loc.name.toLowerCase().includes(destStr.toLowerCase())
            );
            if (staticMatch) {
              destCoords = staticMatch.coords;
              destStr = staticMatch.name;
            } else {
              destCoords = { lat: -8.9280, lng: 13.1950 }; // Belas Shopping como centro de referência
              destStr = 'Belas Shopping';
            }
          }
        }

        // 4. Rota e Preço Real
        const route = mapService.calculateRouteInfo(originCoords, destCoords);
        const zp = await zonePriceService.getZonePrice(originStr, destStr);
        const priceKz = zp?.price_kz ?? Math.max(500, Math.round(500 + route.distanceKm * 250));
        const vehicleType = (args.vehicle_type as any) || 'standard';

        const proposed: KazeProposedRide = {
          origin: originStr,
          originCoords,
          destination: destStr,
          destCoords,
          priceKz,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          vehicleType,
        };

        const summaryText = `🚗 Rota: ${originStr} → ${destStr} (~${route.distanceKm.toFixed(1)} km · ~${priceKz.toLocaleString('pt-AO')} Kz)`;

        return {
          text: `Encontrei o melhor trajecto de **${originStr}** para **${destStr}**!\n\n${summaryText}\n\nQueres que eu peça a corrida agora?`,
          speakText: `Encontrei o trajecto para ${destStr}, fica por cerca de ${priceKz} Kwanzas. Queres que confirme?`,
          isConfirmationQuery: true,
          action: {
            id: crypto.randomUUID(),
            type: 'REQUEST_RIDE',
            title: 'Pedir Corrida',
            summary: summaryText,
            data: proposed,
            status: 'pending',
          },
        };
      }

      case 'schedule_ride': {
        const destStr = cleanDestinationQuery(args.destination);
        const timeStr = args.time || '08:00';
        let dateStr = args.date || '';

        const now = new Date();
        if (!dateStr || /hoje/i.test(dateStr)) {
          dateStr = now.toISOString().split('T')[0] ?? '';
        } else if (/amanh[aã]/i.test(dateStr)) {
          const tmrw = new Date();
          tmrw.setDate(tmrw.getDate() + 1);
          dateStr = tmrw.toISOString().split('T')[0] ?? '';
        }

        let originCoords = context.userLocation || LUANDA_CENTER;
        if (!isWithinLuanda(originCoords)) originCoords = LUANDA_CENTER;
        const originStr = args.origin ? cleanDestinationQuery(args.origin) : 'Minha localização actual';

        let destCoords = await mapService.geocodeAddress(destStr);
        if (!destCoords) destCoords = { lat: -8.9280, lng: 13.1950 };

        const scheduledAt = new Date(`${dateStr}T${timeStr}:00+01:00`).toISOString();

        const proposedSchedule: KazeProposedSchedule = {
          origin: originStr,
          originCoords,
          destination: destStr,
          destCoords,
          date: dateStr,
          time: timeStr,
          scheduledAt,
          vehicleType: (args.vehicle_type as any) || 'standard',
        };

        const summaryText = `📅 Agendamento: ${dateStr} às ${timeStr} (${originStr} → ${destStr})`;

        return {
          text: `Preparei o teu agendamento para **${dateStr} às ${timeStr}** com destino a **${destStr}**.\n\nQueres confirmar o agendamento?`,
          speakText: `Preparei o teu agendamento para ${dateStr} às ${timeStr}. Posso confirmar?`,
          isConfirmationQuery: true,
          action: {
            id: crypto.randomUUID(),
            type: 'SCHEDULE_RIDE',
            title: 'Agendar Corrida',
            summary: summaryText,
            data: proposedSchedule,
            status: 'pending',
          },
        };
      }

      case 'create_contract': {
        const destStr = cleanDestinationQuery(args.destination_address || 'Luanda');
        const titleStr = args.title || `Contrato ${args.contract_type || 'Escolar'}`;
        const timeStart = args.time_start || '07:30';
        const timeEnd = args.time_end || '13:00';
        let destCoords = await mapService.geocodeAddress(destStr);
        if (!destCoords) destCoords = { lat: -8.9280, lng: 13.1950 };

        const proposedContract: KazeProposedContract = {
          contractType: args.contract_type || 'school',
          title: titleStr,
          address: 'Luanda',
          destinationAddress: destStr,
          destLat: destCoords.lat,
          destLng: destCoords.lng,
          timeStart,
          timeEnd,
        };

        const summaryText = `🎓 Contrato: ${titleStr} (${timeStart} - ${timeEnd}) para ${destStr}`;

        return {
          text: `Preparei a proposta do teu **${titleStr}** para **${destStr}** (${timeStart} - ${timeEnd}).\n\nQueres que active o contrato agora?`,
          speakText: `Preparei o teu contrato para ${destStr}. Posso confirmar?`,
          isConfirmationQuery: true,
          action: {
            id: crypto.randomUUID(),
            type: 'CREATE_CONTRACT',
            title: 'Criar Contrato',
            summary: summaryText,
            data: proposedContract,
            status: 'pending',
          },
        };
      }

      case 'check_balance': {
        if (!context.userId) {
          return { text: 'Faz login para consultares o teu saldo na carteira.' };
        }
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance, currency')
          .eq('user_id', context.userId)
          .maybeSingle();

        const balance = wallet?.balance ?? 0;
        const cur = wallet?.currency ?? 'Kz';
        const text = `💰 O teu saldo actual na carteira Zenith é de **${balance.toLocaleString('pt-AO')} ${cur}**.`;

        return {
          text: `${text}\n\nDesejas aceder à tua carteira para recarregar ou ver transacções?`,
          speakText: `O teu saldo actual é de ${balance} Kwanzas.`,
          action: {
            id: crypto.randomUUID(),
            type: 'NAVIGATE_APP',
            title: 'Abrir Carteira',
            summary: 'Ver Carteira e Recargas',
            data: { screen: 'wallet', balanceKz: balance },
            status: 'pending',
          },
        };
      }

      case 'navigate_app': {
        const screen = args.screen || 'home';
        const labels: Record<string, string> = {
          wallet: 'a tua Carteira',
          rides: 'o teu Histórico de Corridas',
          contrato: 'os teus Contratos',
          precos: 'a Tabela de Tarifas por Zona',
          profile: 'o teu Perfil',
          home: 'o Ecrã Principal',
        };
        const label = labels[screen] || screen;

        return {
          text: `A abrir ${label}... 📲`,
          speakText: `A abrir ${label}.`,
          action: {
            id: crypto.randomUUID(),
            type: 'NAVIGATE_APP',
            title: `Navegar para ${screen}`,
            summary: `Abrir ${label}`,
            data: { screen },
            status: 'confirmed',
          },
        };
      }

      case 'cancel_current_ride': {
        if (!context.hasActiveRide) {
          return { text: 'Não tens nenhuma corrida activa no momento para cancelar, mano.' };
        }
        return {
          text: `⚠️ Queres mesmo cancelar a tua corrida activa?`,
          speakText: 'Tens a certeza de que queres cancelar a corrida?',
          isConfirmationQuery: true,
          action: {
            id: crypto.randomUUID(),
            type: 'CANCEL_RIDE',
            title: 'Cancelar Corrida Activa',
            summary: 'Cancelar corrida em curso',
            data: { reason: args.reason || 'Cancelado pelo passageiro via Kaze' },
            status: 'pending',
          },
        };
      }

      default:
        return { text: fallbackText || 'Comando processado pelo Kaze.' };
    }
  }

  /**
   * Analisador local por Expressões Regulares caso a IA esteja offline
   */
  private async _processLocalIntent(
    message: string,
    context: { userId?: string; userLocation?: LatLng | null; hasActiveRide?: boolean }
  ): Promise<KazeAgentResult> {
    const text = message.toLowerCase();

    // 1. Pedir Corrida
    if (/(?:pede|chama|quero|preciso de|levar para|ir para|corrida|t[aá]xi)\b/i.test(text) && !/agenda|amanh|saldo|contrato/i.test(text)) {
      // Extrair rota com "de X para Y" se houver
      const routeMatch = text.match(/(?:de|desde)\s+([^,]+?)\s+(?:para|até|ao|à)\s+(.+)/i);
      let origin: string | undefined;
      let dest: string;

      if (routeMatch) {
        origin = cleanDestinationQuery(routeMatch[1] ?? '');
        dest = cleanDestinationQuery(routeMatch[2] ?? '');
      } else {
        dest = cleanDestinationQuery(text);
      }

      if (!dest || dest.length < 2) dest = 'Belas Shopping';

      return await this._resolveToolAction('request_ride', { destination: dest, origin }, '', context);
    }

    // 2. Agendar Corrida
    if (/agenda|agendar/i.test(text)) {
      const timeMatch = text.match(/(\d{1,2}(?::\d{2})|\d{1,2}h|\d{1,2}\s+horas?)/i);
      const time = timeMatch ? timeMatch[0].replace('h', ':00').replace(' horas', ':00').padStart(5, '0') : '08:00';
      const dest = cleanDestinationQuery(text) || 'Aeroporto 4 de Fevereiro';
      const isTomorrow = /amanh[aã]/i.test(text);

      return await this._resolveToolAction('schedule_ride', {
        destination: dest,
        time,
        date: isTomorrow ? 'amanhã' : 'hoje',
      }, '', context);
    }

    // 3. Contrato
    if (/contrato/i.test(text)) {
      const dest = cleanDestinationQuery(text) || 'Luanda';
      return await this._resolveToolAction('create_contract', {
        contract_type: /escola/i.test(text) ? 'school' : /empresa|trabalho/i.test(text) ? 'corporate' : 'family',
        title: 'Novo Contrato de Transporte',
        destination_address: dest,
        time_start: '07:30',
        time_end: '13:00',
      }, '', context);
    }

    // 4. Saldo / Carteira
    if (/saldo|carteira|dinheiro|quanto tenho/i.test(text)) {
      return await this._resolveToolAction('check_balance', {}, '', context);
    }

    // 5. Histórico de Corridas
    if (/hist[oó]rico|corridas anteriores|viagens passadas/i.test(text)) {
      return await this._resolveToolAction('navigate_app', { screen: 'rides' }, '', context);
    }

    // 6. Cancelar corrida
    if (/cancela.*corrida|cancelar viagem/i.test(text)) {
      return await this._resolveToolAction('cancel_current_ride', {}, '', context);
    }

    // Resposta padrão amigável
    return {
      text: `Olá mano! Sou o Kaze. Posso pedir uma corrida agora ("pede para mim uma corrida para o Belas Shopping"), agendar uma viagem ("agenda para amanhã às 8h"), criar um contrato ou consultar o teu saldo. O que precisas? 🚗✨`,
      speakText: 'Olá! Sou o Kaze. Podes pedir uma corrida, agendar ou consultar o teu saldo.',
    };
  }
}

export const kazeAppAgent = new KazeAppAgent();
