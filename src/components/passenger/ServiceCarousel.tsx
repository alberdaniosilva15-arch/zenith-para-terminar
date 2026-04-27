import React from 'react';
import type { ServiceType } from '../../types';

type StandardVehicleType = Extract<ServiceType, 'standard' | 'moto' | 'comfort' | 'xl'>;
type PremiumServiceType = Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;

interface ServiceCarouselProps {
  selectedVehicle: StandardVehicleType;
  onSelectVehicle: (vehicle: StandardVehicleType) => void;
  onOpenService: (service: PremiumServiceType) => void;
}

const STANDARD_SERVICES: Array<{
  id: StandardVehicleType;
  icon: string;
  title: string;
  subtitle: string;
}> = [
  { id: 'standard', icon: 'TX', title: 'Taxi', subtitle: 'Imediato' },
  { id: 'moto', icon: 'MT', title: 'Moto', subtitle: 'Agil' },
  { id: 'comfort', icon: 'CF', title: 'Comfort', subtitle: 'Mais espaco' },
  { id: 'xl', icon: 'XL', title: 'XL', subtitle: 'Grupo' },
];

const PREMIUM_SERVICES: Array<{
  id: PremiumServiceType;
  icon: string;
  title: string;
  subtitle: string;
}> = [
  { id: 'private_driver', icon: 'PD', title: 'Privado 24h', subtitle: 'Sob demanda' },
  { id: 'charter', icon: 'CH', title: 'Fretamento', subtitle: 'Marketplace' },
  { id: 'cargo', icon: 'CG', title: 'Mercadorias', subtitle: 'Industrial' },
];

export default function ServiceCarousel({
  selectedVehicle,
  onSelectVehicle,
  onOpenService,
}: ServiceCarouselProps) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[#050912] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#050912] to-transparent" />

      <div className="flex gap-2 overflow-x-auto px-1 pb-1 pt-1 no-scrollbar snap-x snap-mandatory scroll-smooth">
        {STANDARD_SERVICES.map((service) => {
          const isActive = selectedVehicle === service.id;
          return (
            <button
              key={service.id}
              onClick={() => onSelectVehicle(service.id)}
              className={`min-w-[118px] shrink-0 snap-start rounded-[1.75rem] border px-4 py-4 text-left transition-all ${
                isActive
                  ? 'border-primary bg-primary/12 shadow-[0_12px_30px_rgba(37,99,235,0.2)]'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="text-2xl font-black">{service.icon}</div>
              <p className="mt-3 text-[11px] font-black text-white">{service.title}</p>
              <p className="mt-1 text-[10px] font-bold text-white/50">{service.subtitle}</p>
            </button>
          );
        })}

        {PREMIUM_SERVICES.map((service) => (
          <button
            key={service.id}
            onClick={() => onOpenService(service.id)}
            className="relative min-w-[122px] shrink-0 snap-start overflow-hidden rounded-[1.9rem] border px-4 py-4 text-left transition-all"
            style={{
              border: '1px solid rgba(230, 195, 100, 0.3)',
              background: 'linear-gradient(180deg, rgba(230,195,100,0.12), rgba(10,10,10,0.82))',
              boxShadow: '0 0 20px rgba(230, 195, 100, 0.08)',
            }}
          >
            <div className="absolute right-3 top-3 rounded-full bg-black/35 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-[#E6C364]">
              Premium
            </div>
            <div className="text-2xl font-black">{service.icon}</div>
            <p className="mt-3 text-[11px] font-black text-white">{service.title}</p>
            <p className="mt-1 text-[10px] font-bold text-white/55">{service.subtitle}</p>
            <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-[#E6C364]/80">
              Toca para reservar
            </p>
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between px-2 text-[9px] font-black uppercase tracking-widest text-white/35">
        <span>Desliza para mais servicos</span>
        <span>Servico agendado / sob demanda</span>
      </div>
    </div>
  );
}
