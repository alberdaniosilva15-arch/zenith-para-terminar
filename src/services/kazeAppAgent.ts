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
import { getLocalKazeResponse } from './geminiService';
import { normalizeAngolanSpeech } from '../lib/angolaSpeechNormalizer';
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

import { getResolvedKazeGroqKey } from '../lib/kazeKey';

export const FRONTEND_GROQ_KEY = getResolvedKazeGroqKey();

const FRONTEND_GEMINI_KEY = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_IA_API_KEY) ||
  ''
).trim();

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
  let q = normalizeAngolanSpeech(String(raw || '')).trim();

  // 1. Remover comandos e saudações comuns
  q = q.replace(/^(?:olá|ola|ei|oi|por favor|kaze|podes|faz favor|mano|cota|kota)\s+/i, '');
  q = q.replace(/^(?:pede|pedir|chama|chamar|quero|preciso de|marca|marcar|levar|leva[- ]me|ir|vai|vamos|bazar|vamos bazar para|quero bazar para)\s+/i, '');
  q = q.replace(/^(?:para mim|pra mim|pro mim)\s+/i, '');

  // 2. Remover o tipo de transporte
  q = q.replace(/^(?:uma corrida|corrida|um táxi|táxi|um taxi|taxi|um carro|carro|uma viagem|viagem|um motogo|motogo|um mambo|o mambo)\s+/i, '');

  // 3. Remover preposições e artigos iniciais
  q = q.replace(/^(?:para|pra|pro|ao|à|a|no|na|nos|nas|em|ate|até)\s+/i, '');
  q = q.replace(/^(?:o|a|os|as|um|uma)\s+/i, '');

  // 4. Remover sufixos de proximidade e conversacionais
  q = q.replace(/\s+(?:mais pr[oó]ximo(?: de mim)?|mais perto(?: de mim)?|por perto|aqui perto)$/i, '');
  q = q.replace(/\s+(?:de mim|onde estou|por favor)$/i, '');

  if (/^(?:minha\s+localiza[cç][aã]o(?:\s+act?ual)?|onde\s+estou|aqui|daqui)$/i.test(q)) {
    return 'Minha localização actual';
  }

  // 5. Preservar quarteirões e sub-zonas específicas (NÃO colapsar para o centro se o utilizador especificou)
  const hasSpecificSubzone = /quarteir[aã]o|bloco|zona\s+[a-z0-9]|fase\s+[0-9]|setor|mercado|rotunda|hospital|rua|avenida|estalagem|capalanga|kikolo|sequele|patriota|kk\s*5000/i.test(q);
  if (hasSpecificSubzone) {
    return q.trim();
  }

  // 6. Normalização de marcos famosos gerais quando não há sub-zona detalhada
  if (/bela[s]?\s*shopping/i.test(q)) return 'Belas Shopping';
  if (/x[y|i]ami\s*kilamba/i.test(q)) return 'Kilamba — Xyami Shopping Kilamba';
  if (/x[y|i]ami/i.test(q)) return 'Xyami Shopping';
  if (/aeroporto|4\s*de\s*fevereiro/i.test(q)) return 'Aeroporto 4 de Fevereiro';
  if (/ilha\s*do\s*cabo|ilha\s*de\s*luanda|\bilha\b/i.test(q) && !/maianga|talatona/i.test(q)) return 'Ilha do Cabo';
  if (/^mutamba$/i.test(q)) return 'Mutamba — Baixa de Luanda';
  if (/^kinaxixi$/i.test(q)) return 'Kinaxixi';
  if (/^talatona$/i.test(q)) return 'Talatona — Centro Administrativo';
  if (/^kilamba$/i.test(q)) return 'Kilamba — Centro & Rotunda Principal';
  if (/^golf\s*2$|^golfe\s*2$/i.test(q)) return 'Golf 2 — Centro';
  if (/^golf\s*1$|^golfe\s*1$/i.test(q)) return 'Golf 1 — Centro';
  if (/^nova\s*vida$/i.test(q)) return 'Nova Vida — Fase 1';
  if (/^viana$/i.test(q)) return 'Viana — Vila de Viana / Centro';
  if (/^cacuaco$/i.test(q)) return 'Cacuaco — Centro / Vila de Cacuaco';
  if (/^morro\s*bento$/i.test(q)) return 'Morro Bento — Morro Bento 1';
  if (/^benfica$/i.test(q)) return 'Benfica — Centro';
  if (/^camama$/i.test(q)) return 'Camama — Centro / Rotunda da Camama';
  if (/^alvalade$/i.test(q)) return 'Alvalade — Centro';
  if (/^maianga$/i.test(q)) return 'Maianga — Centro';
  if (/^cazenga$/i.test(q)) return 'Cazenga — Centro / Marco Histórico 4 de Fevereiro';
  if (/^samba$/i.test(q)) return 'Samba — Centro / Nó da Samba';

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

const KAZE_AGENT_SYSTEM_PROMPT = `Tu és o KAZE, o assistente de inteligência artificial de elite e executivo da Zenith Ride em Luanda, Angola.

═══ PERSONALIDADE E FORMA DE FALAR ═══
- Fala de forma 100% natural, viva, calorosa e autêntica, como um companheiro luandense moderno, educado e experiente.
- Usa gírias e expressões naturais de Luanda com elegância e sem exagero ("mano", "fixe", "tranquilo", "estou na escuta", "tá-se bem", "ya", "qual é a boa").
- NUNCA respondas de forma robótica, burocrática ou como um menu pré-programado! NUNCA repitas frases feitas decoradas.
- Se o utilizador apenas puxar conversa (ex: "fala comigo", "olá", "como estás?", "qual é a boa?", "quem és?", "estás aí?"):
  Responde com entusiasmo genuíno, conversa com ele como um parceiro real, pergunta o que ele manda e como está o dia dele por Luanda.
- Tens conhecimento profundo e real de Angola e Luanda:
  - Centralidade do Kilamba com todos os Quarteirões (A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U) e KK5000
  - Golf 2 com todas as zonas (Zona A, B, C, D, Mercado dos Correios, Rotunda, Hospital Geral) e Nova Vida (Fase 1, 2, 3)
  - Talatona (Lar do Patriota Fases 1 a 3, Belas Shopping, UCAN, EPIC Sana), Morro Bento, Benfica
  - Camama (1, 2, Cidade Universitária UAN), Viana (Estalagem, Capalanga, Km 9 a 30, Zango 0 a 5, Vida Pacífica)
  - Cazenga (Tala Hady, Hoji Ya Henda, Cuca), Cacuaco (Sequele Blocos 1 ao 12, Kikolo), Mutamba, Maianga, Alvalade, Ilha do Cabo
  - Províncias: Benguela, Lobito, Huambo, Lubango, Cabinda, etc.
- Se o utilizador pedir para ir a um quarteirão (ex: "Quarteirão D do Kilamba") ou zona (ex: "Golf 2 Zona B"), passa o destino EXACTO e COMPLETO na ferramenta!

═══ OPERAÇÃO DO APP (TOOL CALLING) ═══
Quando o utilizador quiser realizar uma acção no aplicativo da Zenith Ride, chama imediatamente a ferramenta adequada:
1. Pedir corrida -> chama "request_ride" com o destino limpo (ex: destination="Belas Shopping").
   - Se o utilizador disser "daqui", "onde estou", "da minha localização", ou NÃO mencionar o ponto de partida, deixa origin vazio para o app usar o GPS real!
   - Se disser de onde parte (ex: "do Kinaxixi para o Camama"), passa origin="Kinaxixi".
2. Agendar viagem -> chama "schedule_ride".
3. Criar contrato (escolar, família ou empresa) -> chama "create_contract".
4. Ver saldo ou carteira -> chama "check_balance" ou "navigate_app" com screen="wallet".
5. Ver histórico -> chama "navigate_app" com screen="rides".
6. Cancelar corrida -> chama "cancel_current_ride".

Se for apenas conversa, NÃO chames ferramentas; responde com texto acolhedor, inteligente e com atitude positiva!`;

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
      userAddress?: string | null;
      hasActiveRide?: boolean;
      pendingAction?: KazeProposedAction | null;
    }
  ): Promise<KazeAgentResult> {
    const trimmed = message.trim();

    // ── 1. Verificar se é uma resposta de confirmação de acção pendente ──────
    if (context.pendingAction && context.pendingAction.status === 'pending') {
      const isAffirmative = /^(?:sim|confirma|confirmar|pode|pode pedir|pode ser|pedir|bora|avan[cç]a|avan[cç]ar|ok|positivo|agendar|ativar|vai|vamos|claro|manda|faz isso|com certeza|por favor)\b/i.test(trimmed);
      const isNegative = /^(?:n[aã]o|cancela|cancelar|esquece|deixa|agora n[aã]o|para|parar)\b/i.test(trimmed);

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

    // ── 2. Tentar via Groq AI Ultra-rápido (Qwen 3.8 / Compound) ──────────────
    try {
      const groqResult = await this._callGroqWithTools(trimmed, context);
      if (groqResult) return groqResult;
    } catch (err) {
      console.warn('[KazeAppAgent] Groq tool call falhou:', err);
    }

    // ── 3. Tentar via Gemini Function Calling (IA Nativa de reserva) ───────────
    if (FRONTEND_GEMINI_KEY) {
      try {
        const aiResult = await this._callGeminiWithTools(trimmed, context);
        if (aiResult) return aiResult;
      } catch (err) {
        console.warn('[KazeAppAgent] Gemini tool call falhou, usando analisador local:', err);
      }
    }

    // ── 4. Fallback Local Inteligente (Regex & NLP local sem rede) ───────────
    return await this._processLocalIntent(trimmed, context);
  }

  /**
   * Chamada primária de alta performance via Groq (Qwen 3.8 27B / Compound)
   * Suporta extração de intenções, chamadas de acções e conversa rica em português de Luanda
   */
  private async _callGroqWithTools(
    message: string,
    context: {
      userId?: string;
      userLocation?: LatLng | null;
      userAddress?: string | null;
      hasActiveRide?: boolean;
    }
  ): Promise<KazeAgentResult | null> {
    if (!FRONTEND_GROQ_KEY) return null;

    const userLocContext = context.userAddress
      ? `\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: "${context.userAddress}"]`
      : context.userLocation
      ? `\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: GPS (${context.userLocation.lat.toFixed(4)}, ${context.userLocation.lng.toFixed(4)})]`
      : '\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: GPS em tempo real do dispositivo em Luanda]';

    const systemPrompt = `${KAZE_AGENT_SYSTEM_PROMPT}${userLocContext}

Responde SEMPRE e OBRIGATORIAMENTE em formato JSON válido com esta estrutura exacta:
{
  "thought": "pensamento curto sobre o pedido",
  "text": "resposta amigável e acolhedora do Kaze em português de Luanda",
  "action": null ou {
    "name": "request_ride" | "schedule_ride" | "create_contract" | "check_balance" | "navigate_app" | "cancel_current_ride",
    "args": {
      "destination": "destino em Luanda (se pedido de corrida ou agendamento)",
      "origin": "origem se especificada, ou vazio",
      "vehicle_type": "standard" | "moto" | "comfort" | "xl",
      "date": "YYYY-MM-DD se schedule_ride",
      "time": "HH:MM se schedule_ride",
      "screen": "wallet" | "rides" | "contrato" | "precos" | "profile"
    }
  }
}`;

    const models = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'groq/compound'];

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${FRONTEND_GROQ_KEY}`,
          },
          body: JSON.stringify({
            model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
            temperature: 0.6,
            max_tokens: 450,
          }),
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          console.warn(`[KazeAppAgent] Groq ${model} status ${res.status}`);
          continue;
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        if (parsed) {
          if (parsed.action && parsed.action.name) {
            return await this._resolveToolAction(
              parsed.action.name,
              parsed.action.args || {},
              parsed.text || 'A preparar o teu pedido...',
              context,
              message
            );
          }

          if (parsed.text && parsed.text.trim()) {
            return {
              text: parsed.text.trim(),
              speakText: parsed.text.trim(),
            };
          }
        }
      } catch (err) {
        console.warn(`[KazeAppAgent] Erro ao chamar Groq ${model}:`, err);
      }
    }

    return null;
  }

  /**
   * Chamada de reserva à API do Gemini com declarações de ferramentas (tools)
   */
  private async _callGeminiWithTools(
    message: string,
    context: {
      userId?: string;
      userLocation?: LatLng | null;
      userAddress?: string | null;
      hasActiveRide?: boolean;
    }
  ): Promise<KazeAgentResult | null> {
    const userLocContext = context.userAddress
      ? `\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: "${context.userAddress}"]`
      : context.userLocation
      ? `\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: GPS (${context.userLocation.lat.toFixed(4)}, ${context.userLocation.lng.toFixed(4)})]`
      : '\n[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO: GPS em tempo real do dispositivo]';

    const systemInstruction = `${KAZE_AGENT_SYSTEM_PROMPT}${userLocContext}`;

    // Modelos com alta disponibilidade, latência ultra-baixa e cotas ativas
    const modelsToTry = [
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
    ];

    for (const model of modelsToTry) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${FRONTEND_GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: 'user', parts: [{ text: message }] }],
              tools: KAZE_APP_TOOLS,
              generationConfig: {
                temperature: 0.65,
                maxOutputTokens: 500,
              },
            }),
          }
        );

        if (!res.ok) {
          console.warn(`[KazeAppAgent] Modelo ${model} falhou com status ${res.status}, tentando alternativa...`);
          continue;
        }

        const data = await res.json();
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        // Procurar se houve chamada de função
        const toolCall = parts.find((p: any) => p.functionCall);
        const textPart = parts.find((p: any) => p.text)?.text || '';

        if (import.meta.env.DEV) {
          console.debug(`[KazeAppAgent] ${model} response:`, {
            message,
            hasTool: !!toolCall,
            toolName: toolCall?.functionCall?.name,
            toolArgs: toolCall?.functionCall?.args,
            textPart: textPart?.slice(0, 120),
          });
        }

        if (toolCall) {
          const { name, args } = toolCall.functionCall;
          return await this._resolveToolAction(name, args || {}, textPart, context, message);
        }

        if (textPart && textPart.trim()) {
          return {
            text: textPart.trim(),
            speakText: textPart.trim(),
          };
        }
      } catch (err) {
        console.warn(`[KazeAppAgent] Erro ao chamar modelo ${model}:`, err);
      }
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
    context: { userId?: string; userLocation?: LatLng | null; userAddress?: string | null; hasActiveRide?: boolean },
    rawUserMessage?: string
  ): Promise<KazeAgentResult> {
    switch (toolName) {
      case 'request_ride': {
        const rawDest = args.destination;
        if (!rawDest) return { text: 'Para onde gostarias de ir em Luanda, mano?' };

        // 1. Limpar o destino de frases conversacionais
        let destStr = cleanDestinationQuery(rawDest);

        // 2. Origem: detectar se o utilizador quer a localização actual
        const rawMessageMentionsCurrent = rawUserMessage && /minha localiza|onde estou|aqui|minha posi|daqui|localiza[cç][aã]o actual|localiza[cç][aã]o atual/i.test(rawUserMessage);
        const argMentionsCurrent = !args.origin || /aqui|onde estou|minha localiza|minha posi|daqui|localiza[cç][aã]o actual|localiza[cç][aã]o atual/i.test(args.origin);
        const isCurrentLocationOrigin = rawMessageMentionsCurrent || argMentionsCurrent;

        let originStr = isCurrentLocationOrigin
          ? (context.userAddress || 'Minha localização actual')
          : cleanDestinationQuery(args.origin);

        let originCoords: LatLng | null = isCurrentLocationOrigin ? (context.userLocation || null) : null;

        if (!isCurrentLocationOrigin && originStr) {
          originCoords = await mapService.geocodeAddress(originStr);
        }

        // Se não tiver coordenadas ainda, obter GPS de forma rápida (máximo 1.2s)
        if (!originCoords) {
          try {
            const gpsPromise = mapService.getCurrentPosition();
            const timeoutPromise = new Promise<null>(res => setTimeout(() => res(null), 1200));
            const gps = await Promise.race([gpsPromise, timeoutPromise]);
            if (gps && isWithinLuanda(gps)) {
              originCoords = gps;
              const geoAddress = await mapService.reverseGeocode(originCoords);
              if (geoAddress && geoAddress.trim()) {
                originStr = geoAddress;
              }
            } else {
              originCoords = LUANDA_CENTER;
              originStr = 'Luanda (Mutamba)';
            }
          } catch {
            originCoords = LUANDA_CENTER;
            originStr = 'Luanda (Mutamba)';
          }
        } else if (!isWithinLuanda(originCoords)) {
          originCoords = LUANDA_CENTER;
          originStr = 'Luanda (Mutamba)';
        }

        // Se originStr ainda for genérico ("Minha localização actual") e temos coordenadas válidas,
        // resolver o nome real do bairro/rua com reverse geocoding
        if ((originStr === 'Minha localização actual' || originStr.toLowerCase().includes('localiza')) && originCoords) {
          try {
            const resolvedName = await mapService.reverseGeocode(originCoords);
            if (resolvedName && resolvedName.trim()) {
              originStr = resolvedName;
            }
          } catch { /* manter fallback */ }
        }

        // 3. Destino: Geocodificar com mapa e base local de Luanda
        let destCoords: LatLng | null = await mapService.geocodeAddress(destStr);
        if (!destCoords) {
          const search = await mapService.searchPlaces(destStr, originCoords);
          if (search.length > 0 && search[0]?.coords) {
            destCoords = search[0].coords;
            destStr = search[0].name;
          } else {
            const staticMatch = LUANDA_STATIC_LOCATIONS.find(loc =>
              loc.name.toLowerCase().includes(destStr.toLowerCase())
            );
            if (staticMatch) {
              destCoords = staticMatch.coords;
              destStr = staticMatch.name;
            } else {
              // Buscar de forma mais abrangente com Mapbox
              const broadSearch = await mapService.searchPlaces(`${destStr}, Luanda`);
              if (broadSearch.length > 0 && broadSearch[0]?.coords) {
                destCoords = broadSearch[0].coords;
                destStr = broadSearch[0].name;
              } else {
                // Manter o destino que o utilizador pediu (não forçar Belas!)
                destCoords = LUANDA_CENTER;
              }
            }
          }
        }

        // 4. Rota via Mapbox Directions com fallback rápido (máximo 2s)
        let route = { distanceKm: 8, durationMin: 20 };
        try {
          const routePromise = mapService.getRouteDistance(originCoords, destCoords);
          const routeTimeout = new Promise<any>(res => setTimeout(() => res(null), 2000));
          const r = await Promise.race([routePromise, routeTimeout]);
          if (r) {
            route = r;
          } else {
            const d = mapService.calculateDistance(originCoords, destCoords);
            route = { distanceKm: Math.max(1, Math.round(d * 10) / 10), durationMin: Math.max(5, Math.ceil((d / 25) * 60)) };
          }
        } catch {
          const d = mapService.calculateDistance(originCoords, destCoords);
          route = { distanceKm: Math.max(1, Math.round(d * 10) / 10), durationMin: Math.max(5, Math.ceil((d / 25) * 60)) };
        }

        // Preço por zona com timeout de 1.2s
        let zp: any = null;
        try {
          const zpPromise = zonePriceService.getZonePrice(originStr, destStr);
          const zpTimeout = new Promise<null>(res => setTimeout(() => res(null), 1200));
          zp = await Promise.race([zpPromise, zpTimeout]);
        } catch { /* ignore */ }

        const priceKz = zp?.price_kz ?? Math.max(500, Math.round(500 + route.distanceKm * 250));
        const vehicleType = (args.vehicle_type as any) || 'standard';

        if (import.meta.env.DEV) {
          console.debug('[KazeAppAgent] request_ride resolved:', {
            originStr, originCoords,
            destStr, destCoords,
            route: { distanceKm: route.distanceKm, durationMin: route.durationMin },
            zonePrice: zp?.price_kz ?? null,
            priceKz, vehicleType,
          });
        }

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
    context: { userId?: string; userRole?: string; userLocation?: LatLng | null; userAddress?: string | null; hasActiveRide?: boolean }
  ): Promise<KazeAgentResult> {
    const text = message.toLowerCase();

    // 1. Pedir Corrida
    if (/(?:pede|pedir|chama|chamar|quero|preciso de|levar|leva[- ]me|ir |vai |corrida|t[aá]xi|carro|motogo)\b/i.test(text) && !/agenda|amanh|saldo|contrato/i.test(text)) {
      let origin: string | undefined;
      let dest: string | undefined;

      // Estratégia A: "de/da/do/desde X para/ao/até/pra Y"
      const routeMatch = text.match(/(?:de|da|do|desde)\s+([^,]+?)\s+(?:para|até|ao|à|pro|pra)\s+(.+)/i);
      if (routeMatch) {
        const rawOrig = (routeMatch[1] ?? '').trim();
        if (/minha localiza|onde estou|aqui|minha posi|daqui/i.test(rawOrig)) {
          origin = undefined; // Usar GPS real
        } else {
          origin = cleanDestinationQuery(rawOrig);
        }
        dest = cleanDestinationQuery(routeMatch[2] ?? '');
      }

      // Estratégia B: "para/ao/até/pro/no X"
      if (!dest || dest.length < 2) {
        const destMatch = text.match(/(?:para|pra|pro|ao|à|até|no|na)\s+(?:o\s+|a\s+)?(.+)/i);
        if (destMatch) {
          dest = cleanDestinationQuery(destMatch[1] ?? '');
        }
      }

      // Estratégia C: limpar texto completo (último recurso)
      if (!dest || dest.length < 2) {
        dest = cleanDestinationQuery(text);
      }

      // Se o utilizador disse "da minha localização", "onde estou", etc., garantir que origin é undefined
      if (/minha localiza|onde estou|aqui|minha posi|daqui/i.test(text)) {
        origin = undefined;
      }

      // Se ainda não temos destino válido, PERGUNTAR ao utilizador em vez de enviar lixo
      if (!dest || dest.length < 2 || /^(corrida|táxi|taxi|carro|viagem|motogo)$/i.test(dest)) {
        return {
          text: 'Para onde gostarias de ir em Luanda, mano? Diz-me o destino! 🗺️',
          speakText: 'Para onde queres ir?',
        };
      }

      if (import.meta.env.DEV) {
        console.debug('[KazeAppAgent] _processLocalIntent request_ride:', { origin, dest, rawMessage: message });
      }

      return await this._resolveToolAction('request_ride', { destination: dest, origin }, '', context, message);
    }

    // 2. Agendar Corrida
    if (/agenda|agendar/i.test(text)) {
      const timeMatch = text.match(/(\d{1,2}(?::\d{2})|\d{1,2}h|\d{1,2}\s+horas?)/i);
      const time = timeMatch ? timeMatch[0].replace('h', ':00').replace(' horas', ':00').padStart(5, '0') : '08:00';

      // Extrair destino do agendamento
      const destMatch = text.match(/(?:para|pra|pro|ao|à|até|no|na)\s+(?:o\s+|a\s+)?(.+?)(?:\s+(?:às|as|para|amanha|hoje|$))/i);
      const dest = destMatch ? cleanDestinationQuery(destMatch[1] ?? '') : cleanDestinationQuery(text);
      const isTomorrow = /amanh[aã]/i.test(text);

      return await this._resolveToolAction('schedule_ride', {
        destination: dest || 'Aeroporto 4 de Fevereiro',
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

    // 7. Conversa natural e inteligente offline / local (sem respostas robóticas repetitivas)
    const localReply = getLocalKazeResponse(text);
    return {
      text: localReply,
      speakText: localReply,
    };
  }
}

export const kazeAppAgent = new KazeAppAgent();
