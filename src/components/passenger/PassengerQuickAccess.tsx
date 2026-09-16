// =============================================================================
// ZENITH RIDE v3.3 — src/components/passenger/PassengerQuickAccess.tsx
//
// Carrossel horizontal de acesso rápido do passageiro: Contratos, Traz o Mano,
// Agendar, Pós-viagem, Privado 24h, Fretamento e Mercadorias.
// Extraído de PassengerHome.tsx (SRP) — comportamento e estilos inalterados.
// =============================================================================

import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAutoScroll } from '../../hooks/useAutoScroll';

export type PremiumServiceType = 'private_driver' | 'charter' | 'cargo';

interface PassengerQuickAccessProps {
  onOpenReferral: () => void;
  onOpenSchedule: () => void;
  onOpenPremiumService: (service: PremiumServiceType) => void;
}

interface QuickTile {
  key: string;
  label: string;
  hint: string;
  icon: string;
  onClick: () => void;
}

const PassengerQuickAccess: React.FC<PassengerQuickAccessProps> = ({
  onOpenReferral,
  onOpenSchedule,
  onOpenPremiumService,
}) => {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef, 0.5);

  const tiles: QuickTile[] = [
    {
      key: 'contracts',
      label: 'Contratos',
      hint: 'Escolar e Empresas',
      icon: 'description',
      onClick: () => navigate('/contrato'),
    },
    {
      key: 'referral',
      label: 'Traz o Mano',
      hint: 'Ganha 500 Kz',
      icon: 'redeem',
      onClick: onOpenReferral,
    },
    {
      key: 'schedule',
      label: 'Agendar',
      hint: 'Data e hora',
      icon: 'calendar_month',
      onClick: onOpenSchedule,
    },
    {
      key: 'post_ride',
      label: 'Pós-viagem',
      hint: 'Avaliação e recibo',
      icon: 'rate_review',
      onClick: () => navigate('/pos_viagem_review'),
    },
    {
      key: 'private_driver',
      label: 'Privado 24h',
      hint: 'Motorista dedicado',
      icon: 'shield_person',
      onClick: () => onOpenPremiumService('private_driver'),
    },
    {
      key: 'charter',
      label: 'Fretamento',
      hint: 'Viagens e vans',
      icon: 'directions_bus',
      onClick: () => onOpenPremiumService('charter'),
    },
    {
      key: 'cargo',
      label: 'Mercadorias',
      hint: 'Cargas e entregas',
      icon: 'inventory_2',
      onClick: () => onOpenPremiumService('cargo'),
    },
  ];

  return (
    <section className="liquid-glass-card rounded-[28px] p-5 relative overflow-hidden" data-purpose="quick-access">
      <span className="text-[9px] font-bold tracking-[0.26em] uppercase gold-gradient-text block">
        ACESSO RÁPIDO
      </span>
      <h2 className="font-serif text-[19px] text-white font-normal mt-0.5 mb-3.5">
        Tudo que precisas, rápido e fácil
      </h2>
      <div className="zr-scroll-hint">
        <div
          ref={scrollRef}
          className="zr-scroll-x flex items-center space-x-2.5 overflow-x-auto pb-2 scrollbar-none"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className="liquid-glass-subcard rounded-2xl p-2.5 flex flex-col items-center text-center justify-between min-w-[110px] min-h-[114px] flex-shrink-0 transition duration-200 hover:border-[#DDB658]/50 active:scale-95 group cursor-pointer"
              onClick={tile.onClick}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#2E2514] to-[#12110E] border-t border-[rgba(255,245,210,0.5)] border-[#DCB354]/40 flex items-center justify-center mt-0.5 shadow-md shadow-black">
                <span className="material-symbols-outlined text-[#F2D38A] text-[20px] group-hover:scale-110 transition" style={{ filter: 'drop-shadow(0 1px 3px rgba(210,165,50,0.5))' }}>{tile.icon}</span>
              </div>
              <div className="mt-1.5">
                <p className="text-[11.5px] font-semibold text-white leading-tight">{tile.label}</p>
                <p className="text-[8px] text-neutral-400 leading-snug mt-0.5">{tile.hint}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PassengerQuickAccess;
