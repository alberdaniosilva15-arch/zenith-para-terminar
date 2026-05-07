import React from 'react';

interface RouteInfo {
  distanceKm: number;
  durationMin: number;
  isReal: boolean;  // true = rota real por estrada (Directions API)
}

interface RoutePreviewProps {
  selecting: 'pickup' | 'dest' | null;
  nearbyCount: number | null;
  pickupName: string;
  destName: string;
  routeInfo: RouteInfo | null;
  routeLoading: boolean;
  zonePrice: number | null;
  zoneNames: { origin: string; dest: string } | null;
  onSelectPickup: () => void;
  onSelectDest: () => void;
}

const RoutePreview: React.FC<RoutePreviewProps> = ({
  selecting,
  nearbyCount,
  pickupName,
  destName,
  routeInfo,
  routeLoading,
  zonePrice,
  zoneNames,
  onSelectPickup,
  onSelectDest,
}) => {
  return (
    <section className={`zr-card transition-all duration-500 ${
      selecting ? 'opacity-0 pointer-events-none -translate-y-4 hidden' : 'opacity-100 translate-y-0'
    }`}>
      <div className="zr-inline zr-inline--between">
        <div>
          <p className="zr-kicker">Previsão da rota</p>
          <h2 className="zr-section-title">Trajecto inteligente</h2>
        </div>
        {routeInfo && routeInfo.isReal && (
          <span className="zr-chip zr-chip--gold">Rota real</span>
        )}
      </div>

      <div className="zr-list" style={{ marginTop: '14px' }}>
        <button className="zr-list-item zr-list-item--interactive" onClick={onSelectPickup} style={{ textAlign: 'left', width: '100%' }}>
          <div className="zr-route-dots">
            <span className="dot dot--start"></span>
          </div>
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block' }}>{pickupName || 'Onde estás agora?'}</strong>
            <span className="zr-copy">Partida atual</span>
          </div>
          {nearbyCount !== null && nearbyCount > 0 && (
            <span className="zr-chip zr-chip--info">{nearbyCount} próximos</span>
          )}
        </button>

        {(routeInfo || routeLoading) && (
          <div className="zr-list-item">
            <div style={{ width: '34px' }}></div>
            <div style={{ flex: 1 }}>
              {routeLoading ? (
                <span className="zr-chip zr-chip--muted">A calcular rota...</span>
              ) : routeInfo ? (
                <span className="zr-chip zr-chip--muted">{routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min</span>
              ) : null}
            </div>
            {zonePrice && zoneNames && (
              <span className="zr-chip zr-chip--gold">Preço fixo</span>
            )}
          </div>
        )}

        <button className="zr-list-item zr-list-item--interactive" onClick={onSelectDest} style={{ textAlign: 'left', width: '100%' }}>
          <div className="zr-route-dots">
            <span className="dot dot--end"></span>
          </div>
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block' }}>{destName || 'Para onde queres ir?'}</strong>
            <span className="zr-copy">Destino final</span>
          </div>
          {zonePrice && (
            <strong style={{ fontSize: '16px', color: 'var(--gold)' }}>{Math.round(zonePrice).toLocaleString('pt-AO')} Kz</strong>
          )}
        </button>
      </div>
    </section>
  );
};

export default RoutePreview;
