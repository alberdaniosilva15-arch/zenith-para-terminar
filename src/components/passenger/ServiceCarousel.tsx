import React, { useRef } from 'react';
import type { ServiceType } from '../../types';
import { useAutoScroll } from '../../hooks/useAutoScroll';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef, 0.5);

  return (
    <div className="zr-scroll-hint">
      <div className="zr-scroll-x" style={{ marginTop: '14px' }} ref={scrollRef}>
        {STANDARD_SERVICES.map((service) => {
        const isActive = selectedVehicle === service.id;
        return (
          <button
            key={service.id}
            onClick={() => onSelectVehicle(service.id)}
            className={`zr-option ${isActive ? 'is-active' : ''}`}
            data-service-card
          >
            <strong>{service.title}</strong>
            <span>{service.subtitle}</span>
          </button>
        );
      })}

      {PREMIUM_SERVICES.map((service) => (
        <button
          key={service.id}
          onClick={() => onOpenService(service.id)}
          className="zr-option"
          data-service-card
          style={{ borderColor: 'rgba(230,195,100,0.3)', background: 'rgba(230,195,100,0.05)' }}
        >
          <strong style={{ color: 'var(--gold)' }}>{service.title}</strong>
          <span style={{ opacity: 0.8 }}>{service.subtitle}</span>
        </button>
      ))}
      </div>
    </div>
  );
}
