import React from 'react';
import { AuctionState, AuctionDriver } from '../../types';

interface AuctionListProps {
  auction: AuctionState;
  onSelectDriver: (driver: AuctionDriver) => void;
  onCancelAuction: () => void;
  zonePrice: number | null;
  priceKz: number | null;
}

const AuctionList: React.FC<AuctionListProps> = ({
  auction,
  onSelectDriver,
  onCancelAuction,
  zonePrice,
  priceKz,
}) => {
  if (auction.loading) {
    return (
      <div className="flex flex-col items-center py-16 gap-4">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest">A procurar motoristas...</p>
      </div>
    );
  }

  if (auction.error) {
    return (
      <div className="m-4 bg-primary/8 border border-primary/20 rounded-[2rem] p-6 text-center">
        <p className="text-2xl mb-2">🔍</p>
        <p className="font-black text-on-surface text-sm">{auction.error}</p>
        <button onClick={onCancelAuction} className="mt-4 text-[10px] font-black text-primary/80 uppercase tracking-widest">
          Voltar
        </button>
      </div>
    );
  }

  if (auction.drivers.length > 0) {
    return (
      <div className="p-4 space-y-3">
        {auction.drivers.map((driver) => (
          <DriverAuctionCard
            key={driver.driver_id}
            driver={driver}
            selected={auction.selectedDriver?.driver_id === driver.driver_id}
            onSelect={() => onSelectDriver(driver)}
            priceKz={zonePrice ?? priceKz ?? null}
          />
        ))}
      </div>
    );
  }

  return null;
};

const DriverAuctionCard: React.FC<{
  driver: AuctionDriver; selected: boolean; onSelect: () => void; priceKz: number | null;
}> = ({ driver, selected, onSelect, priceKz }) => (
  <button
    onClick={onSelect}
    className={`w-full text-left p-5 rounded-[2rem] border-2 transition-all active:scale-98 ${
      selected
        ? 'border-primary bg-primary/10 shadow-[0_10px_30px_rgba(37,99,235,0.2)]'
        : 'border-outline-variant/20 bg-surface-container-low hover:border-outline-variant/40 shadow-sm'
    }`}
  >
    <div className="flex items-center gap-4">
      <div className="w-14 h-14 rounded-2xl overflow-hidden bg-surface-container-low shrink-0">
        <img
          src={driver.avatar_url ?? `https://api.dicebear.com/7.x/bottts/svg?seed=${driver.driver_id}`}
          alt={driver.driver_name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-black text-on-surface text-sm truncate">{driver.driver_name}</p>
          {selected && <span className="text-[8px] bg-primary text-white px-2 py-0.5 rounded-full font-black shrink-0">SELECCIONADO</span>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[9px] font-bold text-primary/80">⭐ {driver.rating.toFixed(1)}</span>
          <span className="text-[9px] font-bold text-on-surface-variant/70">{driver.total_rides} corridas</span>
          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
            driver.level === 'Diamante' ? 'bg-primary text-white' :
            driver.level === 'Ouro'     ? 'bg-yellow-100 text-yellow-800' :
            driver.level === 'Prata'    ? 'bg-surface-container text-on-surface-variant' :
            driver.level === 'Bronze'   ? 'bg-orange-100 text-orange-700' :
                                          'bg-surface-container-low text-outline'
          }`}>
            {driver.level === 'Diamante' ? '💎' : driver.level === 'Ouro' ? '⭐' : driver.level === 'Prata' ? '🥈' : driver.level === 'Bronze' ? '🥉' : ''}
            {' '}{driver.level}
          </span>
        </div>
        {priceKz && (
          <p className={`text-[10px] font-black mt-1 ${selected ? 'text-primary' : 'text-on-surface-variant'}`}>
            ~{Math.round(priceKz).toLocaleString('pt-AO')} Kz
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="font-black text-on-surface text-sm">{driver.eta_min} min</p>
        <p className="text-[9px] text-on-surface-variant/70 font-bold">{(driver.distance_m / 1000).toFixed(1)} km</p>
      </div>
    </div>
  </button>
);

export default AuctionList;
