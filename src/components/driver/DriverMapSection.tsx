// =============================================================================
// ZENITH RIDE v3.3 — src/components/driver/DriverMapSection.tsx
//
// Bloco de mapa operacional do motorista: Map3D em modo driver, chips flutuantes
// (preço de combustível / zona segura) e chip de ETA da navegação.
//
// O Map3D está isolado num ErrorBoundary granular (`name="DriverMap3D"`): uma
// falha de WebGL/periférico derruba apenas o mapa, mantendo o cockpit online,
// o radar de Luanda e a lista de corridas disponíveis totalmente interativos.
//
// Extraído de DriverHome.tsx (SRP).
// =============================================================================

import React, { Suspense } from 'react';
import ErrorBoundary from '../ErrorBoundary';
import type { LatLng } from '../../types';

const Map3D = React.lazy(() => import('../Map3D'));

interface DriverMapSectionProps {
  shouldMountMap: boolean;
  carLocation: LatLng | null;
  navEtaMin: number | null;
}

const DriverMapSection: React.FC<DriverMapSectionProps> = ({
  shouldMountMap,
  carLocation,
  navEtaMin,
}) => {
  return (
    <section className="liquid-glass-card rounded-[24px] p-2 relative overflow-hidden mt-3.5">
      <div className="relative w-full h-[270px] rounded-[18px] overflow-hidden border border-white/10">
        <ErrorBoundary
          name="DriverMap3D"
          compact
          fallbackRender={(_error, reset) => (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
              <span className="material-symbols-outlined text-3xl text-neutral-400">map</span>
              <p className="text-[11px] text-neutral-400 font-bold">
                Mapa indisponível. O radar e os pedidos continuam activos.
              </p>
              <button type="button" onClick={reset} className="zr-button zr-button--secondary" style={{ padding: '6px 14px', fontSize: 11 }}>
                Tentar de novo
              </button>
            </div>
          )}
        >
          {shouldMountMap ? (
            <Suspense fallback={<div className="flex items-center justify-center h-full text-xs text-neutral-400">A carregar mapa...</div>}>
              <Map3D
                mode="driver"
                center={carLocation ? [carLocation.lng, carLocation.lat] : undefined}
              />
            </Suspense>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-neutral-400">A preparar mapa...</div>
          )}

          {/* Chip de ETA da Navegação Activa */}
          {navEtaMin !== null && (
            <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none">
              <div className="liquid-glass-subcard px-2.5 py-1 rounded-full text-[10px] text-amber-300 font-bold border border-amber-400/40 flex items-center gap-1 shadow-lg">
                <span className="material-symbols-outlined text-[14px]">navigation</span>
                <span>Chegada em ~{navEtaMin} min</span>
              </div>
            </div>
          )}

          {/* Chips Flutuantes de Informação do Motorista */}
          <div className="absolute top-2.5 right-2.5 z-10">
            <div className="liquid-glass-subcard px-2.5 py-1 rounded-full text-[10px] text-amber-300 font-bold border border-amber-400/30 flex items-center gap-1 shadow-lg">
              <span className="material-symbols-outlined text-[14px]">local_gas_station</span>
              <span>300-350 Kz/L</span>
            </div>
          </div>

          <div className="absolute bottom-2.5 left-2.5 z-10">
            <div className="liquid-glass-subcard px-2.5 py-1 rounded-full text-[10px] text-emerald-300 font-bold border border-emerald-500/30 flex items-center gap-1 shadow-lg">
              <span className="material-symbols-outlined text-[14px]">shield</span>
              <span>Zona Segura • Luanda</span>
            </div>
          </div>
        </ErrorBoundary>
      </div>
    </section>
  );
};

export default DriverMapSection;
