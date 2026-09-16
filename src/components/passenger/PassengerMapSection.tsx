// =============================================================================
// ZENITH RIDE v3.3 — src/components/passenger/PassengerMapSection.tsx
//
// Bloco de mapa do passageiro: Map3D, chip de ETA de aproximação do motorista e
// controlos flutuantes de zoom/centralização (liquid glass).
//
// O Map3D está isolado num ErrorBoundary granular (`name="PassengerMap3D"`):
// uma falha de WebGL/periférico derruba apenas o mapa, mantendo intactos o
// formulário de pedido, atalhos e cartão de corrida activa.
//
// Extraído de PassengerHome.tsx (SRP).
// =============================================================================

import React, { Suspense } from 'react';
import ErrorBoundary from '../ErrorBoundary';
import { MapSingleton } from '../../lib/mapInstance';
import { mapService } from '../../services/mapService';
import type { LatLng } from '../../types';

const Map3D = React.lazy(() => import('../Map3D'));

interface PassengerMapSectionProps {
  shouldMountMap: boolean;
  userLocation: LatLng | null;
  onUserLocationChange: (coords: LatLng) => void;
  approachEtaMin: number | null;
}

const PassengerMapSection: React.FC<PassengerMapSectionProps> = ({
  shouldMountMap,
  userLocation,
  onUserLocationChange,
  approachEtaMin,
}) => {
  return (
    <section className="zr-map relative">
      {!shouldMountMap && <div className="zr-curve" />}
      {shouldMountMap ? (
        <ErrorBoundary
          name="PassengerMap3D"
          compact
          fallbackRender={(_error, reset) => (
            <div className="zr-empty flex flex-col items-center justify-center gap-3 h-full">
              <span className="material-symbols-outlined text-4xl">map</span>
              <p className="text-xs font-bold text-center">
                O mapa não pôde ser carregado. Podes continuar a pedir a tua corrida.
              </p>
              <button type="button" onClick={reset} className="zr-button zr-button--secondary">
                Tentar recarregar o mapa
              </button>
            </div>
          )}
        >
          <Suspense fallback={<div className="zr-empty">A carregar mapa...</div>}>
            <Map3D
              mode="passenger"
              center={userLocation ? [userLocation.lng, userLocation.lat] : undefined}
            />
            {/* Chip de ETA do Motorista a Caminho */}
            {approachEtaMin !== null && (
              <div className="absolute top-3 left-3 z-10 pointer-events-none animate-in fade-in slide-in-from-top-3 duration-300">
                <div className="liquid-glass-subcard px-3 py-1.5 rounded-full text-[11px] text-amber-300 font-black border border-amber-400/50 flex items-center gap-1.5 shadow-xl">
                  <span className="material-symbols-outlined text-[15px]">directions_car</span>
                  <span>Motorista a caminho • Chegada em ~{approachEtaMin} min</span>
                </div>
              </div>
            )}
            {/* Controlos Flutuantes de Zoom e Centralização (Liquid Glass) */}
            <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5 pointer-events-auto">
              <button
                type="button"
                onClick={() => {
                  const map = MapSingleton.get();
                  if (map) map.zoomIn({ duration: 300 });
                }}
                className="w-8 h-8 rounded-xl bg-black/70 backdrop-blur-md border border-white/20 text-white flex items-center justify-center hover:bg-black/90 active:scale-95 transition shadow-lg cursor-pointer"
                title="Aumentar Zoom"
                aria-label="Aumentar Zoom"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const map = MapSingleton.get();
                  if (map) map.zoomOut({ duration: 300 });
                }}
                className="w-8 h-8 rounded-xl bg-black/70 backdrop-blur-md border border-white/20 text-white flex items-center justify-center hover:bg-black/90 active:scale-95 transition shadow-lg cursor-pointer"
                title="Diminuir Zoom"
                aria-label="Diminuir Zoom"
              >
                <span className="material-symbols-outlined text-[18px]">remove</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (userLocation) {
                    const map = MapSingleton.get();
                    if (map) map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 15, duration: 600 });
                  } else {
                    mapService.getCurrentPosition().then((coords) => {
                      onUserLocationChange(coords);
                      const map = MapSingleton.get();
                      if (map) map.flyTo({ center: [coords.lng, coords.lat], zoom: 15, duration: 600 });
                    }).catch(() => {});
                  }
                }}
                className="w-8 h-8 rounded-xl bg-black/70 backdrop-blur-md border border-[#DCB354]/50 text-[#DCB354] flex items-center justify-center hover:bg-black/90 active:scale-95 transition shadow-lg cursor-pointer"
                title="A minha localização"
                aria-label="A minha localização"
              >
                <span className="material-symbols-outlined text-[18px]">my_location</span>
              </button>
            </div>
          </Suspense>
        </ErrorBoundary>
      ) : (
        <div className="zr-empty">A preparar mapa...</div>
      )}
    </section>
  );
};

export default PassengerMapSection;
