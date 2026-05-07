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
      <section className="zr-card zr-card--success zr-pulse">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker" style={{color: 'white'}}>🎉 Parabéns!</p>
            <h2 className="zr-section-title" style={{color: 'white'}}>5 km GRÁTIS!</h2>
            <p className="zr-copy" style={{color: 'white'}}>Chegaste aos {Math.round(perk.km_total ?? 0)} km. A viagem fica por nossa conta!</p>
          </div>
        </div>
      </section>
    );
  }

  // ─── MODO FREE KM DISPONÍVEL ────────────────────────────────────────────────
  if (hasFreeKm) {
    return (
      <section className="zr-card zr-card--success">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Fidelidade Zenith</p>
            <h2 className="zr-section-title">Tens {(perk.free_km_available ?? 0).toFixed(1)} km grátis</h2>
            <p className="zr-copy">Aplicados automaticamente na proxima corrida urbana.</p>
          </div>
          <span className="zr-chip zr-chip--success">Activo</span>
        </div>
        <div className="zr-progress" style={{ marginTop: '14px' }}>
          <div className="zr-progress-fill--success zr-progress-fill" style={{ width: '100%' }}></div>
        </div>
      </section>
    );
  }

  // ─── MODO BARRA DE PROGRESSO ────────────────────────────────────────────────
  return (
    <section className="zr-card zr-card--success">
      <div className="zr-inline zr-inline--between">
        <div>
          <p className="zr-kicker">Fidelidade Zenith</p>
          <h2 className="zr-section-title">Acumula km grátis</h2>
          <p className="zr-copy">Faltam {Math.ceil(perk.km_to_next_perk ?? PERK_THRESHOLD)} km ate ao proximo bonus de 5 km.</p>
        </div>
      </div>
      <div className="zr-progress" style={{ marginTop: '14px' }}>
        <div className="zr-progress-fill--success zr-progress-fill" style={{ width: `${progressPct}%` }}></div>
      </div>
      <p className="zr-note" style={{ marginTop: '8px' }}>
        {kmDone} / {PERK_THRESHOLD} km concluidos.
      </p>
    </section>
  );
};

export default FreePerkBanner;
