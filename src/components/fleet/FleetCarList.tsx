import React from 'react';
import type { FleetCarRecord, FleetDriverAgreementRecord } from '../../types';

interface FleetCarListProps {
  cars: FleetCarRecord[];
  driverNames: Record<string, string>;
  agreementByCarId: Record<string, FleetDriverAgreementRecord | undefined>;
}

const FleetCarList: React.FC<FleetCarListProps> = ({ cars, driverNames, agreementByCarId }) => {
  if (cars.length === 0) {
    return (
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 text-sm text-white/60">
        Ainda nao tens carros registados nesta frota.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cars.map((car) => {
        const agreement = agreementByCarId[car.id];
        const driverName = car.driver_id ? driverNames[car.driver_id] ?? 'Motorista associado' : 'Sem motorista';

        return (
          <div key={car.id} className="rounded-[2rem] border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">{car.plate}</p>
                <p className="text-[11px] text-white/60">{car.model ?? 'Modelo por definir'}{car.year ? ` · ${car.year}` : ''}</p>
              </div>
              <span className={`text-[10px] font-black px-3 py-1 rounded-full ${
                car.active ? 'bg-green-500/15 text-green-300' : 'bg-white/10 text-white/50'
              }`}>
                {car.active ? 'ACTIVO' : 'INACTIVO'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
              <div className="rounded-2xl bg-black/20 p-3">
                <p className="text-white/40 uppercase tracking-widest text-[9px] font-black">Motorista</p>
                <p className="text-white font-bold mt-1">{driverName}</p>
              </div>
              <div className="rounded-2xl bg-black/20 p-3">
                <p className="text-white/40 uppercase tracking-widest text-[9px] font-black">Acordo</p>
                <p className="text-white font-bold mt-1">
                  {agreement ? `${agreement.agreement_type} · ${agreement.status}` : 'Ainda sem acordo'}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FleetCarList;
