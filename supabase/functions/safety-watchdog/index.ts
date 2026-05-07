// =============================================================================
// ZENITH RIDE — Edge Function: safety-watchdog
// Detecta corridas activas há mais de 4 horas e notifica contacto de emergência
// via WhatsApp Business API.
//
// Deploy: supabase functions deploy safety-watchdog --no-verify-jwt
// Trigger: pg_cron a cada 1 hora OU chamada manual do admin
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WA_TOKEN          = Deno.env.get('WA_ACCESS_TOKEN') ?? '';
const WA_PHONE_ID       = Deno.env.get('WA_PHONE_NUMBER_ID') ?? '';
const STALE_HOURS       = 4; // Corrida activa sem fim após X horas

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface StaleRide {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  origin_address: string | null;
  started_at: string;
  passenger_name: string | null;
  passenger_phone: string | null;
  passenger_emergency_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_emergency_phone: string | null;
}

Deno.serve(async (req: Request) => {
  // Apenas aceitar POST com Service Role Key (cron ou admin)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(SERVICE_ROLE_KEY) && !authHeader.includes('Bearer')) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  try {
    // 1. Buscar corridas in_progress com mais de STALE_HOURS
    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: rides, error: ridesErr } = await admin
      .from('rides')
      .select('id, passenger_id, driver_id, origin_address, started_at')
      .eq('status', 'in_progress')
      .lt('started_at', cutoff)
      .limit(50);

    if (ridesErr || !rides?.length) {
      return json({ ok: true, stale_rides: 0, alerts_sent: 0 });
    }

    // 2. Buscar perfis dos passageiros e motoristas envolvidos
    const passengerIds = [...new Set(rides.map(r => r.passenger_id).filter(Boolean))];
    const driverIds = [...new Set(rides.map(r => r.driver_id).filter(Boolean))] as string[];

    const allUserIds = [...new Set([...passengerIds, ...driverIds])];

    const { data: profiles } = await admin
      .from('profiles')
      .select('user_id, name, phone, emergency_contact_name, emergency_contact_phone')
      .in('user_id', allUserIds);

    const profileMap = new Map(
      (profiles ?? []).map(p => [p.user_id, p])
    );

    // 3. Verificar se já alertámos esta corrida (evitar spam)
    const rideIds = rides.map(r => r.id);
    const { data: existingAlerts } = await admin
      .from('safety_watchdog_alerts')
      .select('ride_id')
      .in('ride_id', rideIds);

    const alreadyAlerted = new Set((existingAlerts ?? []).map(a => a.ride_id));

    // 4. Enviar alertas
    let alertsSent = 0;

    for (const ride of rides) {
      if (alreadyAlerted.has(ride.id)) continue;

      const passengerProfile = profileMap.get(ride.passenger_id);
      const driverProfile = ride.driver_id ? profileMap.get(ride.driver_id) : null;

      const passengerName = passengerProfile?.name ?? 'Passageiro';
      const driverName = driverProfile?.name ?? 'Motorista desconhecido';
      const emergencyPhone = passengerProfile?.emergency_contact_phone;
      const startedAt = new Date(ride.started_at).toLocaleTimeString('pt-AO', {
        hour: '2-digit', minute: '2-digit'
      });

      if (emergencyPhone) {
        const message = [
          '🚨 ALERTA DE SEGURANÇA — ZENITH RIDE',
          '',
          `Olá, o(a) ${passengerName} começou uma corrida às ${startedAt} com o motorista ${driverName}, mas ainda não registou o fim da corrida (já passaram mais de ${STALE_HOURS} horas).`,
          '',
          'Por favor, ligue para saber se está tudo bem.',
          '',
          `📞 Número: ${passengerProfile?.phone ?? 'não disponível'}`,
          '',
          '— Enviado automaticamente pelo sistema de segurança Zenith Ride',
        ].join('\n');

        await sendWhatsApp(normalizePhone(emergencyPhone), message);
        alertsSent++;
      }

      // Registar que já alertámos esta corrida
      await admin.from('safety_watchdog_alerts').insert({
        ride_id: ride.id,
        passenger_id: ride.passenger_id,
        driver_id: ride.driver_id,
        alerted_at: new Date().toISOString(),
        emergency_phone_notified: emergencyPhone ?? null,
      });
    }

    return json({
      ok: true,
      stale_rides: rides.length,
      already_alerted: alreadyAlerted.size,
      alerts_sent: alertsSent,
    });

  } catch (e) {
    console.error('[safety-watchdog] erro:', e);
    return json({ error: 'Erro interno.' }, 500);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('244') ? digits : `244${digits}`;
}

async function sendWhatsApp(phone: string, text: string): Promise<boolean> {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.warn('[safety-watchdog] WhatsApp credentials missing.');
    return false;
  }

  const res = await fetch(`https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WA_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('[safety-watchdog] WhatsApp falhou:', res.status, body);
    return false;
  }

  return true;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
