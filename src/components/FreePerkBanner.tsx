// =============================================================================
// ZENITH RIDE v3.0 — FreePerkBanner.tsx
// FIX: .on() chamado ANTES de .subscribe() para evitar erro Realtime
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface FreePerkBannerProps {
  userId: string;
}

interface PerkData {
  km_total:          number;
  free_km_available: number;
  km_to_next_perk:   number;
}

const PERK_THRESHOLD = 70;

const FreePerkBanner: React.FC<FreePerkBannerProps> = ({ userId }) => {
  const [perk,        setPerk]        = useState<PerkData | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const prevFreeKm = useRef<number>(0);

  useEffect(() => {
    if (!userId) return;

    // Carregar dados iniciais
    const loadPerk = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('km_total, free_km_available, km_to_next_perk')
        .eq('user_id', userId)
        .maybeSingle();

      if (data) {
        prevFreeKm.current = (data as PerkData).free_km_available ?? 0;
        setPerk(data as PerkData);
      }
    };

    loadPerk();

    // FIX CRÍTICO: definir .on() ANTES de .subscribe()
    const channelName = `perk:${userId}`;
    const ch = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'profiles',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const p = payload.new as PerkData;
          if ((p.free_km_available ?? 0) > prevFreeKm.current) {
            setCelebrating(true);
            setTimeout(() => setCelebrating(false), 5000);
          }
          prevFreeKm.current = p.free_km_available ?? 0;
          setPerk(p);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[FreePerkBanner] Falha no canal Realtime, a continuar sem RT.');
        }
      });

    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  if (!perk) return null;

  const progressPct = Math.min(
    ((PERK_THRESHOLD - (perk.km_to_next_perk ?? PERK_THRESHOLD)) / PERK_THRESHOLD) * 100,
    100
  );
  const kmDone   = Math.round(PERK_THRESHOLD - (perk.km_to_next_perk ?? PERK_THRESHOLD));
  const hasFreeKm = (perk.free_km_available ?? 0) > 0;

  // ─── MODO CELEBRAÇÃO ────────────────────────────────────────────────────────
  if (celebrating) {
    return (
      <section className="liquid-glass-card rounded-[28px] p-5 relative overflow-hidden" data-purpose="loyalty-card">
        <div className="flex items-start justify-between relative z-10">
          <div className="max-w-[70%]">
            <span className="text-[9px] font-bold tracking-[0.26em] uppercase gold-gradient-text">PARABÉNS!</span>
            <h2 className="font-serif text-[22px] font-normal text-white mt-1 leading-snug tracking-tight">5 km GRÁTIS!</h2>
            <p className="text-[11.5px] text-neutral-300 mt-1.5 leading-relaxed font-normal">
              Chegaste aos {Math.round(perk.km_total ?? 0)} km. A viagem fica por nossa conta!
            </p>
          </div>
          <div className="w-16 h-16 rounded-full liquid-glass-subcard border-t-white/40 border-[#DDB658]/40 flex flex-col items-center justify-center shadow-2xl">
            <span className="material-symbols-outlined text-[#F0D082] text-2xl">celebration</span>
          </div>
        </div>
      </section>
    );
  }

  // ─── MODO FREE KM DISPONÍVEL ────────────────────────────────────────────────
  if (hasFreeKm) {
    return (
      <section className="liquid-glass-card rounded-[28px] p-5 relative overflow-hidden" data-purpose="loyalty-card">
        <div className="flex items-start justify-between relative z-10">
          <div className="max-w-[62%]">
            <span className="text-[9px] font-bold tracking-[0.26em] uppercase gold-gradient-text">FIDELIDADE ZENITH</span>
            <h2 className="font-serif text-[22px] font-normal text-white mt-1 leading-snug tracking-tight">Tens {(perk.free_km_available ?? 0).toFixed(1)} km grátis</h2>
            <p className="text-[11.5px] text-neutral-400 mt-1.5 leading-relaxed font-normal">
              Aplicados automaticamente na próxima corrida urbana.
            </p>
          </div>
          {/* Circular Liquid Glass Gauge */}
          <div className="relative flex items-center justify-center w-24 h-24 -mt-1">
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#DCB354]/25 to-transparent blur-md pointer-events-none" />
            <div className="absolute inset-0 rounded-full border border-[#DDB658]/35 animate-pulse" />
            <div className="absolute inset-1.5 rounded-full border border-white/10" />
            <div className="w-16 h-16 rounded-full liquid-glass-subcard border-t-white/40 border-[#DDB658]/40 flex flex-col items-center justify-center shadow-2xl">
              <span className="text-xl font-bold text-white tracking-tight leading-none filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                {(perk.free_km_available ?? 0).toFixed(0)}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-[#E2C37A] mt-0.5 font-bold">km</span>
            </div>
          </div>
        </div>

        {/* Progress Track */}
        <div className="mt-4 pt-1 relative z-10">
          <div className="w-full h-2.5 rounded-full bg-[#0d0d10] border-t border-black border-b border-white/10 overflow-hidden p-[1.5px] shadow-inner">
            <div className="h-full rounded-full bg-gradient-to-r from-[#946F1C] via-[#E2C167] to-[#FFF3D1] w-full shadow-[0_0_14px_rgba(225,185,85,0.7)] relative">
              <div className="absolute inset-x-0 top-0 h-[40%] bg-white/40 rounded-full" />
              <div aria-hidden="true" className="sheen-overlay" />
            </div>
          </div>
          <span className="block text-[10px] text-neutral-400 mt-2 font-medium">
            Bónus de fidelidade activo
          </span>
        </div>
      </section>
    );
  }

  // ─── MODO BARRA DE PROGRESSO ────────────────────────────────────────────────
  return (
    <section className="liquid-glass-card rounded-[28px] p-5 relative overflow-hidden" data-purpose="loyalty-card">
      <div className="flex items-start justify-between relative z-10">
        <div className="max-w-[62%]">
          <span className="text-[9px] font-bold tracking-[0.26em] uppercase gold-gradient-text">FIDELIDADE ZENITH</span>
          <h2 className="font-serif text-[22px] font-normal text-white mt-1 leading-snug tracking-tight">Acumula km grátis</h2>
          <p className="text-[11.5px] text-neutral-400 mt-1.5 leading-relaxed font-normal">
            Faltam {Math.ceil(perk.km_to_next_perk ?? PERK_THRESHOLD)} km até ao próximo bónus de 5 km.
          </p>
        </div>
        {/* Circular Liquid Glass Gauge */}
        <div className="relative flex items-center justify-center w-24 h-24 -mt-1">
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#DCB354]/25 to-transparent blur-md pointer-events-none" />
          <div className="absolute inset-0 rounded-full border border-[#DDB658]/35 animate-pulse" />
          <div className="absolute inset-1.5 rounded-full border border-white/10" />
          <div className="w-16 h-16 rounded-full liquid-glass-subcard border-t-white/40 border-[#DDB658]/40 flex flex-col items-center justify-center shadow-2xl">
            <span className="text-2xl font-bold text-white tracking-tight leading-none filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              {kmDone}
            </span>
            <span className="text-[9.5px] uppercase tracking-wider text-[#E2C37A] mt-0.5 font-bold">km</span>
          </div>
        </div>
      </div>

      {/* Progress Track & Count */}
      <div className="mt-4 pt-1 relative z-10">
        <div className="w-full h-2.5 rounded-full bg-[#0d0d10] border-t border-black border-b border-white/10 overflow-hidden p-[1.5px] shadow-inner">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#946F1C] via-[#E2C167] to-[#FFF3D1] shadow-[0_0_14px_rgba(225,185,85,0.7)] relative transition-all duration-500"
            style={{ width: `${Math.max(5, progressPct)}%` }}
          >
            <div className="absolute inset-x-0 top-0 h-[40%] bg-white/40 rounded-full" />
            <div aria-hidden="true" className="sheen-overlay" />
          </div>
        </div>
        <span className="block text-[10px] text-neutral-400 mt-2 font-medium">
          {kmDone} / {PERK_THRESHOLD} km concluídos.
        </span>
      </div>
    </section>
  );
};

export default FreePerkBanner;
