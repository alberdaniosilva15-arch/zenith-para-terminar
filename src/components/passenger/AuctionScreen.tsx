// =============================================================================
// AuctionScreen — Ecrã de escolha de motorista (leilão)
// Extraído do PassengerHome.tsx para reduzir tamanho do componente principal
// =============================================================================

import React from 'react';
import AuctionList from './AuctionList';
import type { RideState, AuctionState, AuctionDriver } from '../../types';

interface RouteInfo {
  distanceKm: number;
  durationMin: number;
  isReal: boolean;
}

interface AuctionScreenProps {
  pickupName: string;
  destName: string;
  routeInfo: RouteInfo | null;
  zonePrice: number | null;
  zoneNames: { origin: string; dest: string } | null;
  ride: RideState;
  auction: AuctionState;
  loadingRide: boolean;
  onCancelAuction: () => void;
  onSelectDriver: (driver: AuctionDriver) => void;
  onConfirmDriver: () => Promise<void>;
}

const RouteRow: React.FC<{ dot: string; value: string }> = ({ dot, value }) => (
  <div className="flex items-center gap-3">
    <div className={`w-2 h-2 rounded-full ${dot} shrink-0`} />
    <p className="text-xs font-black text-on-surface-variant truncate">{value}</p>
  </div>
);

const AuctionScreen: React.FC<AuctionScreenProps> = ({
  pickupName, destName, routeInfo, zonePrice, zoneNames,
  ride, auction, loadingRide,
  onCancelAuction, onSelectDriver, onConfirmDriver,
}) => {
  return (
    <div className="flex flex-col bg-[#F8FAFC] min-h-screen pb-28">
      <div className="bg-[#0A0A0A] px-6 pt-8 pb-6 flex items-center gap-4">
        <button
          onClick={onCancelAuction}
          className="w-10 h-10 bg-surface-container-low/10 rounded-full flex items-center justify-center text-white font-black hover:bg-surface-container-low/20 transition-all"
        >
          ←
        </button>
        <div>
          <p className="text-white font-black text-sm">Escolhe o teu motorista</p>
          <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest">
            {auction.loading ? 'A procurar...' : `${auction.drivers.length} disponíveis na tua zona`}
          </p>
        </div>
      </div>

      {/* Rota + distância */}
      <div className="mx-4 mt-4 bg-surface-container-low rounded-[2rem] p-4 border border-outline-variant/20 shadow-sm space-y-2">
        <RouteRow dot="bg-primary" value={pickupName || 'Partida'} />
        <div className="my-1 pl-3 border-l-2 border-dashed border-outline-variant/30">
          {routeInfo && (
            <p className="text-[9px] font-bold text-on-surface-variant/70 py-1">
              {routeInfo.isReal ? '🛣️' : '📏'} {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
              {routeInfo.isReal && <span className="text-primary ml-1">(por estrada)</span>}
            </p>
          )}
        </div>
        <RouteRow dot="bg-red-600" value={destName || 'Destino'} />
        {(zonePrice || ride.priceKz) && (
          <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between">
            {zonePrice && zoneNames ? (
              <span className="text-[8px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black">✓ PREÇO FIXO</span>
            ) : (
              <span className="text-[8px] text-on-surface-variant/60 font-bold">Estimativa</span>
            )}
            <p className="text-right text-sm font-black text-primary">
              {Math.round(zonePrice ?? ride.priceKz ?? 0).toLocaleString('pt-AO')} Kz
            </p>
          </div>
        )}
      </div>

      <AuctionList
        auction={auction}
        onSelectDriver={onSelectDriver}
        onCancelAuction={onCancelAuction}
        zonePrice={zonePrice}
        priceKz={ride.priceKz ?? null}
      />

      {/* Botão confirmar */}
      {auction.selectedDriver && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-surface-container-low/95 backdrop-blur-sm border-t border-outline-variant/20">
          <button
            onClick={onConfirmDriver}
            disabled={loadingRide}
            className="w-full py-6 bg-primary text-white rounded-[2.5rem] font-black text-sm uppercase tracking-[0.2em] shadow-[0_20px_40px_rgba(37,99,235,0.4)] active:scale-98 transition-all disabled:opacity-60"
          >
            {loadingRide ? (
              <span className="flex items-center justify-center gap-3">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                A confirmar...
              </span>
            ) : (
              `CONFIRMAR ${(auction.selectedDriver.driver_name.split(' ')[0] ?? auction.selectedDriver.driver_name).toUpperCase()}`
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default AuctionScreen;
