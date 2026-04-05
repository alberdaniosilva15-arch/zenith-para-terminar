// =============================================================================
// MOTOGO v3.0 — src/components/KazePreditivo.tsx
//
// Banner inteligente que aparece quando o passageiro abre a app.
// Analisa o histórico e sugere a corrida mais provável para aquela hora.
//
// Integração em PassengerHome.tsx (ANTES do card de rota, só em IDLE):
//   import KazePreditivo from './KazePreditivo';
//
//   {ride.status === RideStatus.IDLE && (
//     <KazePreditivo
//       userId={userId}
//       onAccept={(pred) => {
//         setPickupName(pred.origin_address);
//         setPickupCoords({ lat: pred.origin_lat, lng: pred.origin_lng });
//         setDestName(pred.dest_address);
//         setDestCoords({ lat: pred.dest_lat, lng: pred.dest_lng });
//       }}
//     />
//   )}
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { zonePriceService } from '../services/zonePrice';
import type { RidePrediction, ZonePrice } from '../types';

const getLuandaHour = () => (new Date().getUTCHours() + 1) % 24;

interface KazePreditivoProps {
  userId:   string;
  onAccept: (pred: RidePrediction) => void;
}

const KazePreditivo: React.FC<KazePreditivoProps> = ({ userId, onAccept }) => {
  const [prediction, setPrediction] = useState<RidePrediction | null>(null);
  const [zonePrice,  setZonePrice]  = useState<ZonePrice | null>(null);
  const [dismissed,  setDismissed]  = useState(false);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    loadPrediction();
  }, [userId]);

  const loadPrediction = async () => {
    setLoading(true);

    // Hora actual (Angola = UTC+1)
    const currentHour = getLuandaHour();

    // Busca as corridas mais frequentes, com preferência pela hora actual
    const { data } = await supabase
      .from('ride_predictions')
      .select('*')
      .eq('user_id', userId)
      .gte('frequency', 2)                       // mínimo 2 vezes para sugerir
      .order('frequency', { ascending: false })
      .limit(5);

    if (!data || data.length === 0) {
      setLoading(false);
      return;
    }

    // Score: frequência × coincidência de hora
    const scored = (data as RidePrediction[]).map(p => ({
      ...p,
      score: p.frequency * (p.best_hour !== null && Math.abs(p.best_hour - currentHour) <= 1 ? 2 : 1),
    }));

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    setPrediction(best);

    // Tenta obter preço fixo por zona
    const zp = await zonePriceService.getZonePrice(best.origin_address, best.dest_address);
    setZonePrice(zp);

    setLoading(false);
  };

  if (loading || !prediction || dismissed) return null;

  // Mensagem personalizada do Kaze
  const currentHour = getLuandaHour();
  const greeting =
    currentHour < 12 ? 'Bom dia' :
    currentHour < 19 ? 'Boa tarde' : 'Boa noite';

  const isUsualTime = prediction.best_hour !== null &&
    Math.abs(prediction.best_hour - currentHour) <= 1;

  const kazeMsg = isUsualTime
    ? `${greeting}, mano! Já é a tua hora habitual para ${prediction.dest_address.split(',')[0]}.`
    : `${greeting}! Já foi ${prediction.frequency}x a ${prediction.dest_address.split(',')[0]}. Vamos de novo?`;

  const displayPrice = zonePrice?.price_kz ?? prediction.avg_price_kz;

  return (
    <div className="mx-4 mb-4 animate-in slide-in-from-top duration-500">
      <div className="bg-[#0A0A0A] rounded-[2.5rem] p-5 border border-white/5 relative overflow-hidden">
        {/* Glow decorativo */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-[50px] pointer-events-none" />

        {/* Header Kaze */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-lg font-black text-white shadow-lg">
            K
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-0.5">
              Kaze Preditivo ✦
            </p>
            <p className="text-[11px] font-bold text-white/80 leading-snug">
              {kazeMsg}
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="w-8 h-8 rounded-full bg-surface-container-low/5 text-white/30 text-sm flex items-center justify-center hover:bg-surface-container-low/10 transition-all shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Card de rota */}
        <div className="bg-surface-container-low/5 rounded-[1.5rem] p-4 mb-4 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            <p className="text-[11px] font-bold text-white/70 truncate">{prediction.origin_address}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
            <p className="text-[11px] font-bold text-white truncate">{prediction.dest_address}</p>
          </div>
        </div>

        {/* Footer: preço + frequência + botão */}
        <div className="flex items-center gap-3">
          {/* Frequência */}
          <div className="flex-1">
            <p className="text-[8px] text-white/40 font-black uppercase tracking-widest">
              Feito {prediction.frequency}× · {zonePrice ? 'Preço fixo' : 'Estimativa'}
            </p>
            {displayPrice && (
              <p className="text-lg font-black text-white tracking-tighter">
                {Math.round(displayPrice).toLocaleString('pt-AO')} Kz
                {zonePrice && (
                  <span className="text-[8px] text-primary ml-1 font-black">✓ ZONA</span>
                )}
              </p>
            )}
          </div>

          {/* CTA */}
          <button
            onClick={() => onAccept(prediction)}
            className="bg-primary text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-[0_8px_20px_rgba(37,99,235,0.4)] active:scale-95 transition-all"
          >
            USAR AGORA
          </button>
        </div>
      </div>
    </div>
  );
};

export default KazePreditivo;
