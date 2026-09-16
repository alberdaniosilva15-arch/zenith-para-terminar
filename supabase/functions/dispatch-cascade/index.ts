import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WA_TOKEN = Deno.env.get('WA_ACCESS_TOKEN')!;
const WA_PHONE_ID = Deno.env.get('WA_PHONE_NUMBER_ID')!;

const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const DISPATCH_SECRET   = Deno.env.get('DISPATCH_SECRET') || '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendWA(to: string, text: string): Promise<boolean> {
  if (!WA_PHONE_ID || !WA_TOKEN) {
    console.warn('[dispatch-cascade] WhatsApp credentials missing');
    return false;
  }
  const cleanTo = normalizePhone(to);
  if (!cleanTo) {
    console.warn(`[dispatch-cascade] Destino sem digitos: "${to}" — nada enviado.`);
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: cleanTo, type: "text", text: { body: text } }),
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      console.error(`[dispatch-cascade] Meta recusou envio para ${cleanTo}: ${res.status} ${detalhe}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[dispatch-cascade] Excepcao no envio WhatsApp:', err);
    return false;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Normaliza para o formato E.164 sem "+" que a Cloud API espera (244XXXXXXXXX).
 * Devolve '' quando não sobram dígitos suficientes — antes devolvia sempre
 * algo (no mínimo "244"), o que fazia o envio apontar para um número inexistente.
 */
function normalizePhone(phone: string): string {
  const cleaned = String(phone ?? '').replace(/\D/g, '');
  if (cleaned.length < 9) return '';
  if (cleaned.startsWith('244')) return cleaned;
  return '244' + cleaned;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const secretHeader = req.headers.get('x-dispatch-secret') ?? '';

    let isAuthorized = false;
    let authUserId: string | null = null;

    if (
      (DISPATCH_SECRET && secretHeader === DISPATCH_SECRET) ||
      (authHeader && authHeader.includes(SERVICE_ROLE_KEY))
    ) {
      isAuthorized = true;
    } else if (authHeader.startsWith('Bearer ') && SUPABASE_ANON_KEY) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        authUserId = user.id;
      }
    }

    if (!isAuthorized && !authUserId) {
      return new Response(JSON.stringify({ error: 'Não autenticado.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { ride_id, phone } = await req.json();
    if (!ride_id) {
      return new Response(JSON.stringify({ error: 'ride_id obrigatório.' }), { status: 400 });
    }

    const { data: ride } = await supabase
      .from("rides").select("*").eq("id", ride_id).single();

    if (!ride) {
      return new Response(JSON.stringify({ ok: false, reason: "ride_not_found" }), { status: 404 });
    }

    // Se a chamada veio de utilizador comum, verificar se é o passageiro da corrida ou admin
    if (!isAuthorized && authUserId) {
      const { data: userRow } = await supabase
        .from('users')
        .select('role')
        .eq('id', authUserId)
        .maybeSingle();

      const isAdmin = userRow?.role === 'admin';
      if (ride.passenger_id !== authUserId && !isAdmin) {
        return new Response(JSON.stringify({ error: 'Sem permissão para esta corrida.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (ride.status !== "searching") {
      return new Response(JSON.stringify({ ok: false, reason: "invalid_state" }), { status: 400 });
    }

    // Buscar motoristas em cascata (5km → 7km → 12km)
    let drivers: any[] = [];
    for (const radius of [5, 7, 12]) {
      const { data, error } = await supabase.rpc("get_cascade_drivers", {
        p_lat: ride.origin_lat, p_lng: ride.origin_lng, p_radius_km: radius, p_limit: 5,
      });
      if (data && data.length > 0) { 
        drivers = data; 
        break; 
      }
    }

    if (drivers.length === 0) {
      await supabase.from("rides")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Sem motoristas" })
        .eq("id", ride_id);
      await sendWA(phone, "😔 Não encontrámos motoristas disponíveis neste momento. Tenta novamente em 2 minutos.");
      
      // Update whatsapp_sessions to IDLE
      await supabase.from("whatsapp_sessions").update({ state: "IDLE", ride_id: null }).eq("phone", phone);
      return new Response(JSON.stringify({ ok: false, reason: "no_drivers" }));
    }

    // Tentar cada motorista com timeout inteligente
    for (let i = 0; i < drivers.length; i++) {
      const driver = drivers[i];

      // Enviar notificação ao motorista via Push / Database / WhatsApp
      // No teu flow atual, usavas WhatsApp para fallback. Vamos enviar notificação via DB + WhatsApp
      
      const rideCode = ride.id.slice(0, 8).toUpperCase();
      const distanceKm = Number(driver.distance_m ?? 0) / 1000;
      
      const msgText = [
        '🚗 *Nova corrida Exclusiva*',
        `Olá ${driver.driver_name}, tens prioridade nesta corrida!`,
        `Código: ${rideCode}`,
        `Origem: ${ride.origin_address}`,
        `Destino: ${ride.dest_address}`,
        `Preço: ${Number(ride.price_kz).toLocaleString('pt-PT')} Kz`,
        `A apenas ${distanceKm.toFixed(1)} km de ti.`,
        `⏳ Tens ${driver.timeout_sec ?? 8} segundos para aceitar na app Zenith Ride!`
      ].join('\n');

      if (driver.phone) {
        // sendWA normaliza internamente; passamos o valor cru.
        const enviado = await sendWA(driver.phone, msgText);
        if (!enviado) {
          console.error(
            `[dispatch-cascade] Motorista ${driver.driver_name} NAO notificado (telefone: "${driver.phone}").`,
          );
        }
      } else {
        console.warn(
          `[dispatch-cascade] Motorista ${driver.driver_name} (${driver.driver_id}) sem telefone em profiles — nao notificado.`,
        );
      }

      // Aguardar timeout inteligente
      const timeoutMs = (driver.timeout_sec ?? 8) * 1000;
      await sleep(timeoutMs);

      // Verificar se o motorista aceitou (se o ride.status mudou ou driver_id preencheu)
      const { data: updated } = await supabase
        .from("rides").select("status, driver_id").eq("id", ride_id).single();

      if (updated && updated.status !== "searching" && updated.driver_id) {
        // Motorista aceitou! 
        // O webhook original já avisa o passageiro se o motorista aceitar, mas caso não:
        // O motorista clica em "Aceitar" na app, que chama a backend e notifica o passageiro.
        // O nosso cascade pára aqui.
        return new Response(JSON.stringify({ ok: true, driver: driver.driver_name }));
      }
    }

    // Nenhum aceitou
    await supabase.from("rides")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "Sem motoristas" })
        .eq("id", ride_id);
    await supabase.from("whatsapp_sessions").update({ state: "IDLE", ride_id: null }).eq("phone", phone);
    await sendWA(phone, "😔 Nenhum motorista aceitou neste momento. Tenta novamente em 2 min.");

    return new Response(JSON.stringify({ ok: false, reason: "all_declined" }));
  } catch (err) {
    console.error("[dispatch-cascade]", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 });
  }
});
