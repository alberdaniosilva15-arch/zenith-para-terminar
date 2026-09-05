import React, { useEffect, useState, useRef } from 'react';
import type { RouteResult } from '../../services/routeService';
import type { FareEstimate, ServiceType } from '../../types';
import { RideStatus } from '../../types';
import { useAutoScroll } from '../../hooks/useAutoScroll';

type VehicleType = Extract<ServiceType, 'standard' | 'moto' | 'comfort' | 'xl'>;
type PremiumServiceType = Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;

interface ServiceCapsuleItem {
  id: VehicleType | PremiumServiceType;
  type: 'standard' | 'premium';
  title: string;
  subtitle: string;
  icon: string;
  badge?: string;
}

const ALL_SERVICES: ServiceCapsuleItem[] = [
  { id: 'standard', type: 'standard', title: 'Taxi', subtitle: 'Imediato', icon: 'local_taxi' },
  { id: 'moto', type: 'standard', title: 'Moto', subtitle: 'Ágil', icon: 'two_wheeler' },
  { id: 'comfort', type: 'standard', title: 'Comfort', subtitle: 'Mais espaço', icon: 'directions_car', badge: '1' },
  { id: 'xl', type: 'standard', title: 'XL', subtitle: 'Até 6 pess.', icon: 'airport_shuttle' },
  { id: 'private_driver', type: 'premium', title: 'Privado 24h', subtitle: 'Dedicado', icon: 'shield_person' },
  { id: 'charter', type: 'premium', title: 'Fretamento', subtitle: 'Viagens', icon: 'directions_bus' },
  { id: 'cargo', type: 'premium', title: 'Mercadorias', subtitle: 'Cargas', icon: 'inventory_2' },
];

interface RideRequestFormProps {
  rideStatus: RideStatus;
  fareData: FareEstimate | null;
  routeData: RouteResult | null;
  fareExpiresAt: number | null;
  onFareExpire: () => void;
  isReady: boolean;
  searching: boolean;
  calculating: boolean;
  onCalculatePrice: () => void;
  onCallTaxi: () => void;
  onConfirmRideRequest: (finalPriceKz: number) => void;
  onNegotiate?: (proposedPrice: number) => void;
  selectedVehicle?: VehicleType;
  onVehicleChange?: (vehicle: VehicleType) => void;
  onOpenService?: (service: PremiumServiceType) => void;
}

const MOTO_INSURANCE_PRICE = 50;
const MOTO_SAFETY_WARNING = `Por favor, certifica-te de que:

- Tens capacete disponivel (obrigatorio por lei)
- A zona de partida e chegada e segura
- Evita distancias superiores a 20 km

A Zenith recomenda moto-taxi apenas em percursos urbanos conhecidos.`;

const RideRequestForm: React.FC<RideRequestFormProps> = ({
  rideStatus,
  fareData,
  routeData,
  fareExpiresAt,
  onFareExpire,
  isReady,
  searching,
  calculating,
  onCalculatePrice,
  onCallTaxi,
  onConfirmRideRequest,
  onNegotiate,
  selectedVehicle: controlledVehicle,
  onVehicleChange,
  onOpenService,
}) => {
  const [localVehicle, setLocalVehicle] = useState<VehicleType>(controlledVehicle ?? 'standard');
  const [showNegotiate, setShowNegotiate] = useState(false);
  const [proposedPrice, setProposedPrice] = useState('');
  const [showMotoWarning, setShowMotoWarning] = useState(false);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef, 0.45);

  const selectedVehicle = controlledVehicle ?? localVehicle;

  useEffect(() => {
    if (controlledVehicle) {
      setLocalVehicle(controlledVehicle);
    }
  }, [controlledVehicle]);

  useEffect(() => {
    if (!fareExpiresAt) {
      setTimeLeft(0);
      return;
    }

    const calculateTimeLeft = () => Math.max(0, Math.floor((fareExpiresAt - Date.now()) / 1000));
    setTimeLeft(calculateTimeLeft());

    const interval = window.setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining === 0) {
        window.clearInterval(interval);
        onFareExpire();
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [fareExpiresAt, onFareExpire]);

  const baseFare = fareData ? Number(fareData.fare_kz) : 0;
  const scoreDiscount = fareData?.score_discount ?? null;
  const discountedBaseFare = scoreDiscount?.final_price ?? baseFare;
  const originalBaseFare = scoreDiscount?.original_price ?? baseFare;
  const hasScoreDiscount = (scoreDiscount?.discount_pct ?? 0) > 0;
  const insurancePrice = hasInsurance ? MOTO_INSURANCE_PRICE : 0;
  const originalTotal = originalBaseFare + insurancePrice;
  const finalFare = discountedBaseFare + insurancePrice;

  const commitVehicleChange = (vehicle: VehicleType) => {
    setLocalVehicle(vehicle);
    onVehicleChange?.(vehicle);
  };

  const handleVehicleChange = (vehicle: VehicleType) => {
    if (vehicle === 'moto' && selectedVehicle !== 'moto') {
      setShowMotoWarning(true);
      return;
    }

    commitVehicleChange(vehicle);
  };

  if (rideStatus !== RideStatus.IDLE) {
    return null;
  }

  return (
    <section className="liquid-glass-card rounded-[28px] p-5 relative overflow-hidden transition-all duration-300" data-purpose="ride-request">
      {/* Real Luxury Car Hero Background Layer */}
      <div className="car-backdrop-container" aria-hidden="true">
        <img 
          src="/zenith-car-hero.jpeg" 
          alt="Zenith Luxury Sedan" 
          className="car-backdrop-img"
        />
        <div className="car-backdrop-gradient-left"></div>
        <div className="car-backdrop-gradient-bottom"></div>
        <div className="absolute left-[38%] top-[42%] w-24 h-16 bg-[#FFE28A]/20 blur-xl rounded-full pointer-events-none"></div>
      </div>

      {/* Header: Title & Text */}
      <div className="relative z-10 flex items-start justify-between pb-8">
        <div>
          <span className="text-[9px] font-bold tracking-[0.26em] uppercase gold-gradient-text block">
            PEDIDO DE CORRIDA
          </span>
          <h2 className="font-serif text-[22px] text-white font-normal mt-1 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            Para onde vamos?
          </h2>
        </div>
        {timeLeft > 0 && (
          <span className="liquid-glass-subcard text-[10px] font-bold text-[#E2C37A] px-3 py-1 rounded-full border border-[#DDB658]/40">
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Vehicle Selection Carousel with Auto-Scroll */}
      <div className="zr-scroll-hint relative z-10 mt-2">
        <div
          ref={scrollRef}
          className="zr-scroll-x flex items-center space-x-2.5 overflow-x-auto pb-1.5 scrollbar-none"
          style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}
        >
          {ALL_SERVICES.map((s) => {
            const isActive = s.type === 'standard' && selectedVehicle === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (s.type === 'standard') {
                    handleVehicleChange(s.id as VehicleType);
                  } else {
                    onOpenService?.(s.id as PremiumServiceType);
                  }
                }}
                className={`flex-shrink-0 min-w-[110px] rounded-2xl p-2.5 flex flex-col justify-between text-left transition duration-200 transform active:scale-95 overflow-hidden ${
                  isActive
                    ? 'liquid-glass-subcard-active'
                    : 'liquid-glass-subcard opacity-85 hover:opacity-100 hover:border-[#DDB658]/40'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 relative ${
                      isActive
                        ? 'bg-black/40 border border-[#F5DEB3]/40 text-[#F5DE9E]'
                        : s.type === 'premium'
                        ? 'bg-[#2E2514]/60 border border-[#DDB658]/40 text-[#F5DE9E]'
                        : 'bg-white/[0.04] border border-white/10 text-neutral-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                    {s.badge && (
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#DDB658] text-[8px] font-black text-black flex items-center justify-center shadow">
                        {s.badge}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className={`text-xs font-bold leading-tight ${isActive ? 'text-white' : s.type === 'premium' ? 'text-[#F5DE9E]' : 'text-neutral-200'}`}>
                      {s.title}
                    </p>
                    <p className={`text-[8.5px] leading-tight mt-0.5 ${isActive ? 'text-[#F3DE9E] font-medium' : 'text-neutral-400'}`}>
                      {s.subtitle}
                    </p>
                  </div>
                </div>
                {isActive && (
                  <div className="w-8 h-[2px] bg-[#E8C268] rounded-full mx-auto mt-2 shadow-[0_0_6px_rgba(232,194,104,0.8)]" />
                )}
                {isActive && (
                  <div aria-hidden="true" className="sheen-overlay" style={{ animationDuration: '4.5s' }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Moto Safety Warning Modal - Liquid Glass */}
      {showMotoWarning && (
        <div className="fixed inset-0 z-[700] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[32px] p-6 max-w-sm w-full border-t-white/40 border-[#DDB658]/40 shadow-2xl relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 rounded-2xl liquid-glass-subcard border-t-[rgba(255,245,210,0.5)] border-[#DDB658]/40 flex items-center justify-center shadow-lg shadow-black/80">
                <span className="material-symbols-outlined text-[#F0D082] text-2xl filter drop-shadow-[0_2px_4px_rgba(220,175,60,0.45)]">
                  sports_motorsports
                </span>
              </div>
              <div>
                <span className="text-[8.5px] font-bold tracking-[0.24em] uppercase gold-gradient-text block">
                  SEGURANÇA EM PRIMEIRO LUGAR
                </span>
                <h3 className="font-serif text-[19px] text-white font-semibold leading-tight mt-0.5">
                  Aviso de Segurança
                </h3>
              </div>
            </div>

            {/* Checklist */}
            <div className="space-y-2.5 my-4">
              <div className="liquid-glass-subcard rounded-xl p-3 flex items-start space-x-2.5">
                <span className="material-symbols-outlined text-[#F5DE9E] text-base mt-0.5 flex-shrink-0">check_circle</span>
                <p className="text-xs text-neutral-200 leading-relaxed">
                  <strong className="text-white">Capacete obrigatório:</strong> Certifica-te de que tens capacete disponível (exigido por lei).
                </p>
              </div>
              <div className="liquid-glass-subcard rounded-xl p-3 flex items-start space-x-2.5">
                <span className="material-symbols-outlined text-[#F5DE9E] text-base mt-0.5 flex-shrink-0">location_on</span>
                <p className="text-xs text-neutral-200 leading-relaxed">
                  <strong className="text-white">Zonas seguras:</strong> Confirma se o ponto de partida e chegada estão em área iluminada.
                </p>
              </div>
              <div className="liquid-glass-subcard rounded-xl p-3 flex items-start space-x-2.5">
                <span className="material-symbols-outlined text-[#F5DE9E] text-base mt-0.5 flex-shrink-0">speed</span>
                <p className="text-xs text-neutral-200 leading-relaxed">
                  <strong className="text-white">Distância recomendada:</strong> Evita trajectos intermunicipais ou superiores a 20 km.
                </p>
              </div>
            </div>

            <p className="text-[11px] text-neutral-400 italic mb-5 leading-relaxed">
              A Zenith recomenda moto-táxi apenas em percursos urbanos conhecidos e com trânsito moderado.
            </p>

            {/* Modal Buttons */}
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => {
                  commitVehicleChange('standard');
                  setShowMotoWarning(false);
                }}
                className="liquid-glass-subcard flex-1 py-3.5 rounded-full text-xs font-bold text-neutral-300 hover:text-white transition active:scale-95 text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  commitVehicleChange('moto');
                  setShowMotoWarning(false);
                }}
                className="champagne-gold-cta flex-1 py-3.5 rounded-full text-xs font-extrabold text-[#161208] transition active:scale-95 text-center"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fare Data Display */}
      {fareData && (
        <div className="relative z-10 grid grid-cols-2 gap-2 mt-4">
          <div className="liquid-glass-subcard rounded-2xl p-3">
            <p className="text-[9px] font-bold tracking-[0.2em] uppercase gold-gradient-text">Preço estimado</p>
            <h3 className="text-lg font-bold text-white mt-1">{finalFare.toLocaleString('pt-AO')} Kz</h3>
            {hasScoreDiscount && (
              <p className="text-[10px] text-neutral-400 line-through">
                {originalTotal.toLocaleString('pt-AO')} Kz
              </p>
            )}
            {hasScoreDiscount && scoreDiscount?.discount_label && (
              <p className="text-[10px] text-[#E8C268] mt-0.5">
                -{scoreDiscount.discount_pct}% {scoreDiscount.discount_label}
              </p>
            )}
            {routeData && (
              <p className="text-[10px] text-neutral-400 mt-1">
                {routeData.distanceKm.toFixed(1)} km · {routeData.trafficFactor > 1.3 ? 'tráfego intenso' : 'tráfego leve'}
              </p>
            )}
          </div>
          <div className="liquid-glass-subcard rounded-2xl p-3">
            <p className="text-[9px] font-bold tracking-[0.2em] uppercase gold-gradient-text">Pagamento</p>
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-[9px] font-semibold text-[#E8C268] bg-[#E8C268]/10 px-2 py-0.5 rounded-full border border-[#DDB658]/30">Saldo Zenith</span>
              <span className="text-[9px] font-semibold text-neutral-300 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">Cash</span>
              <span className="text-[9px] font-semibold text-neutral-300 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">Multicaixa</span>
            </div>
            <button
              onClick={() => setHasInsurance((value) => !value)}
              className="mt-2 w-full flex items-center justify-between text-[10px] px-2 py-1 rounded-full border transition"
              style={{ borderColor: hasInsurance ? '#DDB658' : 'rgba(255,255,255,0.1)', background: hasInsurance ? 'rgba(221,182,88,0.08)' : 'transparent' }}
            >
              <span className="text-neutral-200">Seguro Zenith {hasInsurance && '✓'}</span>
              <span className="text-[#E8C268] font-bold">+50 Kz</span>
            </button>
          </div>
        </div>
      )}

      {/* CTA Button */}
      {!fareData && (
        <button
          type="button"
          onClick={isReady ? onCalculatePrice : onCallTaxi}
          disabled={searching || calculating}
          className="champagne-gold-cta w-full mt-4 py-3.5 px-6 rounded-full flex items-center justify-between transition-transform active:scale-[0.98] relative z-10 cursor-pointer shadow-lg"
          data-purpose="primary-order-cta"
        >
          <span className="w-7"></span>
          <span className="font-extrabold tracking-[0.16em] text-[13.5px] text-[#161208] drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]">
            {calculating ? 'A CALCULAR ROTA...' : searching ? 'A LOCALIZAR...' : isReady ? 'CALCULAR PREÇO' : 'CHAMAR TÁXI'}
          </span>
          <span className="w-7 h-7 rounded-full bg-[#181308]/90 text-[#F5DEB3] flex items-center justify-center shadow-md border border-[#FBE096]/40 flex-shrink-0">
            <svg className="w-3.5 h-3.5 fill-none stroke-current" strokeWidth="2.6" viewBox="0 0 24 24">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
          </span>
          <div aria-hidden="true" className="sheen-overlay"></div>
        </button>
      )}

      {/* Negotiation Section */}
      {fareData && (
        <div className="relative z-10 liquid-glass-subcard rounded-2xl p-3 mt-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[9px] font-bold tracking-[0.2em] uppercase gold-gradient-text">Negociação</p>
              <p className="text-[10px] text-neutral-400 mt-1">
                {!showNegotiate
                  ? "Podes propor um preço aos motoristas próximos."
                  : `A tua proposta: ${proposedPrice || '0'} Kz`
                }
              </p>
            </div>
            {hasScoreDiscount && <span className="text-[9px] font-bold text-[#E8C268] bg-[#E8C268]/10 px-2 py-0.5 rounded-full border border-[#DDB658]/30">-{scoreDiscount?.discount_pct}%</span>}
          </div>

          {!showNegotiate ? (
            <div className="flex gap-2 mt-3">
              <button
                className="champagne-gold-cta flex-1 py-2.5 rounded-full text-[11px] font-extrabold tracking-widest text-[#161208] text-center relative overflow-hidden"
                onClick={() => onConfirmRideRequest(finalFare)}
                disabled={timeLeft === 0}
              >
                PEDIR CORRIDA
                <div aria-hidden="true" className="sheen-overlay"></div>
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-[11px] font-bold text-neutral-300 border border-white/10 hover:border-[#DDB658]/30 transition"
                onClick={() => {
                  setShowNegotiate(true);
                  setProposedPrice(String(Math.round(discountedBaseFare * 0.85) + insurancePrice));
                }}
              >
                Lançar proposta
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '14px' }}>
              <div className="flex gap-2 mb-3">
                <input
                  type="number"
                  value={proposedPrice}
                  onChange={(event) => setProposedPrice(event.target.value)}
                  className="flex-1 text-center text-lg font-bold bg-black/40 border border-white/10 rounded-xl text-white px-3 py-2 focus:border-[#DDB658]/50 outline-none transition"
                  placeholder="0 Kz"
                />
              </div>
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {[0.8, 0.85, 0.9, 0.95].map((pct) => {
                  const value = Math.round(discountedBaseFare * pct) + insurancePrice;
                  const isActive = proposedPrice === String(value);
                  return (
                    <button
                      key={pct}
                      onClick={() => setProposedPrice(String(value))}
                      className={`text-[10px] font-bold py-1.5 rounded-full border transition ${
                        isActive
                          ? 'bg-[#DDB658] text-[#161208] border-[#DDB658]'
                          : 'text-[#E8C268] border-[#DDB658]/20 hover:border-[#DDB658]/40'
                      }`}
                    >
                      -{Math.round((1 - pct) * 100)}%
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const value = parseInt(proposedPrice, 10);
                    if (!Number.isNaN(value) && value >= 100) {
                      onNegotiate?.(value);
                      setShowNegotiate(false);
                    }
                  }}
                  disabled={!proposedPrice || parseInt(proposedPrice, 10) < 100}
                  className="champagne-gold-cta flex-1 py-2.5 rounded-full text-[11px] font-extrabold tracking-widest text-[#161208] text-center relative overflow-hidden disabled:opacity-50"
                >
                  LANÇAR {proposedPrice} KZ
                </button>
                <button
                  className="px-4 py-2.5 rounded-full text-[11px] font-bold text-neutral-400 border border-white/10 hover:border-white/20 transition"
                  onClick={() => setShowNegotiate(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

function MetricBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'rgba(230,195,100,0.4)' }}>
        {label}
      </p>
      <p className="text-xs font-black text-white" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  );
}

export default RideRequestForm;
