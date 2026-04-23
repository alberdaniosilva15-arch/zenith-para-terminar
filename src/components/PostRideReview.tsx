// =============================================================================
// ZENITH RIDE v3.0 — PostRideReview.tsx (NOVO)
// Activado AUTOMATICAMENTE após corrida concluída
// Kaze guia a avaliação: pergunta, colecta nota 1-5, guarda no Supabase
// IA SÓ ACTIVA AQUI — não consome tokens em idle
// =============================================================================

import React, { useState, useEffect } from 'react';
import { geminiService } from '../services/geminiService';
import { supabase } from '../lib/supabase';
import { generateAndShareReceipt, RideReceiptData } from '../services/pdfService';
import type { PostRideState } from '../types';

interface PostRideReviewProps {
  postRide:     PostRideState;
  onSubmit:     (score: number, comment?: string) => Promise<void>;
  onDismiss:    () => void;
}

type ReviewStep = 'loading' | 'opening' | 'rating' | 'comment' | 'price_feedback' | 'done' | 'receipt';

type PriceRating = 'too_cheap' | 'fair' | 'expensive' | 'too_expensive';
const PRICE_OPTIONS: { value: PriceRating; label: string; emoji: string; color: string }[] = [
  { value: 'too_cheap',     label: 'Muito barato',  emoji: '😊', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
  { value: 'fair',           label: 'Preço justo',   emoji: '👍', color: 'bg-primary/15 text-primary border-primary/30' },
  { value: 'expensive',      label: 'Um pouco caro', emoji: '😐', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  { value: 'too_expensive',  label: 'Muito caro',    emoji: '😤', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
];

const PostRideReview: React.FC<PostRideReviewProps> = ({ postRide, onSubmit, onDismiss }) => {
  const [step,        setStep]        = useState<ReviewStep>('loading');
  const [kazeText,    setKazeText]    = useState('');
  const [score,       setScore]       = useState<number>(0);
  const [hovered,     setHovered]     = useState<number>(0);
  const [comment,     setComment]     = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError,      setPdfError]      = useState<string | null>(null);
  const [priceRating,   setPriceRating]   = useState<PriceRating | null>(null);
  const [priceComment,  setPriceComment]  = useState('');

  const { driverName, priceKz, rideId } = postRide;

  // ------------------------------------------------------------------
  // Step 1: Kaze abre o diálogo após corrida
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!postRide.active) return;
    // Reset de estado local a cada nova avaliação
    setStep('loading');
    setScore(0);
    setComment('');
    setKazeText('');

    (async () => {
      try {
        const res = await geminiService.callPostRideReview({
          driver_name:  postRide.driverName  ?? 'o motorista',
          price_kz:     postRide.priceKz     ?? 0,
          distance_km:  postRide.distanceKm  ?? 0,
          duration_min: postRide.durationMin ?? 0,
          step:         'opening',
        });
        setKazeText(res.text);
        setStep('opening');
      } catch {
        setKazeText(`Como foi a corrida com ${postRide.driverName ?? 'o motorista'}?`);
        setStep('opening');
      }
    })();
  }, [postRide.active, postRide.rideId]);

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
    setStep('price_feedback'); // Vai para feedback de preço ANTES de done
    setSubmitting(false);
  };

  // ------------------------------------------------------------------
  // Step 5: Feedback de preço da rota
  // ------------------------------------------------------------------
  const handlePriceFeedback = async () => {
    if (priceRating && rideId) {
      try {
        await supabase.from('price_feedback').insert({
          ride_id: rideId,
          user_id: postRide.passengerId ?? '',
          origin_zone: postRide.originAddress ?? null,
          dest_zone: postRide.destAddress ?? null,
          price_kz: priceKz ?? 0,
          rating: priceRating,
          comment: priceComment.trim() || null,
        });
      } catch { /* não bloquear o fluxo */ }
    }
    setStep('done');
  };

  const handleReceipt = async (mode: 'save' | 'share') => {
    setGeneratingPdf(true);
    setPdfError(null);
    try {
      const { data: ride } = await supabase
        .from('rides')
        .select(`
          *,
          passenger:profiles!rides_passenger_id_fkey(name),
          driver:profiles!rides_driver_id_fkey(name),
          vehicle:driver_vehicles!driver_vehicles_driver_id_fkey(plate_number, vehicle_type)
        `)
        .eq('id', postRide.rideId!)
        .single();

      if (!ride) {
        setPdfError('Não foi possível carregar os dados da corrida.');
        return;
      }

      const receiptData: RideReceiptData = {
        passengerName:  ride.passenger?.name ?? 'Passageiro',
        driverName:     postRide.driverName ?? ride.driver?.name ?? 'Motorista',
        driverPlate:    ride.vehicle?.plate_number ?? '',
        rideId:         postRide.rideId!,
        acceptedAt:     ride.accepted_at ?? ride.created_at,
        startedAt:      ride.started_at  ?? ride.accepted_at ?? ride.created_at,
        completedAt:    ride.completed_at ?? new Date().toISOString(),
        originAddress:  ride.origin_address,
        destAddress:    ride.dest_address,
        originLat:      ride.origin_lat,
        originLng:      ride.origin_lng,
        destLat:        ride.dest_lat,
        destLng:        ride.dest_lng,
        distanceKm:     ride.distance_km  ?? postRide.distanceKm  ?? 0,
        durationMin:    ride.duration_min ?? postRide.durationMin ?? 0,
        priceKz:        postRide.priceKz  ?? ride.price_kz        ?? 0,
        trafficFactor:  ride.traffic_factor ?? 1.0,
        vehicleType:    ride.vehicle?.vehicle_type ?? 'standard',
      };

      await generateAndShareReceipt(receiptData, mode);
    } catch (e) {
      setPdfError('Erro ao gerar recibo. Tenta novamente.');
      console.error('[PostRideReview] PDF error:', e);
    } finally {
      setGeneratingPdf(false);
    }
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

          {/* STEP: price_feedback — Opinião sobre o preço */}
          {step === 'price_feedback' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="text-center mb-2">
                <p className="text-lg font-black text-on-surface">💰 O que achas do preço?</p>
                <p className="text-[10px] text-on-surface-variant/70 font-bold mt-1">
                  {priceKz ? `${priceKz.toLocaleString('pt-AO')} Kz` : ''} — A tua opinião ajuda-nos a melhorar
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {PRICE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setPriceRating(opt.value)}
                    className={`p-3 rounded-2xl border transition-all active:scale-95 text-center ${
                      priceRating === opt.value
                        ? `${opt.color} border-2 shadow-sm`
                        : 'bg-surface-container-lowest border-outline-variant/20 text-on-surface-variant/70'
                    }`}
                  >
                    <span className="text-2xl block mb-1">{opt.emoji}</span>
                    <span className="text-[9px] font-black uppercase tracking-widest">{opt.label}</span>
                  </button>
                ))}
              </div>

              {priceRating && (
                <textarea
                  value={priceComment}
                  onChange={e => setPriceComment(e.target.value)}
                  placeholder="Comentário opcional sobre o preço..."
                  maxLength={150}
                  rows={2}
                  className="w-full bg-surface-container-lowest border border-outline-variant/20 p-3 rounded-xl outline-none text-xs font-bold text-on-surface resize-none focus:ring-2 focus:ring-primary"
                />
              )}

              <button
                onClick={handlePriceFeedback}
                className="w-full py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"
              >
                {priceRating ? 'ENVIAR OPINIÃO' : 'SALTAR'}
              </button>
            </div>
          )}

          {/* STEP: done */}
          {step === 'done' && (
            <div className="text-center space-y-4 py-2">
              <div className="text-5xl">✅</div>
              <p className="font-black text-on-surface text-lg">Obrigado pelo feedback!</p>
              <p className="text-xs text-on-surface-variant/70 font-bold">A tua avaliação ajuda a melhorar a experiência.</p>
          
              {/* Divisória */}
              <div className="border-t border-white/10 pt-4">
                <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest mb-3">
                  Recibo da corrida
                </p>
          
                {pdfError && (
                  <p className="text-xs text-red-400 mb-3">{pdfError}</p>
                )}
          
                {/* Botão: Partilhar (WhatsApp etc.) */}
                <button
                  onClick={() => handleReceipt('share')}
                  disabled={generatingPdf}
                  className="w-full py-4 bg-[#25D366] text-white rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 mb-3"
                >
                  {generatingPdf ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      A gerar recibo...
                    </>
                  ) : (
                    '📤 Partilhar via WhatsApp'
                  )}
                </button>
          
                {/* Botão: Guardar no telemóvel */}
                <button
                  onClick={() => handleReceipt('save')}
                  disabled={generatingPdf}
                  className="w-full py-4 bg-white/8 border border-white/15 text-white/80 rounded-2xl font-black text-[11px] uppercase tracking-widest active:scale-95 disabled:opacity-50 mb-3"
                >
                  💾 Guardar no Telemóvel
                </button>
              </div>
          
              <button
                onClick={onDismiss}
                className="w-full py-3 text-on-surface-variant/50 font-black text-[9px] uppercase tracking-widest"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostRideReview;
