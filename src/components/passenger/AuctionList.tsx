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
      <div className="zr-list" style={{ marginInline: '14px', marginBottom: '14px' }}>
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
    className={`zr-list-item zr-list-item--interactive ${selected ? 'is-active' : ''}`}
    data-driver-card
    style={{ textAlign: 'left', width: '100%', alignItems: 'center' }}
  >
    <div className="zr-inline" style={{ flex: 1, gap: '12px' }}>
      <div className="zr-avatar">
        <img
          src={driver.avatar_url ?? `https://api.dicebear.com/7.x/bottts/svg?seed=${driver.driver_id}`}
          alt={driver.driver_name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <div>
        <strong style={{ display: 'block' }}>
          {driver.driver_name} {driver.is_elite && '⚡'}
        </strong>
        <span className="zr-copy">
          ⭐ {driver.rating.toFixed(1)} - {driver.total_rides} corridas - {driver.level}
        </span>
      </div>
    </div>
    <div style={{ textAlign: 'right' }}>
      <strong style={{ display: 'block' }}>{driver.eta_min} min</strong>
      <span className="zr-copy">~ {priceKz ? Math.round(priceKz).toLocaleString('pt-AO') : '--'} Kz</span>
    </div>
  </button>
);

export default AuctionList;
