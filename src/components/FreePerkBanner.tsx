// =============================================================================
// MOTOGO v3.0 — src/components/FreePerkBanner.tsx
//
// Banner de fidelidade: a cada 70km corridos, o passageiro ganha 5km grátis.
// Aparece no PassengerHome em 2 momentos:
//   1. Barra de progresso (sempre visível, discreta, em baixo do card de rota)
//   2. Celebração (animação) quando o perk é desbloqueado
//
// Integração em PassengerHome.tsx (logo após o card de rota):
//   import FreePerkBanner from './FreePerkBanner';
//   <FreePerkBanner userId={userId} />
// =============================================================================

import React, { useState, useEffect } from 'react';
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
  const prevFreeKm = React.useRef<number>(0);

  useEffect(() => {
    loadPerk();

    // Realtime: actualiza quando o perfil muda (após corrida completada)
    const ch = supabase
      .channel(`perk:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `user_id=eq.${userId}` },
        (payload) => {
          const p = payload.new as PerkData;
          if (p.free_km_available > prevFreeKm.current) {
            // Acabou de ganhar km grátis!
            setCelebrating(true);
            setTimeout(() => setCelebrating(false), 5000);
          }
          prevFreeKm.current = p.free_km_available;
          setPerk(p);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const loadPerk = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('km_total, free_km_available, km_to_next_perk')
      .eq('user_id', userId)
      .single();

    if (data) {
      prevFreeKm.current = data.free_km_available;
      setPerk(data as PerkData);
    }
  };

  if (!perk) return null;

  const progressPct = Math.min(
    ((PERK_THRESHOLD - perk.km_to_next_perk) / PERK_THRESHOLD) * 100,
    100
  );
  const kmDone = Math.round(PERK_THRESHOLD - perk.km_to_next_perk);
  const hasFreeKm = perk.free_km_available > 0;

  // ─── MODO CELEBRAÇÃO ───────────────────────────────────────────────────────
  if (celebrating) {
    return (
      <div className="mx-4 mb-3 animate-in zoom-in duration-300">
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-[2rem] p-5 text-center text-white relative overflow-hidden">
          <div className="absolute inset-0 opacity-20"
            style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.1) 10px, rgba(255,255,255,0.1) 20px)' }} />
          <p className="text-3xl mb-1">🎉</p>
          <p className="font-black text-lg uppercase tracking-tight">5 km GRÁTIS!</p>
          <p className="text-[10px] font-bold opacity-80 mt-1">
            Chegaste aos {Math.round(perk.km_total)} km acumulados. A viagem fica por nossa conta!
          </p>
        </div>
      </div>
    );
  }

  // ─── MODO FREE KM DISPONÍVEL ───────────────────────────────────────────────
  if (hasFreeKm) {
    return (
      <div className="mx-4 mb-3 animate-in fade-in duration-300">
        <div className="bg-primary/10 border border-primary/30 rounded-[2rem] px-5 py-3 flex items-center gap-3">
          <span className="text-xl">🎁</span>
          <div className="flex-1">
            <p className="text-[10px] font-black text-primary uppercase tracking-widest">
              Tens {perk.free_km_available.toFixed(1)} km grátis
            </p>
            <p className="text-[9px] text-primary font-bold">
              Aplicados automaticamente na próxima corrida
            </p>
          </div>
          <span className="text-[9px] font-black text-primary bg-primary/15 px-3 py-1 rounded-full">ACTIVO</span>
        </div>
      </div>
    );
  }

  // ─── MODO BARRA DE PROGRESSO ───────────────────────────────────────────────
  return (
    <div className="mx-4 mb-3">
      <div className="bg-surface-container-low/80 border border-outline-variant/20 rounded-[2rem] px-5 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">🛣️</span>
            <p className="text-[9px] font-black text-outline uppercase tracking-widest">
              Fidelidade MotoGo
            </p>
          </div>
          <p className="text-[9px] font-black text-on-surface-variant">
            {kmDone} / {PERK_THRESHOLD} km
            <span className="text-on-surface-variant/70"> → 5 km grátis</span>
          </p>
        </div>

        {/* Barra de progresso */}
        <div className="h-2 bg-surface-container-low rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-1000"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <p className="text-[8px] text-on-surface-variant/70 font-bold mt-1.5 text-right">
          Faltam {Math.ceil(perk.km_to_next_perk)} km
        </p>
      </div>
    </div>
  );
};

export default FreePerkBanner;
