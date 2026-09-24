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
import { cotarPreco, fraseDoPreco } from './fareQuote';
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
  /**
   * Preço em Kwanzas, ou `null` quando o motor de tarifação não respondeu.
   * `null` é deliberado: antes havia aqui um fallback inventado
   * (`500 + distância × 250`) e o Kaze chegava a dizer esse número em voz alta
   * ao passageiro. Um preço inventado é pior do que nenhum.
   */
  priceKz: number | null;
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

import { getResolvedKazeGroqKey, getResolvedKazeOpenRouterKey } from '../lib/kazeKey';

export const FRONTEND_GROQ_KEY = getResolvedKazeGroqKey();

/**
 * Rota HTTP alternativa para modelos Gemini 3.x (via OpenRouter).
 * Fica vazia se a chave não estiver configurada — nesse caso a rota é saltada
 * silenciosamente e a cadeia segue para o elo seguinte.
 */
export const FRONTEND_OPENROUTER_KEY = getResolvedKazeOpenRouterKey();

// Chave do Gemini no frontend: DELIBERADAMENTE VAZIA.
//
// A chave anterior foi marcada pela Google como "leaked" e revogada — porque
// uma variável com prefixo GEMINI_/VITE_ é INLINADA no bundle pelo Vite
// (ver envPrefix em vite.config.ts), ficando visível a qualquer visitante.
//
// O caminho Google directo vive agora no servidor: Edge Function `gemini-proxy`,
// que lê o secret GEMINI_API_KEY. Com esta constante vazia, o bloco
// `if (FRONTEND_GEMINI_KEY)` abaixo é saltado e a cadeia segue para a rota
// OpenRouter/Gemini 3.x, que está a funcionar.
//
// ⚠️ NÃO repor uma chave aqui. Para Gemini no cliente, usa o Edge Function.
const FRONTEND_GEMINI_KEY = '';

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
  q = q.replace(/^(?:uma corrida|corrida|um táxi|táxi|um taxi|taxi|um carro|carro|uma viagem|viagem|uma moto|moto|um mambo|o mambo)\s+/i, '');

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
export const KAZE_APP_TOOLS = [
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
              description: 'Tipo de viatura: standard (táxi normal), moto (Zenith Moto), comfort ou xl',
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

export const KAZE_AGENT_SYSTEM_PROMPT = `Tu és o KAZE, o assistente de inteligência artificial de elite e executivo da Zenith Ride em Luanda, Angola.

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

═══ O QUE É A ZENITH RIDE ═══
- A Zenith Ride é uma plataforma angolana de mobilidade urbana, criada para Luanda e a operar em Angola.
- Liga passageiros a motoristas verificados, com preço acordado ANTES da viagem começar — sem surpresas no fim.
- Serviços: Táxi Standard, Zenith Moto (mais barato, ideal para o trânsito), Comfort (mais confortável), XL (para grupos), Motorista Privado, Fretes e Charter, e Contratos de transporte recorrente (escolar, familiar e empresarial).
- Todos os motoristas são verificados (BI/Passaporte e Carta de Condução) e as viagens são rastreadas.
- Tem Safety Shield com partilha de viagem em tempo real e um sistema de emergência que avisa o contacto de segurança do passageiro.

═══ O FUNDADOR — DECORAR ISTO ═══
- O fundador da Zenith Ride chama-se **Dánio Silva**.
- É um jovem empreendedor de Luanda, e criou a Zenith Ride para transformar o transporte urbano em Angola com foco em excelência e inovação.
- Se te perguntarem quem fundou, quem criou ou quem é o dono da Zenith Ride, respondes **Dánio Silva**. Só esse nome.
- Se não tiveres a certeza de um nome, NÃO inventes: diz que não tens essa informação confirmada. Inventar o nome de uma pessoa real é grave.

═══ PREÇOS — REGRA INVIOLÁVEL ═══
- NUNCA digas um preço de memória. NUNCA faças contas de preço. NUNCA cites uma "taxa base" nem um "preço por km".
- O preço é calculado pelo motor de tarifação da plataforma. Muda quando o negócio quiser, sem actualização da app — logo qualquer número que tenhas decorado está desactualizado.
- Se te pedirem quanto custa uma viagem: prepara o trajecto com a ferramenta request_ride (é ela que traz o preço real) ou diz que o valor exacto aparece no ecrã para o trajecto em questão.
- Frases correctas: "O preço exacto aparece no ecrã assim que escolheres o destino." / "Deixa-me preparar o trajecto — o valor que vês no ecrã é o valor que pagas."
- Inventar um preço é o pior erro que podes cometer: o passageiro decide com base nele. Mais vale não dizer número nenhum.

═══ QUEM ÉS TU, QUEM FALA E ONDE ESTÃO ═══
- Quem és tu: Tu és o KAZE, a Inteligência Artificial e assistente de mobilidade da Zenith Ride.
- Onde estás / onde estamos: Estás em Luanda, Angola, integrado na plataforma Zenith Ride e pronto para apoiar o utilizador na sua jornada urbana.
- Quem é o utilizador: Se souberes o nome no bloco [ESTÁS A FALAR COM: …], trata a pessoa pelo nome próprio ("Tu és o [nome]"). Se não tiveres o nome confirmado, trata com respeito e proximidade ("mano", "parceiro").
- Onde está o utilizador: Se te perguntarem "onde estou?", responde com o que está no bloco de localização. Se estiverem em Luanda, confirma que estão em Luanda, Angola, e indica o bairro/endereço exacto disponível.
- Se houver corrida activa e te perguntarem pela corrida, usa as ferramentas do app para agir sobre ela (cancelar, ver histórico) em vez de descreveres de memória.
- Sobre o tempo de chegada ou a posição exacta do motorista: quem sabe é o ecrã da corrida, em tempo real. Não inventes minutos nem distâncias.

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

/**
 * Contexto real que se anexa ao fim do prompt do Kaze.
 *
 * ⚠️ PORQUE É QUE ISTO EXISTE COMO FUNÇÃO E NÃO COMO CÓDIGO INLINE:
 * O KAZE_AGENT_SYSTEM_PROMPT promete ao modelo, em texto, que recebe sempre um
 * bloco `[ESTÁS A FALAR COM: …]` e um bloco `[LOCALIZAÇÃO ACTUAL DO PASSAGEIRO:
 * …]` e, quando existe, um bloco `[O passageiro tem uma corrida activa neste
 * momento.]`. Essa promessa estava a ser cumprida de forma desigual: o caminho
 * de voz (kazeLiveClient) enviava dois dos três, mas os dois caminhos de texto
 * (Gemini e OpenAI-compatible) só enviavam a localização — o `hasActiveRide` era
 * aceite no contexto e nunca usado.
 *
 * Um prompt que promete dados que não chegam é pior do que um prompt sem
 * promessa nenhuma: o modelo ou inventa a informação em falta, ou responde a
 * pedir algo que já lá devia estar. Com uma única função, os blocos passam a ser
 * impossíveis de esquecer num dos caminhos.
 *
 * O bloco do nome entrou por último e pelo mesmo motivo: o `KazeMascot` já
 * recebia `userName` e já cumprimentava a pessoa pelo nome, mas a conversa a
 * partir daí corria sem ele — o Kaze falava sem saber com quem, e um modelo sem
 * o nome no contexto tem tendência a inventá-lo.
 */
export interface ContextoDeVoz {
  userName?: string | null;
  userLocation?: LatLng | null;
  userAddress?: string | null;
  hasActiveRide?: boolean;
}

/**
 * Contexto completo do agente: o que a voz usa, mais o que só o texto usa.
 *
 * Existe para que os três caminhos (voz, Gemini, OpenAI-compatible) partilhem
 * UM tipo. Antes, cada método declarava o seu objecto inline — e foi assim que
 * o `hasActiveRide` ficou aceite-mas-nunca-usado num deles. Um campo a mais
 * numa assinatura e a menos noutra não dá erro nenhum: dá um prompt a prometer
 * dados que não chegam. Com um tipo único, acrescentar um campo obriga a
 * olhar para todos os sítios.
 */
export interface ContextoDoAgente extends ContextoDeVoz {
  userId?: string;
  userRole?: string;
  pendingAction?: KazeProposedAction | null;
}

export function blocoDeContexto(context: ContextoDeVoz): string {
  // O nome vem primeiro, e é o bloco que faltava. O Kaze cumprimentava o
  // utilizador pelo nome no arranque (`KazeMascot`), mas a partir daí falava
  // sem saber com quem — e a "quem estou a falar?" respondia com uma
  // generalidade. Pior: sem o nome no contexto, o modelo tem tendência a
  // inventá-lo, e inventar o nome de uma pessoa real é o erro que já nos
  // custou uma sessão inteira (o "Jão Silva").
  const quem = context.userName
    ? `\n[ESTÁS A FALAR COM: ${context.userName}]`
    : '\n[QUEM ESTÁ A FALAR: utilizador da Zenith Ride (nome não especificado no perfil).]';

  const localizacao = context.userAddress
    ? `\n[LOCALIZAÇÃO ACTUAL DO UTILIZADOR: "${context.userAddress}", Luanda, Angola]`
    : context.userLocation
      ? `\n[LOCALIZAÇÃO ACTUAL DO UTILIZADOR: GPS (${context.userLocation.lat.toFixed(4)}, ${context.userLocation.lng.toFixed(4)}), Luanda, Angola]`
      : '\n[LOCALIZAÇÃO ACTUAL DO UTILIZADOR: Luanda, Angola (coordenadas GPS a sincronizar com o mapa).]';

  const corrida = context.hasActiveRide
    ? '\n[O utilizador tem uma corrida activa neste momento.]'
    : '';

  return `${quem}${localizacao}${corrida}`;
}

/**
 * Orçamento de tempo para resolver uma ferramenta pedida pela VOZ.
 *
 * Porque existe: a Live API só aceita *function calling* síncrono — o modelo
 * fica bloqueado à espera do `sendToolResponse`. O caminho `request_ride`
 * geocodifica o destino e a origem, e essas chamadas ao Mapbox **não tinham
 * limite nenhum**: com a rede pendurada, o `sendToolResponse` nunca saía, o
 * turno morria e o Kaze ficava em silêncio absoluto.
 *
 * Medido contra o código real (`.tmp-kaze-ferramenta-voz.mjs`, rede pendurada):
 *   - destino conhecido → ~2,2 s de silêncio
 *   - destino desconhecido → **nunca respondia**
 *
 * 2,5 s deixa passar os casos que hoje já funcionam (2,2 s) e transforma o
 * silêncio infinito numa resposta honesta. Não altera preços nem rotas.
 */
const PRAZO_FERRAMENTA_VOZ_MS = 2_500;

export class KazeAppAgent {
  /**
   * Processa a mensagem do utilizador e determina se há acção para executar no app
   */
  async processUserMessage(
    message: string,
    context: ContextoDoAgente
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

    // ── 3. Gemini 3.x via OpenRouter (rota HTTP independente) ────────────────
    //  Independente da chave directa do Google: se uma rota cair, esta segura.
    if (FRONTEND_OPENROUTER_KEY) {
      try {
        const orResult = await this._callOpenRouterGeminiWithTools(trimmed, context);
        if (orResult) return orResult;
      } catch (err) {
        console.warn('[KazeAppAgent] OpenRouter/Gemini 3.x falhou:', err);
      }
    }

    // ── 4. Tentar via Gemini Function Calling (IA Nativa de reserva) ───────────
    if (FRONTEND_GEMINI_KEY) {
      try {
        const aiResult = await this._callGeminiWithTools(trimmed, context);
        if (aiResult) return aiResult;
      } catch (err) {
        console.warn('[KazeAppAgent] Gemini tool call falhou, usando analisador local:', err);
      }
    }

    // ── 5. Fallback Local Inteligente (Regex & NLP local sem rede) ───────────
    return await this._processLocalIntent(trimmed, context);
  }

  /**
   * Resolve uma tool call vinda de uma sessão **Live (voz)** reutilizando
   * exactamente a mesma lógica de `_resolveToolAction` que o Groq/Gemini usam.
   *
   * Puramente aditivo — não altera nenhum fluxo existente. Existe para que a
   * voz bidirecional do Kaze possa despoletar acções reais (pedir corrida,
   * agendar, abrir contrato) sem duplicar a camada de resolução de intenções
   * nem manter duas fontes de verdade sobre o que cada ferramenta faz.
   */
  async resolveToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context: ContextoDoAgente,
    fallbackText = '',
    rawUserMessage = '',
  ): Promise<KazeAgentResult> {
    const resolvido = await this._comPrazo(
      this._resolveToolAction(toolName, args, fallbackText, context, rawUserMessage),
      PRAZO_FERRAMENTA_VOZ_MS,
    );

    if (resolvido) return resolvido;

    // O prazo estourou. O modelo TEM de receber alguma coisa — é a única forma
    // de o Live continuar a conversa em vez de ficar à espera para sempre.
    return {
      text: 'Não consegui confirmar os detalhes agora. Podes repetir o destino, mano?',
      speakText: 'Não consegui confirmar isso agora. Podes dizer outra vez?',
    };
  }

  /**
   * Corre `tarefa` com um tecto de tempo. Devolve `null` se o prazo estourar.
   *
   * Usa `Promise.race` e não `AbortController` porque as chamadas que podem
   * pendurar-se estão em `mapService`, que ainda não aceita um sinal em todas
   * as rotas. O pedido pendurado fica pendurado — mas o Kaze responde na
   * mesma, que é o que o utilizador ouve. Fica aqui o único ponto a mudar
   * quando o `mapService` passar a cancelar a sério.
   */
  private async _comPrazo<T>(
    tarefa: Promise<T>,
    ms: number,
  ): Promise<T | null> {
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<null>((res) => {
      temporizador = setTimeout(() => res(null), ms);
    });

    try {
      return await Promise.race([tarefa, prazo]);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  /**
   * Chamada a qualquer endpoint compatível com OpenAI (Groq, OpenRouter, …) em
   * modo JSON, resolvendo acções pelo mesmo `_resolveToolAction`.
   *
   * Existe para que todas as rotas HTTP de texto do Kaze partilhem uma única
   * implementação — o prompt, o parsing e o tratamento de erros não são
   * duplicados. Comportamento idêntico ao anterior, apenas parametrizado.
   */
  private async _callOpenAiCompatibleWithTools(
    endpoint: string,
    apiKey: string,
    models: string[],
    message: string,
    context: ContextoDoAgente,
    timeoutMs = 4500,
  ): Promise<KazeAgentResult | null> {
    if (!apiKey) return null;

    const userLocContext = blocoDeContexto(context);

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

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
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
          console.warn(`[KazeAppAgent] ${model} status ${res.status}`);
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
        console.warn(`[KazeAppAgent] Erro ao chamar ${model}:`, err);
      }
    }

    return null;
  }

  /**
   * Chamada primária de alta performance via Groq (Qwen 3.8 27B / Compound)
   * Suporta extração de intenções, chamadas de acções e conversa rica em português de Luanda
   */
  private async _callGroqWithTools(
    message: string,
    context: ContextoDoAgente
  ): Promise<KazeAgentResult | null> {
    return this._callOpenAiCompatibleWithTools(
      'https://api.groq.com/openai/v1/chat/completions',
      FRONTEND_GROQ_KEY,
      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      message,
      context,
    );
  }

  /**
   * Rota alternativa com **Gemini 3.x** servido por HTTP via OpenRouter.
   *
   * Porque existe: o Live API (voz) precisa da chave directa do Google, mas os
   * modelos Gemini 3.x de *texto* também estão disponíveis via OpenRouter. Isto
   * dá uma segunda rota independente — se uma chave cair, a outra mantém o Kaze
   * a conversar. Timeout mais generoso porque o pedido atravessa mais hops.
   */
  private async _callOpenRouterGeminiWithTools(
    message: string,
    context: ContextoDoAgente
  ): Promise<KazeAgentResult | null> {
    return this._callOpenAiCompatibleWithTools(
      'https://openrouter.ai/api/v1/chat/completions',
      FRONTEND_OPENROUTER_KEY,
      ['google/gemini-3.1-flash-lite', 'google/gemini-3.5-flash-lite', 'google/gemini-2.5-flash'],
      message,
      context,
      7000,
    );
  }

  /**
   * Chamada de reserva à API do Gemini com declarações de ferramentas (tools)
   */
  private async _callGeminiWithTools(
    message: string,
    context: ContextoDoAgente
  ): Promise<KazeAgentResult | null> {
    const userLocContext = blocoDeContexto(context);

    const systemInstruction = `${KAZE_AGENT_SYSTEM_PROMPT}${userLocContext}`;

    // Gemini 3.1 primeiro — é o modelo que queremos para a demo.
    // Os restantes ficam como degradação progressiva se a cota apertar.
    const modelsToTry = [
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
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
    context: ContextoDoAgente,
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

        // ── Preço: SEMPRE pelo motor real, nunca por uma fórmula local ──────
        // Antes isto era `zp?.price_kz ?? Math.max(500, Math.round(500 +
        // route.distanceKm * 250))` — uma fórmula de tarifa escrita em
        // TypeScript, que é exactamente o que este projecto proíbe, e que o
        // Kaze dizia em voz alta. Agora passa tudo por `cotarPreco`, que
        // respeita a prioridade zona-fixa → motor e devolve `null` em vez de
        // inventar.
        const cotacao = await cotarPreco({
          origemNome: originStr,
          destinoNome: destStr,
          origemCoords: originCoords,
          destinoCoords: destCoords,
          distanciaKm: route.distanceKm,
          duracaoMin: route.durationMin,
          tipoVeiculo: (args.vehicle_type as KazeProposedRide['vehicleType']) || 'standard',
          prazoZonaMs: 1200,
        });

        const priceKz = cotacao.precoKz;
        const vehicleType = (args.vehicle_type as any) || 'standard';

        if (import.meta.env.DEV) {
          console.debug('[KazeAppAgent] request_ride resolved:', {
            originStr, originCoords,
            destStr, destCoords,
            route: { distanceKm: route.distanceKm, durationMin: route.durationMin },
            preco: { valor: priceKz, fonte: cotacao.fonte, motivo: cotacao.motivo },
            vehicleType,
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

        const detalheRota = `🚗 Rota: ${originStr} → ${destStr} (~${route.distanceKm.toFixed(1)} km)`;
        const summaryText =
          priceKz != null
            ? `${detalheRota} · ~${priceKz.toLocaleString('pt-AO')} Kz`
            : detalheRota;

        const frase = fraseDoPreco(cotacao, destStr);

        return {
          text: `Encontrei o melhor trajecto de **${originStr}** para **${destStr}**!\n\n${summaryText}\n\n${frase}\n\nQueres que eu peça a corrida agora?`,
          speakText: `Encontrei o trajecto para ${destStr}. ${frase} Queres que confirme?`,
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
    context: ContextoDoAgente
  ): Promise<KazeAgentResult> {
    const text = message.toLowerCase();

    // 1. Pedir Corrida
    if (/(?:pede|pedir|chama|chamar|quero|preciso de|levar|leva[- ]me|ir |vai |corrida|t[aá]xi|carro|moto)\b/i.test(text) && !/agenda|amanh|saldo|contrato/i.test(text)) {
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
      if (!dest || dest.length < 2 || /^(corrida|táxi|taxi|carro|viagem|moto)$/i.test(dest)) {
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
