// =============================================================================
// ZENITH RIDE v3.3 — useDriverHeatmap.ts
// Hook de busca e renderização do heatmap de procura de Luanda via H3
// =============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { cellToLatLng } from 'h3-js';
import { MapSingleton } from '../lib/mapInstance';
import { rideService } from '../services/rideService';

interface UseDriverHeatmapProps {
  isOnline: boolean;
}

export function useDriverHeatmap({ isOnline }: UseDriverHeatmapProps) {
  const [heatmapData, setHeatmapData] = useState<
    Array<{ h3_index: string; demand_count: number; supply_count: number }>
  >([]);
  const heatmapMarkersRef = useRef<any[]>([]);

  const fetchAndDrawHeatmap = useCallback(async () => {
    if (!isOnline) return;
    const data = await rideService.getDemandHeatmap();
    setHeatmapData(data);

    // Limpar markers anteriores
    heatmapMarkersRef.current.forEach((m) => m.remove());
    heatmapMarkersRef.current = [];

    const map = MapSingleton.get();
    if (!map) return;

    data.forEach((item) => {
      // Ratio procura vs oferta
      const ratio = item.supply_count === 0 ? item.demand_count : item.demand_count / item.supply_count;
      if (ratio < 1.5 || item.demand_count === 0) return; // Apenas zonas de alta procura

      const [lat, lng] = cellToLatLng(item.h3_index);
      const mapboxgl = (window as any).mapboxgl;
      if (!mapboxgl) return;

      const el = document.createElement('div');
      const dot = document.createElement('div');
      const isHot = ratio > 3;
      dot.style.cssText = `width:40px;height:40px;border-radius:50%;background:${
        isHot ? 'rgba(239,68,68,0.3)' : 'rgba(249,115,22,0.3)'
      };border:1px solid ${
        isHot ? 'rgba(239,68,68,0.8)' : 'rgba(249,115,22,0.8)'
      };display:flex;align-items:center;justify-content:center;animation:pulse 2s infinite;`;
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size:8px;font-weight:bold;color:white;';
      icon.className = 'material-symbols-outlined';
      icon.textContent = 'local_fire_department';
      dot.appendChild(icon);
      el.appendChild(dot);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);

      heatmapMarkersRef.current.push(marker);
    });
  }, [isOnline]);

  useEffect(() => {
    let interval: any;
    if (isOnline) {
      void fetchAndDrawHeatmap();
      interval = setInterval(fetchAndDrawHeatmap, 60000);
    } else {
      heatmapMarkersRef.current.forEach((m) => m.remove());
      heatmapMarkersRef.current = [];
    }
    return () => clearInterval(interval);
  }, [isOnline, fetchAndDrawHeatmap]);

  return {
    heatmapData,
    fetchAndDrawHeatmap,
  };
}
