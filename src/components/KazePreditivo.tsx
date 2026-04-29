import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { zonePriceService } from '../services/zonePrice';
import type { ProactiveSuggestion, RidePrediction } from '../types';

const MAX_SUGGESTIONS = 3;
const SUPABASE_TIMEOUT_MS = 6000;
const ZONE_PRICE_TIMEOUT_MS = 3000;

const getLuandaNow = () => new Date(
  new Date().toLocaleString('en-US', { timeZone: 'Africa/Luanda' }),
);

function timeoutAfter<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function fetchRidePredictionsViaRest(userId: string): Promise<RidePrediction[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    throw new Error('Fallback REST indisponivel para ride_predictions.');
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/ride_predictions?user_id=eq.${encodeURIComponent(userId)}&frequency=gte.2&select=*&order=frequency.desc&limit=8`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`ride_predictions REST falhou (${response.status}): ${details}`);
  }

  return await response.json() as RidePrediction[];
}

async function safeZonePrice(originAddress: string, destAddress: string) {
  try {
    return await timeoutAfter(
      zonePriceService.getZonePrice(originAddress, destAddress),
      ZONE_PRICE_TIMEOUT_MS,
      'Zone price lookup',
    );
  } catch {
    return null;
  }
}

const getPrimaryAddress = (value: string) => value.split(',')[0]?.trim() || value;

const getGreeting = (hour: number) => {
  if (hour < 12) return 'Bom dia';
  if (hour < 19) return 'Boa tarde';
  return 'Boa noite';
};

function buildSuggestionMessage(prediction: RidePrediction, currentHour: number, currentDay: number): string {
  const greeting = getGreeting(currentHour);
  const destination = getPrimaryAddress(prediction.dest_address);
  const isUsualTime = prediction.best_hour !== null && Math.abs(prediction.best_hour - currentHour) <= 1;
  const isUsualDay = prediction.day_of_week == null || prediction.day_of_week === currentDay;
  const canSchedule = prediction.best_hour !== null && currentHour > prediction.best_hour && isUsualDay;

  if (canSchedule) {
    return `${greeting}. A tua hora habitual para ${destination} ja passou hoje. Posso deixar isto agendado para amanha.`;
  }

  if (isUsualTime) {
    return `${greeting}. Esta rota para ${destination} bate com a tua hora habitual.`;
  }

  if (isUsualDay) {
    return `${greeting}. Hoje combina com a tua rota frequente para ${destination}.`;
  }

  return `${greeting}. Ja fizeste esta rota ${prediction.frequency}x para ${destination}.`;
}

function computeDismissRate(prediction: RidePrediction): number {
  const dismissals = Math.max(0, prediction.dismissals ?? 0);
  const impressions = Math.max(dismissals, prediction.impressions ?? 0);
  if (impressions === 0) return 0;
  return Math.min(0.9, dismissals / impressions);
}

function scorePrediction(prediction: RidePrediction, currentHour: number, currentDay: number): number {
  const hourMatch =
    prediction.best_hour !== null && Math.abs(prediction.best_hour - currentHour) <= 1 ? 2.5 : 1;
  const dayMatch =
    prediction.day_of_week == null || prediction.day_of_week === currentDay ? 1.8 : 1;
  const dismissRate = computeDismissRate(prediction);
  const proactiveBoost = prediction.proactive ? 1.15 : 1;

  return prediction.frequency * hourMatch * dayMatch * (1 - dismissRate) * proactiveBoost;
}

interface KazePreditivoProps {
  userId: string;
  onAccept: (pred: RidePrediction) => void;
  onSchedule?: (pred: RidePrediction) => void;
}

const KazePreditivo: React.FC<KazePreditivoProps> = ({ userId, onAccept, onSchedule }) => {
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);

    try {
      const luandaNow = getLuandaNow();
      const currentHour = luandaNow.getHours();
      const currentDay = luandaNow.getDay();

      let data: RidePrediction[] | null = null;
      try {
        const queryPromise = supabase
          .from('ride_predictions')
          .select('*')
          .eq('user_id', userId)
          .gte('frequency', 2)
          .order('frequency', { ascending: false })
          .limit(8);

        const { data: fetchedData, error } = await timeoutAfter(
          // Nota: Promise.resolve() é necessário porque o builder do Supabase
          // devolve uma PromiseLike (não uma Promise nativa).
          Promise.resolve(queryPromise),
          SUPABASE_TIMEOUT_MS,
          'Kaze ride_predictions query',
        );

        if (error) {
          throw error;
        }

        data = (fetchedData ?? []) as RidePrediction[];
      } catch (queryErr) {
        console.warn('[KazePreditivo] supabase-js query falhou; a tentar fallback REST:', queryErr);
        data = await fetchRidePredictionsViaRest(userId);
      }

      if (!data || data.length === 0) {
        setSuggestions([]);
        return;
      }

      const ranked = (data as RidePrediction[])
        .map((prediction) => ({
          prediction,
          score: scorePrediction(prediction, currentHour, currentDay),
          canSchedule:
            prediction.best_hour !== null &&
            currentHour > prediction.best_hour &&
            (prediction.day_of_week == null || prediction.day_of_week === currentDay),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_SUGGESTIONS);

      const builtSuggestions = await Promise.all(
        ranked.map(async ({ prediction, score, canSchedule }) => ({
          prediction,
          score,
          zone_price: await safeZonePrice(prediction.origin_address, prediction.dest_address),
          kaze_message: buildSuggestionMessage(prediction, currentHour, currentDay),
          can_schedule: canSchedule,
        })),
      );

      setSuggestions(builtSuggestions);

      const predictionIds = builtSuggestions.map((item) => item.prediction.id);
      if (predictionIds.length > 0) {
        void (async () => {
          try {
            await supabase.rpc('bump_ride_prediction_impressions', { p_prediction_ids: predictionIds });
          } catch {
            // Feedback opcional; ignorar se a migração ainda não estiver aplicada.
          }
        })();
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  const topSuggestion = suggestions[0] ?? null;
  const titleMessage = useMemo(() => {
    if (!topSuggestion) return '';
    return topSuggestion.kaze_message;
  }, [topSuggestion]);

  const handleDismiss = useCallback((predictionId: string) => {
    setSuggestions((current) => current.filter((item) => item.prediction.id !== predictionId));
    void (async () => {
      try {
        await supabase.rpc('bump_ride_prediction_dismissal', { p_prediction_id: predictionId });
      } catch {
        // Feedback opcional; ignorar se a migração ainda não estiver aplicada.
      }
    })();
  }, []);

  if (loading || suggestions.length === 0 || !topSuggestion) {
    return null;
  }

  return (
    <div className="mx-4 mb-4 animate-in slide-in-from-top duration-500">
      <div className="relative overflow-hidden rounded-[2.5rem] border border-white/5 bg-[#0A0A0A] p-5">
        <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-primary/10 blur-[50px]" />

        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 text-lg font-black text-white shadow-lg">
            K
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[9px] font-black uppercase tracking-widest text-primary">
              Kaze Proactivo
            </p>
            <p className="text-[11px] font-bold leading-snug text-white/80">
              {titleMessage}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {suggestions.map((suggestion, index) => {
            const destination = getPrimaryAddress(suggestion.prediction.dest_address);
            const origin = getPrimaryAddress(suggestion.prediction.origin_address);
            const displayPrice = suggestion.zone_price?.price_kz ?? suggestion.prediction.avg_price_kz;

            return (
              <div
                key={suggestion.prediction.id}
                className="rounded-[1.5rem] border border-white/6 bg-surface-container-low/5 p-4"
              >
                <div className="mb-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/15 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-primary">
                        {index === 0 ? 'Agora' : `Sugestao ${index + 1}`}
                      </span>
                      {suggestion.prediction.proactive && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-emerald-300">
                          Padrao forte
                        </span>
                      )}
                      <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white/45">
                        Score {suggestion.score.toFixed(1)}
                      </span>
                    </div>

                    <p className="text-[11px] font-bold leading-snug text-white/75">
                      {origin}
                    </p>
                    <p className="mt-1 text-sm font-black text-white">
                      {destination}
                    </p>
                    <p className="mt-2 text-[10px] font-bold leading-snug text-white/55">
                      {suggestion.kaze_message}
                    </p>
                  </div>

                  <button
                    onClick={() => handleDismiss(suggestion.prediction.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm text-white/30 transition-all hover:bg-white/10"
                    aria-label="Dispensar sugestao"
                  >
                    x
                  </button>
                </div>

                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-white/35">
                      Feito {suggestion.prediction.frequency}x
                      {suggestion.zone_price ? ' · Preco fixo' : ' · Estimativa'}
                    </p>
                    {displayPrice != null && (
                      <p className="text-lg font-black tracking-tight text-white">
                        {Math.round(displayPrice).toLocaleString('pt-AO')} Kz
                      </p>
                    )}
                  </div>

                  {suggestion.prediction.best_hour !== null && (
                    <div className="text-right">
                      <p className="text-[8px] font-black uppercase tracking-widest text-white/35">
                        Hora habitual
                      </p>
                      <p className="text-sm font-black text-primary">
                        {String(suggestion.prediction.best_hour).padStart(2, '0')}:00
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onAccept(suggestion.prediction)}
                    className="rounded-2xl bg-primary px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_8px_20px_rgba(37,99,235,0.4)] transition-all active:scale-95"
                  >
                    Usar agora
                  </button>

                  {onSchedule && suggestion.can_schedule && (
                    <button
                      onClick={() => onSchedule(suggestion.prediction)}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white/80 transition-all active:scale-95"
                    >
                      Agendar amanha
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default KazePreditivo;
