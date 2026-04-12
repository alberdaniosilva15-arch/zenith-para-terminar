// src/lib/driverTracker.ts
// FASE 2 — Lógica de rastreio com interpolação LERP
// Garante movimento suave (smooth) do motorista no mapa

import mapboxgl from "mapbox-gl";
import { createDriverMarkerElement } from "../components/Map3D";

// ─── Tipos ────────────────────────────────────────────────────
interface Coords {
  lng: number;
  lat: number;
  heading?: number;
}

// ─── DriverTracker Class ──────────────────────────────────────
export class DriverTracker {
  private map:      mapboxgl.Map;
  private marker:   mapboxgl.Marker | null = null;
  
  // Estado de interpolação
  private current:  Coords = { lng: 0, lat: 0, heading: 0 };
  private target:   Coords = { lng: 0, lat: 0, heading: 0 };
  
  private animationFrameId: number | null = null;
  private readonly LERP_FACTOR = 0.05; // Velocidade da suavização (0.1 = rápido, 0.01 = muito lento)

  constructor(map: mapboxgl.Map) {
    this.map = map;
  }

  // ── Actualizar destino (chamado quando o Supabase envia novo GPS) ─
  updateLocation(newCoords: Coords) {
    // Se for a primeira vez, saltar logo para a posição
    if (!this.marker) {
      this.current = { ...newCoords };
      this.target  = { ...newCoords };
      this._createMarker();
      this._startAnimation();
      return;
    }

    this.target = { ...newCoords };
  }

  // ── Criar marcador no mapa ─────────────────────────────────
  private _createMarker() {
    const el = createDriverMarkerElement(this.current.heading);
    this.marker = new mapboxgl.Marker({
      element: el,
      rotationAlignment: "map",
    })
      .setLngLat([this.current.lng, this.current.lat])
      .addTo(this.map);
  }

  // ── Loop de animação (LERP) ────────────────────────────────
  private _startAnimation() {
    const animate = () => {
      if (!this.marker) return;

      // 1. Calcular nova posição (LERP: current + (target - current) * factor)
      this.current.lng += (this.target.lng - this.current.lng) * this.LERP_FACTOR;
      this.current.lat += (this.target.lat - this.current.lat) * this.LERP_FACTOR;

      // 2. Interpolação de rotação (heading)
      if (this.target.heading !== undefined && this.current.heading !== undefined) {
        // Lógica simples de rotação (não resolve o problema do salto 359 -> 0, mas serve para v3)
        this.current.heading += (this.target.heading - this.current.heading) * 0.1;
      }

      // 3. Aplicar ao marcador
      this.marker.setLngLat([this.current.lng, this.current.lat]);
      
      const el = this.marker.getElement();
      if (el) {
        el.style.transform = `rotate(${this.current.heading || 0}deg)`;
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    animate();
  }

  // ── Limpeza ────────────────────────────────────────────────
  destroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.marker) this.marker.remove();
    this.marker = null;
  }
}
