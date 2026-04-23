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
    <div className={`bg-surface-container-low rounded-[2rem] shadow-2xl p-6 space-y-4 border border-white/40 transition-all duration-500 ${
      selecting ? 'opacity-0 pointer-events-none -translate-y-4' : 'opacity-100 translate-y-0'
    }`}>
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-black text-on-surface-variant/70 uppercase tracking-widest">Trajecto Inteligente</span>
        {nearbyCount !== null && nearbyCount > 0 && (
          <span className="text-[8px] font-black uppercase text-primary bg-primary/10 px-3 py-1 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            {nearbyCount} motoristas próximos
          </span>
        )}
      </div>

      <div className="space-y-2">
        {/* Pickup */}
        <div
          onClick={onSelectPickup}
          className="flex gap-4 items-center cursor-pointer bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/20 hover:bg-surface-container-low transition-all"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
          <p className={`text-xs font-black truncate ${pickupName ? 'text-on-surface' : 'text-on-surface-variant/70'}`}>
            {pickupName || 'Onde estás agora?'}
          </p>
        </div>

        {/* Linha de distância — com loading e badge real */}
        <div className="flex items-center gap-2 pl-5">
          <div className="w-px h-4 bg-outline-variant/40" />
          {routeLoading ? (
            <span className="text-[9px] font-bold text-on-surface-variant/50 bg-surface-container-lowest px-3 py-1 rounded-full flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              A calcular rota real...
            </span>
          ) : routeInfo ? (
            <span className={`text-[9px] font-bold px-3 py-1 rounded-full ${
              routeInfo.isReal
                ? 'text-primary bg-primary/8'
                : 'text-on-surface-variant/70 bg-surface-container-lowest'
            }`}>
              {routeInfo.isReal ? '🛣️' : '📏'} {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
              {routeInfo.isReal
                ? <span className="ml-1 text-primary/90 font-black">(rota real)</span>
                : <span className="ml-1 opacity-50">(estimativa)</span>
              }
            </span>
          ) : null}
        </div>

        {/* Destination */}
        <div
          onClick={onSelectDest}
          className="flex gap-4 items-center cursor-pointer bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/20 hover:bg-surface-container-low transition-all"
        >
          <div className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
          <p className={`text-xs font-black truncate ${destName ? 'text-on-surface' : 'text-on-surface-variant/70'}`}>
            {destName || 'Para onde queres ir?'}
          </p>
        </div>
      </div>

      {/* Preço fixo por zona */}
      {zonePrice && zoneNames && (
        <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="text-[8px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black">✓ PREÇO FIXO</span>
            <span className="text-[8px] text-on-surface-variant/70 font-bold">{zoneNames.origin} → {zoneNames.dest}</span>
          </div>
          <span className="font-black text-primary text-sm">{Math.round(zonePrice).toLocaleString('pt-AO')} Kz</span>
        </div>
      )}
    </div>
  );
};

export default RoutePreview;
