// =============================================================================
// MOTOGO v3.0 — src/components/MotoGoScore.tsx
//
// Score de crédito 0-1000 para motoristas, calculado a partir de:
//   corridas (400) + rating (300) + nível (200) + consistência (100)
//
// Integração em Profile.tsx (adiciona um novo caso em activeSection):
//   import MotoGoScore from './MotoGoScore';
//
//   // Adiciona botão na secção main:
//   <button onClick={() => setActiveSection('motogoscore')}>
//     Ver MotoGo Score
//   </button>
//
//   // Adiciona case no switch de renderização:
//   case 'motogoscore':
//     return <MotoGoScore driverId={dbUser.id} />;
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { MotoGoScore as MotoGoScoreType, ScoreLabel } from '../types';

interface MotoGoScoreProps {
  driverId: string;
}

const SCORE_COLORS: Record<ScoreLabel, { bar: string; badge: string; text: string }> = {
  'Sem Historial': { bar: 'bg-outline-variant',    badge: 'bg-surface-container-low text-on-surface-variant',    text: 'text-on-surface-variant' },
  'Básico':        { bar: 'bg-primary',    badge: 'bg-primary/15 text-primary',    text: 'text-primary' },
  'Médio':         { bar: 'bg-primary',   badge: 'bg-primary/10 text-on-surface',  text: 'text-on-surface' },
  'Bom':           { bar: 'bg-primary/100',    badge: 'bg-primary/10 text-primary',    text: 'text-primary' },
  'Excelente':     { bar: 'bg-primary',     badge: 'bg-primary/10 text-primary',      text: 'text-primary' },
  'Extraordinário':{ bar: 'bg-primary',   badge: 'bg-primary/10 text-primary',  text: 'text-primary' },
};

const BANK_PARTNERS = [
  { name: 'BCA', logo: '🏦', benefit: 'Microcrédito até 2.000.000 Kz' },
  { name: 'BFA', logo: '🏦', benefit: 'Crédito automóvel preferencial' },
  { name: 'BAI', logo: '🏦', benefit: 'Conta poupança sem comissões' },
  { name: 'ENSA', logo: '🛡️', benefit: 'Seguro com prémio reduzido 20%' },
];

const MotoGoScore: React.FC<MotoGoScoreProps> = ({ driverId }) => {
  const [scoreData,   setScoreData]   = useState<MotoGoScoreType | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    loadScore();
  }, [driverId]);

  const loadScore = async () => {
    setLoading(true);

    const { data } = await supabase
      .from('motogo_scores')
      .select('*')
      .eq('driver_id', driverId)
      .single();

    setScoreData(data as MotoGoScoreType | null);
    setLoading(false);
  };

  const recalculate = async () => {
    setCalculating(true);
    const { data } = await supabase.rpc('calculate_motogo_score', {
      p_driver_id: driverId,
    });
    setCalculating(false);

    if (data && data[0]) {
      await loadScore();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Se não há score, pede para calcular
  if (!scoreData) {
    return (
      <div className="p-6 flex flex-col items-center gap-6 text-center">
        <div className="w-24 h-24 rounded-full bg-surface-container-low flex items-center justify-center text-4xl">
          🏆
        </div>
        <div>
          <h3 className="font-black text-on-surface text-xl mb-2">MotoGo Score</h3>
          <p className="text-outline text-sm leading-relaxed">
            O teu score de crédito baseado nas tuas corridas, avaliação e consistência. Bancos angolanos usam este score para aprovar crédito.
          </p>
        </div>
        <button
          onClick={recalculate}
          disabled={calculating}
          className="w-full py-5 bg-primary text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-[0_10px_30px_rgba(37,99,235,0.4)] disabled:opacity-60 transition-all"
        >
          {calculating ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              A calcular...
            </span>
          ) : 'CALCULAR MEU SCORE'}
        </button>
      </div>
    );
  }

  const colors = SCORE_COLORS[scoreData.score_label as ScoreLabel] ?? SCORE_COLORS['Sem Historial'];
  const progressPct = (scoreData.score / 1000) * 100;

  // Data formatada
  const lastCalc = new Date(scoreData.last_calculated).toLocaleDateString('pt-AO', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  return (
    <div className="p-4 space-y-5 pb-10">

      {/* ── Cartão principal do score ─────────────────────────────────────── */}
      <div className="bg-[#0A0A0A] rounded-[2.5rem] p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">MotoGo Score</p>
            <p className="text-6xl font-black text-white tracking-tighter">{scoreData.score}</p>
            <p className="text-[9px] text-white/50 font-bold mt-1">de 1000 pontos</p>
          </div>
          <span className={`px-4 py-2 rounded-full text-[10px] font-black ${colors.badge}`}>
            {scoreData.score_label}
          </span>
        </div>

        {/* Barra de progresso */}
        <div className="h-3 bg-surface-container-low/10 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full ${colors.bar} rounded-full transition-all duration-1000`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-[8px] text-white/30 font-bold text-right">Actualizado: {lastCalc}</p>
      </div>

      {/* ── Detalhes da pontuação ──────────────────────────────────────────── */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-left bg-surface-container-low border border-outline-variant/20 rounded-[2rem] p-5"
      >
        <div className="flex justify-between items-center">
          <p className="font-black text-on-surface text-sm">Como é calculado</p>
          <span className="text-on-surface-variant/70 text-lg">{showDetails ? '▲' : '▼'}</span>
        </div>

        {showDetails && (
          <div className="mt-4 space-y-4">
            <ScoreComponent
              label="Corridas realizadas"
              value={scoreData.rides_component}
              max={400}
              desc={`${Math.round(scoreData.rides_component)} corridas · máx 400 pts`}
            />
            <ScoreComponent
              label="Avaliação média"
              value={scoreData.rating_component}
              max={300}
              desc={`Rating ${(scoreData.rating_component / 300 * 5).toFixed(1)}/5 · máx 300 pts`}
            />
            <ScoreComponent
              label="Nível de motorista"
              value={scoreData.level_component}
              max={200}
              desc={`${scoreData.level_component === 200 ? 'Diamante' : scoreData.level_component === 150 ? 'Ouro' : scoreData.level_component === 100 ? 'Prata' : scoreData.level_component === 50 ? 'Bronze' : 'Novato'} · máx 200 pts`}
            />
            <ScoreComponent
              label="Consistência (90 dias)"
              value={scoreData.consistency_pct}
              max={100}
              desc={`${scoreData.consistency_pct.toFixed(0)}% de conclusão · máx 100 pts`}
            />
          </div>
        )}
      </button>

      {/* ── Parceiros financeiros ──────────────────────────────────────────── */}
      <div>
        <div className="px-2 mb-3">
          <p className="font-black text-on-surface text-sm">Benefícios disponíveis</p>
          <p className="text-[9px] text-on-surface-variant/70 font-bold uppercase tracking-widest">
            Com o teu score actual
          </p>
        </div>

        <div className="space-y-3">
          {BANK_PARTNERS.map((partner, i) => {
            const isLocked = scoreData.score < 300 && i > 1;
            return (
              <div
                key={partner.name}
                className={`bg-surface-container-low border rounded-[2rem] p-5 flex items-center gap-4 ${
                  isLocked ? 'opacity-40 border-outline-variant/20' : 'border-primary/20 shadow-sm'
                }`}
              >
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-2xl shrink-0">
                  {partner.logo}
                </div>
                <div className="flex-1">
                  <p className="font-black text-on-surface text-sm">{partner.name}</p>
                  <p className="text-[10px] text-outline font-bold">{partner.benefit}</p>
                </div>
                {isLocked ? (
                  <span className="text-[8px] bg-surface-container-low text-on-surface-variant/70 px-3 py-1 rounded-full font-black">
                    Score &gt;300
                  </span>
                ) : (
                  <span className="text-[8px] bg-primary/10 text-primary px-3 py-1 rounded-full font-black">
                    ELEGÍVEL
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Recalcular ────────────────────────────────────────────────────── */}
      <button
        onClick={recalculate}
        disabled={calculating}
        className="w-full py-4 border border-outline-variant/30 text-on-surface-variant rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-surface-container-lowest disabled:opacity-50 transition-all"
      >
        {calculating ? 'A actualizar score...' : '↻ Actualizar score'}
      </button>
    </div>
  );
};

// Sub-componente de barra de progresso por componente
const ScoreComponent: React.FC<{
  label: string; value: number; max: number; desc: string;
}> = ({ label, value, max, desc }) => (
  <div>
    <div className="flex justify-between items-center mb-1">
      <p className="text-[10px] font-bold text-on-surface-variant">{label}</p>
      <p className="text-[10px] font-black text-on-surface">{Math.round(value)} pts</p>
    </div>
    <div className="h-1.5 bg-surface-container-low rounded-full overflow-hidden mb-1">
      <div
        className="h-full bg-primary rounded-full transition-all"
        style={{ width: `${Math.min((value / max) * 100, 100)}%` }}
      />
    </div>
    <p className="text-[9px] text-on-surface-variant/70 font-bold">{desc}</p>
  </div>
);

export default MotoGoScore;
