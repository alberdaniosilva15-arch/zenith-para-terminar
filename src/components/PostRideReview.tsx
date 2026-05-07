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
  { value: 'too_cheap',     label: 'Muito barato',  emoji: '😊', color: 'rgba(34,197,94,0.1)' },
  { value: 'fair',           label: 'Preço justo',   emoji: '👍', color: 'rgba(230,195,100,0.1)' },
  { value: 'expensive',      label: 'Um pouco caro', emoji: '😐', color: 'rgba(245,158,11,0.1)' },
  { value: 'too_expensive',  label: 'Muito caro',    emoji: '😤', color: 'rgba(239,68,68,0.1)' },
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
      } catch (err) {
        console.warn('[PostRideReview] Falha no Kaze review (opening):', err);
        setKazeText(`Como foi a corrida com ${postRide.driverName ?? 'o motorista'}?`);
        setStep('opening');
      }
    })();
  }, [postRide.active, postRide.rideId]);

  const handleOpeningContinue = async () => {
    setStep('loading');
    try {
      const res = await geminiService.callPostRideReview({
        driver_name: driverName ?? 'o motorista',
        price_kz: priceKz ?? 0, distance_km: postRide.distanceKm ?? 0, duration_min: postRide.durationMin ?? 0,
        step: 'collect_rating',
      });
      setKazeText(res.text);
    } catch (err) {
      console.warn('[PostRideReview] Falha no Kaze review (rating):', err);
      setKazeText(`Dá uma classificação de 1 a 5 estrelas a ${driverName}.`);
    }
    setStep('rating');
  };

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
    } catch (err) {
      console.warn('[PostRideReview] Falha no Kaze review (comment):', err);
      setKazeText('Queres deixar um comentário?');
    }
    setStep('comment');
  };

  const handleSubmit = async () => {
    if (score === 0) return;
    setSubmitting(true);
    await onSubmit(score, comment.trim() || undefined);
    setStep('price_feedback'); // Vai para feedback de preço ANTES de done
    setSubmitting(false);
  };

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
      } catch (err) { console.warn('[PostRideReview] Falha ao enviar price feedback:', err); }
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
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (!postRide.active) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-end justify-center">
      <div className="zr-app" style={{ minHeight: 'auto', width: '100%', maxWidth: '400px', backgroundColor: 'var(--bg)', borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0', overflow: 'hidden' }}>
        
        {/* Kaze Area */}
        <div style={{ padding: '24px 20px 20px', backgroundColor: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
          <div className="zr-inline" style={{ gap: '14px', marginBottom: '16px' }}>
            <div className="zr-avatar zr-avatar--lg" style={{ backgroundColor: 'rgba(230,195,100,0.1)', color: 'var(--gold)', border: '1px solid var(--line)' }}>K</div>
            <div>
              <p className="zr-kicker" style={{ color: 'var(--gold)' }}>Kaze IA</p>
              <p className="zr-copy">Avaliação da corrida</p>
            </div>
          </div>
          
          <div style={{ backgroundColor: 'rgba(230,195,100,0.05)', padding: '16px', borderRadius: '16px' }}>
            {step === 'loading' ? (
              <div className="zr-loading-dots">
                <span></span><span></span><span></span>
              </div>
            ) : (
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)', lineHeight: 1.5 }}>
                {kazeText}
              </p>
            )}
          </div>
        </div>

        <div style={{ padding: '24px 20px', backgroundColor: 'var(--bg)' }}>
          {/* STEP: opening */}
          {step === 'opening' && (
            <div>
              <div className="zr-list" style={{ marginBottom: '24px' }}>
                <div className="zr-list-item">
                  <div style={{ flex: 1 }}>
                    <span className="zr-meta">Motorista</span>
                    <strong style={{ display: 'block', fontSize: '16px' }}>{driverName}</strong>
                  </div>
                </div>
                {priceKz && (
                  <div className="zr-list-item">
                    <div style={{ flex: 1 }}>
                      <span className="zr-meta">Total pago</span>
                      <strong style={{ display: 'block', fontSize: '16px', color: 'var(--gold)' }}>{priceKz.toLocaleString('pt-AO')} Kz</strong>
                    </div>
                  </div>
                )}
              </div>
              <button className="zr-button zr-button--block" onClick={handleOpeningContinue}>AVALIAR CORRIDA</button>
              <button className="zr-button zr-button--block zr-button--ghost" onClick={onDismiss} style={{ marginTop: '12px' }}>Saltar avaliação</button>
            </div>
          )}

          {/* STEP: rating */}
          {step === 'rating' && (
            <div style={{ textAlign: 'center' }}>
              <div className="zr-stars" style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    onClick={() => handleRatingSelected(s)}
                    style={{ background: 'none', border: 'none', fontSize: '42px', cursor: 'pointer', transition: 'transform 0.2s', opacity: s <= (hovered || score) ? 1 : 0.2 }}
                  >
                    ⭐
                  </button>
                ))}
              </div>
              <p className="zr-kicker">
                {hovered === 1 ? 'Muito mau' : hovered === 2 ? 'Mau' : hovered === 3 ? 'OK' : hovered === 4 ? 'Bom' : hovered === 5 ? 'Excelente!' : 'Toca numa estrela'}
              </p>
            </div>
          )}

          {/* STEP: comment */}
          {step === 'comment' && (
            <div>
              <div className="zr-stars" style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <span key={s} style={{ fontSize: '24px', opacity: s <= score ? 1 : 0.2 }}>⭐</span>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comentário opcional..."
                className="zr-textarea"
                rows={3}
                style={{ width: '100%', marginBottom: '20px' }}
              />
              <button onClick={handleSubmit} disabled={submitting} className="zr-button zr-button--block">
                {submitting ? 'A guardar...' : 'SUBMETER'}
              </button>
              <button onClick={() => handleSubmit()} className="zr-button zr-button--block zr-button--ghost" style={{ marginTop: '12px' }}>
                Saltar comentário
              </button>
            </div>
          )}

          {/* STEP: price_feedback */}
          {step === 'price_feedback' && (
            <div>
              <h3 className="zr-section-title" style={{ textAlign: 'center', marginBottom: '8px' }}>O que achas do preço?</h3>
              <p className="zr-meta" style={{ textAlign: 'center', marginBottom: '20px' }}>{priceKz ? `${priceKz.toLocaleString('pt-AO')} Kz` : ''} — A tua opinião ajuda</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                {PRICE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setPriceRating(opt.value)}
                    style={{
                      padding: '16px',
                      borderRadius: '16px',
                      border: priceRating === opt.value ? '1px solid var(--gold)' : '1px solid var(--line)',
                      background: priceRating === opt.value ? opt.color : 'transparent',
                      textAlign: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ fontSize: '28px', display: 'block', marginBottom: '8px' }}>{opt.emoji}</span>
                    <span className="zr-kicker" style={{ color: 'var(--text)' }}>{opt.label}</span>
                  </button>
                ))}
              </div>

              {priceRating && (
                <textarea
                  value={priceComment}
                  onChange={e => setPriceComment(e.target.value)}
                  placeholder="Comentário sobre o preço..."
                  className="zr-textarea"
                  rows={2}
                  style={{ width: '100%', marginBottom: '20px' }}
                />
              )}

              <button onClick={handlePriceFeedback} className="zr-button zr-button--block">
                {priceRating ? 'ENVIAR OPINIÃO' : 'SALTAR'}
              </button>
            </div>
          )}

          {/* STEP: done */}
          {step === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '56px', marginBottom: '16px' }}>✅</div>
              <h3 className="zr-section-title" style={{ marginBottom: '8px' }}>Obrigado!</h3>
              <p className="zr-copy" style={{ marginBottom: '24px' }}>A tua avaliação ajuda a melhorar a Zenith.</p>

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '24px' }}>
                <p className="zr-kicker" style={{ marginBottom: '16px' }}>Recibo da corrida</p>
                {pdfError && <p className="zr-copy" style={{ color: 'var(--danger)', marginBottom: '16px' }}>{pdfError}</p>}
                
                <button 
                  onClick={() => handleReceipt('share')} 
                  disabled={generatingPdf} 
                  className="zr-button zr-button--block" 
                  style={{ backgroundColor: '#25D366', color: 'white', marginBottom: '12px' }}
                >
                  {generatingPdf ? 'A gerar recibo...' : 'Partilhar via WhatsApp'}
                </button>
                <button 
                  onClick={() => handleReceipt('save')} 
                  disabled={generatingPdf} 
                  className="zr-button zr-button--block zr-button--secondary"
                  style={{ marginBottom: '24px' }}
                >
                  Guardar no Telemóvel
                </button>
              </div>

              <button onClick={onDismiss} className="zr-button zr-button--block zr-button--ghost">Fechar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostRideReview;
