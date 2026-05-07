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
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Escolher motorista</p>
            <h2 className="zr-section-title">Escolha o teu motorista</h2>
          </div>
          <span className="zr-chip zr-chip--info">
            {auction.loading ? 'A procurar...' : `${auction.drivers.length} respostas`}
          </span>
        </div>
      </header>

      {/* Rota + distância */}
      <section className="zr-card" style={{ marginTop: '14px', marginInline: '14px' }}>
        <div className="zr-list">
          <div className="zr-list-item">
            <div className="zr-route-dots">
              <span className="dot dot--start"></span>
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block' }}>{pickupName || 'Partida'}</strong>
              <span className="zr-copy">Localização de partida</span>
            </div>
          </div>
          
          {routeInfo && (
            <div className="zr-list-item">
              <div style={{ width: '34px' }}></div>
              <div style={{ flex: 1 }}>
                <span className="zr-chip zr-chip--muted">
                  {routeInfo.isReal ? '🛣️' : '📏'} {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
                </span>
              </div>
            </div>
          )}

          <div className="zr-list-item">
            <div className="zr-route-dots">
              <span className="dot dot--end"></span>
            </div>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block' }}>{destName || 'Destino'}</strong>
              {(zonePrice || ride.priceKz) && (
                <span className="zr-copy">
                  {zonePrice && zoneNames ? 'Preço Fixo' : 'Estimativa'}
                </span>
              )}
            </div>
            {(zonePrice || ride.priceKz) && (
              <strong style={{ fontSize: '16px', color: 'var(--gold)' }}>
                {Math.round(zonePrice ?? ride.priceKz ?? 0).toLocaleString('pt-AO')} Kz
              </strong>
            )}
          </div>
        </div>
      </section>

      <div style={{ marginInline: '14px', marginTop: '14px' }}>
        <AuctionList
          auction={auction}
          onSelectDriver={onSelectDriver}
          onCancelAuction={onCancelAuction}
          zonePrice={zonePrice}
          priceKz={ride.priceKz ?? null}
        />
      </div>

      {/* Botão confirmar */}
      {auction.selectedDriver && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '14px', background: 'var(--bg)', borderTop: '1px solid var(--line)', zIndex: 50 }}>
          <div className="zr-inline" style={{ gap: '8px' }}>
            <button
              onClick={onCancelAuction}
              className="zr-button zr-button--secondary"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirmDriver}
              disabled={loadingRide}
              className="zr-button zr-button--block"
              style={{ flex: 1 }}
            >
              {loadingRide ? 'A confirmar...' : `CONFIRMAR ${(auction.selectedDriver.driver_name.split(' ')[0] ?? auction.selectedDriver.driver_name).toUpperCase()}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuctionScreen;
