import React, { useState } from 'react';
import { RideStatus } from '../../types';

type VehicleType = 'standard' | 'moto' | 'comfort' | 'xl';

interface RideRequestFormProps {
  rideStatus: RideStatus;
  fareData: any;
  routeData: any;
  priceTimer: number;
  isReady: boolean;
  searching: boolean;
  calculating: boolean;
  onCalculatePrice: () => void;
  onCallTaxi: () => void;
  onConfirmRideRequest: () => void;
  selectedVehicle?: VehicleType;
  onVehicleChange?: (v: VehicleType) => void;
}

const RideRequestForm: React.FC<RideRequestFormProps> = ({
  rideStatus,
  fareData,
  routeData,
  priceTimer,
  isReady,
  searching,
  calculating,
  onCalculatePrice,
  onCallTaxi,
  onConfirmRideRequest,
  selectedVehicle: initialVehicle = 'standard',
  onVehicleChange,
}) => {
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>(initialVehicle);
  const [showMotoWarning, setShowMotoWarning] = useState(false);

  const handleVehicleChange = (type: VehicleType) => {
    if (type === 'moto' && selectedVehicle !== 'moto') {
      setShowMotoWarning(true);
      return;
    }
    setSelectedVehicle(type);
    onVehicleChange?.(type);
  };

  const vehicles = [
    { type: 'standard' as VehicleType, icon: '🚗', label: 'Táxi', priceNote: 'Normal' },
    { type: 'moto' as VehicleType, icon: '🏍️', label: 'Moto', priceNote: '-40%' },
    { type: 'comfort' as VehicleType, icon: '🚙', label: 'Comfort', priceNote: '+40%' },
    { type: 'xl' as VehicleType, icon: '🚐', label: 'XL', priceNote: '+80%' },
  ];

  const MOTO_SAFETY_WARNING = `Por favor, certifica-te de que:\n\n• Tens capacete disponível (obrigatório por lei)\n• A zona de partida e chegada é segura\n• Evita distâncias superiores a 20 km\n\nA Zenith recomenda moto-táxi apenas em percursos urbanos conhecidos.`;

  if (rideStatus !== RideStatus.IDLE) return null;

  return (
    <div className="space-y-4">
      {/* Selector de Tipo de Veículo */}
      <div className="grid grid-cols-4 gap-2">
        {vehicles.map(v => (
          <button
            key={v.type}
            onClick={() => handleVehicleChange(v.type)}
            className={`flex flex-col items-center py-3 rounded-2xl border transition-all ${
              selectedVehicle === v.type 
                ? 'border-primary bg-primary/10' 
                : 'border-white/10 bg-white/5'
            }`}
          >
            <span className="text-2xl">{v.icon}</span>
            <span className="text-[10px] font-bold mt-1">{v.label}</span>
            <span className="text-[9px] text-white/50">{v.priceNote}</span>
          </button>
        ))}
      </div>

      {/* Diálogo de aviso para Moto */}
      {showMotoWarning && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6">
          <div className="bg-[#1a1a1a] rounded-3xl p-6 max-w-sm">
            <p className="font-bold text-lg mb-3 text-yellow-400">⚠️ Aviso de Segurança</p>
            <p className="text-sm text-white/80 whitespace-pre-line mb-4">{MOTO_SAFETY_WARNING}</p>
            <div className="flex gap-3">
              <button onClick={() => { setSelectedVehicle('standard'); setShowMotoWarning(false); }}
                className="flex-1 py-3 border border-white/20 rounded-2xl text-sm font-bold">
                Cancelar
              </button>
              <button onClick={() => { setSelectedVehicle('moto'); onVehicleChange?.('moto'); setShowMotoWarning(false); }}
                className="flex-1 py-3 bg-yellow-500 text-black rounded-2xl text-sm font-bold">
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card de preço Engine Pro (aparece após calcular) */}
      {fareData && (
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{
            background: 'linear-gradient(135deg, #0E0E0E 0%, #1A1600 100%)',
            border: '1px solid rgba(230,195,100,0.3)',
          }}
        >
          {/* Preço principal + Countdown */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'rgba(230,195,100,0.5)' }}>
                Preço estimado
              </p>
              <p className="text-3xl font-black mt-1" style={{ color: '#E6C364' }}>
                {Number(fareData.fare_kz).toLocaleString('pt-AO')} Kz
              </p>
            </div>
            {priceTimer > 0 && (
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'rgba(230,195,100,0.4)' }}>
                  Preço bloqueado
                </p>
                <p className="text-sm font-mono font-bold" style={{ color: 'rgba(230,195,100,0.7)' }}>
                  {Math.floor(priceTimer / 60)}:{String(priceTimer % 60).padStart(2, '0')}
                </p>
              </div>
            )}
          </div>

          {/* Badges dinâmicos */}
          {fareData.badges && (fareData.badges as string[]).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(fareData.badges as string[]).map((badge: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider"
                  style={{ background: 'rgba(230,195,100,0.12)', border: '1px solid rgba(230,195,100,0.3)', color: '#E6C364' }}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          {/* Detalhes da rota */}
          {routeData && (
            <div className="flex gap-4 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
              <div>
                <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'rgba(230,195,100,0.4)' }}>Distância</p>
                <p className="text-xs font-black text-white">{routeData.distanceKm.toFixed(1)} km</p>
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'rgba(230,195,100,0.4)' }}>Tempo</p>
                <p className="text-xs font-black text-white">~{Math.round(routeData.durationMin)} min</p>
              </div>
              {routeData.trafficFactor > 1.3 && (
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'rgba(230,195,100,0.4)' }}>Trânsito</p>
                  <p className="text-xs font-black" style={{ color: '#ff6b35' }}>Intenso</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Botão principal — fluxo dinâmico */}
      {!fareData ? (
        // Botao para calcular o preço via Engine Pro
        <button
          onClick={isReady ? onCalculatePrice : onCallTaxi}
          disabled={searching || calculating}
          className={`w-full py-6 rounded-[2.5rem] font-black text-lg uppercase shadow-2xl tracking-[0.15em] transition-all active:scale-98 disabled:opacity-50 ${
            isReady
              ? 'bg-primary text-white shadow-[0_20px_50px_rgba(37,99,235,0.4)]'
              : 'bg-[#1a1a1a] text-white border border-white/10'
          }`}
        >
          {calculating ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              A calcular rota...
            </span>
          ) : searching ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              A localizar...
            </span>
          ) : isReady ? (
            <span className="flex items-center justify-center gap-3">
              💰 CALCULAR PREÇO
            </span>
          ) : 'CHAMAR TÁXI'}
        </button>
      ) : (
        // Botão de pedir corrida com preço confirmado
        <button
          onClick={onConfirmRideRequest}
          disabled={priceTimer === 0}
          className="w-full py-6 rounded-[2.5rem] font-black text-lg uppercase shadow-2xl tracking-[0.15em] transition-all active:scale-98 disabled:opacity-40"
          style={{ background: '#E6C364', color: '#050505', boxShadow: '0 20px 50px rgba(230,195,100,0.35)' }}
        >
          🚖 PEDIR CORRIDA — {Number(fareData.fare_kz).toLocaleString('pt-AO')} Kz
        </button>
      )}
    </div>
  );
};

export default RideRequestForm;
