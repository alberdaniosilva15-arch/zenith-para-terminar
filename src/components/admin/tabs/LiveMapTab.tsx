import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapSingleton } from '../../../lib/mapInstance';
import { supabase } from '../../../lib/supabase';
import { parseSupabasePoint } from '../../../services/rideService';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const LUANDA_CENTER: [number, number] = [13.2344, -8.8368];

type LayerState = {
  drivers: boolean;
  zones: boolean;
  traffic: boolean;
};

type DriverLocationRow = {
  driver_id: string;
  location: unknown;
  status: string | null;
  updated_at: string | null;
};

const ZONE_FEATURES: GeoJSON.FeatureCollection<GeoJSON.Point, { name: string; demand: 'high' | 'medium' }> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Baixa / Mutamba', demand: 'high' }, geometry: { type: 'Point', coordinates: [13.2417, -8.8159] } },
    { type: 'Feature', properties: { name: 'Talatona', demand: 'high' }, geometry: { type: 'Point', coordinates: [13.1804, -8.9186] } },
    { type: 'Feature', properties: { name: 'Kilamba', demand: 'medium' }, geometry: { type: 'Point', coordinates: [13.2453, -8.9926] } },
    { type: 'Feature', properties: { name: 'Viana', demand: 'medium' }, geometry: { type: 'Point', coordinates: [13.3701, -8.9004] } },
  ],
};

function syncZoneLayers(map: mapboxgl.Map, visible: boolean) {
  const fillLayerId = 'zenith-demand-zones';
  const labelLayerId = 'zenith-demand-zones-label';
  const sourceId = 'zenith-demand-zones-source';

  if (!visible) {
    if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
    if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    return;
  }

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: ZONE_FEATURES,
    });
  }

  if (!map.getLayer(fillLayerId)) {
    map.addLayer({
      id: fillLayerId,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': [
          'match',
          ['get', 'demand'],
          'high', 34,
          24,
        ],
        'circle-color': [
          'match',
          ['get', 'demand'],
          'high', '#E6C364',
          '#38BDF8',
        ],
        'circle-opacity': 0.22,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#F8FAFC',
      },
    });
  }

  if (!map.getLayer(labelLayerId)) {
    map.addLayer({
      id: labelLayerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-offset': [0, 2.2],
      },
      paint: {
        'text-color': '#E2E8F0',
        'text-halo-color': '#020617',
        'text-halo-width': 1,
      },
    });
  }
}

export const LiveMapTab: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const styleRef = useRef<string | null>(null);
  const [layers, setLayers] = useState<LayerState>({ drivers: true, zones: true, traffic: false });
  const [driverCount, setDriverCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapStyle = useMemo(
    () => layers.traffic ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/dark-v11',
    [layers.traffic],
  );

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!MAPBOX_TOKEN) {
      setMapError('Token Mapbox em falta. Define VITE_MAPBOX_TOKEN para activar o mapa.');
      return;
    }

    const reusingExistingMap = Boolean(MapSingleton.get());
    const map = MapSingleton.init(mapContainerRef.current, MAPBOX_TOKEN, {
      center: LUANDA_CENTER,
      zoom: 11.6,
      style: mapStyle,
      pitch: 0,
      bearing: 0,
    });

    if (!map) {
      setMapError('Nao foi possivel inicializar o mapa. Tenta recarregar o browser.');
      return;
    }

    const resizeMap = () => MapSingleton.resize();
    const resizeTarget = mapContainerRef.current;
    const resizeObserver = typeof ResizeObserver !== 'undefined' && resizeTarget
      ? new ResizeObserver(() => resizeMap())
      : null;
    const handleMapLoad = () => {
      mapRef.current = map;
      styleRef.current = reusingExistingMap ? null : mapStyle;
      setMapReady(true);
      setMapError(null);
      resizeMap();
    };
    const handleMapError = (event: any) => {
      const message = event?.error?.message || event?.error?.statusText || 'Falha ao carregar o estilo do mapa.';
      console.error('[LiveMapTab.map]', event?.error || event);
      if (typeof message === 'string' && message.trim()) {
        setMapError(message);
      }
    };

    const hasNavigationControl = Boolean(mapContainerRef.current.querySelector('.mapboxgl-ctrl-bottom-right .mapboxgl-ctrl-group'));
    if (!hasNavigationControl) {
      map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    }
    map.on('error', handleMapError);
    if (map.loaded()) {
      handleMapLoad();
    } else {
      map.once('load', handleMapLoad);
    }
    resizeObserver?.observe(resizeTarget);
    window.addEventListener('resize', resizeMap);
    window.addEventListener('zenith:map-resize', resizeMap);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resizeMap);
    });

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resizeMap);
      window.removeEventListener('zenith:map-resize', resizeMap);
      map.off('error', handleMapError);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      mapRef.current = null;
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const applyLayers = () => {
      styleRef.current = mapStyle;
      syncZoneLayers(map, layers.zones);
      MapSingleton.resize();
    };

    if (styleRef.current !== mapStyle) {
      const handleStyleLoad = () => applyLayers();
      map.once('style.load', handleStyleLoad);
      map.setStyle(mapStyle);

      return () => {
        map.off('style.load', handleStyleLoad);
      };
    }

    if (map.isStyleLoaded()) {
      applyLayers();
    }
  }, [layers.zones, mapReady, mapStyle]);

  useEffect(() => {
    let cancelled = false;

    const fetchDrivers = async () => {
      if (!mapRef.current || !mapReady) return;

      try {
        const { data, error } = await supabase
          .from('driver_locations')
          .select('driver_id, location, status, updated_at')
          .eq('status', 'available');

        if (error) throw error;
        if (cancelled) return;

        const rows = (data ?? []) as DriverLocationRow[];
        const rowsWithCoords = rows
          .map((row) => ({
            ...row,
            coords: parseSupabasePoint(row.location),
          }))
          .filter((row) => row.coords);

        setDriverCount(rowsWithCoords.length);
        setLastSync(new Date().toISOString());
        setMapError(null);

        const currentIds = new Set(rowsWithCoords.map((row) => row.driver_id));

        markersRef.current.forEach((marker, driverId) => {
          if (!currentIds.has(driverId) || !layers.drivers) {
            marker.remove();
            markersRef.current.delete(driverId);
          }
        });

        if (!layers.drivers) return;

        rowsWithCoords.forEach((row) => {
          const coords: [number, number] = [row.coords!.lng, row.coords!.lat];
          const existing = markersRef.current.get(row.driver_id);

          if (existing) {
            existing.setLngLat(coords);
            return;
          }

          const markerEl = document.createElement('div');
          markerEl.style.cssText = [
            'width:14px',
            'height:14px',
            'border-radius:999px',
            'background:#4cf5d8',
            'border:2px solid #020617',
            'box-shadow:0 0 12px rgba(76,245,216,0.9)',
          ].join(';');

          const marker = new mapboxgl.Marker({ element: markerEl })
            .setLngLat(coords)
            .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(
              `<div style="color:#020617;font-weight:700;">Motorista online</div><div style="font-size:12px;">${row.driver_id.slice(0, 8)} • ${row.status ?? 'available'}</div>`,
            ))
            .addTo(mapRef.current!);

          markersRef.current.set(row.driver_id, marker);
        });
      } catch (e: any) {
        console.error('[LiveMapTab.fetchDrivers]', e);
        if (!cancelled) {
          setMapError(e.message || 'Nao foi possivel carregar telemetria da frota.');
        }
      }
    };

    void fetchDrivers();
    const interval = window.setInterval(() => void fetchDrivers(), 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [layers.drivers, mapReady]);

  return (
    <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative', background: '#0a0f1a' }}>
      <div ref={mapContainerRef} className="absolute inset-0" />

      {mapError && (
        <div className="absolute left-6 top-6 max-w-md rounded-lg border border-red-400/20 bg-[#120608]/90 px-4 py-3 text-sm text-red-200 z-20">
          {mapError}
        </div>
      )}

      <div className="absolute top-6 right-6 w-64 bg-[#050505]/90 backdrop-blur-md border border-primary/15 rounded-lg shadow-[0_20px_40px_rgba(0,0,0,0.8)] p-lg z-10">
        <div className="font-headline-lg text-on-surface mb-md">Camadas do Mapa</div>
        <div className="flex flex-col gap-sm">
          {[
            { key: 'drivers', label: 'Motoristas Activos' },
            { key: 'zones', label: 'Zonas de Procura' },
            { key: 'traffic', label: 'Intensidade de Transito' },
          ].map((item) => (
            <label key={item.key} className="flex items-center justify-between cursor-pointer group">
              <span className="font-body-sm text-on-surface-variant group-hover:text-primary transition-colors">{item.label}</span>
              <div className="relative inline-flex items-center h-5 w-9">
                <input
                  checked={layers[item.key as keyof LayerState]}
                  onChange={() => setLayers((prev) => ({ ...prev, [item.key]: !prev[item.key as keyof LayerState] }))}
                  className="sr-only peer"
                  type="checkbox"
                />
                <div className="w-9 h-5 bg-surface-variant rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-primary after:border-primary after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary/20 border border-primary/30"></div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end z-10 pointer-events-none">
        <div className="bg-[#050505]/90 backdrop-blur-md border border-primary/15 px-6 py-3 rounded pointer-events-auto">
          <div className="font-label-sm text-on-surface-variant uppercase mb-1">Sector Actual</div>
          <div className="font-headline-xl text-primary tracking-tight font-bold">LUANDA \ GLOBAL</div>
        </div>
        <div className="bg-[#050505]/90 backdrop-blur-md border border-primary/15 px-6 py-3 rounded pointer-events-auto flex items-center gap-4">
          <div>
            <div className="font-label-sm text-on-surface-variant uppercase mb-1">Estado da Frota</div>
            <div className="font-body-sm text-on-surface">{driverCount} motoristas online</div>
            <div className="font-body-sm text-on-surface-variant">
              {lastSync ? `Ultima sincronizacao: ${new Date(lastSync).toLocaleTimeString('pt-AO')}` : 'Aguardando telemetria...'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
