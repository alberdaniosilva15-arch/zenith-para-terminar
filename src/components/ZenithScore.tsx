// =============================================================================
// ZENITH RIDE v3.0 — src/components/ZenithScore.tsx
//
// Score de crédito 0-1000 para motoristas, calculado a partir de:
//   corridas (400) + rating (300) + nível (200) + consistência (100)
//
// Integração em Profile.tsx (adiciona um novo caso em activeSection):
//   import ZenithScore from './ZenithScore';
//
//   // Adiciona botão na secção main:
//   <button onClick={() => setActiveSection('zenithscore')}>
//     Ver Zenith Score
//   </button>
//
//   // Adiciona case no switch de renderização:
//   case 'zenithscore':
//     return <ZenithScore driverId={dbUser.id} />;
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { ZenithScore as ZenithScoreType, ScoreLabel } from '../types';

interface ZenithScoreProps {
  driverId: string;
}

const SCORE_COLORS: Record<ScoreLabel, { bar: string; badgeBg: string; text: string }> = {
  'Sem Historial': { bar: 'var(--muted)', badgeBg: 'var(--surface-3)', text: 'var(--text)' },
  'Básico':        { bar: 'var(--gold-soft)', badgeBg: 'rgba(230,195,100,0.1)', text: 'var(--gold-soft)' },
  'Médio':         { bar: 'var(--gold-soft)', badgeBg: 'rgba(230,195,100,0.2)', text: 'var(--gold)' },
  'Bom':           { bar: 'var(--gold)', badgeBg: 'rgba(230,195,100,0.3)', text: 'var(--gold)' },
  'Excelente':     { bar: 'var(--success)', badgeBg: 'rgba(34,197,94,0.1)', text: 'var(--success)' },
  'Extraordinário':{ bar: 'var(--gold)', badgeBg: 'rgba(230,195,100,0.4)', text: 'var(--gold)' },
};

const BANK_PARTNERS = [
  { name: 'BCA', logo: '🏦', benefit: 'Microcrédito até 2.000.000 Kz' },
  { name: 'BFA', logo: '🏦', benefit: 'Crédito automóvel preferencial' },
  { name: 'BAI', logo: '🏦', benefit: 'Conta poupança sem comissões' },
  { name: 'ENSA', logo: '🛡️', benefit: 'Seguro com prémio reduzido 20%' },
];

const ZenithScore: React.FC<ZenithScoreProps> = ({ driverId }) => {
  const [scoreData,   setScoreData]   = useState<ZenithScoreType | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [scoreUnavailable, setScoreUnavailable] = useState(false);

  useEffect(() => {
    loadScore();
  }, [driverId]);

  const loadScore = async () => {
    setLoading(true);

    const primaryRes = await supabase
      .from('zenith_scores')
      .select('*')
      .eq('driver_id', driverId)
      .single();
    const { data, error } = primaryRes.error && (primaryRes.error as { code?: string } | null)?.code === '42P01'
      ? await supabase
          .from('motogo_scores')
          .select('*')
          .eq('driver_id', driverId)
          .single()
      : primaryRes;

    const errorCode = (error as { code?: string } | null)?.code;
    if (errorCode === '42P01') {
      setScoreUnavailable(true);
      setScoreData(null);
      setLoading(false);
      return;
    }

    setScoreData(data as ZenithScoreType | null);
    setScoreUnavailable(false);
    setLoading(false);
  };

  const recalculate = async () => {
    if (scoreUnavailable) {
      return;
    }

    setCalculating(true);
    let rpcRes = await supabase.rpc('calculate_zenith_score', {
      p_driver_id: driverId,
    });
    if (rpcRes.error && (rpcRes.error as { code?: string } | null)?.code === '42883') {
      rpcRes = await supabase.rpc('calculate_motogo_score', {
        p_driver_id: driverId,
      });
    }
    const { data, error } = rpcRes;
    setCalculating(false);

    const errorCode = (error as { code?: string } | null)?.code;
    if (errorCode === '42883' || errorCode === '42P01') {
      setScoreUnavailable(true);
      return;
    }

    if (data && data[0]) {
      await loadScore();
    }
  };

  if (loading) {
    return (
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  // Se não há score, pede para calcular
  if (!scoreData) {
    return (
      <div className="zr-app" style={{ minHeight: '100vh', padding: '24px' }}>
        <div className="zr-empty" style={{ marginBottom: '32px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', color: 'var(--gold)', marginBottom: '16px' }}>workspace_premium</span>
          <h3 className="zr-section-title">Zenith Score</h3>
          <p className="zr-copy" style={{ marginTop: '8px' }}>
            O teu score de crédito baseado nas tuas corridas, avaliação e consistência. Bancos angolanos usam este score para aprovar crédito.
          </p>
        </div>
        <button
          onClick={recalculate}
          disabled={calculating || scoreUnavailable}
          className="zr-button zr-button--block"
        >
          {calculating ? 'A calcular...' : 'Calcular Meu Score'}
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
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <div style={{ padding: '14px' }}>

        {/* ── Cartão principal do score ─────────────────────────────────────── */}
        <section className="zr-bank" style={{ marginBottom: '24px' }}>
          <div className="zr-bank-head zr-inline zr-inline--between" style={{ alignItems: 'flex-start' }}>
            <div>
              <p className="zr-kicker">Zenith Score</p>
              <h2 className="zr-balance" style={{ fontSize: '48px', margin: '4px 0' }}>{scoreData.score}</h2>
              <p className="zr-meta" style={{ opacity: 0.6 }}>de 1000 pontos</p>
            </div>
            <div style={{ padding: '6px 12px', borderRadius: '16px', background: colors.badgeBg, color: colors.text, fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }}>
              {scoreData.score_label}
            </div>
          </div>

          <div className="zr-progress" style={{ marginBottom: '8px' }}>
            <div className="zr-progress-bar" style={{ width: `${progressPct}%`, backgroundColor: colors.bar }} />
          </div>
          <p className="zr-meta" style={{ textAlign: 'right', fontSize: '8px' }}>Actualizado: {lastCalc}</p>
        </section>

        {/* ── Detalhes da pontuação ──────────────────────────────────────────── */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="zr-card"
          style={{ width: '100%', textAlign: 'left', marginBottom: '24px', cursor: 'pointer' }}
        >
          <div className="zr-inline zr-inline--between">
            <h3 className="zr-section-title" style={{ fontSize: '16px', margin: 0 }}>Como é calculado</h3>
            <span className="material-symbols-outlined">{showDetails ? 'expand_less' : 'expand_more'}</span>
          </div>

          {showDetails && (
            <div className="zr-stack" style={{ marginTop: '16px', gap: '16px' }}>
              <ScoreComponent label="Corridas realizadas" value={scoreData.rides_component} max={400} barColor={colors.bar} desc={`${Math.round(scoreData.rides_component)} corridas · máx 400 pts`} />
              <ScoreComponent label="Avaliação média" value={scoreData.rating_component} max={300} barColor={colors.bar} desc={`Rating ${(scoreData.rating_component / 300 * 5).toFixed(1)}/5 · máx 300 pts`} />
              <ScoreComponent label="Nível de motorista" value={scoreData.level_component} max={200} barColor={colors.bar} desc={`${scoreData.level_component === 200 ? 'Diamante' : scoreData.level_component === 150 ? 'Ouro' : scoreData.level_component === 100 ? 'Prata' : scoreData.level_component === 50 ? 'Bronze' : 'Novato'} · máx 200 pts`} />
              <ScoreComponent label="Consistência (90 dias)" value={scoreData.consistency_pct} max={100} barColor={colors.bar} desc={`${scoreData.consistency_pct.toFixed(0)}% de conclusão · máx 100 pts`} />
            </div>
          )}
        </button>

        {/* ── Parceiros financeiros ──────────────────────────────────────────── */}
        <div style={{ marginBottom: '24px' }}>
          <h3 className="zr-section-title" style={{ fontSize: '16px', marginBottom: '4px' }}>Benefícios disponíveis</h3>
          <p className="zr-meta" style={{ marginBottom: '16px' }}>Com o teu score actual</p>

          <div className="zr-list">
            {BANK_PARTNERS.map((partner, i) => {
              const isLocked = scoreData.score < 300 && i > 1;
              return (
                <div key={partner.name} className="zr-list-item" style={{ opacity: isLocked ? 0.4 : 1, filter: isLocked ? 'grayscale(1)' : 'none' }}>
                  <div className="zr-inline" style={{ gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', background: 'var(--surface-3)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
                      {partner.logo}
                    </div>
                    <div>
                      <strong style={{ display: 'block' }}>{partner.name}</strong>
                      <span className="zr-meta">{partner.benefit}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {isLocked ? (
                      <span className="zr-chip zr-chip--danger" style={{ fontSize: '8px' }}>Score &gt;300</span>
                    ) : (
                      <span className="zr-chip zr-chip--success" style={{ fontSize: '8px' }}>Elegível</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Recalcular ────────────────────────────────────────────────────── */}
        <button onClick={recalculate} disabled={calculating} className="zr-button zr-button--secondary zr-button--block">
          {calculating ? 'A actualizar score...' : '↻ Actualizar score'}
        </button>
      </div>
    </div>
  );
};

// Sub-componente de barra de progresso por componente
const ScoreComponent: React.FC<{
  label: string; value: number; max: number; desc: string; barColor: string;
}> = ({ label, value, max, desc, barColor }) => (
  <div>
    <div className="zr-inline zr-inline--between" style={{ marginBottom: '4px' }}>
      <p className="zr-meta" style={{ fontSize: '10px' }}>{label}</p>
      <p style={{ fontSize: '10px', fontWeight: 'bold' }}>{Math.round(value)} pts</p>
    </div>
    <div className="zr-progress" style={{ marginBottom: '4px' }}>
      <div className="zr-progress-bar" style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: barColor }} />
    </div>
    <p className="zr-meta" style={{ fontSize: '9px' }}>{desc}</p>
  </div>
);

export default ZenithScore;
