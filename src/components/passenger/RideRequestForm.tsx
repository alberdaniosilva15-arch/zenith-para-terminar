import React, { useEffect, useState } from 'react';
import type { RouteResult } from '../../services/routeService';
import type { FareEstimate, ServiceType } from '../../types';
import { RideStatus } from '../../types';
import ServiceCarousel from './ServiceCarousel';

type VehicleType = Extract<ServiceType, 'standard' | 'moto' | 'comfort' | 'xl'>;
type PremiumServiceType = Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;

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
    <section className="zr-card zr-card--hero">
      <div className="zr-inline zr-inline--between">
        <div>
          <p className="zr-kicker">Pedido de corrida</p>
          <h2 className="zr-section-title">Pedido de corrida e negociacao</h2>
        </div>
        {timeLeft > 0 && (
          <span className="zr-chip zr-chip--warning">
            Preço bloqueado {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      <ServiceCarousel
        selectedVehicle={selectedVehicle}
        onSelectVehicle={handleVehicleChange}
        onOpenService={(service) => onOpenService?.(service)}
      />

      {showMotoWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-sm rounded-3xl bg-[#1a1a1a] p-6">
            <p className="mb-3 text-lg font-bold text-yellow-400">Aviso de seguranca</p>
            <p className="mb-4 whitespace-pre-line text-sm text-white/80">{MOTO_SAFETY_WARNING}</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  commitVehicleChange('standard');
                  setShowMotoWarning(false);
                }}
                className="flex-1 rounded-2xl border border-white/20 py-3 text-sm font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  commitVehicleChange('moto');
                  setShowMotoWarning(false);
                }}
                className="flex-1 rounded-2xl bg-yellow-500 py-3 text-sm font-bold text-black"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {fareData && (
        <div className="zr-grid zr-grid--2" style={{ marginTop: '14px' }}>
          <div className="zr-alert-box">
            <p className="zr-kicker">Preço estimado</p>
            <h3 className="zr-title zr-title--sm">{finalFare.toLocaleString('pt-AO')} Kz</h3>
            {hasScoreDiscount && (
              <p className="zr-copy" style={{ textDecoration: 'line-through', opacity: 0.5 }}>
                {originalTotal.toLocaleString('pt-AO')} Kz
              </p>
            )}
            {hasScoreDiscount && scoreDiscount?.discount_label && (
              <p className="zr-copy" style={{ color: 'var(--gold)' }}>
                -{scoreDiscount.discount_pct}% {scoreDiscount.discount_label}
              </p>
            )}
            {routeData && (
              <p className="zr-copy">Distância {routeData.distanceKm.toFixed(1)} km - tráfego {routeData.trafficFactor > 1.3 ? 'intenso' : 'leve'}</p>
            )}
          </div>
          <div className="zr-alert-box">
            <p className="zr-kicker">Pagamento</p>
            <div className="zr-inline" style={{ marginTop: '6px' }}>
              <span className="zr-chip zr-chip--gold">Saldo Zenith</span>
              <span className="zr-chip">Cash</span>
              <span className="zr-chip">Multicaixa</span>
            </div>
            
            <button
              onClick={() => setHasInsurance((value) => !value)}
              className="zr-chip"
              style={{ marginTop: '8px', width: '100%', justifyContent: 'space-between', borderColor: hasInsurance ? 'var(--primary)' : undefined }}
            >
              <span>Seguro Zenith {hasInsurance && '✓'}</span>
              <span style={{ color: 'var(--primary)' }}>+50 Kz</span>
            </button>
          </div>
        </div>
      )}

      {!fareData ? (
        <div style={{ marginTop: '14px' }}>
          <button
            onClick={isReady ? onCalculatePrice : onCallTaxi}
            disabled={searching || calculating}
            className={`zr-button zr-button--block ${isReady ? '' : 'zr-button--secondary'}`}
          >
            {calculating ? 'A calcular rota...' : searching ? 'A localizar...' : isReady ? 'Calcular Preço' : 'Chamar Táxi'}
          </button>
        </div>
      ) : (
        <div className="zr-card" style={{ marginTop: '14px', padding: '14px', background: 'rgba(230,195,100,0.08)' }}>
          <div className="zr-inline zr-inline--between">
            <div>
              <p className="zr-kicker">Negociação</p>
              <p className="zr-copy">
                {!showNegotiate
                  ? "Podes propor um preço aos motoristas próximos."
                  : `A tua proposta: ${proposedPrice || '0'} Kz`
                }
              </p>
            </div>
            {hasScoreDiscount && <span className="zr-chip zr-chip--gold">-{scoreDiscount?.discount_pct}%</span>}
          </div>

          {!showNegotiate ? (
            <div className="zr-inline" style={{ marginTop: '12px' }}>
              <button className="zr-button zr-button--sm animate-shimmer" onClick={() => onConfirmRideRequest(finalFare)} disabled={timeLeft === 0}>
                Pedir corrida
              </button>
              <button className="zr-button zr-button--sm zr-button--ghost" onClick={() => {
                setShowNegotiate(true);
                setProposedPrice(String(Math.round(discountedBaseFare * 0.85) + insurancePrice));
              }}>
                Lançar proposta
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '14px' }}>
              <div className="zr-inline" style={{ gap: '8px', marginBottom: '14px' }}>
                <input
                  type="number"
                  value={proposedPrice}
                  onChange={(event) => setProposedPrice(event.target.value)}
                  className="zr-input"
                  style={{ flex: 1, textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}
                  placeholder="0 Kz"
                />
              </div>
              <div className="zr-grid zr-grid--4" style={{ marginBottom: '14px' }}>
                {[0.8, 0.85, 0.9, 0.95].map((pct) => {
                  const value = Math.round(discountedBaseFare * pct) + insurancePrice;
                  return (
                    <button
                      key={pct}
                      onClick={() => setProposedPrice(String(value))}
                      className="zr-chip"
                      style={{ background: proposedPrice === String(value) ? 'var(--gold)' : 'transparent', color: proposedPrice === String(value) ? 'var(--bg)' : 'var(--gold)' }}
                    >
                      -{Math.round((1 - pct) * 100)}%
                    </button>
                  );
                })}
              </div>
              <div className="zr-inline">
                <button
                  onClick={() => {
                    const value = parseInt(proposedPrice, 10);
                    if (!Number.isNaN(value) && value >= 100) {
                      onNegotiate?.(value);
                      setShowNegotiate(false);
                    }
                  }}
                  disabled={!proposedPrice || parseInt(proposedPrice, 10) < 100}
                  className="zr-button zr-button--sm"
                >
                  Lançar {proposedPrice} Kz
                </button>
                <button className="zr-button zr-button--sm zr-button--ghost" onClick={() => setShowNegotiate(false)}>
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
