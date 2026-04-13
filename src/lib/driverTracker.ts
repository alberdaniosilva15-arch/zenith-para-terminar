// src/lib/driverTracker.ts
// FIX 1: RAF infinito corrigido — loop para quando current ≈ target
// FIX: heading interpolação usa caminho mais curto sempre

import mapboxgl from 'mapbox-gl';
import { createDriverMarkerElement } from '../components/Map3D';

interface Coords {
  lng: number;
  lat: number;
  heading?: number;
}

export class DriverTracker {
  private map:    mapboxgl.Map;
  private marker: mapboxgl.Marker | null = null;

  private current: Coords = { lng: 0, lat: 0, heading: 0 };
  private target:  Coords = { lng: 0, lat: 0, heading: 0 };

  private animationFrameId: number | null = null;

  // Suavização de posição e rotação
  private readonly LERP_FACTOR   = 0.08;
  private readonly HEAD_FACTOR   = 0.12;

  // ── FIX 1: thresholds de paragem ────────────────────────────────────────
  // Quando |delta| fica abaixo destes valores o RAF pára silenciosamente.
  // Valores em graus de coordenada (~0.000011° ≈ 1m no equador)
  private readonly POS_THRESHOLD  = 0.000005; // ~0.5 m
  private readonly HEAD_THRESHOLD = 0.05;      // 0.05°

  constructor(map: mapboxgl.Map) {
    this.map = map;
  }

  // ── Chamado quando Supabase envia novo GPS ─────────────────────────────
  updateLocation(newCoords: Coords) {
    if (!this.marker) {
      this.current = { ...newCoords };
      this.target  = { ...newCoords };
      this._createMarker();
      this._startAnimation();
      return;
    }

    this.target = { ...newCoords };

    // FIX 1: Re-arrancar o RAF se estava parado (chegou ao target anterior)
    if (this.animationFrameId === null) {
      this._startAnimation();
    }
  }

  // ── Criar marcador ─────────────────────────────────────────────────────
  private _createMarker() {
    const el = createDriverMarkerElement(this.current.heading);
    this.marker = new mapboxgl.Marker({
      element: el,
      rotationAlignment: 'map',
    })
      .setLngLat([this.current.lng, this.current.lat])
      .addTo(this.map);
  }

  // ── Loop de animação LERP com paragem automática ───────────────────────
  private _startAnimation() {
    const animate = () => {
      if (!this.marker) return;

      // 1. Interpolação de posição
      const dLng = this.target.lng - this.current.lng;
      const dLat = this.target.lat - this.current.lat;
      this.current.lng += dLng * this.LERP_FACTOR;
      this.current.lat += dLat * this.LERP_FACTOR;

      // 2. Interpolação de heading (caminho mais curto, ≤ 180°)
      let dHead = 0;
      if (this.target.heading !== undefined && this.current.heading !== undefined) {
        dHead = ((this.target.heading - this.current.heading) + 540) % 360 - 180;
        this.current.heading = ((this.current.heading + dHead * this.HEAD_FACTOR) + 360) % 360;
      }

      // 3. Aplicar ao marcador
      this.marker.setLngLat([this.current.lng, this.current.lat]);
      const el = this.marker.getElement();
      if (el) {
        el.style.transform = `rotate(${this.current.heading ?? 0}deg)`;
      }

      // FIX 1: Verificar se chegámos ao destino — parar RAF para não
      // consumir CPU a 60fps quando o motorista está parado
      const posSettled  = Math.abs(dLng) < this.POS_THRESHOLD &&
                          Math.abs(dLat) < this.POS_THRESHOLD;
      const headSettled = Math.abs(dHead) < this.HEAD_THRESHOLD;

      if (posSettled && headSettled) {
        // Snapping final para eliminar floating-point residual
        this.current.lng     = this.target.lng;
        this.current.lat     = this.target.lat;
        this.current.heading = this.target.heading;
        this.animationFrameId = null;
        return; // ← RAF pára aqui; será re-arrancado por updateLocation()
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  // ── Limpeza ────────────────────────────────────────────────────────────
  destroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }
  }
}
