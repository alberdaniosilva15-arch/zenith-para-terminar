import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyCors,
  corsForbidden,
  resolveCorsHeaders,
} from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const CORS_OPTIONS = {
  methods: 'POST, OPTIONS',
  headers: 'authorization, content-type, x-cron-secret',
};

interface CompletedRideRow {
  passenger_id: string | null;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  price_kz: number | null;
  completed_at: string | null;
  created_at: string;
}

interface AggregatedPattern {
  user_id: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  frequency: number;
  last_used_at: string;
  avg_price_kz: number | null;
  best_hour: number | null;
  day_of_week: number | null;
  proactive: boolean;
}

function json(body: unknown, status = 200, corsHeaders: Headers | null = null) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return applyCors(response, corsHeaders);
}

function incrementCounter(counter: Map<number, number>, key: number) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function getMode(counter: Map<number, number>): number | null {
  let bestKey: number | null = null;
  let bestCount = -1;

  for (const [key, count] of counter.entries()) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }

  return bestKey;
}

function getLuandaHour(dateText: string): number {
  return Number.parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Luanda',
      hour: '2-digit',
      hour12: false,
    }).format(new Date(dateText)),
    10,
  );
}

function getLuandaDayOfWeek(dateText: string): number {
  const dayText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Luanda',
    weekday: 'short',
  }).format(new Date(dateText));

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return dayMap[dayText] ?? 0;
}

async function fetchCompletedRides() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const pageSize = 1000;
  const rides: CompletedRideRow[] = [];

  for (let page = 0; page < 1000; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from('rides')
      .select('passenger_id, origin_address, origin_lat, origin_lng, dest_address, dest_lat, dest_lng, price_kz, completed_at, created_at')
      .eq('status', 'completed')
      .not('passenger_id', 'is', null)
      .order('completed_at', { ascending: true, nullsFirst: false })
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as CompletedRideRow[];
    rides.push(...rows);

    if (rows.length < pageSize) {
      break;
    }
  }

  return { supabase, rides };
}

function aggregatePatterns(rides: CompletedRideRow[]): AggregatedPattern[] {
  const grouped = new Map<string, {
    pattern: Omit<AggregatedPattern, 'frequency' | 'avg_price_kz' | 'best_hour' | 'day_of_week' | 'proactive'>;
    frequency: number;
    priceSum: number;
    priceCount: number;
    hourCounter: Map<number, number>;
    dayCounter: Map<number, number>;
  }>();

  for (const ride of rides) {
    if (!ride.passenger_id) continue;

    const key = [
      ride.passenger_id,
      ride.origin_address.trim().toLowerCase(),
      ride.dest_address.trim().toLowerCase(),
    ].join('::');

    const baseDate = ride.completed_at ?? ride.created_at;
    const existing = grouped.get(key);

    if (!existing) {
      const next = {
        pattern: {
          user_id: ride.passenger_id,
          origin_address: ride.origin_address,
          origin_lat: ride.origin_lat,
          origin_lng: ride.origin_lng,
          dest_address: ride.dest_address,
          dest_lat: ride.dest_lat,
          dest_lng: ride.dest_lng,
          last_used_at: baseDate,
        },
        frequency: 0,
        priceSum: 0,
        priceCount: 0,
        hourCounter: new Map<number, number>(),
        dayCounter: new Map<number, number>(),
      };
      grouped.set(key, next);
    }

    const target = grouped.get(key);
    if (!target) continue;

    target.frequency += 1;
    if (ride.price_kz != null) {
      target.priceSum += Number(ride.price_kz);
      target.priceCount += 1;
    }

    if (baseDate > target.pattern.last_used_at) {
      target.pattern.last_used_at = baseDate;
    }

    incrementCounter(target.hourCounter, getLuandaHour(baseDate));
    incrementCounter(target.dayCounter, getLuandaDayOfWeek(baseDate));
  }

  return [...grouped.values()].map((entry) => ({
    ...entry.pattern,
    frequency: entry.frequency,
    avg_price_kz: entry.priceCount > 0 ? Math.round((entry.priceSum / entry.priceCount) * 100) / 100 : null,
    best_hour: getMode(entry.hourCounter),
    day_of_week: getMode(entry.dayCounter),
    proactive: entry.frequency >= 3,
  }));
}

Deno.serve(async (req: Request) => {
  const corsHeaders = resolveCorsHeaders(req, CORS_OPTIONS);
  if (req.headers.get('Origin') && !corsHeaders) {
    return corsForbidden();
  }

  if (req.method === 'OPTIONS') {
    return applyCors(new Response(null, { status: 204 }), corsHeaders);
  }
  if (req.method !== 'POST') return json({ error: 'Metodo nao suportado.' }, 405, corsHeaders);

  if (CRON_SECRET) {
    const incomingSecret = req.headers.get('x-cron-secret');
    if (incomingSecret !== CRON_SECRET) {
      return json({ error: 'Nao autorizado.' }, 401, corsHeaders);
    }
  }

  try {
    const { supabase, rides } = await fetchCompletedRides();
    const patterns = aggregatePatterns(rides);

    const chunkSize = 250;
    for (let index = 0; index < patterns.length; index += chunkSize) {
      const chunk = patterns.slice(index, index + chunkSize);
      const { error } = await supabase
        .from('ride_predictions')
        .upsert(chunk, {
          onConflict: 'user_id,origin_address,dest_address',
          ignoreDuplicates: false,
        });

      if (error) {
        throw error;
      }
    }

    return json({
      ok: true,
      processed_rides: rides.length,
      updated_patterns: patterns.length,
      proactive_patterns: patterns.filter((pattern) => pattern.proactive).length,
    }, 200, corsHeaders);
  } catch (error) {
    console.error('[analyze-patterns] failed:', error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Erro interno.',
    }, 500, corsHeaders);
  }
});
