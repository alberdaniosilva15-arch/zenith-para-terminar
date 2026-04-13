// src/components/Map3D.tsx
// FASE 1 — Componente Map3D estabilizado com singleton WebGL

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import mapboxgl from "mapbox-gl";
import { MapSingleton } from "../lib/mapInstance";
import "mapbox-gl/dist/mapbox-gl.css";

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
  mode = "passenger",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init apenas uma vez

  // ── Efeito separado para atualizar posição sem recriar ──────
  useEffect(() => {
    if (!center) return;
    MapSingleton.get()?.flyTo({ center, zoom: zoom ?? 14, pitch: pitch ?? 0, duration: 800 });
  }, [center, zoom, pitch]);

  // ── Resize quando o container muda de tamanho ──────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => MapSingleton.resize());
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  return (
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
  );
});

Map3D.displayName = "Map3D";

export default Map3D;

// ─── Utilitário: criar elemento HTML de marcador personalizado ─
export function createDriverMarkerElement(heading: number = 0): HTMLElement {
  const el = document.createElement("div");
  el.className = "zenith-driver-marker";
  el.style.cssText = `
    width: 40px;
    height: 40px;
    transform: rotate(${heading}deg);
    transition: transform 0.3s ease;
    cursor: pointer;
  `;
  el.innerHTML = `
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="#1e293b" stroke="#3B82F6" stroke-width="2"/>
      <path d="M20 8 L28 28 L20 24 L12 28 Z" fill="#3B82F6"/>
    </svg>
  `;
  return el;
}
