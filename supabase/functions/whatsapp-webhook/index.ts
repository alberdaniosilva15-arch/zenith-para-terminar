// =============================================================================
// ZENITH RIDE — Edge Function: whatsapp-webhook
// Integração do Bot Lukéni com o WhatsApp (Meta Cloud API)
//
// Este ficheiro tem três responsabilidades:
//
//   1. Verificação do webhook (GET) e autenticação dos POST.
//   2. Duas acções internas chamadas pela app (src/services/rideService.ts):
//        - driver_fallback_for_ride
//        - passenger_ride_accepted
//   3. O fluxo conversacional de pedido de corrida por WhatsApp.
//
// ── O fluxo de corrida ───────────────────────────────────────────────────────
//   O passageiro manda a LOCALIZAÇÃO (ou escreve "corrida")
//     -> o bot pede o destino
//     -> o bot geocodifica o destino (Mapbox) e calcula rota + preço
//     -> o bot mostra o preço e pede confirmação
//     -> o passageiro confirma
//     -> o bot cria a corrida e notifica os motoristas mais próximos
//     -> o motorista responde "ACEITAR <código>"
//     -> o passageiro recebe os dados do motorista
//
// O estado de cada conversa vive em `bot_conversations`, uma linha por telefone.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsForbidden,
  corsHeadersToObject,
  resolveCorsHeaders,
} from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ⚠️ Os nomes reais dos secrets no Supabase são WA_ACCESS_TOKEN e
// WA_PHONE_NUMBER_ID — é o que dispatch-cascade e safety-watchdog já usam.
// Este ficheiro lia WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID, que NÃO
// existem. Consequência: sendWhatsAppMessage() caía sempre no ramo "mock",
// escrevia a mensagem no log e devolvia `true` — reportava sucesso sem ter
// enviado nada. Falha silenciosa, e a razão de nenhum motorista receber
// pedidos de corrida.
//
// Aceitam-se os dois nomes para não quebrar quem já configure o antigo.
const WHATSAPP_API_TOKEN =
  Deno.env.get('WA_ACCESS_TOKEN') ?? Deno.env.get('WHATSAPP_API_TOKEN') ?? '';
const WHATSAPP_PHONE_NUMBER_ID =
  Deno.env.get('WA_PHONE_NUMBER_ID') ?? Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';

// ⚠️ SEM valor por omissão. Antes era `?? 'zenith_lukeni_secret'`, ou seja,
// um segredo escrito à mão no código-fonte — ficava no histórico do git para
// sempre e não se rodava sem alterar e re-deployar o ficheiro.
//
// Aceita os dois nomes porque o projecto tem os dois em sítios diferentes:
// o secret realmente definido no Supabase chama-se WA_VERIFY_TOKEN.
const WHATSAPP_VERIFY_TOKEN =
  Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? Deno.env.get('WA_VERIFY_TOKEN') ?? '';

// Segredo da app Meta, usado para validar a assinatura HMAC dos POST.
// Já estava configurado no Supabase, mas o código nunca o usava.
const WHATSAPP_APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';

// Janela de tolerância para mensagens recebidas.
//
// Quando o bot está desligado, a Meta guarda as mensagens e entrega-as todas de
// uma vez quando voltamos a estar online. Sem este corte, o bot respondia a SMS
// de dias antes — parecia avariado e enchia o utilizador com respostas a coisas
// que já não interessam.
//
// 15 minutos cobrem atrasos normais de rede e reenvios da Meta, e cortam o
// histórico acumulado. Afinável por secret (WHATSAPP_JANELA_MENSAGEM_MIN).
const JANELA_MENSAGEM_SEGUNDOS = (() => {
  const minutos = Number(Deno.env.get('WHATSAPP_JANELA_MENSAGEM_MIN') ?? '');
  if (Number.isFinite(minutos) && minutos > 0) return Math.floor(minutos * 60);
  return 15 * 60;
})();

// Validade de uma sessão de conversa (por inactividade).
//
// ⚠️ BUG REAL. O estado de cada conversa vive em `bot_conversations` e NINGUÉM
// o expirava. O Dánio pediu uma corrida a 15/09, voltou a 20/09 e o bot abriu
// com "só falta aquilo que me pediste" — a retomar um fluxo de CINCO DIAS antes,
// como se não tivesse passado nada. Não é o modelo que está confuso: é a sessão
// que nunca morreu.
//
// Uma sessão sem corrida viva morre ao fim disto. Com corrida viva (a procurar,
// aceite, a caminho ou a decorrer) NUNCA expira — o passageiro pode demorar a
// responder e isso não pode custar-lhe a viagem.
// Afinável por secret (WHATSAPP_SESSAO_MIN).
const SESSAO_VALIDADE_MINUTOS = (() => {
  const minutos = Number(Deno.env.get('WHATSAPP_SESSAO_MIN') ?? '');
  if (Number.isFinite(minutos) && minutos > 0) return minutos;
  return 30;
})();

/** Estados de corrida em que a sessão tem de sobreviver a tudo. */
const CORRIDA_VIVA = new Set(['searching', 'accepted', 'picking_up', 'in_progress']);

// Geocodificação de endereços escritos à mão (o pin de localização já traz
// coordenadas e não precisa disto).
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_TOKEN') ?? '';

const CORS_OPTIONS = {
  methods: 'GET, POST, OPTIONS',
};

// ─── Preços ──────────────────────────────────────────────────────────────────
// NÃO existe fórmula de preço neste ficheiro — de propósito.
//
// A fonte de verdade é a função Postgres `calculate_fare_engine_pro`, que lê a
// tabela `pricing_config` (tarifa base, Kz/km, Kz/min, surge, pesos de zona,
// escalões de utilizador, taxas nocturna/aeroporto/trânsito). É exactamente a
// mesma função que o app usa em `PassengerHome.handleConfirmRoute`, por isso o
// preço que o Lukéni diz no WhatsApp é o mesmo que o passageiro veria no app.
//
// Quando o admin mexer nos preços, o bot apanha a alteração no pedido seguinte,
// sem deploy nenhum. Duplicar a fórmula aqui foi um erro que já foi corrigido —
// não voltar a fazê-lo.
const ENGINE_PRECO_RPC = 'calculate_fare_engine_pro';

// Mapa de zonas — CÓPIA EXACTA de `LUANDA_ZONE_MAP` em src/services/zonePrice.ts.
// Os 11 valores canónicos (Benfica, Cazenga, Centro, Kilamba, Luanda Norte,
// Maianga, Miramar, Rangel, Samba, Talatona, Viana) são os únicos que existem em
// `zone_prices`. Se o mapa do app mudar, este tem de mudar com ele.
const LUANDA_ZONE_MAP: Record<string, string> = {
  // Viana
  'Viana': 'Viana',
  'Petrangol': 'Viana',
  'Cacuaco': 'Viana',
  'Km 30': 'Viana',
  'Catete': 'Viana',

  // Kilamba
  'Kilamba': 'Kilamba',
  'Kilamba Kiaxi': 'Kilamba',
  'Zango': 'Kilamba',
  'Zango 1': 'Kilamba',
  'Zango 2': 'Kilamba',

  // Talatona
  'Talatona': 'Talatona',
  'Benfica Sul': 'Talatona',
  'Camama': 'Talatona',
  'Golf': 'Talatona',
  'Belas': 'Talatona',
  'Belas Shopping': 'Talatona',

  // Centro / Ilha
  'Centro': 'Centro',
  'Ilha de Luanda': 'Centro',
  'Ilha': 'Centro',
  'Ingombota': 'Centro',
  'Mutamba': 'Centro',
  'Largo do Kinaxixi': 'Centro',
  'Praia do Bispo': 'Centro',

  // Miramar
  'Miramar': 'Miramar',
  'Alvalade': 'Miramar',
  'Maianga': 'Maianga',
  'Patrice Lumumba': 'Maianga',

  // Cazenga
  'Cazenga': 'Cazenga',
  'Palanca': 'Cazenga',
  'Vila Alice': 'Cazenga',
  'Rocha Pinto': 'Cazenga',

  // Rangel
  'Rangel': 'Rangel',
  'Hoji ya Henda': 'Rangel',
  'Golfe': 'Rangel',

  // Samba
  'Samba': 'Samba',
  'Golf 2': 'Samba',
  'Camanga': 'Samba',

  // Benfica
  'Benfica': 'Benfica',
  'Cacuaco Norte': 'Benfica',

  // Luanda Norte
  'Luanda Norte': 'Luanda Norte',
  'Viana Norte': 'Luanda Norte',
  'Sequele': 'Luanda Norte',
};

// O app procura a palavra-chave MAIS LONGA primeiro, para "Benfica Sul" dar
// Talatona e não Benfica. Pré-ordenamos uma vez, em vez de ordenar a cada chamada.
const ZONAS_POR_ESPECIFICIDADE: Array<[string, string]> = Object
  .entries(LUANDA_ZONE_MAP)
  .sort((a, b) => b[0].length - a[0].length);

// O PassengerHome envia 5/5 por omissão quando ainda não contou os motoristas
// por perto; com 5/5 o surge do motor fica em 1.5x. É o mesmo número que o app
// mostra nas mesmas circunstâncias.
const DEMANDA_PADRAO = 5;
const OFERTA_PADRAO = 5;

// O `routeService` do app fixa o factor de trânsito em 1.2, que fica abaixo do
// `traffic_threshold` de 1.3 do pricing_config — logo a taxa de trânsito não
// se aplica. Mantemos igual para o preço bater certo com o app.
const TRANSITO_FACTOR = 1.2;

// Aeroporto 4 de Fevereiro — o app considera "aeroporto" dentro de 1 km.
const AEROPORTO = { lat: -8.8577, lng: 13.2312 };
const AEROPORTO_RAIO_KM = 1.0;

// Luanda — usado como viés de proximidade na geocodificação.
const LUANDA = { lat: -8.8383, lng: 13.2344 };

// ─── Tipos ───────────────────────────────────────────────────────────────────

// Os nomes têm de ser exactamente estes: `bot_conversations.state` tem um
// CHECK constraint (idle, awaiting_origin, awaiting_dest, awaiting_confirm,
// dispatching, in_ride, completed). Nomes fora desta lista são rejeitados
// pela base de dados.
type Estado =
  | 'idle'
  | 'awaiting_origin'
  | 'awaiting_dest'
  | 'awaiting_confirm'
  | 'dispatching'
  // O bot não conhece o sítio que o utilizador escreveu e está a aprender:
  //   aprendendo_nome -> à espera que ele diga o nome (ou mande o pin)
  //   aprendendo_pin  -> já tem o nome, falta o pin para fixar as coordenadas
  | 'aprendendo_nome'
  | 'aprendendo_pin';

interface Sessao {
  id: string;
  phone: string;
  user_id: string | null;
  state: Estado;
  origin_address: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_address: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  estimated_price: number | null;
  ride_id: string | null;
  dispatch_attempt: number | null;
  // Contexto da aprendizagem (ver migração 20260916130000)
  aprendendo_slot: 'origem' | 'destino' | null;
  aprendendo_texto: string | null;
  aprendendo_nome: string | null;
  // Marcas de tempo — `updated_at` é o que decide se a sessão ainda vale.
  created_at: string | null;
  updated_at: string | null;
}

interface MensagemEntrante {
  telefone: string;         // dígitos, sem "+"
  nome: string;
  texto: string;
  tipo: string;             // text | location | interactive | ...
  lat: number | null;
  lng: number | null;
  descricaoLocal: string | null;
  msgId: string | null;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

function apenasDigitos(valor: unknown): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Normaliza para o formato que a Cloud API espera: 244XXXXXXXXX.
 * Devolve '' quando não há dígitos suficientes — antes devolvia sempre algo
 * (no mínimo "244"), o que apontava o envio para um número inexistente.
 */
function normalizarTelefone(telefone: string): string {
  const digitos = apenasDigitos(telefone);
  if (digitos.length < 9) return '';
  return digitos.startsWith('244') ? digitos : '244' + digitos;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function horaEmLuanda(): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Africa/Luanda',
    }).format(new Date()),
  );
}

/** Escapa um texto para poder entrar num RegExp sem o alterar. */
function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detecta a zona canónica a partir de um endereço escrito.
 *
 * ⚠️ ISTO É SÓ UM FALLBACK. A fonte normal da zona é o campo `zona` da tabela
 * `luanda_places`, atribuído por proximidade real das coordenadas. Esta função
 * só corre quando o local não veio da base.
 *
 * Duas correcções em relação à versão anterior:
 *   1. Fronteira de palavra em vez de `includes()`. Antes, "Centro Comercial
 *      do Golfe" continha "centro" e cotava a zona Centro; e "Golf" casava
 *      dentro de qualquer palavra que o contivesse.
 *   2. A palavra-chave tem de ter pelo menos 5 letras para casar no meio de
 *      uma frase — nomes curtos e comuns ("Ilha", "Golf") só valem quando são
 *      o endereço inteiro.
 */
function detectarZona(endereco: string): string | null {
  const baixo = endereco.toLowerCase().trim();
  const comEspacos = ` ${baixo} `;

  // 1. Endereço que é exactamente o nome da zona (o caso mais comum e seguro).
  for (const [palavra, zona] of ZONAS_POR_ESPECIFICIDADE) {
    if (baixo === palavra.toLowerCase()) return zona;
  }

  // 2. Palavra inteira dentro do endereço.
  for (const [palavra, zona] of ZONAS_POR_ESPECIFICIDADE) {
    const alvo = palavra.toLowerCase();
    if (alvo.length < 5) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escaparRegex(alvo)}([^a-z0-9]|$)`);
    if (re.test(comEspacos)) return zona;
  }
  return null;
}

function kz(valor: number): string {
  return Number(valor).toLocaleString('pt-AO', { maximumFractionDigits: 0 });
}

/**
 * Valida a assinatura `X-Hub-Signature-256` da Meta.
 *
 * A Meta assina o corpo cru com HMAC-SHA256 usando o App Secret. Sem esta
 * verificação, qualquer pessoa pode fazer POST de mensagens falsas — e este
 * webhook executa acções com service_role.
 *
 * A comparação é feita byte a byte sem saída antecipada, para não vazar
 * informação por diferença de tempo.
 */
async function verificarAssinaturaMeta(
  corpoCru: string,
  cabecalho: string,
  segredo: string,
): Promise<boolean> {
  if (!cabecalho.startsWith('sha256=')) return false;

  const recebido = cabecalho.slice('sha256='.length).toLowerCase();
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign(
    'HMAC',
    chave,
    new TextEncoder().encode(corpoCru),
  );
  const esperado = Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (esperado.length !== recebido.length) return false;

  let diferenca = 0;
  for (let i = 0; i < esperado.length; i += 1) {
    diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  }
  return diferenca === 0;
}

// ─── Envio ───────────────────────────────────────────────────────────────────

async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    // Falha ruidosa. Antes registava no log e devolvia `true`, portanto quem
    // chamava contava a mensagem como entregue e o problema ficava invisível.
    console.error(
      `[whatsapp-webhook] Credenciais WhatsApp ausentes (WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID). Mensagem NAO enviada para ${to}.`,
    );
    return false;
  }

  const cleanPhone = normalizarTelefone(to);
  if (!cleanPhone) {
    // Chega aqui quando o "telefone" é, por exemplo, um email — o que acontecia
    // porque get_cascade_drivers devolvia u.email na coluna phone.
    console.error(`[whatsapp-webhook] Destino invalido, sem digitos: "${to}". Mensagem NAO enviada.`);
    return false;
  }

  try {
    const res = await fetch(
      // v19.0 está obsoleta na Meta. As outras funções do projecto já usam
      // v21.0/v22.0 — alinhado aqui para não haver duas versões do contrato.
      `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
      }
    );

    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      console.error(
        `[whatsapp-webhook] A Meta recusou o envio para ${cleanPhone}: ${res.status} ${detalhe}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[whatsapp-webhook] Falha no envio WhatsApp API:', err);
    return false;
  }
}

/**
 * Marca a mensagem como lida e liga o indicador "a escrever…" no WhatsApp.
 *
 * É o detalhe que mais denuncia um robô: responder em 200 ms, sempre, sem
 * nunca aparecer "a escrever". A Meta aceita o `typing_indicator` na Cloud API;
 * se a versão da Graph API em uso não o aceitar, falha em silêncio — o
 * indicador é cosmético e a conversa não pode depender dele.
 */
async function marcarALer(msgId: string | null): Promise<void> {
  if (!WHATSAPP_API_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !msgId) return;
  try {
    await fetch(
      `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: msgId,
          typing_indicator: { type: 'text' },
        }),
      },
    );
  } catch {
    // Cosmético — nunca deve rebentar o fluxo.
  }
}

/**
 * Pausa curta e proporcional ao tamanho da resposta.
 *
 * Uma resposta instantânea a uma mensagem longa parece script. Não passa de
 * ~2 s para não atrasar o pedido nem aproximar o limite de tempo da função.
 */
async function pausaHumana(texto: string): Promise<void> {
  const ms = Math.min(2200, 450 + texto.length * 12);
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Geocodificação ──────────────────────────────────────────────────────────

interface Coordenadas {
  lat: number;
  lng: number;
  endereco: string;
  // Preenchidos quando o local veio da tabela `luanda_places` (ou do OSM).
  // A zona vem da BASE DE DADOS, não de comparação de palavras no endereço —
  // foi assim que o bot deixou de cotar a zona errada.
  zona?: string | null;
  categoria?: string | null;
  origemLocal?: 'tabela' | 'osm' | 'mapbox' | 'aprendido';
  confianca?: number;
  localId?: string | null;
}

/**
 * Onde fica um sítio e a que zona pertence.
 * O pin de localização do WhatsApp não passa pelo geocoding de texto — já
 * traz lat/lng; para esse caso existe `resolverPonto`.
 */

// ─── Geocodificação: tabela → OpenStreetMap → Mapbox ────────────────────────
//
// HISTÓRIA (medida contra as APIs, não suposta):
//
//   Antes, isto perguntava só ao Mapbox. O geocoding do Mapbox desta conta NÃO
//   tem bairros de Luanda. Resultado real:
//     "Zango"            -> Zangon Kataf, Kaduna, NIGÉRIA
//     "Rocha Pinto"      -> Pintos, Rocha, URUGUAI
//     "Golfe Cidade Alta"-> Alto Kauale, Província do UÍGE (300 km de Luanda)
//   E quando acertava num município ("Talatona"), devolvia o CENTRO do
//   município — nunca o sítio exacto. Daí as queixas: "zonas que o bot não
//   conhece" e "não coloca a localização exacta".
//
//   Agora a ordem é:
//     1. `luanda_places` (base local com ~15 000 locais reais de Luanda +
//        Icolo e Bengo, extraídos do OpenStreetMap) — instantâneo, sem rede;
//     2. Nominatim/OSM — para o que ainda não está na base; o resultado é
//        GUARDADO na tabela, ou seja o bot aprende sozinho a cada pesquisa;
//     3. Mapbox — último recurso, já só para municípios.
//
//   Quando nada disto resolve, o bot entra em modo de APRENDIZAGEM: pergunta
//   ao utilizador o nome e a localização e guarda o sítio para sempre.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
// Identificação obrigatória pela política de uso do Nominatim.
const NOMINATIM_UA = 'ZenithRide/1.0 (+https://zenith-ride-build.vercel.app)';
// Caixa de Luanda metropolitana + Icolo e Bengo (oeste,sul,leste,norte).
const LUANDA_VIEWBOX = '12.95,-9.70,14.40,-8.55';

// O Nominatim limita a 1 pedido por segundo. Esta marca é de módulo: o
// isolate da Edge Function é reaproveitado entre invocações, por isso a
// espera aplica-se ao processo todo e não a cada pedido.
let ultimoPedidoNominatim = 0;

async function esperarNominatim(): Promise<void> {
  const agora = Date.now();
  const decorrido = agora - ultimoPedidoNominatim;
  const MIN_MS = 1100;
  if (decorrido < MIN_MS) {
    await new Promise((r) => setTimeout(r, MIN_MS - decorrido));
  }
  ultimoPedidoNominatim = Date.now();
}

/**
 * Qualidade do tipo devolvido pelo OSM. Quanto MENOR, mais específico — e
 * mais perto daquilo que o passageiro quer dizer quando escreve um nome.
 * Um `place` genérico ("Província de Luanda") nunca deve ganhar a um bairro.
 */
function qualidadeTipoOsm(tipo: string): number {
  const ordem: Record<string, number> = {
    neighbourhood: 0, quarter: 1, suburb: 2, residential: 3,
    village: 4, hamlet: 5, city_district: 6, borough: 7,
    town: 8, municipality: 9, administrative: 10, city: 11,
    locality: 12, island: 13,
  };
  if (tipo in ordem) return ordem[tipo]!;
  // objetos dentro de um lugar (loja, posto, mercado) — aceitáveis, mas depois
  if (['fuel', 'pub', 'marketplace', 'bus_station', 'shop', 'bank', 'pharmacy',
       'restaurant', 'hotel', 'school', 'hospital'].includes(tipo)) return 30;
  // vias — só como último recurso dentro do OSM
  if (['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'].includes(tipo)) return 40;
  return 50;
}

/** Distância aproximada em metros entre dois pontos (Haversine). */
function metrosEntre(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

interface LocalTabela {
  id: string;
  nome: string;
  lat: number;
  lng: number;
  zona: string | null;
  categoria: string | null;
  origem: string;
  confianca: number;
  endereco_completo: string | null;
  similaridade: number;
  correspondencia: string;
}

/**
 * Palavras que, sozinhas, não identificam sítio nenhum. Se alguém escrever só
 * "rua" ou "mercado", o bot tem de perguntar qual — não pode escolher uma
 * "Rua 1" qualquer no meio de milhares. Sem isto, a base com 15 000 locais
 * transformava um pedido vago numa resposta confiante e errada.
 */
const NOMES_GENERICOS = new Set([
  'rua', 'avenida', 'av', 'alameda', 'estrada', 'beco', 'travessa',
  'bairro', 'zona', 'quarteirao', 'distrito', 'municipio', 'cidade', 'vila',
  'escola', 'mercado', 'igreja', 'hospital', 'clinica', 'farmacia', 'loja',
  'parque', 'praca', 'predio', 'edificio', 'casa', 'hotel', 'banco',
  'restaurante', 'bar', 'campo', 'centro', 'terminal', 'posto', 'oficina',
]);

/** Minúsculas sem acentos, igual ao `zr_normaliza_local` do Postgres. */
function normalizarNome(texto: string): string {
  return texto
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Um nome de sítio que NÃO identifica sítio nenhum.
 *
 * O `NOMES_GENERICOS` sozinho só apanha a palavra isolada ("rua"). Mas em
 * Luanda os dados do OSM estão cheios de "Rua 10", "Rua 11", "Avenida 5" — que
 * passam no teste de palavra isolada e, no entanto, não servem para nada:
 * existem dezenas de "Rua 10" na mesma cidade. Usar uma delas como nome do
 * ponto mandava o motorista para o sítio errado com toda a confiança.
 */
function ehNomeGenerico(nome: string): boolean {
  const n = normalizarNome(nome);
  if (NOMES_GENERICOS.has(n)) return true;
  // "rua 10", "avenida 5", "travessa 3b" — via numerada, não é referência.
  return /^(rua|avenida|av|alameda|estrada|beco|travessa|bairro|zona|quarteirao|quarteirão)\s+\d+\s*[a-z]?$/i.test(n);
}

/**
 * Passo 1: procurar na base local `luanda_places`.
 * Devolve null quando não há nada suficientemente parecido — um falso positivo
 * aqui é pior do que não responder, porque manda o motorista para o sítio errado.
 */
async function procurarNaTabela(
  supabaseAdmin: ReturnType<typeof createClient>,
  texto: string,
  ref?: { lat: number; lng: number } | null,
): Promise<LocalTabela | null> {
  const normalizado = normalizarNome(texto);
  if (NOMES_GENERICOS.has(normalizado)) {
    console.log(`[whatsapp-webhook] "${texto}" e um nome generico — nao resolvo da tabela.`);
    return null;
  }

  const { data, error } = await supabaseAdmin.rpc('resolver_local', {
    p_texto: texto,
    p_lat: ref?.lat ?? null,
    p_lng: ref?.lng ?? null,
  });

  if (error) {
    console.error('[whatsapp-webhook] resolver_local falhou:', error.message);
    return null;
  }

  const linha = (Array.isArray(data) ? data[0] : data) as LocalTabela | undefined;
  if (!linha) return null;

  // Aceitar só correspondências credíveis.
  const sim = Number(linha.similaridade ?? 0);
  const ok =
    linha.correspondencia === 'exato' ||
    // prefixo curto ("rua" -> "rua 1") só passa se o nome for longo
    (linha.correspondencia === 'prefixo' && (sim >= 0.45 || normalizado.length >= 6)) ||
    (linha.correspondencia === 'contido' && sim >= 0.5) ||
    sim >= 0.55;

  if (!ok) {
    console.log(
      `[whatsapp-webhook] "${texto}": melhor candidato "${linha.nome}" ` +
        `(${linha.correspondencia}, ${sim.toFixed(2)}) — fraco demais, ignorado.`,
    );
    return null;
  }
  return linha;
}

/** Passo 2: perguntar ao OpenStreetMap (Nominatim). */
async function geocodificarNoNominatim(
  texto: string,
  ref?: { lat: number; lng: number } | null,
): Promise<{ lat: number; lng: number; endereco: string; tipo: string } | null> {
  await esperarNominatim();

  const url = new URL(`${NOMINATIM_URL}/search`);
  url.searchParams.set('q', texto);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', 'pt');
  url.searchParams.set('countrycodes', 'ao');
  url.searchParams.set('viewbox', LUANDA_VIEWBOX);
  url.searchParams.set('bounded', '1');
  url.searchParams.set('addressdetails', '1');

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      console.error(`[whatsapp-webhook] Nominatim devolveu ${res.status} para "${texto}".`);
      return null;
    }
    const dados = await res.json() as Array<{
      lat?: string; lon?: string; display_name?: string; type?: string;
    }>;
    if (!Array.isArray(dados) || dados.length === 0) return null;

    // Ordenar por qualidade do tipo e, em empate, por proximidade ao ponto de
    // referência (quando o bot já sabe onde o passageiro está).
    const pontuados = dados
      .filter((d) => d.lat && d.lon)
      .map((d) => {
        const lat = Number(d.lat), lng = Number(d.lon);
        const tipo = d.type ?? '?';
        const dist = ref ? metrosEntre(ref.lat, ref.lng, lat, lng) : 0;
        return { lat, lng, tipo, dist, endereco: d.display_name ?? texto };
      })
      .sort((a, b) =>
        qualidadeTipoOsm(a.tipo) - qualidadeTipoOsm(b.tipo) || a.dist - b.dist);

    const melhor = pontuados[0];
    if (!melhor) return null;
    return melhor;
  } catch (err) {
    console.warn('[whatsapp-webhook] Nominatim falhou:', err);
    return null;
  }
}

/**
 * Passo 3: Mapbox — último recurso. Continua a servir para municípios, mas
 * nunca deve ganhar a um resultado do OSM. Resultados de tipo `region`/`place`
 * com relevância baixa são rejeitados: foi assim que "Golfe Cidade Alta"
 * acabava no Uíge.
 */
async function geocodificarNoMapbox(
  texto: string,
): Promise<{ lat: number; lng: number; endereco: string; tipo: string } | null> {
  if (!MAPBOX_TOKEN) return null;

  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(texto)}.json`,
  );
  url.searchParams.set('access_token', MAPBOX_TOKEN);
  url.searchParams.set('country', 'ao');
  url.searchParams.set('language', 'pt');
  url.searchParams.set('limit', '5');
  url.searchParams.set('proximity', `${LUANDA.lng},${LUANDA.lat}`);
  // Limitar à área de serviço: sem isto o Mapbox devolve sítios de outras
  // províncias com o mesmo nome.
  url.searchParams.set('bbox', '12.95,-9.70,14.40,-8.55');

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.error(`[whatsapp-webhook] Mapbox devolveu ${res.status} para "${texto}".`);
      return null;
    }
    const dados = await res.json() as {
      features?: Array<{
        center?: [number, number]; place_name?: string;
        place_type?: string[]; relevance?: number;
      }>;
    };
    const features = (dados.features ?? []).filter((f) => f.center);
    if (features.length === 0) return null;

    const pontuados = features.map((f) => ({
      lat: f.center![1],
      lng: f.center![0],
      endereco: f.place_name ?? texto,
      tipo: (f.place_type ?? ['?'])[0] ?? '?',
      rel: Number(f.relevance ?? 0),
    })).sort((a, b) =>
      qualidadeTipoOsm(a.tipo) - qualidadeTipoOsm(b.tipo) || b.rel - a.rel);

    const melhor = pontuados[0]!;
    // Uma província inteira nunca é uma resposta aceitável para uma morada.
    if (melhor.tipo === 'region') {
      console.warn(`[whatsapp-webhook] Mapbox só devolveu uma região para "${texto}" — rejeitado.`);
      return null;
    }
    return melhor;
  } catch (err) {
    console.warn('[whatsapp-webhook] Mapbox falhou:', err);
    return null;
  }
}

/**
 * Guarda na base um local resolvido pelo OSM, para a próxima vez ser
 * instantâneo. É isto que faz o bot "aprender em tempo real" sem ninguém
 * mexer em nada.
 *
 * Fica com `origem = 'aprendido'` (confiança 60) e não com `'osm'` (90): as
 * coordenadas vieram do OSM, mas o NOME foi escrito por um utilizador e pode
 * ter gralhas. Marcado assim, aparece em `locais_a_verificar` para revisão e
 * nunca se confunde com os locais extraídos directamente do mapa.
 */
async function aprenderDoOsm(
  supabaseAdmin: ReturnType<typeof createClient>,
  nome: string,
  lat: number,
  lng: number,
  endereco: string,
  tipo: string,
  telefone?: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('registar_local', {
      p_nome: nome,
      p_lat: lat,
      p_lng: lng,
      p_raio_m: 500,
      p_zona: null,
      p_origem: 'aprendido',
      p_aprendido_de: telefone ?? null,
      p_endereco: endereco,
      p_osm_tipo: tipo,
      p_categoria: null,
    });
    if (error) {
      console.warn('[whatsapp-webhook] Nao consegui guardar o local do OSM:', error.message);
    }
  } catch (err) {
    console.warn('[whatsapp-webhook] Falha a guardar local do OSM:', err);
  }
}

/**
 * Cadeia completa: tabela -> OSM -> Mapbox.
 * `ref` é o ponto de referência conhecido (normalmente a origem da corrida)
 * e serve para desempatar nomes repetidos — "Rua 1" a partir do Kilamba é a
 * "Rua 1" do Kilamba.
 */
async function geocodificar(
  supabaseAdmin: ReturnType<typeof createClient>,
  texto: string,
  ref?: { lat: number; lng: number } | null,
): Promise<Coordenadas | null> {
  const limpo = texto.trim();
  if (limpo.length < 3) return null;

  // ── 1. Base local ──
  const daTabela = await procurarNaTabela(supabaseAdmin, limpo, ref);
  if (daTabela) {
    await supabaseAdmin.rpc('reforcar_local', { p_id: daTabela.id }).then(
      () => {},
      () => {},
    );
    return {
      lat: Number(daTabela.lat),
      lng: Number(daTabela.lng),
      endereco: daTabela.endereco_completo || daTabela.nome,
      zona: daTabela.zona,
      categoria: daTabela.categoria,
      origemLocal: daTabela.origem === 'aprendido' ? 'aprendido' : 'tabela',
      confianca: daTabela.confianca,
      localId: daTabela.id,
    };
  }

  // ── 2. OpenStreetMap ──
  const doOsm = await geocodificarNoNominatim(limpo, ref);
  if (doOsm) {
    // Aprende para a próxima — sem bloquear a resposta ao passageiro.
    aprenderDoOsm(supabaseAdmin, limpo, doOsm.lat, doOsm.lng, doOsm.endereco, doOsm.tipo)
      .catch(() => {});
    return {
      lat: doOsm.lat,
      lng: doOsm.lng,
      endereco: doOsm.endereco,
      zona: null,
      categoria: null,
      origemLocal: 'osm',
      confianca: 80,
      localId: null,
    };
  }

  // ── 3. Mapbox (último recurso) ──
  const doMapbox = await geocodificarNoMapbox(limpo);
  if (doMapbox) {
    return {
      lat: doMapbox.lat,
      lng: doMapbox.lng,
      endereco: doMapbox.endereco,
      zona: null,
      categoria: null,
      origemLocal: 'mapbox',
      confianca: 60,
      localId: null,
    };
  }

  return null;
}

/** Converte coordenadas em endereço legível e na zona canónica. */
async function reverterCoordenadas(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_TOKEN) return null;
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`,
  );
  url.searchParams.set('access_token', MAPBOX_TOKEN);
  url.searchParams.set('language', 'pt');
  url.searchParams.set('limit', '1');
  // Sem `types`, o Mapbox devolve o objeto mais próximo — que costuma ser uma
  // loja ou um café, e não o sítio onde a pessoa está. Foi esta a razão de o
  // pin aparecer sempre com o nome errado.
  url.searchParams.set('types', 'address,street,neighborhood,locality,place,district');
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const dados = await res.json() as { features?: Array<{ place_name?: string }> };
    return dados.features?.[0]?.place_name ?? null;
  } catch {
    return null;
  }
}

// ─── Ponto (pin de localização) → endereço + zona ───────────────────────────

/**
 * Último recurso para a zona, quando nem a base local nem o OSM a dão.
 * Mapeia o nome administrativo do OSM para uma das 11 zonas de `zone_prices`.
 * É um fallback pequeno de propósito: a fonte normal é o campo `zona` da
 * tabela `luanda_places`, que já vem com a atribuição feita.
 */
const ZONA_POR_ADMIN: Record<string, string> = {
  'talatona': 'Talatona', 'belas': 'Talatona', 'camama': 'Talatona',
  'kifica': 'Talatona', 'futungo': 'Talatona', 'quifica': 'Talatona',
  'benfica': 'Benfica',
  'samba': 'Samba', 'morro bento': 'Samba',
  'cazenga': 'Cazenga', 'rocha pinto': 'Cazenga', 'palanca': 'Cazenga',
  'tala hady': 'Cazenga', 'tala-hady': 'Cazenga', 'hoji ya henda': 'Cazenga',
  'kilamba': 'Kilamba', 'kilamba kiaxi': 'Kilamba',
  'nova cidade de kilamba': 'Kilamba', 'zango': 'Kilamba',
  'viana': 'Viana', 'cacuaco': 'Viana', 'estalagem': 'Viana', 'sapu': 'Viana',
  'rangel': 'Rangel', 'sambizanga': 'Rangel', 'golf': 'Rangel', 'golfe': 'Rangel',
  'maianga': 'Maianga', 'prenda': 'Maianga', 'cassenda': 'Maianga',
  'neves bendinha': 'Maianga', 'alvalade': 'Maianga',
  'miramar': 'Miramar',
  'ingombota': 'Centro', 'mutamba': 'Centro', 'kinaxixi': 'Centro',
  'maculusso': 'Centro', 'coqueiros': 'Centro', 'ilha do cabo': 'Centro',
  'ilha de luanda': 'Centro', 'praia do bispo': 'Centro',
  'sao paulo': 'Centro', 'bairro operario': 'Centro',
};

/**
 * Quanto detalhe útil tem uma morada. Decide entre a morada que o WhatsApp
 * manda agarrada ao pin e a que o bot resolve sozinho.
 *
 * ⚠️ BUG REAL, medido no pedido do Dánio (20/09/2026). Os três pontos que
 * gravam a morada de um pin preferiam SEMPRE a descrição que vem agarrada ao
 * pin do WhatsApp, mesmo quando era pior do que a que o bot tinha resolvido.
 * No pedido real:
 *
 *   WhatsApp mandou : "Quilamba Quiaxi, Belas, Província de Luanda, Angola"
 *   o bot resolveu : "Rua 53 (Rua Francisco Imperial Santana), Urbanização Nova Vida"
 *   ficou gravado  : a do WhatsApp  <- a pior das duas
 *
 * Agora ganha a mais específica: conta as partes que NÃO são administrativas
 * ("Município de X", "Província de Y", "Angola") e dá um ponto extra a quem
 * nomeia uma via. Empate fica com a do bot, que vem das coordenadas.
 */
const PARTE_ADMIN = /^(munic[íi]pio|prov[íi]ncia|comuna|distrito|angola|luanda|cidade|urbano|peri-?urbano)\b/i;
const NOMEIA_VIA = /\b(rua|avenida|av\.?|estrada|beco|travessa|alameda|largo|praça|praca)\b/i;

function especificidade(endereco: string | null | undefined): number {
  if (!endereco) return 0;
  const partes = endereco.split(',').map((p) => p.trim()).filter((p) => p !== '');
  let n = 0;
  for (const p of partes) if (!PARTE_ADMIN.test(p)) n++;
  if (NOMEIA_VIA.test(endereco)) n += 1;
  return n;
}

/** A mais específica das duas moradas. Empate -> a do bot (vem das coordenadas). */
function melhorEndereco(
  doWhatsapp: string | null | undefined,
  doBot: string | null | undefined,
): string {
  const a = (doWhatsapp ?? '').trim();
  const b = (doBot ?? '').trim();
  if (!a) return b;
  if (!b) return a;
  return especificidade(a) > especificidade(b) ? a : b;
}

export interface PontoResolvido {
  endereco: string;
  zona: string | null;
  /** Nome de um local conhecido/aprendido a menos do raio do pin. */
  localConhecido: string | null;
  categoria: string | null;
}

/** Reverse geocoding no OpenStreetMap, com o hierárquico administrativo. */
async function reverterNoNominatim(lat: number, lng: number): Promise<{
  endereco: string; zona: string | null;
} | null> {
  await esperarNominatim();
  const url = new URL(`${NOMINATIM_URL}/reverse`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('zoom', '18');
  url.searchParams.set('accept-language', 'pt');
  url.searchParams.set('addressdetails', '1');

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const d = await res.json() as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const a = d.address ?? {};

    // ⚠️ BUG REAL, medido contra a API (20/09/2026) — não suposto.
    //
    // A cadeia antiga era `[road, neighbourhood ?? suburb]` e, quando ambos
    // faltavam, caía para `county`. Em Luanda isso dava "Município do Belas" a
    // qualquer pin fora do centro, porque o OSM de Angola NÃO fornece `suburb`
    // — fornece `residential`, `town` e `city`. Resposta crua do OSM para um
    // pin no Kilamba:
    //
    //   address: { residential: "Kilamba", town: "Nova Cidade de Kilamba",
    //              county: "Município do Belas" }
    //   -> road: ausente, neighbourhood: ausente, suburb: ausente
    //   -> antigo: "Município do Belas"   (inútil para o motorista)
    //   -> agora: "Kilamba, Nova Cidade de Kilamba"
    //
    // A regra: via (se houver) + a área mais específica + o nível seguinte.
    const via = a['road'] ?? a['pedestrian'] ?? a['footway'] ?? null;
    const area1 = a['neighbourhood'] ?? a['suburb'] ?? a['quarter'] ?? a['residential'] ?? null;
    const area2 = a['city_district'] ?? a['village'] ?? a['hamlet'] ?? a['town'] ?? null;

    const partes: string[] = [];
    if (via) partes.push(via);
    if (area1) partes.push(area1);
    if (area2 && area2 !== area1 && area2 !== via) partes.push(area2);

    const endereco = partes.length > 0
      ? partes.join(', ')
      : (a['city'] ?? a['county'] ?? d.display_name ?? '');

    // A zona sai do campo administrativo mais específico que existir.
    let zona: string | null = null;
    for (const chave of ['neighbourhood', 'suburb', 'quarter', 'city_district',
                         'village', 'town', 'county', 'city']) {
      const valor = a[chave];
      if (valor && ZONA_POR_ADMIN[valor.toLowerCase().trim()]) {
        zona = ZONA_POR_ADMIN[valor.toLowerCase().trim()]!;
        break;
      }
    }
    return { endereco: endereco || d.display_name || `${lat}, ${lng}`, zona };
  } catch (err) {
    console.warn('[whatsapp-webhook] Reverse Nominatim falhou:', err);
    return null;
  }
}

/**
 * Resolve um pin de localização.
 *
 * Ordem:
 *   1. `locais_perto` — se houver um local conhecido/aprendido a menos do
 *      raio dele, usamos o NOME desse local. É isto que faz o bot "não ficar
 *      mais na dúvida" depois de alguém lhe ter ensinado a zona.
 *   2. OSM reverse — endereço real + zona pelo hierárquico administrativo.
 *   3. Mapbox reverse — último recurso.
 *
 * Em nenhum caso se inventa um endereço: sem resposta, devolve-se a
 * coordenada em texto.
 */
async function resolverPonto(
  supabaseAdmin: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
): Promise<PontoResolvido> {
  let zona: string | null = null;
  let localConhecido: string | null = null;
  let categoria: string | null = null;

  // ── 1. Local conhecido à volta do pin ──
  try {
    const { data } = await supabaseAdmin.rpc('locais_perto', {
      p_lat: lat, p_lng: lng, p_raio_m: 1000, p_max: 5,
    });
    const perto = (data ?? []) as Array<{
      nome: string; zona: string | null; distancia_m: number;
      origem: string; confianca: number;
    }>;
    const comZona = perto.find((p) => !!p.zona);
    if (comZona) zona = comZona.zona;
    // ⚠️ BUG REAL. O limiar era `confianca >= 80`, mas TODOS os locais vindos
    // do OSM têm confianca 70–72 (verificado na base: "Parque Nova Vida" = 72
    // a 70 m do pin do Dánio). O limiar de 80 não deixava passar nenhum — a
    // base sabia exactamente onde a pessoa estava e o código deitava fora,
    // caindo para o município.
    //
    // Baixado para 70 com duas salvaguardas: distância máxima e recusa de
    // nomes genéricos ("Rua 10", "Avenida 5"), que não identificam sítio.
    const melhor = perto.find(
      (p) =>
        Number(p.confianca) >= 70 &&
        Number(p.distancia_m) <= 900 &&
        !!p.nome &&
        !ehNomeGenerico(p.nome),
    );
    if (melhor) localConhecido = melhor.nome;
  } catch (err) {
    console.warn('[whatsapp-webhook] locais_perto falhou:', err);
  }

  // ── 2. OSM ──
  const osm = await reverterNoNominatim(lat, lng);
  if (osm) {
    if (!zona) zona = osm.zona;
    if (osm.endereco) {
      return {
        endereco: localConhecido
          ? `${localConhecido} (${osm.endereco})`
          : osm.endereco,
        zona, localConhecido, categoria,
      };
    }
  }

  // ── 3. Mapbox ──
  const mapbox = await reverterCoordenadas(lat, lng);
  if (mapbox) {
    return {
      endereco: localConhecido ? `${localConhecido} (${mapbox})` : mapbox,
      zona, localConhecido, categoria,
    };
  }

  return {
    endereco: localConhecido ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    zona, localConhecido, categoria,
  };
}

/**
 * Zona canónica de uma coordenada, a partir da base local.
 *
 * Existe porque a zona tem de sobreviver entre mensagens: a origem é guardada
 * em `bot_conversations` só com lat/lng/endereço, e o preço é calculado uma
 * mensagem depois. Em vez de guardar a zona (que podia ficar desactualizada),
 * volta-se a perguntar à base pela coordenada — é barato e é sempre coerente
 * com o que o mapa diz.
 */
async function zonaPorCoordenadas(
  supabaseAdmin: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.rpc('locais_perto', {
      p_lat: lat, p_lng: lng, p_raio_m: 3000, p_max: 8,
    });
    const perto = (data ?? []) as Array<{ zona: string | null; distancia_m: number }>;
    const comZona = perto
      .filter((p) => !!p.zona)
      .sort((a, b) => Number(a.distancia_m) - Number(b.distancia_m));
    return comZona[0]?.zona ?? null;
  } catch (err) {
    console.warn('[whatsapp-webhook] zonaPorCoordenadas falhou:', err);
    return null;
  }
}

/**
 * Guarda um local ensinado pelo utilizador (ou confirmado por pin).
 * Devolve o id do local gravado, ou null em caso de falha.
 */
async function registarLocalAprendido(
  supabaseAdmin: ReturnType<typeof createClient>,
  nome: string,
  lat: number,
  lng: number,
  telefone: string,
  endereco?: string | null,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('registar_local', {
      p_nome: nome,
      p_lat: lat,
      p_lng: lng,
      p_raio_m: 1000,
      p_zona: null,
      p_origem: 'aprendido',
      p_aprendido_de: telefone,
      p_endereco: endereco ?? null,
      p_osm_tipo: null,
      p_categoria: null,
    });
    if (error) {
      console.error('[whatsapp-webhook] registar_local falhou:', error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (err) {
    console.error('[whatsapp-webhook] Falha a registar local aprendido:', err);
    return null;
  }
}

// ─── Preço ───────────────────────────────────────────────────────────────────

interface Preco {
  price_kz: number;
  distance_km: number;
  duration_min: number;
  surge_multiplier: number;
  is_zone_price: boolean;
  origem_do_preco: 'zona' | 'motor';
  badges: string[];
}

interface RotaCalculada {
  distanceKm: number;
  durationMin: number;
  trafficFactor: number;
  real: boolean;
}

/**
 * Rota real por estrada (Mapbox Directions), com o mesmo fallback do app
 * (`routeService.getRoute`): se a API falhar, Haversine a 30 km/h.
 */
async function calcularRota(
  origem: Coordenadas,
  destino: Coordenadas,
): Promise<RotaCalculada> {
  const distanciaReta = haversineKm(origem.lat, origem.lng, destino.lat, destino.lng);

  if (MAPBOX_TOKEN) {
    // Nota: o Mapbox quer lng,lat — não lat,lng.
    const url =
      'https://api.mapbox.com/directions/v5/mapbox/driving/' +
      `${origem.lng},${origem.lat};${destino.lng},${destino.lat}` +
      `?geometries=geojson&overview=false&access_token=${MAPBOX_TOKEN}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const dados = (await res.json()) as {
          routes?: Array<{ distance?: number; duration?: number }>;
        };
        const rota = dados.routes?.[0];
        if (rota?.distance != null && rota?.duration != null) {
          return {
            distanceKm: Math.round((rota.distance / 1000) * 10) / 10,
            durationMin: Math.round(rota.duration / 60),
            trafficFactor: TRANSITO_FACTOR,
            real: true,
          };
        }
        console.warn('[whatsapp-webhook] Mapbox Directions sem rotas — a usar Haversine.');
      } else {
        console.warn(
          `[whatsapp-webhook] Mapbox Directions devolveu ${res.status} — a usar Haversine.`,
        );
      }
    } catch (err) {
      console.warn('[whatsapp-webhook] Mapbox Directions falhou — a usar Haversine:', err);
    }
  } else {
    console.warn('[whatsapp-webhook] MAPBOX_TOKEN ausente — a usar Haversine.');
  }

  return {
    distanceKm: Math.round(distanciaReta * 10) / 10,
    durationMin: Math.ceil((distanciaReta / 30) * 60),
    trafficFactor: TRANSITO_FACTOR,
    real: false,
  };
}

function ehNoiteEmLuanda(): boolean {
  const hora = horaEmLuanda();
  return hora >= 22 || hora < 6;
}

function ehAeroporto(destino: Coordenadas): boolean {
  const graus = Math.sqrt(
    (destino.lat - AEROPORTO.lat) ** 2 + (destino.lng - AEROPORTO.lng) ** 2,
  );
  return graus * 111 < AEROPORTO_RAIO_KM;
}

/**
 * Preço de uma corrida — igual ao que o app mostra ao passageiro.
 *
 * Ordem de prioridade (a mesma do `handleConfirmDriver` do PassengerHome):
 *   1. Preço fixo do par de zonas (`zone_prices`), quando as zonas diferem;
 *   2. `calculate_fare_engine_pro`, que lê `pricing_config`.
 *
 * Devolve `null` quando o motor não responde. Não inventamos preço nenhum: quem
 * chama tem de dizer ao passageiro para tentar outra vez.
 */
async function calcularPreco(
  supabaseAdmin: ReturnType<typeof createClient>,
  origem: Coordenadas,
  destino: Coordenadas,
): Promise<Preco | null> {
  const rota = await calcularRota(origem, destino);

  // ── 1. Preço fixo por zona ──
  // A zona vem da BASE DE DADOS quando o local foi resolvido por lá (campo
  // `zona` de `luanda_places`, atribuído por proximidade real). Só quando não
  // há zona é que se cai na comparação de palavras do endereço — que era a
  // origem dos erros: "Centro Comercial X" continha "centro" e cotava Centro.
  const zonaOrigem = origem.zona ?? detectarZona(origem.endereco);
  const zonaDestino = destino.zona ?? detectarZona(destino.endereco);
  if (zonaOrigem && zonaDestino && zonaOrigem !== zonaDestino) {
    const { data: zp, error: erroZp } = await supabaseAdmin
      .from('zone_prices')
      .select('price_kz, distance_km')
      .eq('active', true)
      .or(
        `and(origin_zone.eq.${zonaOrigem},dest_zone.eq.${zonaDestino}),` +
          `and(origin_zone.eq.${zonaDestino},dest_zone.eq.${zonaOrigem})`,
      )
      .limit(1)
      .maybeSingle();

    if (erroZp) {
      console.error('[whatsapp-webhook] Erro a ler zone_prices:', erroZp.message);
    } else if (zp) {
      return {
        price_kz: Number(zp.price_kz),
        distance_km: Math.round((Number(zp.distance_km) || rota.distanceKm) * 100) / 100,
        duration_min: rota.durationMin,
        surge_multiplier: 1.0,
        is_zone_price: true,
        origem_do_preco: 'zona',
        badges: [`Preço fixo ${zonaOrigem} → ${zonaDestino}`],
      };
    }
  }

  // ── 2. Motor de preço — lê pricing_config, nunca valores fixos aqui ──
  const { data, error } = await supabaseAdmin.rpc(ENGINE_PRECO_RPC, {
    p_distance_km: rota.distanceKm,
    p_duration_min: rota.durationMin,
    p_origin_lat: origem.lat,
    p_origin_lng: origem.lng,
    p_dest_lat: destino.lat,
    p_dest_lng: destino.lng,
    p_service_tier: 'standard',
    p_demand_count: DEMANDA_PADRAO,
    p_supply_count: OFERTA_PADRAO,
    p_is_night: ehNoiteEmLuanda(),
    p_is_airport: ehAeroporto(destino),
    p_traffic_factor: rota.trafficFactor,
  });

  if (error || !data) {
    console.error(
      `[whatsapp-webhook] ${ENGINE_PRECO_RPC} falhou:`,
      error?.message ?? 'sem dados',
    );
    return null;
  }

  const resultado = data as {
    fare_kz?: number;
    surge_factor?: number;
    badges?: string[];
  };
  const precoFinal = Number(resultado.fare_kz);
  if (!Number.isFinite(precoFinal) || precoFinal <= 0) {
    console.error(`[whatsapp-webhook] ${ENGINE_PRECO_RPC} devolveu preco invalido:`, data);
    return null;
  }

  return {
    price_kz: precoFinal,
    distance_km: rota.distanceKm,
    duration_min: rota.durationMin,
    surge_multiplier: Number(resultado.surge_factor ?? 1),
    is_zone_price: false,
    origem_do_preco: 'motor',
    badges: Array.isArray(resultado.badges) ? resultado.badges : [],
  };
}

// ─── Sessão ──────────────────────────────────────────────────────────────────

/**
 * Há uma corrida em curso para esta sessão?
 *
 * Existe para a expiração não ser cega: um passageiro com motorista a caminho
 * pode calar-se meia hora — e isso não pode fazer-lhe perder a viagem.
 */
async function temCorridaViva(
  supabaseAdmin: ReturnType<typeof createClient>,
  sessao: Sessao,
): Promise<boolean> {
  if (!sessao.ride_id) return false;
  try {
    const { data } = await supabaseAdmin
      .from('rides')
      .select('status')
      .eq('id', sessao.ride_id)
      .maybeSingle();
    return CORRIDA_VIVA.has(String((data as { status?: string } | null)?.status ?? ''));
  } catch (err) {
    console.warn('[whatsapp-webhook] temCorridaViva falhou:', err);
    // Não sei se há corrida viva -> assumir que sim. Preferimos uma sessão a
    // mais do que cancelar a viagem a alguém que estava à espera do carro.
    return true;
  }
}

/**
 * Carrega a sessão de um telefone, expirando-a se estiver velha.
 *
 * Devolve a MESMA linha já limpa, com `state: 'idle'`, e não `null`. A diferença
 * importa: `guardarSessao` grava por `id` quando recebe uma sessão, e insere
 * quando não recebe. Devolver `null` criava uma linha nova a cada sessão morta —
 * uma por telefone e por expiração, para sempre. É o oposto do que o Dánio
 * pediu ("guarda a última sessão e apaga o resto").
 *
 * `'idle'` é o estado neutro permitido pelo CHECK da tabela, e o índice único
 * parcial (`idx_bot_conv_phone_active`) não o conta como sessão activa. Quem
 * lê o estado trata `'idle'` como conversa nova.
 */
async function carregarSessao(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
): Promise<Sessao | null> {
  const { data, error } = await supabaseAdmin
    .from('bot_conversations')
    .select('*')
    .eq('phone', telefone)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[whatsapp-webhook] Erro a carregar sessao:', error.message);
    return null;
  }
  if (!data) return null;

  const sessao = data as Sessao;
  const marca = new Date(sessao.updated_at ?? sessao.created_at ?? '').getTime();
  // Sem marca de tempo fiável não se expira nada: é melhor uma sessão a mais do
  // que deitar fora um fluxo a meio por causa de um campo mal preenchido.
  if (!Number.isFinite(marca)) return sessao;

  const idadeMin = (Date.now() - marca) / 60000;
  if (idadeMin <= SESSAO_VALIDADE_MINUTOS) return sessao;

  if (await temCorridaViva(supabaseAdmin, sessao)) return sessao;

  console.log(
    `[whatsapp-webhook] Sessao de ${telefone} com ${Math.floor(idadeMin)} min ` +
      `(estado ${sessao.state}) — expirada, a comecar do zero.`,
  );
  const limpa = {
    state: 'idle' as const,
    origin_address: null, origin_lat: null, origin_lng: null,
    dest_address: null, dest_lat: null, dest_lng: null,
    estimated_price: null, ride_id: null, dispatch_attempt: null,
    aprendendo_nome: null, aprendendo_texto: null, aprendendo_slot: null,
  };
  const { error: erroLimpeza } = await supabaseAdmin
    .from('bot_conversations')
    .update(limpa)
    .eq('id', sessao.id);
  if (erroLimpeza) {
    console.error('[whatsapp-webhook] Erro a expirar sessao:', erroLimpeza.message);
  }
  return { ...sessao, ...limpa };
}

async function guardarSessao(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
  campos: Record<string, unknown>,
  sessaoExistente?: Sessao | null,
): Promise<void> {
  const agora = new Date().toISOString();

  if (sessaoExistente?.id) {
    const { error } = await supabaseAdmin
      .from('bot_conversations')
      .update({ ...campos, updated_at: agora })
      .eq('id', sessaoExistente.id);
    if (error) console.error('[whatsapp-webhook] Erro a actualizar sessao:', error.message);
    return;
  }

  const { error } = await supabaseAdmin
    .from('bot_conversations')
    .insert({ phone: telefone, ...campos, updated_at: agora });
  if (error) console.error('[whatsapp-webhook] Erro a criar sessao:', error.message);
}

// ─── Utilizadores ────────────────────────────────────────────────────────────

/**
 * Liga um número de WhatsApp a um utilizador da plataforma.
 *
 * Se o número ainda não tiver conta, cria uma — sem isto não há como gravar a
 * corrida, porque `rides.passenger_id` é obrigatório. A conta fica com um email
 * sintético e é confirmada automaticamente; o telefone é guardado no perfil.
 */
async function resolverUtilizador(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
  nome: string,
): Promise<string | null> {
  const digitos = normalizarTelefone(telefone);
  if (!digitos) return null;
  const ultimos9 = digitos.slice(-9);

  const { data: existente } = await supabaseAdmin
    .from('profiles')
    .select('user_id, phone')
    .ilike('phone', `%${ultimos9}`);

  // Um mesmo número pode estar em mais do que um perfil (acontece neste
  // projecto: o admin e o motorista de teste partilham número). Preferimos
  // sempre uma conta que NÃO seja motorista — um motorista a pedir corrida
  // para si próprio confundiria o fluxo.
  if (existente && existente.length > 0) {
    const ids = existente.map((c) => c.user_id as string);
    const { data: contas } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .in('id', ids);
    const conta = contas?.find((u) => u.role !== 'driver') ?? contas?.[0];
    if (conta?.id) return conta.id as string;
    if (ids[0]) return ids[0];
  }

  const email = `wa_${digitos}@passageiro.zenithride.ao`;
  const { data: criado, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID() + crypto.randomUUID(),
    user_metadata: { nome, origem: 'whatsapp' },
  });

  if (error) {
    console.error('[whatsapp-webhook] Nao consegui criar utilizador:', error.message);
    return null;
  }
  const userId = criado?.user?.id;
  if (!userId) return null;

  const { error: erroPerfil } = await supabaseAdmin
    .from('profiles')
    .update({ phone: `+${digitos}`, name: nome || `Passageiro ${ultimos9}` })
    .eq('user_id', userId);
  if (erroPerfil) {
    console.warn('[whatsapp-webhook] Perfil criado sem telefone:', erroPerfil.message);
  }

  console.log(`[whatsapp-webhook] Conta de passageiro criada para ${digitos}.`);
  return userId;
}

/** Devolve o user_id do motorista com este telefone, ou null. */
async function resolverMotorista(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
): Promise<string | null> {
  const digitos = normalizarTelefone(telefone);
  if (!digitos) return null;
  const ultimos9 = digitos.slice(-9);

  const { data: candidatos } = await supabaseAdmin
    .from('profiles')
    .select('user_id, phone')
    .ilike('phone', `%${ultimos9}`);

  if (!candidatos || candidatos.length === 0) return null;

  const { data: contas } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .in('id', candidatos.map((c) => c.user_id as string));

  const motorista = contas?.find((u) => u.role === 'driver');
  return motorista?.id ? (motorista.id as string) : null;
}

// ─── Motoristas ──────────────────────────────────────────────────────────────

interface MotoristaCandidato {
  driver_id: string;
  driver_name: string;
  phone: string;
  // `null` quando a origem do candidato é o H3 — esse caminho não traz
  // distância real, e preferimos não mostrar nada a mostrar um número falso.
  distance_m: number | null;
  timeout_sec: number;
}

// ─── H3 ──────────────────────────────────────────────────────────────────────
//
// O motorista deve ser escolhido pelo H3 (o mais próximo / mais viável).
//
// ⚠️ Não há extensão `h3` no Postgres deste projecto — `pg_available_extensions`
// não a lista. As colunas `driver_locations.h3_index_res9/res7` são preenchidas
// pelo cliente, e `find_drivers_h3` exige os índices já calculados. Por isso o
// H3 é calculado aqui, em JavaScript.
//
// A biblioteca entra por importação dinâmica: se falhar no runtime do Deno, o
// fluxo cai para a pesquisa por raio (PostGIS) em vez de rebentar.
//
// Validado contra dados de produção:
//   geoToH3(-8.96154571889185, 13.2041574720155, 9) === '89831e3142bffff'
//   geoToH3(-8.8383, 13.2344, 9)                   === '89831e38397ffff'
// — exactamente as células que estão em `driver_locations`.

type LibH3 = {
  geoToH3: (lat: number, lng: number, res: number) => string;
  kRing: (cell: string, k: number) => string[];
};

let h3Carregado: LibH3 | false | null = null;

async function carregarH3(): Promise<LibH3 | false> {
  if (h3Carregado !== null) return h3Carregado;
  try {
    // v3.7.2 é a última sem WebAssembly — importante num runtime que não lê
    // ficheiros do disco.
    const mod: any = await import(
      'https://cdn.jsdelivr.net/npm/h3-js@3.7.2/dist/h3-js.es.js'
    );
    const lib = (mod?.default ?? mod) as LibH3;
    if (typeof lib?.geoToH3 !== 'function') throw new Error('geoToH3 em falta');
    h3Carregado = lib;
    console.log('[whatsapp-webhook] h3-js carregado — a usar indexacao H3.');
  } catch (err) {
    console.warn(
      '[whatsapp-webhook] h3-js indisponivel neste runtime — a usar PostGIS por raio:',
      err,
    );
    h3Carregado = false;
  }
  return h3Carregado;
}

/**
 * Candidatos pela célula H3 res-9 do passageiro e vizinhos (kRing 1 = 7
 * células, ~1,2 km de raio).
 *
 * Devolve `null` quando o H3 não está disponível — assim o chamador distingue
 * "não há H3" de "o H3 não encontrou ninguém".
 */
async function encontrarMotoristasPorH3(
  supabaseAdmin: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
): Promise<MotoristaCandidato[] | null> {
  const h3 = await carregarH3();
  if (!h3) return null;

  let celulas: string[];
  try {
    celulas = h3.kRing(h3.geoToH3(lat, lng, 9), 1);
  } catch (err) {
    console.warn('[whatsapp-webhook] Falha a calcular celulas H3:', err);
    return null;
  }

  const { data, error } = await supabaseAdmin.rpc('find_drivers_h3', {
    p_h3_indexes: celulas,
    // A origem é obrigatória: sem ela a função não mede a distância real até
    // ao ponto de recolha e devolveria um valor fixo.
    p_origin_lat: lat,
    p_origin_lng: lng,
    p_limit: 8,
  });
  if (error) {
    console.error('[whatsapp-webhook] find_drivers_h3 falhou:', error.message);
    return null;
  }

  const candidatos = (data ?? []) as Array<{ driver_id: string; driver_name: string }>;
  if (candidatos.length === 0) return [];

  // ⚠️ `find_drivers_h3` NÃO devolve telefone — devolve até uma distância fixa
  // de 500 m e um eta de 2 min. O telefone tem de vir de `profiles`, senão
  // voltamos ao problema original: motorista sem forma de ser avisado.
  const { data: perfis } = await supabaseAdmin
    .from('profiles')
    .select('user_id, phone')
    .in('user_id', candidatos.map((c) => c.driver_id));

  const telefonePorId = new Map<string, string>();
  for (const p of (perfis ?? []) as any[]) {
    if (apenasDigitos(p.phone).length >= 9) telefonePorId.set(p.user_id, String(p.phone));
  }

  const semTelefone = candidatos.filter((c) => !telefonePorId.has(c.driver_id)).length;
  if (semTelefone > 0) {
    console.warn(
      `[whatsapp-webhook] ${semTelefone} motorista(s) no H3 sem telefone em profiles — excluidos.`,
    );
  }

  return candidatos
    .filter((c) => telefonePorId.has(c.driver_id))
    .map((c) => ({
      driver_id: c.driver_id,
      driver_name: c.driver_name,
      phone: telefonePorId.get(c.driver_id)!,
      distance_m: null,
      timeout_sec: 8,
    }));
}

/** Cascata de raios: 5 km -> 7 km -> 12 km, igual ao dispatch-cascade. */
async function encontrarMotoristasPorRaio(
  supabaseAdmin: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
): Promise<MotoristaCandidato[]> {
  for (const raio of [5, 7, 12]) {
    const { data, error } = await supabaseAdmin.rpc('get_cascade_drivers', {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: raio,
      p_limit: 5,
    });
    if (error) {
      console.error(`[whatsapp-webhook] get_cascade_drivers(${raio}km) falhou:`, error.message);
      continue;
    }
    const lista = (data ?? []) as MotoristaCandidato[];
    // Só servem motoristas com telefone — sem telefone não há como avisar.
    const comTelefone = lista.filter((d) => apenasDigitos(d.phone).length >= 9);
    if (comTelefone.length > 0) return comTelefone;
  }
  return [];
}

/**
 * H3 primeiro; se o H3 não estiver disponível ou não encontrar ninguém,
 * cascata por raio. Nunca falha em silêncio: registamos qual dos dois correu.
 */
async function encontrarMotoristas(
  supabaseAdmin: ReturnType<typeof createClient>,
  lat: number,
  lng: number,
): Promise<MotoristaCandidato[]> {
  const porH3 = await encontrarMotoristasPorH3(supabaseAdmin, lat, lng);

  if (porH3 && porH3.length > 0) {
    console.log(`[whatsapp-webhook] H3 encontrou ${porH3.length} motorista(s).`);
    return porH3;
  }

  const porRaio = await encontrarMotoristasPorRaio(supabaseAdmin, lat, lng);

  if (porH3 === null) {
    console.log('[whatsapp-webhook] H3 indisponivel — cascata por raio.');
  } else if (porH3.length === 0 && porRaio.length > 0) {
    console.log('[whatsapp-webhook] H3 sem resultados — cascata por raio encontrou motorista(s).');
  }

  return porRaio;
}

async function notificarMotoristas(
  supabaseAdmin: ReturnType<typeof createClient>,
  rideId: string,
  origem: string,
  destino: string,
  precoKz: number,
  distanciaKm: number,
  lat: number,
  lng: number,
): Promise<{ enviados: number; candidatos: number }> {
  const motoristas = await encontrarMotoristas(supabaseAdmin, lat, lng);
  const codigo = rideId.slice(0, 8).toUpperCase();

  let enviados = 0;
  for (const m of motoristas) {
    const texto = [
      '🚗 *Nova corrida Zenith Ride*',
      `Olá ${m.driver_name}, tens uma corrida perto de ti!`,
      '',
      `📍 *Origem:* ${origem}`,
      `🏁 *Destino:* ${destino}`,
      `💰 *Valor:* ${kz(precoKz)} Kz`,
      `📏 *Distância:* ${distanciaKm} km`,
      // A distância só aparece quando é real. O caminho H3 não a traz, e é
      // melhor omitir a linha do que mostrar "a 0,0 km de ti".
      ...(typeof m.distance_m === 'number' && m.distance_m > 0
        ? [`🛣️ *A ${(m.distance_m / 1000).toFixed(1)} km de ti*`]
        : []),
      '',
      `Responde *ACEITAR ${codigo}* para ficar com a viagem.`,
    ].join('\n');

    if (await sendWhatsAppMessage(m.phone, texto)) enviados += 1;
  }

  if (enviados === 0) {
    console.warn(
      `[whatsapp-webhook] Corrida ${rideId}: ${motoristas.length} motorista(s) disponivel(is) com telefone, 0 notificados.`,
    );
  }
  return { enviados, candidatos: motoristas.length };
}

// ─── Fluxo conversacional ────────────────────────────────────────────────────

const PEDIDO_DE_CORRIDA =
  /\b(pedir|chamar|marcar|quero|preciso de)\s+(uma\s+)?(corrida|moto|t[áa]xi|transporte|viagem|carro)\b|^corrida$|^t[áa]xi$|^taxi$|^(leva-me|me leva)\s+a/i;

// Antes: /^(1|sim|s|ok|...)\b/i — o \b fazia "S. Pedro" começar por "s"
// (S seguido de ponto é word boundary) e era lido como confirmação.
// Agora exige que a MENSAGEM INTEIRA (após trim) seja a palavra de
// confirmação, permitindo apenas pontuação final: "s", "s!", "sim.", "ok".
const CONFIRMA = /^(1|sim|s|ok|okay|confirmo|confirmar|aceito|aceitar|vamos|bora|yes)\b\s*[!.;?]*\s*$/i;
const RECUSA = /^(2|n[ãa]o|nao|cancelar|cancela|desistir|no)\b\s*[!.;?]?\s*$/i;

function ehPedidoDeCorrida(texto: string): boolean {
  return PEDIDO_DE_CORRIDA.test(texto.trim());
}

// ─── Voz humana ──────────────────────────────────────────────────────────────
// Um humano não repete a mesma frase palavra por palavra de cada vez, nem
// despeja o manual inteiro a quem só disse "bom dia". Estas peças dão variedade
// e tratamento pelo nome — é o que tira o cheiro a robô das respostas.

/**
 * Escolhe uma das formulações, de forma determinística a partir de `semente`.
 *
 * Determinístico de propósito: a Meta reenvia o mesmo webhook quando não
 * recebe 200, e um `Math.random()` faria a mesma mensagem sair diferente em
 * cada reenvio. Com a semente, a variação é estável por conversa.
 */
function variar(opcoes: string[], semente: string): string {
  if (opcoes.length === 0) return '';
  if (opcoes.length === 1) return opcoes[0]!;
  let h = 0;
  for (let i = 0; i < semente.length; i += 1) h = (h * 31 + semente.charCodeAt(i)) | 0;
  return opcoes[Math.abs(h) % opcoes.length]!;
}

/** Primeiro nome, só quando parece mesmo um nome de pessoa. */
function primeiroNome(nome: string): string {
  const bruto = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  if (bruto.length < 2 || bruto.length > 20) return '';
  if (!/^[A-Za-zÀ-ÿ'’-]+$/.test(bruto)) return '';
  return bruto.charAt(0).toUpperCase() + bruto.slice(1).toLowerCase();
}

/** ", Dánio" ou "" — para encaixar o nome sem deixar vírgula solta. */
function comNome(nome: string): string {
  const n = primeiroNome(nome);
  return n ? `, ${n}` : '';
}

// ⚠️ Nada de `\b` no fim: em JavaScript o `\b` é ASCII, portanto depois de
// uma letra acentuada — "olá", "até amanhã" — não vê fronteira nenhuma e o
// padrão nunca casava. `(?!\p{L})` com a flag `u` faz o que se pretendia:
// "não pode vir outra letra a seguir".
const CUMPRIMENTO =
  /^(ol[áa]|oi+|hey|hello|hi|bom dia|boa tarde|boa noite|boas|tudo bem|como est[áa]s?|como vai|sauda[çc][õo]es)(?!\p{L})/iu;
const AGRADECIMENTO = /^(obrigad[oa]s?|valeu|vlw|agradecido|thanks|thank you|obg)(?!\p{L})/iu;
const DESPEDIDA = /^(adeus|at[ée] (logo|breve|amanh[ãa])|fica bem|boa sorte|xau|bye)(?!\p{L})/iu;

const AJUDA_ABERTURAS = [
  'Oi{no}! Sou o Lukéni, da Zenith Ride 👋',
  'Olá{no}! Aqui é o Lukéni, da Zenith Ride 👋',
  'Boas{no}! Lukéni, da Zenith Ride 👋',
  'Ei{no}! Sou o Lukéni, da Zenith Ride 👋',
];

const AJUDA_CORPO = [
  'Diz-me só *corrida* e eu trato do resto — pergunto-te de onde sais e para onde vais.',
  '',
  'Se preferires, toca em 📎 → *Localização* e eu uso logo onde estás, sem escreveres nada.',
  '',
  'Conheço os bairros, ruas, hospitais, escolas e mercados de Luanda. Se me disseres um sítio que ainda não conheço, peço-te a localização e guardo-o para a próxima vez.',
].join('\n');

function textoAjuda(nome: string, semente: string): string {
  const abertura = variar(AJUDA_ABERTURAS, semente).replace('{no}', comNome(nome));
  return [abertura, '', AJUDA_CORPO].join('\n');
}

/**
 * Responde a conversa que não é um pedido de corrida.
 *
 * Antes, quem escrevia "bom dia" ou "obrigado" recebia o manual de instruções
 * completo — era a coisa mais robótica que o bot fazia. Devolve `true` quando
 * já respondeu (e o fluxo normal deve parar).
 */
async function tratarConversaSolta(
  telefone: string,
  texto: string,
  nome: string,
  sessao: Sessao | null,
): Promise<boolean> {
  const t = texto.trim();
  if (!t) return false;
  const semente = telefone + t;

  if (CUMPRIMENTO.test(t)) {
    // A meio de um pedido, o cumprimento é só um cumprimento: repetir o manual
    // faria o utilizador perder o fio à meada.
    const aMeio = sessao?.state === 'awaiting_origin' || sessao?.state === 'awaiting_dest';
    await sendWhatsAppMessage(
      telefone,
      aMeio
        ? variar([
            `Oi${comNome(nome)}! Continuo à espera da tua resposta 👇`,
            `Boas${comNome(nome)}! Estou aqui — falta só aquilo que te pedi 👇`,
          ], semente)
        : textoAjuda(nome, semente),
    );
    return true;
  }

  if (AGRADECIMENTO.test(t)) {
    await sendWhatsAppMessage(
      telefone,
      variar([
        `De nada${comNome(nome)} 🙌`,
        `Sempre às ordens${comNome(nome)} 👊`,
        `Ora essa${comNome(nome)}, é para isso que estou aqui.`,
      ], semente),
    );
    return true;
  }

  if (DESPEDIDA.test(t)) {
    await sendWhatsAppMessage(
      telefone,
      variar([
        `Até à próxima${comNome(nome)} 👋`,
        `Fica bem${comNome(nome)}! Quando precisares, é só chamar.`,
      ], semente),
    );
    return true;
  }

  return false;
}

/**
 * Trata uma mensagem de passageiro. Devolve a resposta a enviar, ou null se
 * já respondeu por dentro.
 */
/**
 * Calcula o preço e mostra o resumo da viagem.
 * Extraído para poder ser chamado tanto pelo fluxo normal como pelo fluxo de
 * aprendizagem (quando o destino só fica conhecido depois de aprendido).
 */
async function processarDestino(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
  sessao: Sessao | null,
  origem: Coordenadas,
  destino: Coordenadas,
): Promise<void> {
  const preco = await calcularPreco(supabaseAdmin, origem, destino);
  if (!preco) {
    // Preferimos não dar preço nenhum a inventar um. A origem já está
    // guardada na sessão, por isso só precisa de reenviar o destino.
    await sendWhatsAppMessage(
      telefone,
      '⚠️ Não consegui calcular o preço agora. A tua localização já está guardada — ' +
        'reenvia o destino dentro de um minuto, por favor.',
    );
    return;
  }

  await guardarSessao(supabaseAdmin, telefone, {
    state: 'awaiting_confirm',
    dest_address: destino.endereco,
    dest_lat: destino.lat,
    dest_lng: destino.lng,
    estimated_price: preco.price_kz,
    aprendendo_slot: null, aprendendo_texto: null, aprendendo_nome: null,
  }, sessao);

  const linhas = [
    'Aqui está o resumo 🧾',
    '',
    `De — ${origem.endereco}`,
    `Para — ${destino.endereco}`,
    `Distância — ${preco.distance_km} km (~${preco.duration_min} min)`,
    `Preço — *${kz(preco.price_kz)} Kz*${preco.is_zone_price ? ' _(preço fixo da zona)_' : ''}`,
    '',
    variar([
      'Confirmas? Responde *1* para seguir ou *2* para deixar estar.',
      'Digo ao motorista? *1* para avançar, *2* para cancelar.',
    ], telefone + String(preco.price_kz)),
  ];
  await sendWhatsAppMessage(telefone, linhas.join('\n'));
}

/**
 * Retoma o pedido de corrida depois de o local ter sido resolvido ou aprendido.
 * `slot` diz qual dos extremos era o que faltava.
 */
async function continuarComLocal(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
  sessao: Sessao | null,
  slot: 'origem' | 'destino',
  coords: Coordenadas,
): Promise<void> {
  if (slot === 'origem') {
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'awaiting_dest',
      origin_address: coords.endereco,
      origin_lat: coords.lat,
      origin_lng: coords.lng,
      aprendendo_slot: null, aprendendo_texto: null, aprendendo_nome: null,
    }, sessao);
    await sendWhatsAppMessage(telefone, `📍 *${coords.endereco}*\n\n🏁 Para onde queres ir?`);
    return;
  }

  const origemLat = Number(sessao?.origin_lat);
  const origemLng = Number(sessao?.origin_lng);
  const origem: Coordenadas = {
    lat: origemLat,
    lng: origemLng,
    endereco: sessao?.origin_address ?? 'Origem',
    zona: Number.isFinite(origemLat) && Number.isFinite(origemLng)
      ? await zonaPorCoordenadas(supabaseAdmin, origemLat, origemLng)
      : null,
  };
  await processarDestino(supabaseAdmin, telefone, sessao, origem, coords);
}

/**
 * O bot não conhece o sítio. Em vez de recusar o pedido, entra em modo de
 * aprendizagem: pede o nome e/ou a localização e guarda-o para sempre.
 */
async function iniciarAprendizagem(
  supabaseAdmin: ReturnType<typeof createClient>,
  telefone: string,
  texto: string,
  slot: 'origem' | 'destino',
  sessao: Sessao | null,
  nomePessoa = '',
): Promise<void> {
  await guardarSessao(supabaseAdmin, telefone, {
    state: 'aprendendo_nome',
    aprendendo_slot: slot,
    aprendendo_texto: texto,
    aprendendo_nome: null,
  }, sessao);

  await sendWhatsAppMessage(
    telefone,
    [
      `Hmm${comNome(nomePessoa)} — ainda não conheço *«${texto}»* 🤔`,
      '',
      'Manda-me a *localização* desse sítio (📎 → *Localização*) e eu guardo-o com esse ' +
        'nome e cerca de 1 km à volta. A partir daí nunca mais te pergunto.',
      '',
      'Ou escreve o nome completo, ex.: _Zango 3, Viana_.',
    ].join('\n'),
  );
}

const DESISTIR = /^(cancelar|cancela|desistir|parar|stop|sair|nada|esquece)$/i;

/**
 * Fluxo de aprendizagem de um local desconhecido.
 *
 *   aprendendo_nome -> à espera do nome (ou de um pin que fixe o sítio)
 *   aprendendo_pin  -> já tem o nome, falta o pin
 *
 * Em qualquer dos passos, "cancelar" sai.
 */
async function tratarAprendizagem(
  supabaseAdmin: ReturnType<typeof createClient>,
  msg: MensagemEntrante,
  sessao: Sessao | null,
  estado: Estado,
): Promise<void> {
  const telefone = normalizarTelefone(msg.telefone);
  const texto = msg.texto.trim();
  const slot = (sessao?.aprendendo_slot ?? 'origem') as 'origem' | 'destino';
  const veioLocalizacao = msg.lat !== null && msg.lng !== null;

  // ── Desistir, em qualquer ponto ──
  if (!veioLocalizacao && DESISTIR.test(texto)) {
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'awaiting_origin',
      origin_address: null, origin_lat: null, origin_lng: null,
      dest_address: null, dest_lat: null, dest_lng: null,
      estimated_price: null, ride_id: null,
      aprendendo_slot: null, aprendendo_texto: null, aprendendo_nome: null,
    }, sessao);
    await sendWhatsAppMessage(
      telefone,
      '👌 Sem problema. Escreve *corrida* quando quiseres tentar outra vez.',
    );
    return;
  }

  // ── Passo 1: temos o nome, falta confirmar o sítio ──
  if (estado === 'aprendendo_nome') {
    // (a) Chegou um pin: é a prova de onde o sítio fica. O nome é o que ele
    //     escreveu primeiro (ou, se não houver, usamos o próprio texto).
    if (veioLocalizacao) {
      const nome = (sessao?.aprendendo_texto ?? texto).trim() || texto;
      const ponto = await resolverPonto(supabaseAdmin, msg.lat!, msg.lng!);
      const id = await registarLocalAprendido(
        supabaseAdmin, nome, msg.lat!, msg.lng!, telefone, ponto.endereco,
      );
      if (!id) {
        await sendWhatsAppMessage(
          telefone,
          '⚠️ Não consegui guardar esse sítio agora. Manda a localização outra vez, por favor.',
        );
        return;
      }
      await sendWhatsAppMessage(
        telefone,
        `✅ Guardei *${nome}* (~1 km à volta). Já não volto a perguntar.`,
      );
      await continuarComLocal(supabaseAdmin, telefone, sessao, slot, {
        lat: msg.lat!, lng: msg.lng!,
        endereco: ponto.endereco,
        zona: ponto.zona,
        origemLocal: 'aprendido',
      });
      return;
    }

    // (b) Chegou texto: é o nome corrigido. Tentamos resolvê-lo já.
    if (!texto) {
      await sendWhatsAppMessage(
        telefone,
        'Manda o nome do sítio, ou a localização em 📎 → *Localização*.',
      );
      return;
    }
    const resolvido = await geocodificar(supabaseAdmin, texto, null);
    if (resolvido) {
      const nome = (sessao?.aprendendo_texto ?? texto).trim() || texto;
      await registarLocalAprendido(
        supabaseAdmin, nome, resolvido.lat, resolvido.lng, telefone, resolvido.endereco,
      );
      await sendWhatsAppMessage(
        telefone,
        `✅ Guardei *${nome}*.\n📍 ${resolvido.endereco}`,
      );
      await continuarComLocal(supabaseAdmin, telefone, sessao, slot, resolvido);
      return;
    }

    // Não há forma de o localizar sem o pin.
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'aprendendo_pin',
      aprendendo_nome: texto,
    }, sessao);
    await sendWhatsAppMessage(
      telefone,
      [
        `Ainda não encontro *«${texto}»* no mapa.`,
        '',
        'Manda a *localização* exacta (📎 → *Localização*) e eu guardo esse sítio com esse nome.',
        '',
        'Ou escreve *cancelar*.',
      ].join('\n'),
    );
    return;
  }

  // ── Passo 2: temos o nome, à espera do pin ──
  if (veioLocalizacao) {
    const nome = (sessao?.aprendendo_nome ?? sessao?.aprendendo_texto ?? texto).trim() || texto;
    const ponto = await resolverPonto(supabaseAdmin, msg.lat!, msg.lng!);
    const id = await registarLocalAprendido(
      supabaseAdmin, nome, msg.lat!, msg.lng!, telefone, ponto.endereco,
    );
    if (!id) {
      await sendWhatsAppMessage(
        telefone,
        '⚠️ Não consegui guardar esse sítio agora. Manda a localização outra vez, por favor.',
      );
      return;
    }
    await sendWhatsAppMessage(
      telefone,
      `✅ Guardei *${nome}* (~1 km à volta). Já não volto a perguntar.`,
    );
    await continuarComLocal(supabaseAdmin, telefone, sessao, slot, {
      lat: msg.lat!, lng: msg.lng!,
      endereco: ponto.endereco,
      zona: ponto.zona,
      origemLocal: 'aprendido',
    });
    return;
  }

  await sendWhatsAppMessage(
    telefone,
    'Preciso da *localização* para fixar esse sítio. Toca em 📎 → *Localização*.\n\n' +
      'Ou escreve *cancelar*.',
  );
}

async function tratarPassageiro(
  supabaseAdmin: ReturnType<typeof createClient>,
  msg: MensagemEntrante,
): Promise<void> {
  const telefone = normalizarTelefone(msg.telefone);
  const sessao = await carregarSessao(supabaseAdmin, telefone);
  const texto = msg.texto.trim();
  const veioLocalizacao = msg.lat !== null && msg.lng !== null;
  let estado = sessao?.state ?? null;

  // `'idle'` é o estado neutro: sessão expirada (ver `carregarSessao`) ou nunca
  // começada. Em qualquer dos casos a mensagem é uma conversa nova — mas a
  // linha da base é reaproveitada, para não haver uma por telefone e por sessão.
  if (estado === 'idle') estado = null;

  // ── Cancelar, em qualquer estado ──
  if (/^(cancelar|cancela|desistir|parar|stop)$/i.test(texto)) {
    if (sessao?.ride_id) {
      await supabaseAdmin
        .from('rides')
        .update({ status: 'cancelled' })
        .eq('id', sessao.ride_id)
        .eq('status', 'searching');
    }
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'awaiting_origin',
      origin_address: null, origin_lat: null, origin_lng: null,
      dest_address: null, dest_lat: null, dest_lng: null,
      estimated_price: null, ride_id: null,
    }, sessao);
    await sendWhatsAppMessage(
      telefone,
      variar([
        `Pronto${comNome(msg.nome)}, cancelei o pedido 👍 Quando quiseres, escreve *corrida*.`,
        `Já está${comNome(msg.nome)}, pedido cancelado. É só escreveres *corrida* quando precisares.`,
      ], telefone + texto),
    );
    return;
  }

  // ── Aprendizagem de um local: tem prioridade sobre tudo o resto ──
  // Enquanto o bot está a aprender um sítio, cada mensagem é uma resposta a
  // essa pergunta (nome ou pin) — não pode cair no fluxo normal, senão o
  // utilizador ficava preso num ciclo de "não encontrei".
  if (estado === 'aprendendo_nome' || estado === 'aprendendo_pin') {
    await tratarAprendizagem(supabaseAdmin, msg, sessao, estado);
    return;
  }

  // ── Corrida já em curso: tratar ANTES de aceitar um pedido novo ──
  if (estado === 'dispatching' && sessao?.ride_id) {
    const { data: corrida } = await supabaseAdmin
      .from('rides')
      .select('status')
      .eq('id', sessao.ride_id)
      .maybeSingle();

    const estadoCorrida = corrida?.status ?? null;

    if (estadoCorrida === 'searching') {
      await sendWhatsAppMessage(
        telefone,
        `Ainda estou à procura de motorista para ti${comNome(msg.nome)} ⏳\n\n` +
          `Código da viagem: *${sessao.ride_id.slice(0, 8).toUpperCase()}*. ` +
          'Se quiseres desistir, escreve *cancelar*.',
      );
      return;
    }
    if (
      estadoCorrida === 'accepted' ||
      estadoCorrida === 'picking_up' ||
      estadoCorrida === 'in_progress'
    ) {
      if (!/^cancelar\b/i.test(texto)) {
        // O passageiro está a mandar mensagem durante a corrida: o bot é o intermediário!
        const { data: rideData } = await supabaseAdmin
          .from('rides')
          .select('driver_id')
          .eq('id', sessao.ride_id)
          .maybeSingle();

        if (rideData?.driver_id) {
          const { data: driverProfile } = await supabaseAdmin
            .from('profiles')
            .select('phone, name')
            .eq('user_id', rideData.driver_id)
            .maybeSingle();

          if (driverProfile?.phone) {
            await sendWhatsAppMessage(
              driverProfile.phone,
              `💬 *Mensagem do Passageiro (${msg.nome || 'Passageiro'}):*\n"${texto}"`,
            );
            await sendWhatsAppMessage(
              telefone,
              `✅ A tua mensagem foi entregue ao motorista ${driverProfile.name || ''}:\n"${texto}"`,
            );
            return;
          }
        }

        await sendWhatsAppMessage(
          telefone,
          variar([
            'O teu motorista já vem a caminho 🚗 Acompanha tudo em directo no mapa da app!',
            `Boa notícia${comNome(msg.nome)} — o motorista já vem a caminho 🚗 Vê os dados acima.`,
          ], telefone),
        );
        return;
      }
    }
    // A corrida morreu (cancelada ou concluída) — limpar e seguir para um pedido novo.
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'awaiting_origin',
      origin_address: null, origin_lat: null, origin_lng: null,
      dest_address: null, dest_lat: null, dest_lng: null,
      estimated_price: null, ride_id: null,
    }, sessao);
    estado = 'awaiting_origin';
  }

  // ── Conversa solta: cumprimentar, agradecer, despedir-se ──
  // Só corre quando estamos à espera de input. A meio de um pedido, "obrigado"
  // não pode atropelar o fluxo — e "bom dia" não deve despejar o manual.
  if (estado === null || estado === 'awaiting_origin' || estado === 'awaiting_dest') {
    if (await tratarConversaSolta(telefone, texto, msg.nome, sessao)) return;
  }

  // ── Sem sessão: só arranco se for um pedido explícito ──
  if (estado === null && !veioLocalizacao && !ehPedidoDeCorrida(texto)) {
    await sendWhatsAppMessage(telefone, textoAjuda(msg.nome, telefone + texto));
    return;
  }

  // ── Passo 1: origem ──
  if (estado === null) {
    if (veioLocalizacao) {
      const ponto = await resolverPonto(supabaseAdmin, msg.lat!, msg.lng!);
      const endereco = melhorEndereco(msg.descricaoLocal, ponto.endereco);
      await guardarSessao(supabaseAdmin, telefone, {
        state: 'awaiting_dest',
        origin_address: endereco,
        origin_lat: msg.lat,
        origin_lng: msg.lng,
        dest_address: null, dest_lat: null, dest_lng: null,
        estimated_price: null, ride_id: null,
      }, sessao);
      await sendWhatsAppMessage(
        telefone,
        `Recebi${comNome(msg.nome)} 📍 Estás em *${endereco}*.\n\n` +
          variar([
            'Para onde vamos?',
            'E para onde é que te levo?',
            'Diz-me só o destino.',
          ], telefone + endereco),
      );
      return;
    }

    await guardarSessao(supabaseAdmin, telefone, {
      state: 'awaiting_origin',
      origin_address: null, origin_lat: null, origin_lng: null,
      dest_address: null, dest_lat: null, dest_lng: null,
      estimated_price: null, ride_id: null,
    }, sessao);
    await sendWhatsAppMessage(
      telefone,
      `${variar(['Vamos a isso', 'Bora', 'Perfeito'], telefone + texto)}${comNome(msg.nome)} 🚕\n\n` +
        '*De onde é que sais?*\n\n' +
        'O mais rápido é tocares em 📎 → *Localização* e eu uso logo onde estás. ' +
        'Também podes escrever (ex.: _Belas_, _Talatona_, _Kilamba_).',
    );
    return;
  }

  // ── Passo 2: origem escrita à mão ──
  if (estado === 'awaiting_origin') {
    // Repetir "corrida" enquanto se espera pela origem é comum — não vale a
    // pena tentar geocodificar a palavra "corrida" como se fosse um sítio.
    if (ehPedidoDeCorrida(texto)) {
      await sendWhatsAppMessage(
        telefone,
        `Já estou nisso${comNome(msg.nome)} — falta só saber *de onde sais* 📍\n\n` +
          'Toca em 📎 → *Localização* e eu uso logo onde estás, ou escreve ' +
          '(ex.: _Belas_, _Talatona_).',
      );
      return;
    }
    if (veioLocalizacao) {
      const ponto = await resolverPonto(supabaseAdmin, msg.lat!, msg.lng!);
      const endereco = melhorEndereco(msg.descricaoLocal, ponto.endereco);
      await guardarSessao(supabaseAdmin, telefone, {
        state: 'awaiting_dest',
        origin_address: endereco, origin_lat: msg.lat, origin_lng: msg.lng,
      }, sessao);
      await sendWhatsAppMessage(
        telefone,
        `Anotado 📍 *${endereco}*\n\n` +
          variar(['Para onde vamos?', 'E o destino?', 'Diz-me para onde é.'], telefone + endereco),
      );
      return;
    }

    const coords = await geocodificar(supabaseAdmin, texto);
    if (!coords) {
      // Não conhecemos este sítio — em vez de recusar, o bot APRENDE.
      await iniciarAprendizagem(supabaseAdmin, telefone, texto, 'origem', sessao, msg.nome);
      return;
    }
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'awaiting_dest',
      origin_address: coords.endereco, origin_lat: coords.lat, origin_lng: coords.lng,
    }, sessao);
    await sendWhatsAppMessage(
      telefone,
      `Anotado 📍 *${coords.endereco}*\n\n` +
        variar(['Para onde vamos?', 'E o destino?', 'Diz-me para onde é.'], telefone + coords.endereco),
    );
    return;
  }

  // ── Passo 3: destino ──
  if (estado === 'awaiting_dest') {
    let destino: Coordenadas | null = null;
    const origemLat = Number(sessao!.origin_lat);
    const origemLng = Number(sessao!.origin_lng);
    // A origem serve de referência para desempatar nomes repetidos:
    // "Rua 1" escrito a partir do Kilamba é a "Rua 1" do Kilamba.
    const origemRef = Number.isFinite(origemLat) && Number.isFinite(origemLng)
      ? { lat: origemLat, lng: origemLng }
      : null;

    if (veioLocalizacao) {
      const ponto = await resolverPonto(supabaseAdmin, msg.lat!, msg.lng!);
      destino = {
        lat: msg.lat!,
        lng: msg.lng!,
        endereco: melhorEndereco(msg.descricaoLocal, ponto.endereco),
        zona: ponto.zona,
      };
    } else {
      destino = await geocodificar(supabaseAdmin, texto, origemRef);
    }

    if (!destino) {
      await iniciarAprendizagem(supabaseAdmin, telefone, texto, 'destino', sessao, msg.nome);
      return;
    }

    const origem: Coordenadas = {
      lat: origemLat,
      lng: origemLng,
      endereco: sessao!.origin_address ?? 'Origem',
      // A zona da origem é recalculada pela coordenada: a sessão só guarda
      // lat/lng/endereço, e a zona tem de vir da base para o preço de zona
      // bater certo com o que o app mostraria.
      zona: await zonaPorCoordenadas(supabaseAdmin, origemLat, origemLng),
    };

    await processarDestino(supabaseAdmin, telefone, sessao, origem, destino);
    return;
  }

  // ── Passo 4: confirmação ──
  if (estado === 'awaiting_confirm') {
    if (RECUSA.test(texto)) {
      await guardarSessao(supabaseAdmin, telefone, {
        state: 'awaiting_origin',
        origin_address: null, origin_lat: null, origin_lng: null,
        dest_address: null, dest_lat: null, dest_lng: null,
        estimated_price: null, ride_id: null,
      }, sessao);
      await sendWhatsAppMessage(
        telefone,
        variar([
          `Sem problema${comNome(msg.nome)} 👌 Quando precisares, é só escreveres *corrida*.`,
          `Fica à vontade${comNome(msg.nome)}. Escreve *corrida* quando quiseres.`,
        ], telefone + texto),
      );
      return;
    }

    if (!CONFIRMA.test(texto)) {
      await sendWhatsAppMessage(
        telefone,
        variar([
          'Só preciso de um *1* para confirmar ou *2* para cancelar 👍',
          'Diz-me *1* para seguir com a viagem ou *2* para deixar estar.',
        ], telefone + texto),
      );
      return;
    }

    const userId = sessao!.user_id ?? (await resolverUtilizador(supabaseAdmin, telefone, msg.nome));
    if (!userId) {
      await sendWhatsAppMessage(
        telefone,
        '⚠️ Não consegui abrir a tua conta para registar a corrida. Tenta outra vez dentro de um minuto.',
      );
      return;
    }

    // ── Há mesmo alguém para atender? ────────────────────────────────────────
    // ⚠️ Isto não é uma optimização: é a diferença entre prometer e cumprir.
    //
    // Antes, o bot criava a corrida, dizia ao passageiro «Código da viagem:
    // ABC12345 — guarda-o, é o que o motorista vai pedir», e só DEPOIS
    // descobria que não havia motorista nenhum. Cancelava tudo uns segundos
    // mais tarde e deixava o passageiro com um código que nunca chegou a
    // ninguém.
    //
    // O Danio apanhou isto em 20/09: duas corridas seguidas (22:39 e 22:41),
    // ambas canceladas, porque `driver_locations` tinha 0 motoristas
    // `available`. Um código de viagem só tem valor se houver quem o leia.
    //
    // Se não há ninguém, dizemos a verdade AGORA e não se cria nada. O
    // passageiro fica em `awaiting_confirm`, portanto basta responder *1*
    // outra vez quando quiser tentar de novo — não perde o pedido.
    const origemLat = Number(sessao!.origin_lat);
    const origemLng = Number(sessao!.origin_lng);

    if (Number.isFinite(origemLat) && Number.isFinite(origemLng)) {
      // ⚠️ Envolvido em try/catch de propósito: uma verificação prévia que
      // falha NUNCA pode impedir o despacho. Se isto rebentar, seguimos como
      // antes — criar a corrida e deixar o `enviados === 0` tratar do assunto.
      // O pior que pode acontecer é voltarmos ao comportamento antigo, não a
      // ficarmos sem socorro nenhum.
      let candidatosAgora: MotoristaCandidato[] = [];
      try {
        candidatosAgora = await encontrarMotoristas(supabaseAdmin, origemLat, origemLng);
      } catch (e) {
        console.warn('[whatsapp-webhook] Verificacao previa de motoristas falhou:', e);
      }

      if (candidatosAgora.length === 0) {
        await sendWhatsAppMessage(
          telefone,
          `Não te vou mentir${comNome(msg.nome)} — neste momento não tenho nenhum motorista ` +
            'disponível perto de ti 🚫\n\n' +
            `O trajecto *${sessao!.origin_address} → ${sessao!.dest_address}* fica em ` +
            `*${kz(Number(sessao!.estimated_price))} Kz*.\n\n` +
            'Não criei a viagem, para não te dar um código que não serve para nada. ' +
            'Responde *1* dentro de pouco tempo e eu volto a procurar.',
        );
        return;
      }
    }

    const { data: ride, error: erroCorrida } = await supabaseAdmin
      .from('rides')
      .insert({
        passenger_id: userId,
        origin_address: sessao!.origin_address,
        origin_lat: sessao!.origin_lat,
        origin_lng: sessao!.origin_lng,
        dest_address: sessao!.dest_address,
        dest_lat: sessao!.dest_lat,
        dest_lng: sessao!.dest_lng,
        price_kz: sessao!.estimated_price,
        status: 'searching',
        vehicle_type: 'standard',
      })
      .select('id')
      .single();

    if (erroCorrida || !ride) {
      console.error('[whatsapp-webhook] Nao consegui criar a corrida:', erroCorrida?.message);
      await sendWhatsAppMessage(telefone, '⚠️ Não consegui registar a corrida. Tenta novamente.');
      return;
    }

    const rideId = ride.id as string;
    await guardarSessao(supabaseAdmin, telefone, {
      state: 'dispatching',
      ride_id: rideId,
      user_id: userId,
      dispatch_attempt: 1,
    }, sessao);

    await sendWhatsAppMessage(
      telefone,
      `Feito${comNome(msg.nome)} ✅ Já estou a procurar o motorista mais próximo.\n\n` +
        `Código da viagem: *${rideId.slice(0, 8).toUpperCase()}* — guarda-o, é o que o motorista vai pedir.\n\n` +
        'Aviso-te assim que alguém aceitar.',
    );

    const resultado = await notificarMotoristas(
      supabaseAdmin,
      rideId,
      sessao!.origin_address ?? 'Origem',
      sessao!.dest_address ?? 'Destino',
      Number(sessao!.estimated_price),
      Number(
        haversineKm(
          Number(sessao!.origin_lat), Number(sessao!.origin_lng),
          Number(sessao!.dest_lat), Number(sessao!.dest_lng),
        ).toFixed(1),
      ),
      Number(sessao!.origin_lat),
      Number(sessao!.origin_lng),
    );

    if (resultado.enviados === 0) {
      await supabaseAdmin
        .from('rides')
        .update({ status: 'cancelled' })
        .eq('id', rideId)
        .eq('status', 'searching');

      // ⚠️ Aqui havia `{ state: 'awaiting_origin', ride_id: null }` e MAIS NADA.
      // O `guardarSessao` faz merge, portanto `origin_address`, `dest_address` e
      // `estimated_price` do pedido falhado ficavam lá dentro. A sessão dizia
      // "estou à espera da origem" mas já tinha um trajecto e um preço de uma
      // tentativa anterior — e a mensagem seguinte do passageiro era lida contra
      // esses dados velhos.
      //
      // Foi exactamente este o estado que ficou gravado em 20/09 nas duas
      // conversas: `awaiting_origin` com origem, destino E preço preenchidos,
      // `ride_id` nulo e `dispatch_attempt` a 1.
      //
      // Agora mantém-se em `awaiting_confirm` com o pedido intacto: o passageiro
      // responde *1* e o bot volta a procurar, sem ter de reescrever a morada
      // toda. É também o que a verificação anterior promete.
      await guardarSessao(supabaseAdmin, telefone, {
        state: 'awaiting_confirm',
        ride_id: null,
        dispatch_attempt: null,
      }, sessao);

      await sendWhatsAppMessage(
        telefone,
        `Pois${comNome(msg.nome)}, neste momento não tenho motorista por perto 😔\n\n` +
          `O trajecto *${sessao!.origin_address} → ${sessao!.dest_address}* continua ` +
          `guardado por *${kz(Number(sessao!.estimated_price))} Kz*.\n\n` +
          'Responde *1* daqui a pouco e eu volto a procurar — não precisas de repetir as moradas.',
      );
    }
    return;
  }

  // Rede de segurança — não devia chegar aqui.
  await sendWhatsAppMessage(telefone, textoAjuda(msg.nome, telefone + texto));
}

/** Motorista a responder "ACEITAR <código>". */
async function tratarMotorista(
  supabaseAdmin: ReturnType<typeof createClient>,
  msg: MensagemEntrante,
): Promise<boolean> {
  const telefone = normalizarTelefone(msg.telefone);
  const texto = msg.texto.trim();

  const aceitar = texto.match(/^aceitar\s+([0-9a-f]{4,8})$/i);
  const recusar = texto.match(/^recusar\s+([0-9a-f]{4,8})$/i);

  if (!aceitar && !recusar) return false;

  const driverId = await resolverMotorista(supabaseAdmin, telefone);
  if (!driverId) {
    await sendWhatsAppMessage(
      telefone,
      '⚠️ Este número não está registado como motorista Zenith Ride. Entra na app para activares a tua conta.',
    );
    return true;
  }

  const codigo = (aceitar?.[1] ?? recusar?.[1])!.toLowerCase();

  const { data: corrida } = await supabaseAdmin
    .from('rides')
    .select('id, status, driver_id, passenger_id, origin_address, dest_address, price_kz')
    .ilike('id', `${codigo}%`)
    .eq('status', 'searching')
    .is('driver_id', null)
    .limit(1)
    .maybeSingle();

  if (!corrida) {
    await sendWhatsAppMessage(
      telefone,
      `⚠️ A corrida *${codigo.toUpperCase()}* já não está disponível — foi atribuída a outro motorista ou cancelada.`,
    );
    return true;
  }

  if (recusar) {
    await sendWhatsAppMessage(telefone, '👌 Registado. Fico à espera que aceites a próxima.');
    return true;
  }

  // Atribuição com guarda: só se ainda estiver à procura e sem motorista.
  const { data: atribuida } = await supabaseAdmin
    .from('rides')
    .update({ driver_id: driverId, status: 'accepted' })
    .eq('id', corrida.id)
    .eq('status', 'searching')
    .is('driver_id', null)
    .select('id')
    .maybeSingle();

  if (!atribuida) {
    await sendWhatsAppMessage(
      telefone,
      `⚠️ Chegaste tarde — a corrida *${codigo.toUpperCase()}* foi para outro motorista.`,
    );
    return true;
  }

  // Dados do motorista, para o passageiro
  const { data: perfil } = await supabaseAdmin
    .from('profiles')
    .select('name, phone, rating')
    .eq('user_id', driverId)
    .maybeSingle();

  await sendWhatsAppMessage(
    telefone,
    [
      '✅ *Corrida aceite!*',
      '',
      `📍 *Recolha:* ${corrida.origin_address}`,
      `🏁 *Destino:* ${corrida.dest_address}`,
      `💰 *Valor:* ${kz(Number(corrida.price_kz))} Kz`,
      '',
      'Abre a app Zenith Ride para iniciar a navegação.',
    ].join('\n'),
  );

  // Avisar o passageiro
  const { data: passageiro } = await supabaseAdmin
    .from('profiles')
    .select('phone')
    .eq('user_id', corrida.passenger_id)
    .maybeSingle();

  if (passageiro?.phone) {
    const cleanPhone = (perfil?.phone || '').replace(/\D/g, '');
    const waLink = cleanPhone ? `https://wa.me/${cleanPhone.startsWith('244') ? cleanPhone : '244' + cleanPhone}` : '';

    await sendWhatsAppMessage(
      passageiro.phone,
      [
        '🎉 *A tua corrida foi aceite!*',
        '',
        `👨‍✈️ *Motorista:* ${perfil?.name ?? 'Motorista Zenith'}`,
        `📞 *Contacto do Motorista:* ${perfil?.phone ?? 'Ver na app'}`,
        ...(waLink ? [`💬 *WhatsApp Directo:* ${waLink}`] : []),
        `⭐ *Avaliação:* ${perfil?.rating ?? '—'}`,
        `💰 *Preço:* ${kz(Number(corrida.price_kz))} Kz`,
        '',
        '💡 *Intermediário Zenith:* Podes responder directamente a este bot que eu entrego as tuas mensagens ao motorista!',
      ].join('\n'),
    );
  }

  return true;
}

// ─── Servidor ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const resolvedCorsHeaders = resolveCorsHeaders(req, CORS_OPTIONS);
  if (req.headers.get('Origin') && !resolvedCorsHeaders) {
    return corsForbidden();
  }

  const corsHeaders = corsHeadersToObject(resolvedCorsHeaders);

  // 1. Verificação de Webhook GET (Meta Cloud API / Baileys webhook challenge)
  if (req.method === 'GET') {
    // Fail-closed: sem segredo configurado não se valida nada, e um webhook
    // sem verificação deixa qualquer um subscrever-se ao fluxo de mensagens.
    if (!WHATSAPP_VERIFY_TOKEN) {
      console.error('[whatsapp-webhook] WHATSAPP_VERIFY_TOKEN nao definida — a recusar.');
      return new Response('Servico mal configurado', { status: 503 });
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? 'ok', { status: 200 });
    }
    return new Response('Token de verificação inválido', { status: 403 });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Autenticação do POST ─────────────────────────────────────────────────
  // Antes NÃO havia nenhuma: qualquer pessoa podia fazer POST a este endpoint
  // e executar acções com service_role (disparar fallbacks, notificar
  // motoristas, mexer em corridas). Aceitam-se duas provas de identidade:
  //
  //   1. Assinatura HMAC da Meta (x-hub-signature-256) — callbacks reais.
  //   2. JWT de utilizador do Supabase — chamadas internas da app.
  //      (src/services/rideService.ts envia `Authorization: Bearer <token>`)
  //
  // A chave `anon` NÃO serve: é pública, vai no bundle do browser.
  const corpoCru = await req.text();

  const cabecalhoAssinatura = req.headers.get('x-hub-signature-256') ?? '';
  const assinaturaMetaValida = WHATSAPP_APP_SECRET
    ? await verificarAssinaturaMeta(corpoCru, cabecalhoAssinatura, WHATSAPP_APP_SECRET)
    : false;

  let jwtUtilizadorValido = false;
  if (!assinaturaMetaValida) {
    const cabecalhoAuth = req.headers.get('Authorization') ?? '';
    if (cabecalhoAuth.startsWith('Bearer ')) {
      const { data, error } = await supabaseAdmin.auth.getUser(
        cabecalhoAuth.slice('Bearer '.length),
      );
      jwtUtilizadorValido = !error && !!data?.user;
    }
  }

  if (!assinaturaMetaValida && !jwtUtilizadorValido) {
    console.warn('[whatsapp-webhook] POST recusado: sem assinatura Meta nem JWT valido.');
    return new Response(JSON.stringify({ error: 'Nao autorizado.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = corpoCru ? JSON.parse(corpoCru) : {};
    const action = body.action as string | undefined;

    // ─────────────────────────────────────────────────────────────────────────
    // A. Fallback para Motoristas Próximos (chamado pela app)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'driver_fallback_for_ride') {
      const rideId = body.ride_id;
      if (!rideId) {
        return new Response(JSON.stringify({ error: 'ride_id em falta' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: ride } = await supabaseAdmin
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .single();

      if (!ride) {
        return new Response(JSON.stringify({ error: 'Corrida não encontrada' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const resultado = await notificarMotoristas(
        supabaseAdmin,
        rideId,
        ride.origin_address,
        ride.dest_address,
        Number(ride.price_kz),
        Number(ride.distance_km ?? 0),
        Number(ride.origin_lat),
        Number(ride.origin_lng),
      );

      if (resultado.enviados === 0) {
        console.warn(
          `[whatsapp-webhook] Nenhuma notificacao enviada para a corrida ${rideId}. ` +
            `Motoristas com telefone: ${resultado.candidatos}.`,
        );
        return new Response(
          JSON.stringify({
            success: false,
            reason: resultado.candidatos === 0 ? 'sem_motoristas_com_telefone' : 'envio_falhou',
            dispatched_count: 0,
            drivers_available: resultado.candidatos,
            ride_id: rideId,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          dispatched_count: resultado.enviados,
          ride_id: rideId,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // B. Notificação de Corrida Aceite para o Passageiro (chamado pela app)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === 'passenger_ride_accepted') {
      const rideId = body.ride_id;
      if (!rideId) {
        return new Response(JSON.stringify({ error: 'ride_id em falta' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ANTES:
      //   .select('*, driver:driver_id(name, phone), passenger:passenger_id(phone, name)')
      //
      // As duas chaves estrangeiras de `rides` apontam para `users`, e `users`
      // só tem (id, email, role, created_at, updated_at, tenant_id,
      // suspended_until). Não tem `name` nem `phone`.
      //
      // Resultado: o PostgREST devolvia erro, `ride` ficava null, e a função
      // respondia `{ success: true, notified: false }` — o passageiro NUNCA
      // recebia os dados do motorista, e ninguém dava por isso.
      //
      // Os dados vivem em `profiles`. Passa a ser feito em dois passos.
      const { data: ride } = await supabaseAdmin
        .from('rides')
        .select('id, driver_id, passenger_id, price_kz, origin_address, dest_address')
        .eq('id', rideId)
        .maybeSingle();

      if (!ride) {
        return new Response(JSON.stringify({ error: 'Corrida não encontrada' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const ids = [ride.driver_id, ride.passenger_id].filter(Boolean) as string[];
      const { data: perfis } = await supabaseAdmin
        .from('profiles')
        .select('user_id, name, phone, rating')
        .in('user_id', ids);

      const perfilMotorista = perfis?.find((p) => p.user_id === ride.driver_id);
      const perfilPassageiro = perfis?.find((p) => p.user_id === ride.passenger_id);

      if (!perfilPassageiro?.phone) {
        console.warn(
          `[whatsapp-webhook] Corrida ${rideId}: passageiro sem telefone em profiles — nada enviado.`,
        );
        return new Response(
          JSON.stringify({ success: false, reason: 'passageiro_sem_telefone' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const cleanDriverPhone = (perfilMotorista?.phone || '').replace(/\D/g, '');
      const waDriverLink = cleanDriverPhone ? `https://wa.me/${cleanDriverPhone.startsWith('244') ? cleanDriverPhone : '244' + cleanDriverPhone}` : '';

      const msg = [
        '🎉 *A tua corrida Zenith Ride foi aceite!*',
        '',
        `👨‍✈️ *Motorista:* ${perfilMotorista?.name ?? 'Motorista Zenith'}`,
        `📞 *Contacto:* ${perfilMotorista?.phone ?? 'Ver na App'}`,
        ...(waDriverLink ? [`💬 *WhatsApp Directo:* ${waDriverLink}`] : []),
        `⭐ *Avaliação:* ${perfilMotorista?.rating ?? '—'}`,
        `🚗 *Preço:* ${kz(Number(ride.price_kz))} Kz`,
        '',
        '💡 *Intermediário Zenith:* Podes responder directamente aqui para enviar mensagens ao motorista durante a corrida.',
      ].join('\n');

      const enviado = await sendWhatsAppMessage(perfilPassageiro.phone, msg);

      return new Response(
        JSON.stringify({ success: enviado, notified: enviado }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C. Mensagens recebidas da Meta (webhook oficial)
    // ─────────────────────────────────────────────────────────────────────────
    const entries = body.entry;
    if (!Array.isArray(entries)) {
      return new Response(JSON.stringify({ success: true, ignored: 'payload_desconhecido' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const entry of entries) {
      const changes = entry?.changes;
      if (!Array.isArray(changes)) continue;

      for (const change of changes) {
        const value = change?.value;
        const mensagens = value?.messages;
        if (!Array.isArray(mensagens)) continue;

        const contacto = value?.contacts?.[0];
        const nome = contacto?.profile?.name ?? '';

        for (const m of mensagens) {
          const telefone = String(m?.from ?? '');
          if (!telefone) continue;

          // ── Deduplicação: a Meta reenvia webhooks quando não recebe 200. ──
          if (m?.id) {
            const chaveDedup = `wa_${m.id}`;
            const { data: jaVisto } = await supabaseAdmin
              .from('message_dedup')
              .select('id')
              .eq('message_id', chaveDedup)
              .limit(1)
              .maybeSingle();
            if (jaVisto) {
              console.log(`[whatsapp-webhook] Mensagem ${m.id} repetida — ignorada.`);
              continue;
            }
            await supabaseAdmin
              .from('message_dedup')
              .insert({ message_id: chaveDedup });
          }

          // ── Mensagens antigas: a Meta guarda o que chega com o bot desligado
          // e entrega tudo de uma vez quando voltamos. Responder a uma SMS de há
          // três dias é o que fazia o bot parecer avariado — e enchia o
          // utilizador com respostas a coisas que já não interessam.
          //
          // A janela é de 15 minutos por omissão: cobre atrasos normais de rede
          // e reenvios da Meta, e corta o histórico acumulado.
          const tsMensagem = Number(m?.timestamp ?? 0);
          if (tsMensagem > 0) {
            const idadeSeg = Math.floor(Date.now() / 1000) - tsMensagem;
            if (idadeSeg > JANELA_MENSAGEM_SEGUNDOS) {
              console.log(
                `[whatsapp-webhook] Mensagem ${m?.id ?? '?'} com ${Math.floor(idadeSeg / 60)} min — ignorada (fora da janela).`,
              );
              continue;
            }
          }

          const tipo = String(m?.type ?? 'text');
          const texto = String(
            m?.text?.body ??
              m?.interactive?.button_reply?.title ??
              m?.interactive?.list_reply?.title ??
              m?.button?.text ??
              '',
          ).trim();

          const msg: MensagemEntrante = {
            telefone,
            nome,
            texto,
            tipo,
            lat: tipo === 'location' ? Number(m?.location?.latitude) : null,
            lng: tipo === 'location' ? Number(m?.location?.longitude) : null,
            descricaoLocal: tipo === 'location'
              ? (m?.location?.address ?? m?.location?.name ?? null)
              : null,
            msgId: m?.id ?? null,
          };

          // Marca como lida e liga o "a escrever…" antes de tratar. É o sinal
          // que faz o utilizador sentir que há alguém do outro lado.
          await marcarALer(m?.id ?? null);

          // Motorista primeiro: "ACEITAR xxxx" tem de funcionar em qualquer estado.
          const tratadoComoMotorista = await tratarMotorista(supabaseAdmin, msg);
          if (tratadoComoMotorista) continue;

          if (!texto && msg.lat === null) {
            await sendWhatsAppMessage(
              telefone,
              'Recebi a tua mensagem, mas ainda não sei ler esse tipo de conteúdo. ' +
                'Escreve *corrida* ou manda a tua localização em 📎 → *Localização*.',
            );
            continue;
          }

          // Uma resposta instantânea parece script — sobretudo quando a
          // pergunta era longa. Pequena pausa antes de responder.
          await pausaHumana(texto);

          await tratarPassageiro(supabaseAdmin, msg);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[whatsapp-webhook] Erro:', error);
    // Mesmo em erro devolvemos 200 para a Meta não entrar em ciclo de reenvios.
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Erro interno' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
