import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const WHATSAPP_VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
const WHATSAPP_GRAPH_TOKEN = Deno.env.get('WHATSAPP_GRAPH_TOKEN') ?? '';
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_TOKEN') ?? '';

type SessionState = 'IDLE' | 'AWAITING_ORIGIN' | 'AWAITING_DEST' | 'AWAITING_CONFIRM' | 'RIDE_ACTIVE';

type IncomingMessage = {
  from: string;
  type: 'text' | 'location' | 'interactive' | string;
  text?: { body?: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    button_reply?: { title?: string; id?: string };
    list_reply?: { title?: string; id?: string };
  };
};

type SessionRow = {
  id: string;
  phone: string;
  user_id: string | null;
  state: SessionState;
  origin_address: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_address: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  ride_id: string | null;
  updated_at: string;
};

type InternalActionBody = {
  action?: string;
  ride_id?: string;
};

type NearbyDriverRow = {
  driver_id: string;
  driver_name?: string | null;
  distance_m?: number | null;
};

type DriverLocationRow = {
  driver_id: string;
  status: string | null;
  updated_at: string | null;
};

type DriverProfileRow = {
  user_id: string;
  name: string | null;
  phone: string | null;
  rating?: number | null;
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      return withCors(new Response(challenge, { status: 200 }));
    }

    return withCors(json({ error: true, message: 'Falha na verificacao do webhook.' }, 403));
  }

  if (req.method !== 'POST') {
    return withCors(json({ error: true, message: 'Metodo nao suportado.' }, 405));
  }

  try {
    const body = await req.json();

    if (isInternalActionRequest(body)) {
      return withCors(await handleInternalActionRequest(req, body));
    }

    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value ?? {};
        const messages = Array.isArray(value.messages) ? value.messages : [];

        for (const message of messages) {
          await handleIncomingMessage(message as IncomingMessage);
        }
      }
    }

    return withCors(json({ ok: true }, 200));
  } catch (error) {
    console.error('[whatsapp-webhook] erro:', error);
    return withCors(json({ error: true, message: 'Erro interno.' }, 500));
  }
});

async function handleIncomingMessage(message: IncomingMessage) {
  const phone = normalizePhone(message.from);
  const session = await getOrCreateSession(phone);
  const text = getMessageText(message);

  switch (session.state) {
    case 'IDLE':
      if (message.type === 'location' && message.location) {
        await handleOriginStep(session, message.location.latitude, message.location.longitude);
        return;
      }
      await updateSession(phone, { state: 'AWAITING_ORIGIN' });
      await sendWhatsAppText(phone, 'Olá! Sou o Kaze da Zenith Ride. Envia a tua localização para pedir uma corrida.');
      return;

    case 'AWAITING_ORIGIN':
      if (message.type === 'location' && message.location) {
        await handleOriginStep(session, message.location.latitude, message.location.longitude);
        return;
      }
      await sendWhatsAppText(phone, 'Preciso primeiro da tua localização actual. Usa a opção de enviar localização no WhatsApp.');
      return;

    case 'AWAITING_DEST':
      if (message.type === 'location' && message.location) {
        await handleDestinationStep(
          session,
          { lat: message.location.latitude, lng: message.location.longitude },
          null,
        );
        return;
      }

      if (text) {
        await handleDestinationStep(session, null, text);
        return;
      }

      await sendWhatsAppText(phone, 'Para onde queres ir? Podes enviar uma localização ou escrever o destino.');
      return;

    case 'AWAITING_CONFIRM':
      if (!text) {
        await sendWhatsAppText(phone, 'Responde "Sim" para confirmar ou "Não" para cancelar.');
        return;
      }

      if (isAffirmative(text)) {
        await confirmRideRequest(session);
        return;
      }

      if (isNegative(text)) {
        await resetSession(phone);
        await sendWhatsAppText(phone, 'Pedido cancelado. Quando quiseres, envia uma nova mensagem e recomeçamos.');
        return;
      }

      await sendWhatsAppText(phone, 'Não percebi. Responde apenas com "Sim" ou "Não".');
      return;

    case 'RIDE_ACTIVE':
      if (text && text.toLowerCase().includes('cancel')) {
        await cancelActiveRide(session);
        return;
      }
      await sendWhatsAppText(phone, 'A tua corrida continua activa. Assim que houver uma actualização importante eu volto aqui.');
      return;
  }
}

async function handleOriginStep(session: SessionRow, latitude: number, longitude: number) {
  const originAddress = await reverseGeocode(latitude, longitude);
  await updateSession(session.phone, {
    state: 'AWAITING_DEST',
    origin_address: originAddress,
    origin_lat: latitude,
    origin_lng: longitude,
  });

  await sendWhatsAppText(
    session.phone,
    `📍 Estás em ${originAddress}. Para onde queres ir? Envia uma localização ou escreve o destino.`,
  );
}

async function handleDestinationStep(
  session: SessionRow,
  coords: { lat: number; lng: number } | null,
  destinationText: string | null,
) {
  if (session.origin_lat == null || session.origin_lng == null) {
    await updateSession(session.phone, { state: 'AWAITING_ORIGIN' });
    await sendWhatsAppText(session.phone, 'Vamos recomeçar. Envia primeiro a tua localização actual.');
    return;
  }

  let destination: { lat: number; lng: number; address: string } | null = null;

  if (coords) {
    destination = {
      lat: coords.lat,
      lng: coords.lng,
      address: await reverseGeocode(coords.lat, coords.lng),
    };
  } else if (destinationText) {
    destination = await forwardGeocode(destinationText);
  }

  if (!destination) {
    await sendWhatsAppText(session.phone, 'Não consegui perceber o destino. Tenta enviar uma localização ou um endereço mais completo.');
    return;
  }

  const distanceKm = haversineKm(session.origin_lat, session.origin_lng, destination.lat, destination.lng);
  const durationMin = Math.max(4, Math.round((distanceKm / 24) * 60));
  const isNight = new Date().getHours() >= 22 || new Date().getHours() < 6;
  const fare = await admin.rpc('calculate_fare_engine_pro', {
    p_distance_km: distanceKm,
    p_duration_min: durationMin,
    p_origin_lat: session.origin_lat,
    p_origin_lng: session.origin_lng,
    p_dest_lat: destination.lat,
    p_dest_lng: destination.lng,
    p_service_tier: 'standard',
    p_demand_count: 5,
    p_supply_count: 5,
    p_is_night: isNight,
    p_is_airport: false,
    p_traffic_factor: 1.05,
  });

  const fareKz = Number((fare.data as { fare_kz?: number } | null)?.fare_kz ?? Math.max(800, Math.round(distanceKm * 260)));

  await updateSession(session.phone, {
    state: 'AWAITING_CONFIRM',
    dest_address: destination.address,
    dest_lat: destination.lat,
    dest_lng: destination.lng,
  });

  await sendWhatsAppText(
    session.phone,
    `🚗 De ${session.origin_address ?? 'origem'} para ${destination.address}\n` +
    `💰 Preço: ${fareKz.toLocaleString('pt-PT')} Kz\n` +
    `⏱️ ~${durationMin} min\n\n` +
    'Confirmar? Responde com Sim ou Não.',
  );
}

async function confirmRideRequest(session: SessionRow) {
  if (!session.user_id) {
    await sendWhatsAppText(
      session.phone,
      'Consegui montar o pedido, mas preciso que o teu número esteja ligado a uma conta Zenith Ride. Actualiza o telefone no perfil da app e tenta de novo.',
    );
    return;
  }

  if (
    session.origin_lat == null ||
    session.origin_lng == null ||
    session.dest_lat == null ||
    session.dest_lng == null ||
    !session.origin_address ||
    !session.dest_address
  ) {
    await resetSession(session.phone);
    await sendWhatsAppText(session.phone, 'Faltaram dados do trajecto. Vamos recomeçar: envia a tua localização actual.');
    return;
  }

  const distanceKm = haversineKm(session.origin_lat, session.origin_lng, session.dest_lat, session.dest_lng);
  const durationMin = Math.max(4, Math.round((distanceKm / 24) * 60));
  const isNight = new Date().getHours() >= 22 || new Date().getHours() < 6;
  const fareResult = await admin.rpc('calculate_fare_engine_pro', {
    p_distance_km: distanceKm,
    p_duration_min: durationMin,
    p_origin_lat: session.origin_lat,
    p_origin_lng: session.origin_lng,
    p_dest_lat: session.dest_lat,
    p_dest_lng: session.dest_lng,
    p_service_tier: 'standard',
    p_demand_count: 5,
    p_supply_count: 5,
    p_is_night: isNight,
    p_is_airport: false,
    p_traffic_factor: 1.05,
  });
  const fare = Number(
    (fareResult.data as { fare_kz?: number } | null)?.fare_kz ?? Math.max(800, Math.round(distanceKm * 260)),
  );

  const { data: ride, error } = await admin
    .from('rides')
    .insert({
      passenger_id: session.user_id,
      driver_id: null,
      origin_address: session.origin_address,
      origin_lat: session.origin_lat,
      origin_lng: session.origin_lng,
      dest_address: session.dest_address,
      dest_lat: session.dest_lat,
      dest_lng: session.dest_lng,
      distance_km: distanceKm,
      duration_min: durationMin,
      surge_multiplier: 1,
      price_kz: fare,
      status: 'searching',
      driver_confirmed: false,
    })
    .select('id')
    .single();

  if (error || !ride?.id) {
    console.error('[whatsapp-webhook] falha ao criar ride:', error);
    await sendWhatsAppText(session.phone, 'Não consegui criar a corrida agora. Tenta novamente daqui a pouco.');
    return;
  }

  await updateSession(session.phone, {
    state: 'RIDE_ACTIVE',
    ride_id: ride.id,
  });

  await sendWhatsAppText(
    session.phone,
    'Pedido confirmado! 🚗 Já estamos a procurar motoristas disponíveis no app. Vou continuar contigo por aqui.',
  );

  await sendDriverFallbackForRide(ride.id);
}

async function cancelActiveRide(session: SessionRow) {
  if (session.ride_id && session.user_id) {
    const { data } = await admin.rpc('cancel_ride_safe', {
      p_ride_id: session.ride_id,
      p_user_id: session.user_id,
      p_reason: 'Cancelado via WhatsApp',
    });
    const result = Array.isArray(data) ? data[0] : data;
    if (result && !result.success) {
      await sendWhatsAppText(
        session.phone,
        `Nao foi possivel cancelar: ${result.message ?? 'corrida ja nao esta num estado cancelavel.'}`,
      );
      return;
    }
  }

  await resetSession(session.phone);
  await sendWhatsAppText(session.phone, 'Corrida cancelada por aqui. Quando quiseres, podemos montar outra.');
}

async function getOrCreateSession(phone: string): Promise<SessionRow> {
  const { data: existing } = await admin
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    return existing as SessionRow;
  }

  const userId = await findLinkedUserId(phone);
  const { data } = await admin
    .from('whatsapp_sessions')
    .insert({
      phone,
      user_id: userId,
      state: 'IDLE',
    })
    .select('*')
    .single();

  return data as SessionRow;
}

async function updateSession(phone: string, patch: Record<string, unknown>) {
  await admin
    .from('whatsapp_sessions')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('phone', phone);
}

async function resetSession(phone: string) {
  await updateSession(phone, {
    state: 'IDLE',
    origin_address: null,
    origin_lat: null,
    origin_lng: null,
    dest_address: null,
    dest_lat: null,
    dest_lng: null,
    ride_id: null,
  });
}

async function findLinkedUserId(phone: string): Promise<string | null> {
  const digits = phone.replace(/\D/g, '');
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .or(`phone.eq.${digits},phone.eq.+${digits},phone.eq.+244${digits}`)
    .maybeSingle();

  return profile?.user_id ?? null;
}

function isInternalActionRequest(body: unknown): body is InternalActionBody {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const action = (body as InternalActionBody).action;
  return action === 'driver_fallback_for_ride' || action === 'passenger_ride_accepted';
}

async function handleInternalActionRequest(req: Request, body: InternalActionBody) {
  if (body.action === 'driver_fallback_for_ride') {
    return handleInternalDriverFallbackRequest(req, body);
  }

  return handleInternalPassengerAcceptedRequest(req, body);
}

async function handleInternalDriverFallbackRequest(req: Request, body: InternalActionBody) {
  const rideId = body.ride_id?.trim();
  if (!rideId) {
    return json({ error: true, message: 'ride_id em falta.' }, 400);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return json({ error: true, message: 'Não autenticado.' }, 401);
  }

  const { data: ride } = await admin
    .from('rides')
    .select('id')
    .eq('id', rideId)
    .eq('passenger_id', userId)
    .maybeSingle();

  if (!ride?.id) {
    return json({ error: true, message: 'Corrida não encontrada para este utilizador.' }, 403);
  }

  const result = await sendDriverFallbackForRide(rideId);
  return json({ ok: true, ...result }, 200);
}

async function handleInternalPassengerAcceptedRequest(req: Request, body: InternalActionBody) {
  const rideId = body.ride_id?.trim();
  if (!rideId) {
    return json({ error: true, message: 'ride_id em falta.' }, 400);
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return json({ error: true, message: 'Nao autenticado.' }, 401);
  }

  const { data: ride } = await admin
    .from('rides')
    .select('id, status')
    .eq('id', rideId)
    .eq('driver_id', userId)
    .maybeSingle();

  if (!ride?.id) {
    return json({ error: true, message: 'Corrida nao encontrada para este motorista.' }, 403);
  }

  if (ride.status !== 'accepted' && ride.status !== 'picking_up' && ride.status !== 'in_progress') {
    return json({ error: true, message: 'Corrida ainda nao esta num estado notificavel.' }, 409);
  }

  const result = await notifyPassengerAboutAcceptedRide(rideId);
  return json({ ok: true, ...result }, 200);
}

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !SUPABASE_ANON_KEY) {
    return null;
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  return data.user.id;
}

async function sendDriverFallbackForRide(rideId: string): Promise<{ sent: number; candidates: number; eligibleDrivers: number }> {
  const { data: ride, error: rideError } = await admin
    .from('rides')
    .select('id, status, origin_address, origin_lat, origin_lng, dest_address, price_kz, distance_km')
    .eq('id', rideId)
    .maybeSingle();

  if (rideError || !ride || ride.status !== 'searching') {
    return { sent: 0, candidates: 0, eligibleDrivers: 0 };
  }

  const { data: nearbyDrivers, error: driversError } = await admin.rpc('find_nearby_drivers', {
    p_lat: ride.origin_lat,
    p_lng: ride.origin_lng,
    p_radius_km: 7,
    p_limit: 6,
  });

  if (driversError || !Array.isArray(nearbyDrivers) || nearbyDrivers.length === 0) {
    if (driversError) {
      console.warn('[whatsapp-webhook] fallback drivers RPC falhou:', driversError.message);
    }
    return { sent: 0, candidates: 0, eligibleDrivers: 0 };
  }

  const candidates = nearbyDrivers as NearbyDriverRow[];
  const driverIds = [...new Set(candidates.map((driver) => driver.driver_id).filter(Boolean))];
  if (driverIds.length === 0) {
    return { sent: 0, candidates: 0, eligibleDrivers: 0 };
  }

  const [{ data: locations }, { data: profiles }] = await Promise.all([
    admin
      .from('driver_locations')
      .select('driver_id, status, updated_at')
      .in('driver_id', driverIds),
    admin
      .from('profiles')
      .select('user_id, name, phone')
      .in('user_id', driverIds),
  ]);

  const locationMap = new Map<string, DriverLocationRow>(
    ((locations ?? []) as DriverLocationRow[]).map((row) => [row.driver_id, row]),
  );
  const profileMap = new Map<string, DriverProfileRow>(
    ((profiles ?? []) as DriverProfileRow[]).map((row) => [row.user_id, row]),
  );

  const eligibleDrivers = candidates
    .filter((driver) => {
      const location = locationMap.get(driver.driver_id);
      const profile = profileMap.get(driver.driver_id);
      return Boolean(
        location
        && location.status === 'available'
        && profile?.phone,
      );
    });

  let sent = 0;

  for (const driver of eligibleDrivers) {
    const profile = profileMap.get(driver.driver_id);
    if (!profile?.phone) {
      continue;
    }

    const delivered = await sendWhatsAppText(
      normalizePhone(profile.phone),
      buildDriverFallbackMessage({
        driverName: profile.name ?? driver.driver_name ?? 'Motorista',
        rideId: ride.id,
        originAddress: ride.origin_address,
        destAddress: ride.dest_address,
        priceKz: Number(ride.price_kz ?? 0),
        distanceKm: Number(ride.distance_km ?? 0),
        distanceMeters: Number(driver.distance_m ?? 0),
      }),
    );

    if (delivered) {
      sent += 1;
    }
  }

  return { sent, candidates: candidates.length, eligibleDrivers: eligibleDrivers.length };
}

function buildDriverFallbackMessage(params: {
  driverName: string;
  rideId: string;
  originAddress: string;
  destAddress: string;
  priceKz: number;
  distanceKm: number;
  distanceMeters: number;
}): string {
  const rideCode = params.rideId.slice(0, 8).toUpperCase();
  const distanceKm = params.distanceKm > 0
    ? `${params.distanceKm.toFixed(1)} km`
    : `${Math.max(0.1, params.distanceMeters / 1000).toFixed(1)} km`;

  return [
    '🚗 Nova corrida disponível',
    `${params.driverName}, tens um passageiro!`,
    `Código: ${rideCode}`,
    `Origem: ${params.originAddress}`,
    `Destino: ${params.destAddress}`,
    `Preço: ${params.priceKz.toLocaleString('pt-PT')} Kz`,
    `Distância: ${distanceKm}`,
    'Abre a app Zenith Ride para aceitar!',
  ].join('\n');
}

async function notifyPassengerAboutAcceptedRide(rideId: string): Promise<{ sent: boolean; reason?: string }> {
  const { data: ride, error: rideError } = await admin
    .from('rides')
    .select('id, passenger_id, driver_id, origin_lat, origin_lng')
    .eq('id', rideId)
    .maybeSingle();

  if (rideError || !ride?.id || !ride.passenger_id || !ride.driver_id) {
    return { sent: false, reason: 'ride_not_found' };
  }

  const [{ data: session }, { data: driverProfile }, nearbyResp] = await Promise.all([
    admin
      .from('whatsapp_sessions')
      .select('phone')
      .eq('ride_id', ride.id)
      .eq('user_id', ride.passenger_id)
      .maybeSingle(),
    admin
      .from('profiles')
      .select('name, rating')
      .eq('user_id', ride.driver_id)
      .maybeSingle(),
    admin.rpc('find_nearby_drivers', {
      p_lat: ride.origin_lat,
      p_lng: ride.origin_lng,
      p_radius_km: 20,
      p_limit: 20,
    }),
  ]);

  if (!session?.phone) {
    return { sent: false, reason: 'no_whatsapp_session' };
  }

  const nearbyDrivers = Array.isArray(nearbyResp.data) ? nearbyResp.data as NearbyDriverRow[] : [];
  const acceptedDriver = nearbyDrivers.find((driver) => driver.driver_id === ride.driver_id);
  const etaMin = acceptedDriver?.distance_m != null
    ? Math.max(2, Math.ceil(Number(acceptedDriver.distance_m) / 400))
    : null;

  const delivered = await sendWhatsAppText(
    normalizePhone(session.phone),
    buildPassengerAcceptedMessage({
      driverName: driverProfile?.name ?? 'Motorista',
      rating: Number(driverProfile?.rating ?? 5),
      etaMin,
    }),
  );

  return delivered ? { sent: true } : { sent: false, reason: 'delivery_failed' };
}

function buildPassengerAcceptedMessage(params: {
  driverName: string;
  rating: number;
  etaMin: number | null;
}): string {
  const ratingText = Number.isFinite(params.rating) ? params.rating.toFixed(1) : '5.0';
  const etaText = params.etaMin != null
    ? `Chega em ~${params.etaMin} min.`
    : 'O motorista já está a caminho.';

  return [
    '✅ Motorista encontrado!',
    `🚗 ${params.driverName} ⭐ ${ratingText}`,
    etaText,
    'Acompanha a corrida na app Zenith Ride.',
  ].join('\n');
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const { data: cached } = await admin
    .from('geocoding_cache')
    .select('full_address')
    .eq('query_text', cacheKey)
    .maybeSingle();

  if (cached?.full_address) {
    return cached.full_address;
  }

  if (!MAPBOX_TOKEN) {
    return `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=address,neighborhood,locality,place,poi,district&language=pt&access_token=${MAPBOX_TOKEN}`;
  const response = await fetch(url);
  const payload = await response.json();
  const address = payload?.features?.[0]?.place_name_pt ?? payload?.features?.[0]?.place_name ?? `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;

  await admin
    .from('geocoding_cache')
    .upsert({
      query_text: cacheKey,
      lat,
      lng,
      full_address: address,
      source: 'mapbox',
    }, { onConflict: 'query_text' });

  return address;
}

async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; address: string } | null> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const { data: cached } = await admin
    .from('geocoding_cache')
    .select('lat, lng, full_address')
    .eq('query_text', normalized)
    .maybeSingle();

  if (cached?.lat != null && cached?.lng != null) {
    return {
      lat: Number(cached.lat),
      lng: Number(cached.lng),
      address: cached.full_address ?? query,
    };
  }

  if (!MAPBOX_TOKEN) {
    return null;
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=AO&language=pt&limit=1&access_token=${MAPBOX_TOKEN}`;
  const response = await fetch(url);
  const payload = await response.json();
  const feature = payload?.features?.[0];

  if (!feature?.center?.length) {
    return null;
  }

  const result = {
    lng: Number(feature.center[0]),
    lat: Number(feature.center[1]),
    address: feature.place_name_pt ?? feature.place_name ?? query,
  };

  await admin
    .from('geocoding_cache')
    .upsert({
      query_text: normalized,
      lat: result.lat,
      lng: result.lng,
      full_address: result.address,
      source: 'mapbox',
    }, { onConflict: 'query_text' });

  return result;
}

function getMessageText(message: IncomingMessage): string | null {
  if (message.type === 'text') {
    return message.text?.body?.trim() ?? null;
  }

  if (message.type === 'interactive') {
    return (
      message.interactive?.button_reply?.title?.trim() ??
      message.interactive?.list_reply?.title?.trim() ??
      null
    );
  }

  return null;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('244') ? digits : `244${digits}`;
}

function isAffirmative(value: string): boolean {
  const text = value.trim().toLowerCase();
  return text === 'sim' || text === 's' || text === 'confirmar';
}

function isNegative(value: string): boolean {
  const text = value.trim().toLowerCase();
  return text === 'nao' || text === 'não' || text === 'n';
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return value * Math.PI / 180;
}

async function sendWhatsAppText(phone: string, text: string): Promise<boolean> {
  if (!WHATSAPP_GRAPH_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn('[whatsapp-webhook] credenciais WhatsApp nao configuradas.');
    return false;
  }

  const response = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_GRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: {
        body: text,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn('[whatsapp-webhook] envio WhatsApp falhou:', response.status, body);
    return false;
  }

  return true;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function withCors(response: Response) {
  response.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  response.headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Vary', 'Origin');
  return response;
}
