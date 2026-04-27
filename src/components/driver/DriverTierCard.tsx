import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { DriverTier, UserLevel, ZenithScore as ZenithScoreType } from '../../types';

interface DriverTierCardProps {
  driverId: string;
}

interface DriverTierSnapshot {
  rating: number;
  total_rides: number;
  level: UserLevel;
}

const TIER_ORDER: Array<{
  id: DriverTier;
  title: string;
  minRating: number;
  minRides: number;
  requiredLevel?: UserLevel;
  benefits: string[];
}> = [
  {
    id: 'taxi',
    title: 'Nível 1 · Táxi',
    minRating: 3.0,
    minRides: 0,
    benefits: ['Acesso ao fluxo standard', 'Ranking base no matching'],
  },
  {
    id: 'comfort',
    title: 'Nível 2 · Comfort',
    minRating: 4.2,
    minRides: 50,
    benefits: ['Corridas comfort', 'Maior visibilidade em zonas premium'],
  },
  {
    id: 'private',
    title: 'Nível 3 · Motorista Privado',
    minRating: 4.5,
    minRides: 200,
    requiredLevel: 'Ouro',
    benefits: ['Pedidos de longa duração', 'Clientes recorrentes de alto valor'],
  },
  {
    id: 'logistics',
    title: 'Nível 4 · Logística/Fretamento',
    minRating: 4.5,
    minRides: 500,
    requiredLevel: 'Diamante',
    benefits: ['Fretamento e mercadorias', 'Operações empresariais e frota'],
  },
];

const LEVEL_WEIGHT: Record<UserLevel, number> = {
  Novato: 0,
  Bronze: 1,
  Prata: 2,
  Ouro: 3,
  Diamante: 4,
};

export default function DriverTierCard({ driverId }: DriverTierCardProps) {
  const [profile, setProfile] = useState<DriverTierSnapshot | null>(null);
  const [score, setScore] = useState<ZenithScoreType | null>(null);
  const [scoreUnavailable, setScoreUnavailable] = useState(false);

  useEffect(() => {
    if (!driverId) return;

    let active = true;

    const load = async () => {
      const [profileRes, primaryScoreRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('rating, total_rides, level')
          .eq('user_id', driverId)
          .maybeSingle(),
        supabase
          .from('zenith_scores')
          .select('*')
          .eq('driver_id', driverId)
          .maybeSingle(),
      ]);

      if (!active) return;

      if (!profileRes.error) {
        setProfile((profileRes.data ?? null) as DriverTierSnapshot | null);
      }

      const scoreRes = primaryScoreRes.error && (primaryScoreRes.error as { code?: string } | null)?.code === '42P01'
        ? await supabase
            .from('motogo_scores')
            .select('*')
            .eq('driver_id', driverId)
            .maybeSingle()
        : primaryScoreRes;
      const scoreErrorCode = (scoreRes.error as { code?: string } | null)?.code;
      if (!scoreRes.error) {
        setScore((scoreRes.data ?? null) as ZenithScoreType | null);
        setScoreUnavailable(false);
      } else if (scoreErrorCode === '42P01') {
        console.warn('[DriverTierCard] zenith_scores ainda nao existe no projecto Supabase.');
        setScore(null);
        setScoreUnavailable(true);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [driverId]);

  const tierState = useMemo(() => {
    if (!profile) return null;

    const currentTier = [...TIER_ORDER]
      .reverse()
      .find((tier) => (
        profile.rating >= tier.minRating
        && profile.total_rides >= tier.minRides
        && (!tier.requiredLevel || LEVEL_WEIGHT[profile.level] >= LEVEL_WEIGHT[tier.requiredLevel])
      )) ?? TIER_ORDER[0];

    const currentIndex = TIER_ORDER.findIndex((tier) => tier.id === currentTier.id);
    const nextTier = TIER_ORDER[currentIndex + 1] ?? null;

    if (!nextTier) {
      return {
        currentTier,
        nextTier: null,
        progressPct: 100,
        missing: [],
      };
    }

    const ratingProgress = Math.min(profile.rating / nextTier.minRating, 1);
    const ridesProgress = nextTier.minRides === 0 ? 1 : Math.min(profile.total_rides / nextTier.minRides, 1);
    const levelProgress = nextTier.requiredLevel
      ? Math.min(LEVEL_WEIGHT[profile.level] / LEVEL_WEIGHT[nextTier.requiredLevel], 1)
      : 1;

    const missing: string[] = [];
    if (profile.rating < nextTier.minRating) {
      missing.push(`rating ${nextTier.minRating.toFixed(1)}+`);
    }
    if (profile.total_rides < nextTier.minRides) {
      missing.push(`${nextTier.minRides - profile.total_rides} corridas`);
    }
    if (nextTier.requiredLevel && LEVEL_WEIGHT[profile.level] < LEVEL_WEIGHT[nextTier.requiredLevel]) {
      missing.push(`nível ${nextTier.requiredLevel}`);
    }

    return {
      currentTier,
      nextTier,
      progressPct: Math.round(((ratingProgress + ridesProgress + levelProgress) / 3) * 100),
      missing,
    };
  }, [profile]);

  if (!profile || !tierState) {
    return null;
  }

  return (
    <div className="rounded-[2.5rem] border border-[#E6C364]/20 bg-[#0A0A0A] p-5 text-white shadow-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#E6C364]/70">Progressão Zenith</p>
          <h3 className="mt-2 text-lg font-black">{tierState.currentTier.title}</h3>
          <p className="mt-1 text-[11px] font-bold text-white/60">
            Rating {profile.rating.toFixed(1)} · {profile.total_rides} corridas · nível {profile.level}
          </p>
        </div>
        <div className="rounded-full border border-[#E6C364]/25 bg-[#E6C364]/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#E6C364]">
          {scoreUnavailable ? 'Zenith Score indisponivel' : `Zenith Score ${Math.round(score?.score ?? 0)}`}
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/55">
          <span>Progresso para o próximo tier</span>
          <span>{tierState.progressPct}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full"
            style={{
              width: `${tierState.progressPct}%`,
              background: 'linear-gradient(90deg, rgba(230,195,100,0.35), #E6C364)',
            }}
          />
        </div>
        {tierState.nextTier ? (
          <p className="text-[11px] font-bold text-white/60">
            Próximo: {tierState.nextTier.title} · falta {tierState.missing.join(', ')}.
          </p>
        ) : (
          <p className="text-[11px] font-bold text-white/60">
            Top tier desbloqueado. Agora o foco é manter consistência e score.
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-2">
        {tierState.currentTier.benefits.map((benefit) => (
          <div key={benefit} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] font-bold text-white/75">
            {benefit}
          </div>
        ))}
      </div>
    </div>
  );
}
