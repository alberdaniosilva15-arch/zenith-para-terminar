import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import mapboxgl from "mapbox-gl";
import { MapSingleton } from "../lib/mapInstance";
import "mapbox-gl/dist/mapbox-gl.css";

// Re-export para manter compatibilidade com código existente
export { createDriverMarkerElement } from "../lib/driverMarker";

// ─── Tipos ────────────────────────────────────────────────────
export interface Map3DHandle {
  getMap:    () => mapboxgl.Map | null;
  resize:    () => void;
  flyTo:     (options: Parameters<mapboxgl.Map['flyTo']>[0]) => void;
}

export interface Map3DProps {
  mapboxToken?: string;
  center?:     [number, number];
  zoom?:       number;
  pitch?:      number;
  mode?:       "passenger" | "driver" | "tracking" | "admin";
  onMapReady?: (map: mapboxgl.Map) => void;
  className?: string;
  style?:     React.CSSProperties;
}

// ─── Componente ───────────────────────────────────────────────
const Map3D = forwardRef<Map3DHandle, Map3DProps>(({
  mapboxToken,
  center,
  zoom,
  pitch,
  onMapReady,
  className = "",
  style: styleProp,
}, ref) => {

  const containerRef = useRef<HTMLDivElement>(null);
  const token = mapboxToken ?? import.meta.env.VITE_MAPBOX_TOKEN as string;

  // ── API exposta ao componente pai via ref ──────────────────
  useImperativeHandle(ref, () => ({
    getMap:    () => MapSingleton.get(),
    resize:    () => MapSingleton.resize(),
    flyTo:     (options) => MapSingleton.get()?.flyTo(options),
  }));

  // ── Inicializar mapa ───────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !token) return;

    MapSingleton.init(containerRef.current, token, {
      center,
      zoom,
      pitch,
    });

    MapSingleton.onReady((readyMap) => {
      onMapReady?.(readyMap);
    });

    return () => {
      // Singleton persiste, apenas limpamos se necessário
    };
  }, []);

  // ── Efeito separado para atualizar posição sem recriar ──────
  useEffect(() => {
    if (!center) return;
    // Validar coordenadas antes de flyTo — NaN/undefined crasha o Mapbox
    const [lng, lat] = center;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    MapSingleton.get()?.flyTo({ center: [lng, lat], zoom: zoom ?? 14, pitch: pitch ?? 0, duration: 800 });
  }, [center, zoom, pitch]);

  // ── Resize quando o container muda de tamanho ──────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => MapSingleton.resize());
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        className={`map3d-container ${className}`}
        style={{
          width:    "100%",
          height:   "100%",
          minHeight: "300px",
          position: "relative",
          ...styleProp,
        }}
      />
    </div>
  );
});

Map3D.displayName = "Map3D";

export default Map3D;

// src/components/Map3D.tsx
// FASE 1 — Componente Map3D estabilizado com singleton WebGL
// NOTA: createDriverMarkerElement foi movida para src/lib/driverMarker.ts
//       para resolver conflito de import static vs dynamic no Vite.
