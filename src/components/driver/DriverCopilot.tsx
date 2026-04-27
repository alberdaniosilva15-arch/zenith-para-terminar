import React, { useEffect, useMemo, useState } from 'react';
import { cellToLatLng } from 'h3-js';
import type { LatLng } from '../../types';
import { haversineMeters } from '../../lib/geo';
import { mapService } from '../../services/mapService';

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
        if (!cancelled && address) {
          setZoneLabel(address.split(',')[0]);
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

  if (!suggestion) {
    return null;
  }

  return (
    <div className="rounded-[2rem] border border-primary/20 bg-primary/10 p-5 text-white">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[9px] uppercase tracking-[0.22em] text-primary/80 font-black">Driver Copilot</p>
          <p className="text-sm font-black mt-2">
            📍 Vai {suggestion.distanceKm.toFixed(1)} km para {zoneLabel} {'->'} +{suggestion.chanceLift}% chance de corrida
          </p>
          <p className="text-[11px] text-white/65 mt-2">
            Procura acima da oferta agora. Excelente momento para reposicionamento inteligente.
          </p>
        </div>

        <div className="w-20 h-20 rounded-full border border-white/15 bg-black/20 flex items-center justify-center shrink-0">
          <div
            className="text-3xl transition-transform duration-300"
            style={{ transform: `rotate(${suggestion.angle}deg)` }}
          >
            ➜
          </div>
        </div>
      </div>
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
