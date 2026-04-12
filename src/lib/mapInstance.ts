// src/lib/mapInstance.ts
// FASE 1 — Singleton do Mapbox para reutilização de contexto WebGL
// Evita: múltiplos contextos WebGL, ecrã preto, crashes de memória

import mapboxgl from "mapbox-gl";

// ─── Tipos ────────────────────────────────────────────────────
interface MapConfig {
  center?:   [number, number]; // [lng, lat]
  zoom?:     number;
  style?:    string;
  pitch?:    number;
  bearing?:  number;
}

interface MapSingletonState {
  map:          mapboxgl.Map | null;
  container:    HTMLElement | null;
  isReady:      boolean;
  pendingResize: boolean;
}

// ─── Estado interno do singleton ───────────────────────────────
const state: MapSingletonState = {
  map:           null,
  container:     null,
  isReady:       false,
  pendingResize: false,
};

// Callbacks registados para notificar componentes quando o mapa estiver pronto
const readyCallbacks: Array<(map: mapboxgl.Map) => void> = [];

// ─── Configuração padrão Luanda ────────────────────────────────
const DEFAULT_CONFIG: Required<MapConfig> = {
  center:  [13.2344, -8.8383], // Luanda centro
  zoom:    13,
  style:   "mapbox://styles/mapbox/dark-v11",
  pitch:   45,
  bearing: 0,
};

// ─── MapSingleton ─────────────────────────────────────────────
export const MapSingleton = {

  // ── Inicializar ou reutilizar instância ────────────────────
  init(container: HTMLElement, token: string, config: MapConfig = {}): mapboxgl.Map {
    // Caso 1: Mesma instância, mesmo container → só resize
    if (state.map && state.container === container) {
      this.resize();
      return state.map;
    }

    // Caso 2: Instância existe mas container mudou → destroy + recreate
    if (state.map && state.container !== container) {
      this._destroy();
    }

    // Caso 3: Sem instância → criar nova
    mapboxgl.accessToken = token;

    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const map = new mapboxgl.Map({
      container,
      style:            mergedConfig.style,
      center:           mergedConfig.center,
      zoom:             mergedConfig.zoom,
      pitch:            mergedConfig.pitch,
      bearing:          mergedConfig.bearing,
      // ── Optimizações para Angola (RAM limitada, 3G) ────────
      maxTileCacheSize: 50,           // Limitar cache de tiles — protege RAM
      fadeDuration:     0,            // Sem fade — mais rápido em 3G
      antialias:        false,        // Desactivar antialiasing — poupa GPU
      trackResize:      true,         // Auto-resize ao redimensionar janela
    });

    state.map       = map;
    state.container = container;
    state.isReady   = false;

    // Marcar como pronto quando o estilo carregar
    map.once("load", () => {
      state.isReady = true;
      // Executar callbacks pendentes
      readyCallbacks.forEach(cb => cb(map));
      readyCallbacks.length = 0;
      this.resize();
    });

    return map;
  },

  get(): mapboxgl.Map | null {
    return state.map;
  },

  onReady(callback: (map: mapboxgl.Map) => void): void {
    if (state.isReady && state.map) {
      callback(state.map);
    } else {
      readyCallbacks.push(callback);
    }
  },

  resize(): void {
    if (!state.map) return;
    requestAnimationFrame(() => {
      if (state.map) {
        state.map.resize();
      }
    });
  },

  destroy(): void {
    this._destroy();
  },

  _destroy(): void {
    if (state.map) {
      state.map.remove();
      state.map       = null;
      state.container = null;
      state.isReady   = false;
      readyCallbacks.length = 0;
    }
  },
};
