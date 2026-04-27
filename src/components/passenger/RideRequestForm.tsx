import React, { useEffect, useState } from 'react';
import type { ServiceType } from '../../types';
import { RideStatus } from '../../types';
import ServiceCarousel from './ServiceCarousel';

type VehicleType = Extract<ServiceType, 'standard' | 'moto' | 'comfort' | 'xl'>;
type PremiumServiceType = Extract<ServiceType, 'private_driver' | 'charter' | 'cargo'>;

interface RideRequestFormProps {
  rideStatus: RideStatus;
  fareData: any;
  routeData: any;
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
  const finalFare = baseFare + (hasInsurance ? MOTO_INSURANCE_PRICE : 0);

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
    <div className="space-y-4">
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
        <div
          className="space-y-3 rounded-2xl p-5"
          style={{
            background: 'linear-gradient(135deg, #0E0E0E 0%, #1A1600 100%)',
            border: '1px solid rgba(230,195,100,0.3)',
          }}
        >
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(230,195,100,0.5)' }}>
                Preco estimado
              </p>
              <p className="mt-1 text-3xl font-black" style={{ color: '#E6C364' }}>
                {finalFare.toLocaleString('pt-AO')} Kz
              </p>
            </div>
            {timeLeft > 0 && (
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(230,195,100,0.4)' }}>
                  Preco bloqueado
                </p>
                <p className="text-sm font-mono font-bold" style={{ color: 'rgba(230,195,100,0.7)' }}>
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </p>
              </div>
            )}
          </div>

          {fareData.badges && (fareData.badges as string[]).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(fareData.badges as string[]).map((badge: string, index: number) => (
                <span
                  key={`${badge}-${index}`}
                  className="rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider"
                  style={{
                    background: 'rgba(230,195,100,0.12)',
                    border: '1px solid rgba(230,195,100,0.3)',
                    color: '#E6C364',
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          <div
            onClick={() => setHasInsurance((value) => !value)}
            className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-all ${
              hasInsurance
                ? 'border-primary bg-primary/10'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${hasInsurance ? 'border-primary bg-primary' : 'border-white/30'}`}>
                {hasInsurance && <span className="text-[10px] font-black text-white">OK</span>}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black leading-tight text-white">Seguro Zenith Basic</span>
                <span className="text-[9px] font-bold leading-tight text-white/50">Proteccao em viagem</span>
              </div>
            </div>
            <span className="text-xs font-black text-primary">+50 Kz</span>
          </div>

          {routeData && (
            <div className="flex gap-4 border-t pt-2" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <MetricBlock label="Distancia" value={`${routeData.distanceKm.toFixed(1)} km`} />
              <MetricBlock label="Tempo" value={`~${Math.round(routeData.durationMin)} min`} />
              {routeData.trafficFactor > 1.3 && (
                <MetricBlock label="Trafego" value="Intenso" tone="#ff6b35" />
              )}
            </div>
          )}
        </div>
      )}

      {!fareData ? (
        <button
          onClick={isReady ? onCalculatePrice : onCallTaxi}
          disabled={searching || calculating}
          className={`w-full rounded-[2.5rem] py-6 text-lg font-black uppercase tracking-[0.15em] shadow-2xl transition-all active:scale-98 disabled:opacity-50 ${
            isReady
              ? 'bg-primary text-white shadow-[0_20px_50px_rgba(37,99,235,0.4)]'
              : 'border border-white/10 bg-[#1a1a1a] text-white'
          }`}
        >
          {calculating ? (
            <span className="flex items-center justify-center gap-3">
              <span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              A calcular rota...
            </span>
          ) : searching ? (
            <span className="flex items-center justify-center gap-3">
              <span className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              A localizar...
            </span>
          ) : isReady ? (
            'CALCULAR PRECO'
          ) : (
            'CHAMAR TAXI'
          )}
        </button>
      ) : (
        <div className="space-y-3">
          <button
            onClick={() => onConfirmRideRequest(finalFare)}
            disabled={timeLeft === 0}
            className="w-full rounded-[2.5rem] py-6 text-lg font-black uppercase tracking-[0.15em] shadow-2xl transition-all active:scale-98 disabled:opacity-40"
            style={{ background: '#E6C364', color: '#050505', boxShadow: '0 20px 50px rgba(230,195,100,0.35)' }}
          >
            PEDIR CORRIDA - {finalFare.toLocaleString('pt-AO')} Kz
          </button>

          {!showNegotiate ? (
            <button
              onClick={() => {
                setShowNegotiate(true);
                setProposedPrice(String(Math.round(baseFare * 0.85) + (hasInsurance ? MOTO_INSURANCE_PRICE : 0)));
              }}
              className="w-full rounded-2xl border-2 border-dashed py-4 text-[11px] font-black uppercase tracking-widest transition-all active:scale-98"
              style={{
                borderColor: 'rgba(230,195,100,0.4)',
                color: '#E6C364',
                background: 'rgba(230,195,100,0.05)',
              }}
            >
              Podemos negociar?
            </button>
          ) : (
            <div
              className="space-y-3 rounded-2xl p-4"
              style={{ background: 'rgba(230,195,100,0.08)', border: '1px solid rgba(230,195,100,0.25)' }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#E6C364' }}>
                  A tua proposta
                </p>
                <button onClick={() => setShowNegotiate(false)} className="text-[9px] font-black uppercase text-white/40">
                  Fechar
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={proposedPrice}
                    onChange={(event) => setProposedPrice(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-xl font-black text-white outline-none focus:border-[#E6C364]/50"
                    placeholder="0"
                    min={100}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/40">Kz</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[0.8, 0.85, 0.9, 0.95].map((pct) => {
                  const value = Math.round(baseFare * pct) + (hasInsurance ? MOTO_INSURANCE_PRICE : 0);
                  return (
                    <button
                      key={pct}
                      onClick={() => setProposedPrice(String(value))}
                      className={`flex-1 rounded-lg py-2 text-[9px] font-black transition-all ${
                        proposedPrice === String(value)
                          ? 'bg-[#E6C364] text-black'
                          : 'bg-white/5 text-white/50'
                      }`}
                    >
                      -{Math.round((1 - pct) * 100)}%
                    </button>
                  );
                })}
              </div>
              <p className="text-center text-[8px] font-bold text-white/30">
                Motoristas proximos vao ver a tua proposta e decidir se aceitam.
              </p>
              <button
                onClick={() => {
                  const value = parseInt(proposedPrice, 10);
                  if (!Number.isNaN(value) && value >= 100) {
                    onNegotiate?.(value);
                    setShowNegotiate(false);
                  }
                }}
                disabled={!proposedPrice || parseInt(proposedPrice, 10) < 100}
                className="w-full rounded-2xl py-4 text-sm font-black uppercase tracking-widest transition-all active:scale-98 disabled:opacity-40"
                style={{ background: '#E6C364', color: '#050505' }}
              >
                LANCAR PROPOSTA - {proposedPrice ? parseInt(proposedPrice, 10).toLocaleString('pt-AO') : '0'} Kz
              </button>
            </div>
          )}
        </div>
      )}
    </div>
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
