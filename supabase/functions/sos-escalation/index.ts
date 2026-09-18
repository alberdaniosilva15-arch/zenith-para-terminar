// =============================================================================
// ZENITH RIDE — Edge Function: sos-escalation
//
// A escada de segurança da corrida. É chamada de minuto a minuto pelo
// `pg_cron` (job `sos-escalation-a-cada-minuto`, através do `pg_net`).
//
//   A corrida passa 1,5× a duração prevista
//        -> a app pergunta ao passageiro "está tudo bem?"      (2 min)
//        -> ninguém responde: o painel de admin é avisado       (10 min)
//        -> continua sem resposta: o contacto de emergência recebe
//           um WhatsApp com o carro, o motorista e a posição
//
// Este ficheiro é só a LIGAÇÃO ao mundo exterior (Supabase, WhatsApp, HTTP).
// As regras estão em `logica.ts` e a orquestração em `motor.ts` — que não
// conhecem nem o Supabase nem a rede, e por isso podem ser provadas com o
// relógio controlado.
//
// Deploy: supabase functions deploy sos-escalation --no-verify-jwt
//   (o `--no-verify-jwt` é obrigatório: quem chama é o pg_cron, que não tem
//    sessão de utilizador. A autenticação é feita aqui dentro, pelo segredo.)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  correrEscada,
  type MudancasAlerta,
  type MudancasEscada,
  type NovaEscada,
  type Ponto,
  type Porta,
} from './motor.ts';
import {
  JANELA_ALERTAS_MS,
  MAX_TENTATIVAS_CONTACTO,
  type AlertaParaNotificar,
  type CorridaParaVigiar,
  type Escada,
} from './logica.ts';
import { applyCors, corsForbidden, resolveCorsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const WA_TOKEN = Deno.env.get('WA_ACCESS_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WA_PHONE_NUMBER_ID') ?? '';

// O cron do Supabase manda `SOS_CRON_SECRET`; um cron externo pode mandar o
// `CRON_SECRET` que já existia. Ambos servem.
const SOS_CRON_SECRET = Deno.env.get('SOS_CRON_SECRET') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Porta real ───────────────────────────────────────────────────────────────

const porta: Porta = {
  async listarCorridasEmCurso() {
    const { data, error } = await admin
      .from('rides')
      .select(
        'id, passenger_id, driver_id, origin_address, dest_address, started_at, duration_min, origin_lat, origin_lng',
      )
      .eq('status', 'in_progress')
      .limit(200);

    if (error) throw new Error(`listar corridas: ${error.message}`);
    return (data ?? []) as CorridaParaVigiar[];
  },

  async listarEscadasAbertas() {
    const { data, error } = await admin
      .from('ride_safety_checks')
      .select('*')
      .in('estado', ['pergunta', 'alerta_admin', 'whatsapp_enviado'])
      .limit(300);

    if (error) throw new Error(`listar escadas abertas: ${error.message}`);
    return (data ?? []) as Escada[];
  },

  async listarEscadasDasCorridas(rideIds: string[]) {
    if (rideIds.length === 0) return [];

    const { data, error } = await admin
      .from('ride_safety_checks')
      .select('*')
      .in('ride_id', rideIds)
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw new Error(`listar escadas: ${error.message}`);
    return (data ?? []) as Escada[];
  },

  async lerPerfil(userId: string) {
    const { data } = await admin
      .from('profiles')
      .select('user_id, name, phone, emergency_contact_phone')
      .eq('user_id', userId)
      .maybeSingle();

    return data ?? null;
  },

  async lerViatura(driverId: string) {
    const { data } = await admin
      .from('driver_documents')
      .select('car_brand, car_model, car_color, car_plate')
      .eq('driver_id', driverId)
      .maybeSingle();

    return data ?? null;
  },

  async lerUltimoPonto(rideId: string): Promise<Ponto | null> {
    const { data } = await admin
      .from('ride_track_points')
      .select('lat, lng, recorded_at')
      .eq('ride_id', rideId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as Ponto | null) ?? null;
  },

  async criarEscada(linha: NovaEscada) {
    const { error } = await admin.from('ride_safety_checks').insert({
      ride_id: linha.ride_id,
      passenger_id: linha.passenger_id,
      driver_id: linha.driver_id,
      estado: linha.estado,
      answer_deadline: linha.answer_deadline,
    });

    if (error) throw new Error(error.message);
  },

  async actualizarEscada(id: string, mudancas: MudancasEscada) {
    const { error } = await admin.from('ride_safety_checks').update(mudancas).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async criarAvisoAdmin(aviso) {
    const { data, error } = await admin
      .from('panic_alerts')
      .insert({
        user_id: aviso.user_id,
        ride_id: aviso.ride_id,
        driver_name: aviso.driver_name,
        severity: aviso.severity,
        lat: aviso.lat,
        lng: aviso.lng,
      })
      .select('id')
      .single();

    if (error) {
      // O aviso ao admin é o degrau mais importante da escada. Se não entrar,
      // tem de doer — não se engole o erro.
      throw new Error(`criar aviso admin: ${error.message}`);
    }

    return (data as { id: string } | null)?.id ?? null;
  },

  async enviarWhatsApp(telefone: string, texto: string) {
    if (!WA_TOKEN || !WA_PHONE_ID) {
      throw new Error('credenciais do WhatsApp em falta (WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID)');
    }

    const res = await fetch(`https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WA_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: texto },
      }),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`graph API ${res.status}: ${corpo.slice(0, 200)}`);
    }

    return true;
  },

  // ── Alertas de pânico (passo 4) ────────────────────────────────────────────

  async listarAlertasPorAvisar(): Promise<AlertaParaNotificar[]> {
    // Filtramos por idade JÁ em SQL: um alerta antigo não interessa e não vale
    // a pena trazê-lo para memória a cada minuto.
    const desde = new Date(Date.now() - JANELA_ALERTAS_MS).toISOString();

    const { data, error } = await admin
      .from('panic_alerts')
      .select(
        'id, user_id, ride_id, severity, source, created_at, lat, lng, driver_name, audio_storage_path, contact_phone, contact_notified_at, contact_attempts',
      )
      .is('contact_notified_at', null)
      .lt('contact_attempts', MAX_TENTATIVAS_CONTACTO)
      .gte('created_at', desde)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) throw new Error(error.message);
    return (data ?? []) as AlertaParaNotificar[];
  },

  async lerCorrida(rideId: string) {
    const { data, error } = await admin
      .from('rides')
      .select('origin_address, dest_address')
      .eq('id', rideId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const linha = data as { origin_address: string | null; dest_address: string | null };
    return { origem: linha.origin_address, destino: linha.dest_address };
  },

  async criarLinkDoAudio(caminho: string): Promise<string | null> {
    // O bucket `panic-audio` é PRIVADO. Um URL directo devolveria 400 ao
    // contacto; o link tem de ser assinado. 24 horas é tempo suficiente para
    // alguém ver a mensagem e guardar o áudio.
    const { data, error } = await admin.storage
      .from('panic-audio')
      .createSignedUrl(caminho, 24 * 60 * 60);

    if (error) throw new Error(error.message);
    return data?.signedUrl ?? null;
  },

  async actualizarAlerta(id: string, mudancas: MudancasAlerta) {
    const { error } = await admin.from('panic_alerts').update(mudancas).eq('id', id);
    if (error) throw new Error(error.message);
  },
};

// ── Autenticação ─────────────────────────────────────────────────────────────

function comparacaoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

function segredoValido(recebido: string): boolean {
  if (!recebido) return false;
  const candidatos = [SOS_CRON_SECRET, CRON_SECRET].filter((s) => s.length > 0);
  return candidatos.some((s) => comparacaoConstante(recebido, s));
}

async function adminValido(authHeader: string): Promise<boolean> {
  if (!authHeader.startsWith('Bearer ') || !SUPABASE_ANON_KEY) return false;

  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
  } = await cliente.auth.getUser();

  if (!user) return false;

  const { data } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  return data?.role === 'admin';
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

function json(corpo: unknown, status = 200, cors?: Headers | null): Response {
  return applyCors(
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    cors ?? null,
  );
}

// ── Limpeza do áudio de pânico ───────────────────────────────────────────────
//
// Porque é que isto vive aqui e não numa função SQL: o Supabase PROÍBE apagar
// directamente de `storage.objects` — há um trigger que responde
// "Direct deletion from storage tables is not allowed. Use the Storage API".
// A função `delete_old_panic_audio()` fazia exactamente isso e falhava todos os
// dias às 03:00. O áudio de emergência acumulava para sempre.
//
// Aqui usamos a Storage API como deve ser. E a lista de ficheiros a apagar vem
// da própria base de dados (`panic_alerts.audio_storage_path`), não de uma
// travessia de pastas no bucket: quem criou o ficheiro sabe onde ele está.

/** Dias que uma gravação de emergência é retida antes de ser apagada. */
const DIAS_DE_RETENCAO_AUDIO = 7;

interface ResultadoDaLimpeza {
  removidos: number;
  falhados: number;
  erros: string[];
}

async function limparAudioAntigo(): Promise<ResultadoDaLimpeza> {
  const limite = new Date(
    Date.now() - DIAS_DE_RETENCAO_AUDIO * 24 * 60 * 60 * 1000,
  ).toISOString();

  const resultado: ResultadoDaLimpeza = { removidos: 0, falhados: 0, erros: [] };

  const { data, error } = await admin
    .from('panic_alerts')
    .select('id, audio_storage_path')
    .lt('created_at', limite)
    .not('audio_storage_path', 'is', null)
    .is('audio_purged_at', null)
    .limit(500);

  if (error) throw new Error(`listar audio a limpar: ${error.message}`);

  const linhas = (data ?? []) as { id: string; audio_storage_path: string }[];
  if (linhas.length === 0) return resultado;

  // A Storage API aceita vários caminhos de uma vez — uma chamada, não 500.
  const caminhos = linhas.map((l) => l.audio_storage_path);

  const { data: apagados, error: erroApagar } = await admin.storage
    .from('panic-audio')
    .remove(caminhos);

  if (erroApagar) {
    resultado.falhados = caminhos.length;
    resultado.erros.push(`remover: ${erroApagar.message}`);
    return resultado;
  }

  // A API devolve os que conseguiu apagar. Um ficheiro que já não existia não
  // conta como falha — pode ter sido apagado numa execução anterior.
  const apagadosSet = new Set(
    ((apagados ?? []) as { name: string }[]).map((o) => o.name),
  );

  const marcados: string[] = [];
  for (const linha of linhas) {
    const nome = linha.audio_storage_path.split('/').pop() ?? linha.audio_storage_path;
    if (apagadosSet.size === 0 || apagadosSet.has(nome) || apagadosSet.has(linha.audio_storage_path)) {
      marcados.push(linha.id);
    }
  }

  if (marcados.length > 0) {
    const { error: erroMarcar } = await admin
      .from('panic_alerts')
      .update({
        audio_storage_path: null,
        audio_purged_at: new Date().toISOString(),
      })
      .in('id', marcados);

    if (erroMarcar) {
      resultado.erros.push(`marcar como purgado: ${erroMarcar.message}`);
      resultado.falhados += marcados.length;
    } else {
      resultado.removidos = marcados.length;
    }
  }

  return resultado;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req, { methods: 'POST, OPTIONS' });

  if (req.method === 'OPTIONS') {
    return applyCors(new Response(null, { status: 204 }), corsHeaders);
  }

  if (req.method !== 'POST') {
    return json({ error: 'Metodo nao permitido.' }, 405, corsHeaders);
  }

  if (req.headers.get('Origin') && !corsHeaders) {
    return corsForbidden();
  }

  const autorizado =
    segredoValido(req.headers.get('x-cron-secret') ?? '') ||
    (await adminValido(req.headers.get('Authorization') ?? ''));

  if (!autorizado) {
    return json({ error: 'Nao autorizado.' }, 401, corsHeaders);
  }

  try {
    // Modo limpeza: accionado pelo cron diário (`?tarefa=limpar-audio`). A
    // autenticação é a mesma — o segredo do cron. Não é um endpoint público.
    const tarefa = new URL(req.url).searchParams.get('tarefa');

    if (tarefa === 'limpar-audio') {
      const limpeza = await limparAudioAntigo();
      if (limpeza.erros.length > 0) {
        console.error('[sos-escalation] limpeza de audio:', limpeza.erros);
      }
      return json({ ok: limpeza.erros.length === 0, tarefa, ...limpeza }, 200, corsHeaders);
    }

    const relatorio = await correrEscada(porta, Date.now());

    if (relatorio.erros.length > 0) {
      console.error('[sos-escalation] erros:', relatorio.erros);
    }

    return json({ ok: true, ...relatorio }, 200, corsHeaders);
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    console.error('[sos-escalation] falhou:', detalhe);
    return json({ ok: false, error: detalhe }, 500, corsHeaders);
  }
});
