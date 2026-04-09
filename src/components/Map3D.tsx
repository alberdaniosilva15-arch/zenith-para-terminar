// =============================================================================
// ZENITH RIDE v3.1 — Map3D.tsx
//
// FIXES v3.1:
//   1. Nova prop `userLocation` — centra o mapa na posição real do utilizador
//   2. maxTileCacheSize: 100 → 30 (menos memória / peso)
//   3. pitch inicial = 0 — mapa plano no arranque (mais leve)
//   4. terrain/fog/3D buildings inicializados de forma segura
//   5. ResizeObserver — evita crash ao redimensionar a janela
//   6. Solo ativa 3D buildings/terrain após style load completo
// =============================================================================

import React, { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { LatLng } from '../types';
import { RideStatus } from '../types';

// ─── Config ────────────────────────────────────────────────────────────────────
const TOKEN         = (import.meta.env.VITE_MAPBOX_TOKEN as string) ?? '';
const LUANDA_CENTER: [number, number] = [13.2343, -8.8368];
const ROUTE_SRC     = 'motogo-route';
const ROUTE_CASING  = 'motogo-route-casing';
const ROUTE_LINE    = 'motogo-route-line';

// ─── Tipos ─────────────────────────────────────────────────────────────────────
export interface Map3DProps {
  pickup?:       LatLng;   // origem da corrida
  destination?:  LatLng;   // destino da corrida
  carLocation?:  LatLng;   // posição do motorista (RT via Supabase)
  userLocation?: LatLng;   // FIX v3.1: posição GPS real do utilizador
  status?:       RideStatus;
  dataSaver?:    boolean;
}

// ─── Marcadores HTML ────────────────────────────────────────────────────────
function makeMarkerEl(content: string, bg: string, glow: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width:46px; height:46px; border-radius:50%;
    background:${bg}; border:3px solid rgba(255,255,255,0.95);
    display:flex; align-items:center; justify-content:center;
    font-size:22px; cursor:default;
    box-shadow:0 4px 20px ${glow}, 0 0 0 6px ${glow.replace('0.5', '0.15')};
    transition:transform .25s cubic-bezier(.34,1.56,.64,1);
    will-change:transform;
  `;
  el.innerHTML = content;
  return el;
}

function getBearing(from: [number, number], to: [number, number]): number {
  const [lng1, lat1] = from.map(x => x * Math.PI / 180);
  const [lng2, lat2] = to.map(x => x * Math.PI / 180);
  const dLng = lng2 - lng1;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function makeCarMarker(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative; width:50px; height:50px;';

  const pulse = document.createElement('div');
  pulse.style.cssText = `
    position:absolute; inset:-8px; border-radius:50%;
    background:rgba(37,99,235,0.25);
    animation:motogo-pulse 2s ease-out infinite;
  `;

  const icon = makeMarkerEl('🏍️', 'linear-gradient(135deg,#1d4ed8,#2563eb)', 'rgba(37,99,235,0.5)');
  icon.style.position = 'absolute';
  icon.style.inset    = '2px';
  icon.style.width    = '46px';
  icon.style.height   = '46px';

  el.appendChild(pulse);
  el.appendChild(icon);

  if (!document.getElementById('motogo-map-styles')) {
    const style = document.createElement('style');
    style.id = 'motogo-map-styles';
    style.textContent = `
      @keyframes motogo-pulse {
        0%   { transform:scale(1);   opacity:.6; }
        70%  { transform:scale(1.6); opacity:0; }
        100% { transform:scale(1);   opacity:0; }
      }
    `;
    document.head.appendChild(style);
  }

  return el;
}

// ─── Fetch rota real via Mapbox Directions API ────────────────────────────────
async function fetchRoute(
  origin: LatLng,
  dest:   LatLng
): Promise<GeoJSON.LineString | null> {
  if (!TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?geometries=geojson&overview=full&steps=false&access_token=${TOKEN}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.routes?.[0]?.geometry as GeoJSON.LineString) ?? null;
  } catch {
    return null;
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────
const Map3D: React.FC<Map3DProps> = ({
  pickup,
  destination,
  carLocation,
  userLocation,
  status,
  dataSaver = false,
}) => {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<mapboxgl.Map | null>(null);
  const markerCarRef   = useRef<mapboxgl.Marker | null>(null);
  const markerOrigRef  = useRef<mapboxgl.Marker | null>(null);
  const markerDestRef  = useRef<mapboxgl.Marker | null>(null);
  const markerUserRef  = useRef<mapboxgl.Marker | null>(null); // FIX: marcador posição utilizador
  const mapReadyRef    = useRef(false);
  const prevCarPosRef  = useRef<[number, number] | null>(null);

  // ── 1. Inicializar mapa (apenas uma vez) ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!TOKEN) {
      console.error('[Map3D] VITE_MAPBOX_TOKEN não definido no .env');
      return;
    }

    mapboxgl.accessToken = TOKEN;

    // FIX: centrar no utilizador se disponível, depois no pickup, depois em Luanda
    const initialCenter: [number, number] = userLocation
      ? [userLocation.lng, userLocation.lat]
      : pickup
      ? [pickup.lng, pickup.lat]
      : LUANDA_CENTER;

    const map = new mapboxgl.Map({
      container:  containerRef.current,
      style:      'mapbox://styles/mapbox/dark-v11',
      center:     initialCenter,
      zoom:       15,
      pitch:      0, // FIX: começa plano (mais leve), 3D só após load
      bearing:    -10,
      antialias:  !dataSaver,
      maxTileCacheSize: dataSaver ? 15 : 30, // FIX: reduzido de 100 para 30
    });

    mapRef.current = map;

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: !dataSaver }),
      'bottom-right'
    );

    map.on('load', () => {
      // ── Terrain 3D ──────────────────────────────────────────────────────
      if (!dataSaver) {
        try {
          map.addSource('mapbox-dem', {
            type:     'raster-dem',
            url:      'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom:  14,
          });
          map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });
          map.setFog({
            range:           [0.5, 10],
            color:           '#0a0f1e',
            'horizon-blend': 0.05,
          });
          // Activar pitch 3D suavemente após o style carregar
          map.easeTo({ pitch: 48, duration: 1500 });
        } catch (e) {
          console.warn('[Map3D] terrain/fog não disponível:', e);
        }
      }

      // ── 3D Buildings ─────────────────────────────────────────────────────
      if (!dataSaver) {
        try {
          const labelLayerId = map.getStyle().layers?.find(
            (l: mapboxgl.AnyLayer) => l.type === 'symbol' && (l as mapboxgl.SymbolLayer).layout?.['text-field']
          )?.id;

          map.addLayer(
            {
              id:             '3d-buildings',
              source:         'composite',
              'source-layer': 'building',
              filter:         ['==', 'extrude', 'true'],
              type:           'fill-extrusion',
              minzoom:        14,
              paint: {
                'fill-extrusion-color': [
                  'interpolate', ['linear'], ['get', 'height'],
                  0,   '#0d1929',
                  30,  '#0f2744',
                  80,  '#1a3a6b',
                  150, '#1d4ed8',
                ],
                'fill-extrusion-height':  ['get', 'height'],
                'fill-extrusion-base':    ['get', 'min_height'],
                'fill-extrusion-opacity': 0.85,
              },
            },
            labelLayerId
          );
        } catch (e) {
          console.warn('[Map3D] 3D buildings não disponível:', e);
        }
      }

      // ── Rota: source + layers ─────────────────────────────────────────
      map.addSource(ROUTE_SRC, {
        type: 'geojson',
        data: {
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });

      map.addLayer({
        id:     ROUTE_CASING,
        type:   'line',
        source: ROUTE_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint:  { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': 12, 'line-blur': 4 },
      });

      map.addLayer({
        id:     ROUTE_LINE,
        type:   'line',
        source: ROUTE_SRC,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3b82f6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 17, 6],
          'line-opacity': 0.95,
        },
      });

      mapReadyRef.current = true;

      if (pickup && destination) {
        drawRouteAndMarkers(map, pickup, destination);
      } else if (pickup) {
        placeMarker('origin', map, [pickup.lng, pickup.lat]);
        map.flyTo({ center: [pickup.lng, pickup.lat], zoom: 15, duration: 800 });
      }
    });

    // FIX: ResizeObserver — o mapa adapta-se ao tamanho do container
    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      mapReadyRef.current = false;
      markerCarRef.current?.remove();
      markerOrigRef.current?.remove();
      markerDestRef.current?.remove();
      markerUserRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helper: colocar / mover marcador estático ───────────────────────────
  const placeMarker = useCallback((
    type: 'origin' | 'dest',
    map:  mapboxgl.Map,
    coords: [number, number]
  ) => {
    if (type === 'origin') {
      if (!markerOrigRef.current) {
        markerOrigRef.current = new mapboxgl.Marker({
          element: makeMarkerEl('📍', '#16a34a', 'rgba(22,163,74,0.5)'),
          anchor:  'center',
        }).setLngLat(coords).addTo(map);
      } else {
        markerOrigRef.current.setLngLat(coords);
      }
    } else {
      if (!markerDestRef.current) {
        markerDestRef.current = new mapboxgl.Marker({
          element: makeMarkerEl('🏁', '#dc2626', 'rgba(220,38,38,0.5)'),
          anchor:  'center',
        }).setLngLat(coords).addTo(map);
      } else {
        markerDestRef.current.setLngLat(coords);
      }
    }
  }, []);

  // ── Helper: desenhar rota + marcadores + câmara ─────────────────
  const drawRouteAndMarkers = useCallback(async (
    map:    mapboxgl.Map,
    origin: LatLng,
    dest:   LatLng
  ) => {
    const origCoords: [number, number] = [origin.lng, origin.lat];
    const destCoords: [number, number] = [dest.lng,   dest.lat];

    placeMarker('origin', map, origCoords);
    placeMarker('dest',   map, destCoords);

    const geometry = await fetchRoute(origin, dest);
    const src = map.getSource(ROUTE_SRC) as mapboxgl.GeoJSONSource | undefined;

    if (src && geometry) {
      src.setData({ type: 'Feature', properties: {}, geometry });
    }

    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend(origCoords);
    bounds.extend(destCoords);
    if (geometry?.coordinates?.length) {
      geometry.coordinates.forEach((c) => bounds.extend(c as [number, number]));
    }

    map.fitBounds(bounds, {
      padding:  { top: 90, bottom: 180, left: 60, right: 60 },
      maxZoom:  16.5,
      pitch:    dataSaver ? 0 : 45,
      duration: 1400,
    });
  }, [dataSaver, placeMarker]);

  // ── 2. Reagir a mudanças de pickup / destination ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickup || !destination) return;

    if (mapReadyRef.current) {
      drawRouteAndMarkers(map, pickup, destination);
    } else {
      const onLoad = () => drawRouteAndMarkers(map, pickup!, destination!);
      map.once('load', onLoad);
      return () => { map.off('load', onLoad); };
    }
  }, [pickup?.lat, pickup?.lng, destination?.lat, destination?.lng, drawRouteAndMarkers]);

  // ── FIX: 3. Posição real do utilizador — marcador azul pulsante ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userLocation) return;

    const coords: [number, number] = [userLocation.lng, userLocation.lat];

    if (!markerUserRef.current) {
      const el = makeMarkerEl('📍', 'linear-gradient(135deg,#2563eb,#1d4ed8)', 'rgba(37,99,235,0.6)');
      markerUserRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(coords)
        .addTo(map);

      // Centrar no utilizador se não há pickup definido
      if (!pickup) {
        map.flyTo({ center: coords, zoom: 15, duration: 1000 });
      }
    } else {
      markerUserRef.current.setLngLat(coords);
    }
  }, [userLocation?.lat, userLocation?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 4. Tracking em tempo real do motorista ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !carLocation) return;

    const coords: [number, number] = [carLocation.lng, carLocation.lat];

    if (!markerCarRef.current) {
      markerCarRef.current = new mapboxgl.Marker({
        element: makeCarMarker(),
        anchor:  'center',
      }).setLngLat(coords).addTo(map);
      prevCarPosRef.current = coords;
    } else {
      if (prevCarPosRef.current) {
        const bearing = getBearing(prevCarPosRef.current, coords);
        const markerEl = markerCarRef.current.getElement();
        const iconEl = markerEl.children[1] as HTMLElement;
        if (iconEl) {
          iconEl.style.transform = `rotate(${bearing}deg)`;
          iconEl.style.transition = 'transform 0.6s ease-in-out';
        }
      }
      prevCarPosRef.current = coords;
      markerCarRef.current.setLngLat(coords);
    }

    if (
      status === RideStatus.PICKING_UP ||
      status === RideStatus.IN_PROGRESS
    ) {
      map.easeTo({
        center:   coords,
        zoom:     17,
        pitch:    dataSaver ? 0 : 55,
        duration: 1200,
        easing:   (t) => 1 - Math.pow(1 - t, 3),
      });
    }
  }, [carLocation?.lat, carLocation?.lng, status, dataSaver]);

  // ── 5. Remover marcador do motorista quando corrida termina ──────────────
  useEffect(() => {
    if (
      status === RideStatus.COMPLETED ||
      status === RideStatus.CANCELLED ||
      status === RideStatus.IDLE
    ) {
      markerCarRef.current?.remove();
      markerCarRef.current = null;
    }
  }, [status]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        aria-label="Mapa Zenith Ride Luanda"
      />
      {!TOKEN && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg,#050912,#0d1929)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '32px' }}>🗺️</span>
          <p style={{
            color: '#64748b', fontSize: '11px', fontFamily: 'monospace',
            textAlign: 'center', padding: '0 24px',
          }}>
            VITE_MAPBOX_TOKEN não definido no ficheiro .env
          </p>
        </div>
      )}
    </div>
  );
};

export default Map3D;
