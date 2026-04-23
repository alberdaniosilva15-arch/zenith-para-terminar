// src/lib/mapInstance.ts
// FASE 1 — Singleton do Mapbox para reutilização de contexto WebGL
// Evita: múltiplos contextos WebGL, ecrã preto, crashes de memória

import mapboxgl from "mapbox-gl";

export let mapInstance: mapboxgl.Map | null = null;

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

// Container persistente — criado LAZY (apenas quando init() é chamado)
let persistentContainer: HTMLDivElement | null = null;

function getOrCreateContainer(): HTMLDivElement {
  if (!persistentContainer) {
    persistentContainer = document.createElement("div");
    persistentContainer.style.width = "100%";
    persistentContainer.style.height = "100%";
    persistentContainer.style.position = "absolute";
    persistentContainer.style.top = "0";
    persistentContainer.style.left = "0";
  }
  return persistentContainer;
}

// ─── Configuração padrão Luanda ─────────────────────────────
const DEFAULT_CONFIG: Required<MapConfig> = {
  center:  [13.2344, -8.8383], // Luanda centro
  zoom:    14,
  style:   "mapbox://styles/mapbox/dark-v11",
  pitch:   45,
  bearing: 0,
};

// Callbacks registados para notificar componentes quando o mapa estiver pronto
const readyCallbacks: Array<(map: mapboxgl.Map) => void> = [];

// ─── MapSingleton ─────────────────────────────────────────────
export const MapSingleton = {

  // ── Inicializar ou reutilizar instância ────────────────────
  init(targetContainer: HTMLElement, token: string, config: MapConfig = {}): mapboxgl.Map | null {
    const container = getOrCreateContainer();
    // 1. O container alvo precisa de receber o nosso persistentContainer
    if (!targetContainer.contains(container)) {
      targetContainer.appendChild(container);
    }

    // 2. Se o mapa já existe, basta fazer resize e devolver
    if (state.map) {
      this.resize();
      return state.map;
    }

    // 3. Se não existe map, criamos agora pela primeira vez e injetamos
    mapboxgl.accessToken = token;

    // Filtrar props undefined do config para não sobrescrever defaults com undefined
    // JS: {...{center: [1,2]}, ...{center: undefined}} = {center: undefined} ← BUG se não filtrarmos
    const cleanConfig: Partial<MapConfig> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        (cleanConfig as any)[key] = value;
      }
    }
    const mergedConfig = { ...DEFAULT_CONFIG, ...cleanConfig };

    try {
      const map = new mapboxgl.Map({
        container:        container,
        style:            mergedConfig.style,
        center:           mergedConfig.center,
        zoom:             mergedConfig.zoom,
        pitch:            mergedConfig.pitch,
        bearing:          mergedConfig.bearing,
        // ── Optimizações para Angola (RAM limitada, 3G) ────────
        maxTileCacheSize: 200,          
        fadeDuration:     0,            
        antialias:        false,        
        trackResize:      true,         
        preserveDrawingBuffer: false,
        localIdeographFontFamily: false as any, // Não carregar fontes CJK desnecessárias
      });
      mapInstance = map;

      state.map       = map;
      state.container = targetContainer;
      state.isReady   = false;

      // Marcar como pronto quando o estilo carregar
      map.once("load", () => {
        state.isReady = true;

        // ── Activar labels de POIs, bairros, ruas em português ───────────
        try {
          // Configurar o idioma do mapa para português
          const style = map.getStyle();
          if (style?.layers) {
            for (const layer of style.layers) {
              // Activar labels em português onde disponível
              if (
                layer.type === 'symbol' &&
                (layer as any).layout?.['text-field']
              ) {
                try {
                  map.setLayoutProperty(layer.id, 'text-field', [
                    'coalesce',
                    ['get', 'name_pt'],
                    ['get', 'name'],
                  ]);
                } catch { /* layer pode não suportar expression */ }
              }

              // Tornar TODOS os POIs visíveis: restaurantes, hotéis, escolas, hospitais
              if (
                layer.type === 'symbol' &&
                (layer.id.includes('poi') ||
                 layer.id.includes('food') ||
                 layer.id.includes('shop') ||
                 layer.id.includes('lodging') ||
                 layer.id.includes('transit') ||
                 layer.id.includes('education') ||
                 layer.id.includes('medical') ||
                 layer.id.includes('park') ||
                 layer.id.includes('sport') ||
                 layer.id.includes('building'))
              ) {
                try {
                  map.setPaintProperty(layer.id, 'text-opacity', 1);
                  map.setPaintProperty(layer.id, 'icon-opacity', 1);
                  map.setLayoutProperty(layer.id, 'visibility', 'visible');
                } catch { /* ignorar layers sem estes props */ }
              }

              // Tornar labels de neighborhoods/localités/ruas sempre visíveis
              if (
                layer.type === 'symbol' &&
                (layer.id.includes('settlement') ||
                 layer.id.includes('place') ||
                 layer.id.includes('neighborhood') ||
                 layer.id.includes('road') ||
                 layer.id.includes('street') ||
                 layer.id.includes('natural'))
              ) {
                try {
                  map.setPaintProperty(layer.id, 'text-opacity', 1);
                  map.setLayoutProperty(layer.id, 'visibility', 'visible');
                } catch { /* ignorar */ }
              }
            }
          }
        } catch (e) {
          console.warn('[MapSingleton] Não foi possível configurar labels:', e);
        }

        // Executar callbacks pendentes
        readyCallbacks.forEach(cb => cb(map));
        readyCallbacks.length = 0;
        this.resize();
      });

      return map;
    } catch (err: any) {
      console.warn("Failed to initialize WebGL or Mapbox:", err.message);
      targetContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;margin:15px;background:#1e293b;border-radius:15px;color:#94a3b8;font-size:12px;text-align:center;padding:20px;">O teu navegador não suporta mapas em 3D (WebGL) ou falhou. Tenta reiniciar o browser.</div>';
      return null;
    }
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
      // Remover container persistente do DOM mãe para não deixar ghosts
      if (persistentContainer?.parentNode) {
        persistentContainer.parentNode.removeChild(persistentContainer);
      }
      state.map.remove();
      mapInstance = null;
      state.map       = null;
      state.container = null;
      state.isReady   = false;
      readyCallbacks.length = 0;
    }
  },
};
