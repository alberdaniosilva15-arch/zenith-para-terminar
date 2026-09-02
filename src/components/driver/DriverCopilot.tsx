import React, { useEffect, useMemo, useState } from 'react';
import { cellToLatLng } from 'h3-js';
import type { LatLng } from '../../types';
import { haversineMeters } from '../../lib/geo';
import { mapService } from '../../services/mapService';
import { geminiService } from '../../services/geminiService';

interface HeatmapCell {
  h3_index: string;
  demand_count: number;
  supply_count: number;
}

interface DriverCopilotProps {
  isOnline: boolean;
  hasActiveRide: boolean;
  driverCoords: LatLng | null;
  heatmapData: HeatmapCell[];
}

const DriverCopilot: React.FC<DriverCopilotProps> = ({
  isOnline,
  hasActiveRide,
  driverCoords,
  heatmapData,
}) => {
  const [zoneLabel, setZoneLabel] = useState('zona quente');

  const suggestion = useMemo(() => {
    if (!isOnline || hasActiveRide || !driverCoords) {
      return null;
    }

    const ranked = heatmapData
      .map((cell) => {
        const [lat, lng] = cellToLatLng(cell.h3_index);
        const demandRatio = cell.supply_count === 0
          ? cell.demand_count
          : cell.demand_count / Math.max(cell.supply_count, 1);
        const distanceMeters = haversineMeters(driverCoords.lat, driverCoords.lng, lat, lng);
        const score = demandRatio * 1000 - distanceMeters * 0.22;

        return {
          cell,
          target: { lat, lng },
          demandRatio,
          distanceMeters,
          score,
        };
      })
      .filter((item) => item.demandRatio >= 1.2)
      .sort((first, second) => second.score - first.score);

    if (ranked.length === 0) {
      return null;
    }

    const best = ranked[0];
    if (!best) {
      return null;
    }

    const distanceKm = Math.max(best.distanceMeters / 1000, 0.1);
    const chanceLift = Math.min(85, Math.max(18, Math.round((best.demandRatio - 1) * 28)));
    const angle = bearing(driverCoords, best.target);

    return {
      distanceKm,
      chanceLift,
      angle,
      target: best.target,
      demandRatio: best.demandRatio,
    };
  }, [driverCoords, hasActiveRide, heatmapData, isOnline]);

  useEffect(() => {
    let cancelled = false;

    if (!suggestion) {
      setZoneLabel('zona quente');
      return;
    }

    mapService.reverseGeocode(suggestion.target)
      .then((address) => {
        const label = address.split(',')[0]?.trim() || 'zona quente';
        if (!cancelled) {
          setZoneLabel(label);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setZoneLabel('zona quente');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [suggestion]);

  const [isAsking, setIsAsking] = useState(false);
  const [driverQuestion, setDriverQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const handleAskKaze = async (customPrompt?: string) => {
    const q = customPrompt || driverQuestion;
    if (!q.trim()) return;

    setLoadingAi(true);
    try {
      const chat = geminiService.createKazeChat({
        role: 'driver',
        driverCoords,
        zoneLabel,
        isOnline,
        hasActiveRide,
      });

      const res = await chat.sendMessage(
        `[Motorista em Luanda na zona ${zoneLabel}]: ${q}`,
        { zone: zoneLabel, role: 'driver', isOnline }
      );
      setAiAnswer(res.text);
      setIsAsking(false);
    } catch (e: any) {
      setAiAnswer('Kaze Copilot: Foca nas zonas de maior fluxo (Talatona, Maianga, Centro) para maximizar as tuas corridas hoje!');
    } finally {
      setLoadingAi(false);
    }
  };

  if (!suggestion && !aiAnswer && !isAsking) {
    return (
      <div className="rounded-[2rem] border border-white/10 bg-surface-container p-4 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">psychology</span>
            <span className="text-xs font-black uppercase tracking-wider text-white">Kaze Driver Copilot</span>
          </div>
          <button
            onClick={() => setIsAsking(true)}
            className="text-[10px] font-black uppercase tracking-widest text-black bg-primary px-3 py-1.5 rounded-full hover:bg-primary/90 transition-colors"
          >
            Perguntar à IA
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[2rem] border border-primary/30 bg-primary/10 p-5 text-white space-y-4 shadow-lg shadow-primary/5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[9px] uppercase tracking-[0.22em] text-primary font-black">Driver Copilot Activo</p>
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          </div>
          {suggestion && (
            <>
              <p className="text-sm font-black mt-2">
                <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>location_on</span> Vai {suggestion.distanceKm.toFixed(1)} km para {zoneLabel} {'->'} +{suggestion.chanceLift}% chance de corrida
              </p>
              <p className="text-[11px] text-white/70 mt-1">
                Procura acima da oferta. Excelente momento para reposicionamento inteligente.
              </p>
            </>
          )}
        </div>

        {suggestion && (
          <div className="w-16 h-16 rounded-full border border-primary/30 bg-black/60 flex items-center justify-center shrink-0">
            <div
              className="text-2xl text-primary transition-transform duration-300"
              style={{ transform: `rotate(${suggestion.angle}deg)` }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 'inherit', verticalAlign: 'middle' }}>arrow_forward</span>
            </div>
          </div>
        )}
      </div>

      {/* Resposta da IA se existir */}
      {aiAnswer && (
        <div className="p-3.5 rounded-2xl bg-black/70 border border-primary/20 text-xs text-white/90 leading-relaxed">
          <div className="flex items-center gap-1.5 text-primary text-[10px] font-black uppercase tracking-widest mb-1.5">
            <span className="material-symbols-outlined text-sm">smart_toy</span>
            <span>Kaze Copilot IA</span>
          </div>
          <p>{aiAnswer}</p>
        </div>
      )}

      {/* Botões Rápidos e Caixa de Pergunta */}
      {isAsking ? (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={driverQuestion}
              onChange={(e) => setDriverQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleAskKaze()}
              placeholder="Ex: Onde estão a pagar melhor agora?"
              className="flex-1 rounded-xl bg-black/50 border border-white/15 px-3 py-2 text-xs text-white outline-none focus:border-primary"
            />
            <button
              onClick={() => void handleAskKaze()}
              disabled={loadingAi}
              className="bg-primary text-black font-black px-4 py-2 rounded-xl text-xs uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50"
            >
              {loadingAi ? '...' : 'Enviar'}
            </button>
            <button
              onClick={() => setIsAsking(false)}
              className="px-2 text-white/50 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
          <button
            onClick={() => void handleAskKaze('Onde há mais passageiros agora em Luanda?')}
            className="text-[10px] font-bold bg-white/5 border border-white/10 hover:border-primary/40 px-2.5 py-1.5 rounded-lg text-white/80 transition-colors"
          >
            🔥 Onde há mais procura?
          </button>
          <button
            onClick={() => void handleAskKaze('Como posso maximizar os meus ganhos na próxima hora?')}
            className="text-[10px] font-bold bg-white/5 border border-white/10 hover:border-primary/40 px-2.5 py-1.5 rounded-lg text-white/80 transition-colors"
          >
            💰 Dica de Ganhos
          </button>
          <button
            onClick={() => setIsAsking(true)}
            className="text-[10px] font-bold bg-primary/20 text-primary border border-primary/30 px-2.5 py-1.5 rounded-lg hover:bg-primary/30 transition-colors"
          >
            💬 Perguntar outro tema
          </button>
        </div>
      )}
    </div>
  );
};

function bearing(from: LatLng, to: LatLng): number {
  const lat1 = degreesToRadians(from.lat);
  const lat2 = degreesToRadians(to.lat);
  const deltaLng = degreesToRadians(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

  return radiansToDegrees(Math.atan2(y, x));
}

function degreesToRadians(value: number) {
  return value * Math.PI / 180;
}

function radiansToDegrees(value: number) {
  return value * 180 / Math.PI;
}

export default DriverCopilot;
