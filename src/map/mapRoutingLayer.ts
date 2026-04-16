// src/map/mapRoutingLayer.ts
// Desenha rota animada no Mapbox GL JS v3 — compatível com dark-v11 + pitch 45°

import mapboxgl from 'mapbox-gl';
import type { RouteResult } from '../services/mapboxRoutingService';

const SOURCE_ID = 'zenith-route-source';
const LAYER_GLOW = 'zenith-route-glow';
const LAYER_LINE = 'zenith-route-line';
const LAYER_DASH = 'zenith-route-dash';

export function drawRoute(map: mapboxgl.Map, route: RouteResult): void {
  clearRoute(map);

  // Source GeoJSON da rota
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: route.geojson,
  });

  // 1. Glow exterior (halo azul ciano — combina com dark-v11)
  map.addLayer({
    id: LAYER_GLOW,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#00D4FF',
      'line-width': 14,
      'line-opacity': 0.18,
      'line-blur': 6,
    },
  });

  // 2. Linha sólida principal
  map.addLayer({
    id: LAYER_LINE,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#00D4FF',
      'line-width': 4,
      'line-opacity': 0.9,
    },
  });

  // 3. Traço animado sobre a linha (efeito de movimento)
  map.addLayer({
    id: LAYER_DASH,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#FFFFFF',
      'line-width': 3,
      'line-opacity': 0.6,
      'line-dasharray': [0, 4, 3],
    },
  });

  // Anima o dasharray para efeito "movimento"
  let step = 0;
  const dashPatterns = [
    [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2],
    [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5],
    [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3],
    [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5],
    [0, 3, 3, 1], [0, 3.5, 3, 0.5],
  ];

  const animInterval = setInterval(() => {
    if (!map.getLayer(LAYER_DASH)) {
      clearInterval(animInterval);
      return;
    }
    step = (step + 1) % dashPatterns.length;
    map.setPaintProperty(LAYER_DASH, 'line-dasharray', dashPatterns[step]);
  }, 80);

  // Guarda o interval no mapa para cleanup posterior
  (map as any)._zenithRouteInterval = animInterval;

  // Ajusta câmara para mostrar a rota completa
  map.fitBounds(route.bbox as mapboxgl.LngLatBoundsLike, {
    padding: { top: 140, bottom: 220, left: 60, right: 60 },
    duration: 1400,
    essential: true,
  });
}

export function clearRoute(map: mapboxgl.Map): void {
  // Para animação
  if ((map as any)._zenithRouteInterval) {
    clearInterval((map as any)._zenithRouteInterval);
    delete (map as any)._zenithRouteInterval;
  }

  if (map.getLayer(LAYER_DASH)) map.removeLayer(LAYER_DASH);
  if (map.getLayer(LAYER_LINE)) map.removeLayer(LAYER_LINE);
  if (map.getLayer(LAYER_GLOW)) map.removeLayer(LAYER_GLOW);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}
