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
    <section
      className={`liquid-glass-card rounded-[28px] p-5 relative overflow-hidden transition-all duration-500 ${
        selecting ? 'opacity-0 pointer-events-none -translate-y-4 hidden' : 'opacity-100 translate-y-0'
      }`}
    >
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div>
          <span className="text-[9px] font-bold tracking-[0.26em] uppercase gold-gradient-text block">
            PREVISÃO DA ROTA
          </span>
          <h2 className="font-serif text-[21px] text-white font-normal mt-0.5">
            Trajecto inteligente
          </h2>
        </div>
        {routeInfo && routeInfo.isReal && (
          <span className="liquid-glass-subcard text-[10px] font-bold text-[#E2C37A] px-3 py-1 rounded-full border border-[#DDB658]/40 shadow-sm">
            Rota real
          </span>
        )}
      </div>

      <div className="space-y-2.5 relative z-10">
        {/* Pickup Button */}
        <button
          type="button"
          onClick={onSelectPickup}
          className="liquid-glass-subcard w-full rounded-2xl p-3.5 flex items-center space-x-3 text-left transition duration-200 hover:border-[#DDB658]/40 active:scale-[0.99] group"
        >
          <div className="w-8 h-8 rounded-xl bg-[#2E2514]/80 border border-[#DDB658]/30 flex items-center justify-center flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F5DE9E] shadow-[0_0_8px_rgba(245,222,158,0.8)] animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <strong className="block text-[13px] font-semibold text-white truncate group-hover:text-[#FBE8BC] transition">
              {pickupName || 'Onde estás agora?'}
            </strong>
            <span className="text-[10px] text-neutral-400 font-normal">Partida actual</span>
          </div>
          {nearbyCount !== null && nearbyCount > 0 && (
            <span className="text-[10px] font-bold text-[#E2C37A] bg-[#2E2514]/60 px-2.5 py-0.5 rounded-full border border-[#DDB658]/30 flex-shrink-0">
              {nearbyCount} próximos
            </span>
          )}
        </button>

        {/* Distance / Route Status Pill */}
        {(routeInfo || routeLoading) && (
          <div className="flex items-center justify-between px-3 py-0.5 text-xs">
            <div className="flex items-center space-x-2 text-neutral-400">
              <span className="material-symbols-outlined text-[15px] text-[#DDB658]">trending_flat</span>
              {routeLoading ? (
                <span className="text-[11px] text-neutral-400 animate-pulse">A calcular rota...</span>
              ) : routeInfo ? (
                <span className="text-[11px] text-neutral-300 font-medium">
                  {routeInfo.distanceKm.toFixed(1)} km · ~{routeInfo.durationMin} min
                </span>
              ) : null}
            </div>
            {zonePrice && zoneNames && (
              <span className="text-[10px] font-bold text-[#E2C37A] uppercase tracking-wider bg-[#2E2514]/60 px-2 py-0.5 rounded-full border border-[#DDB658]/30">
                Preço fixo
              </span>
            )}
          </div>
        )}

        {/* Destination Button */}
        <button
          type="button"
          onClick={onSelectDest}
          className="liquid-glass-subcard w-full rounded-2xl p-3.5 flex items-center space-x-3 text-left transition duration-200 hover:border-[#DDB658]/40 active:scale-[0.99] group"
        >
          <div className="w-8 h-8 rounded-xl bg-[#2A1414]/80 border border-red-500/30 flex items-center justify-center flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.7)]" />
          </div>
          <div className="flex-1 min-w-0">
            <strong className="block text-[13px] font-semibold text-white truncate group-hover:text-[#FBE8BC] transition">
              {destName || 'Para onde queres ir?'}
            </strong>
            <span className="text-[10px] text-neutral-400 font-normal">Destino final</span>
          </div>
          {zonePrice && (
            <strong className="text-[14px] font-extrabold text-[#F5DE9E] filter drop-shadow-[0_1px_3px_rgba(220,175,60,0.5)] flex-shrink-0">
              {Math.round(zonePrice).toLocaleString('pt-AO')} Kz
            </strong>
          )}
        </button>
      </div>
    </section>
  );
};

export default RoutePreview;
