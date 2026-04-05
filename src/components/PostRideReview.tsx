// =============================================================================
// MOTOGO AI v2.1 — PostRideReview.tsx (NOVO)
// Activado AUTOMATICAMENTE após corrida concluída
// Kaze guia a avaliação: pergunta, colecta nota 1-5, guarda no Supabase
// IA SÓ ACTIVA AQUI — não consome tokens em idle
// =============================================================================

import React, { useState, useEffect } from 'react';
import { geminiService } from '../services/geminiService';
import type { PostRideState } from '../types';

interface PostRideReviewProps {
  postRide:     PostRideState;
  onSubmit:     (score: number, comment?: string) => Promise<void>;
  onDismiss:    () => void;
}

type ReviewStep = 'loading' | 'opening' | 'rating' | 'comment' | 'done';

const PostRideReview: React.FC<PostRideReviewProps> = ({ postRide, onSubmit, onDismiss }) => {
  const [step,        setStep]        = useState<ReviewStep>('loading');
  const [kazeText,    setKazeText]    = useState('');
  const [score,       setScore]       = useState<number>(0);
  const [hovered,     setHovered]     = useState<number>(0);
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  const { driverName, priceKz, rideId } = postRide;

  // ------------------------------------------------------------------
  // Step 1: Kaze abre o diálogo após corrida
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!postRide.active) return;
    (async () => {
      setStep('loading');
      try {
        const res = await geminiService.callPostRideReview({
          driver_name:  driverName ?? 'o motorista',
          price_kz:     priceKz ?? 0,
          distance_km:  postRide.distanceKm ?? 0,
          duration_min: postRide.durationMin ?? 0,
          step:         'opening',
        });
        setKazeText(res.text);
        setStep('opening');
      } catch {
        setKazeText(`Como foi a corrida com ${driverName}?`);
        setStep('opening');
      }
    })();
  }, [postRide.active]);

  // ------------------------------------------------------------------
  // Step 2: Kaze pede a classificação
  // ------------------------------------------------------------------
  const handleOpeningContinue = async () => {
    setStep('loading');
    try {
      const res = await geminiService.callPostRideReview({
        driver_name: driverName ?? 'o motorista',
        price_kz: priceKz ?? 0, distance_km: postRide.distanceKm ?? 0, duration_min: postRide.durationMin ?? 0,
        step: 'collect_rating',
      });
      setKazeText(res.text);
    } catch {
      setKazeText(`Dá uma classificação de 1 a 5 estrelas a ${driverName}.`);
    }
    setStep('rating');
  };

  // ------------------------------------------------------------------
  // Step 3: Confirmar rating, pedir comentário opcional
  // ------------------------------------------------------------------
  const handleRatingSelected = async (s: number) => {
    setScore(s);
    setStep('loading');
    try {
      const res = await geminiService.callPostRideReview({
        driver_name: driverName ?? 'o motorista',
        price_kz: priceKz ?? 0, distance_km: postRide.distanceKm ?? 0, duration_min: postRide.durationMin ?? 0,
        step: 'collect_comment',
      });
      setKazeText(res.text);
    } catch {
      setKazeText('Queres deixar um comentário?');
    }
    setStep('comment');
  };

  // ------------------------------------------------------------------
  // Step 4: Submeter
  // ------------------------------------------------------------------
  const handleSubmit = async () => {
    if (score === 0) return;
    setSubmitting(true);
    await onSubmit(score, comment.trim() || undefined);
    setStep('done');
    setSubmitting(false);
  };

  if (!postRide.active) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end justify-center p-4">
      <div className="w-full max-w-sm rounded-[2rem] border border-primary/20 overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.4)] animate-in slide-in-from-bottom-10 duration-400">

        {/* Header Kaze */}
        <div className="bg-[#0A0A0A] px-8 pt-8 pb-6">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
              <img
                src="https://img.icons8.com/3d-fluency/64/robot-3.png"
                alt="Kaze"
                className="w-10 h-10"
              />
            </div>
            <div>
              <p className="text-[9px] font-black text-primary uppercase tracking-widest">Kaze</p>
              <p className="text-[8px] text-white/40 font-bold">Avaliação da corrida</p>
            </div>
          </div>

          {/* Balão de fala do Kaze */}
          <div className="bg-primary/5 rounded-2xl p-4 min-h-[60px] flex items-center">
            {step === 'loading' ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            ) : (
              <p className="text-sm text-white font-bold leading-relaxed">{kazeText}</p>
            )}
          </div>
        </div>

        {/* Conteúdo dinâmico por step */}
        <div className="p-6 space-y-5">

          {/* STEP: opening */}
          {step === 'opening' && (
            <div className="space-y-3">
              <div className="bg-surface-container-lowest rounded-2xl p-4 flex justify-between items-center">
                <span className="text-xs font-black text-on-surface-variant">Motorista</span>
                <span className="text-sm font-black text-on-surface">{driverName}</span>
              </div>
              {priceKz && (
                <div className="bg-surface-container-lowest rounded-2xl p-4 flex justify-between items-center">
                  <span className="text-xs font-black text-on-surface-variant">Total pago</span>
                  <span className="text-sm font-black text-on-surface">
                    {priceKz.toLocaleString('pt-AO')} Kz
                  </span>
                </div>
              )}
              <button
                onClick={handleOpeningContinue}
                className="w-full py-5 bg-[#0A0A0A] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-surface-container-highest transition-all active:scale-95"
              >
                AVALIAR CORRIDA
              </button>
              <button
                onClick={onDismiss}
                className="w-full py-3 text-on-surface-variant/70 font-black text-[9px] uppercase tracking-widest hover:text-on-surface-variant transition-colors"
              >
                Saltar avaliação
              </button>
            </div>
          )}

          {/* STEP: rating — estrelas */}
          {step === 'rating' && (
            <div className="space-y-4">
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    onClick={() => handleRatingSelected(s)}
                    className="transition-transform hover:scale-125 active:scale-95"
                  >
                    <span className={`text-4xl ${s <= (hovered || score) ? 'opacity-100' : 'opacity-20'}`}>
                      ⭐
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-center text-[9px] font-bold text-on-surface-variant/70 uppercase tracking-widest">
                {hovered === 1 ? 'Muito mau' : hovered === 2 ? 'Mau' : hovered === 3 ? 'OK' : hovered === 4 ? 'Bom' : hovered === 5 ? 'Excelente!' : 'Toca numa estrela'}
              </p>
            </div>
          )}

          {/* STEP: comment */}
          {step === 'comment' && (
            <div className="space-y-4">
              <div className="flex justify-center gap-2 mb-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <span key={s} className={`text-2xl ${s <= score ? 'opacity-100' : 'opacity-20'}`}>⭐</span>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comentário opcional (ex: motorista pontual, boa condução...)"
                maxLength={200}
                rows={3}
                className="w-full bg-surface-container-lowest border border-outline-variant/20 p-4 rounded-2xl outline-none text-sm font-bold text-on-surface resize-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-5 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-primary transition-all active:scale-95 disabled:opacity-60"
              >
                {submitting ? 'A guardar...' : 'SUBMETER AVALIAÇÃO'}
              </button>
              <button
                onClick={() => handleSubmit()}
                className="w-full py-3 text-on-surface-variant/70 font-black text-[9px] uppercase tracking-widest"
              >
                Submeter sem comentário
              </button>
            </div>
          )}

          {/* STEP: done */}
          {step === 'done' && (
            <div className="text-center space-y-4 py-4">
              <div className="text-5xl">✅</div>
              <p className="font-black text-on-surface text-lg">Obrigado pelo feedback!</p>
              <p className="text-xs text-on-surface-variant/70 font-bold">A tua avaliação ajuda a melhorar a experiência.</p>
              <button
                onClick={onDismiss}
                className="w-full py-5 bg-[#0A0A0A] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest"
              >
                FECHAR
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostRideReview;
