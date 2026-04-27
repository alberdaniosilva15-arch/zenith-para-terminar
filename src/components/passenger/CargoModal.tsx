import React, { useEffect, useMemo, useState } from 'react';
import { premiumService } from '../../services/premiumService';

interface CargoModalProps {
  userId: string;
  pickupName: string;
  destName: string;
  pickupCoords?: { lat: number; lng: number } | null;
  destCoords?: { lat: number; lng: number } | null;
  onClose: () => void;
}

type CargoType = 'light' | 'medium' | 'heavy';
type Urgency = 'normal' | 'express';

export default function CargoModal({
  userId,
  pickupName,
  destName,
  pickupCoords,
  destCoords,
  onClose,
}: CargoModalProps) {
  const [cargoType, setCargoType] = useState<CargoType>('light');
  const [needsHelpers, setNeedsHelpers] = useState(false);
  const [helperCount, setHelperCount] = useState(1);
  const [pickupAddress, setPickupAddress] = useState(pickupName);
  const [destAddress, setDestAddress] = useState(destName);
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [weightKg, setWeightKg] = useState(50);
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [quote, setQuote] = useState(0);

  const estimatedDistanceKm = useMemo(() => {
    if (!pickupCoords || !destCoords) {
      return 8;
    }

    const dx = pickupCoords.lat - destCoords.lat;
    const dy = pickupCoords.lng - destCoords.lng;
    return Math.max(Math.sqrt(dx * dx + dy * dy) * 111, 8);
  }, [destCoords, pickupCoords]);

  useEffect(() => {
    premiumService.estimateCargoPrice({
      weightKg,
      helperCount: needsHelpers ? helperCount : 0,
      estimatedDistanceKm,
      urgency,
    }).then((result) => setQuote(result?.totalKz ?? 0));
  }, [estimatedDistanceKm, helperCount, needsHelpers, urgency, weightKg]);

  const handleSubmit = async () => {
    setLoading(true);
    const booking = await premiumService.createCargoBooking({
      userId,
      pickupAddress: pickupAddress || 'Pickup a confirmar',
      pickupLat: pickupCoords?.lat ?? null,
      pickupLng: pickupCoords?.lng ?? null,
      destAddress: destAddress || 'Destino a confirmar',
      destLat: destCoords?.lat ?? null,
      destLng: destCoords?.lng ?? null,
      cargoType,
      needsHelpers,
      helperCount: needsHelpers ? helperCount : 0,
      estimatedWeightKg: weightKg,
      urgency,
      specialInstructions: instructions || null,
      estimatedDistanceKm,
      notes: `Cargo ${cargoType} · ${urgency}`,
      notifyMe: true,
    });
    setLoading(false);

    if (booking) {
      setSuccess('Interesse registado. Vais entrar na lista de arranque do serviço de mercadorias Zenith.');
    }
  };

  return (
    <div className="fixed inset-0 z-[160] bg-black/85 p-4 backdrop-blur-md">
      <div
        className="mx-auto flex h-full w-full max-w-xl flex-col overflow-hidden rounded-[2.5rem] border"
        style={{
          background: 'linear-gradient(180deg, #0B0B0B 0%, #15130B 100%)',
          borderColor: 'rgba(230,195,100,0.18)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-start justify-between border-b border-white/10 p-6 text-white">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#E6C364]/75">Industrial premium</p>
            <h2 className="mt-2 text-xl font-black">Mercadorias Zenith</h2>
            <p className="mt-1 text-[11px] font-bold text-white/60">
              Visual premium, arranque controlado. Capturamos a procura antes da operação entrar em tempo real.
            </p>
          </div>
          <button onClick={onClose} className="h-10 w-10 rounded-full bg-white/5 text-white/55">
            x
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-white">
          {success && (
            <div className="rounded-[1.75rem] border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm font-bold text-emerald-100">
              {success}
            </div>
          )}

          <section className="space-y-3">
            <SectionTitle title="1. Tipo de carga" />
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'light', label: 'Leve <50kg' },
                { id: 'medium', label: 'Media 50-200kg' },
                { id: 'heavy', label: 'Pesada >200kg' },
              ].map((item) => (
                <OptionCard
                  key={item.id}
                  active={cargoType === item.id}
                  onClick={() => setCargoType(item.id as CargoType)}
                >
                  {item.label}
                </OptionCard>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle title="2. Ajudantes" />
            <label className="flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4">
              <div>
                <p className="text-sm font-black text-white">Precisa de ajudantes?</p>
                <p className="text-[10px] font-bold text-white/50">Cada ajudante acrescenta custo operacional fixo</p>
              </div>
              <button
                type="button"
                onClick={() => setNeedsHelpers((value) => !value)}
                className={`h-8 w-14 rounded-full transition-all ${needsHelpers ? 'bg-[#E6C364]' : 'bg-white/10'}`}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-white transition-all ${needsHelpers ? 'translate-x-7' : 'translate-x-1'}`}
                />
              </button>
            </label>
            {needsHelpers && (
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map((count) => (
                  <OptionCard key={count} active={helperCount === count} onClick={() => setHelperCount(count)}>
                    {count} ajudante{count === 1 ? '' : 's'}
                  </OptionCard>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle title="3. Pickup e destino" />
            <input
              value={pickupAddress}
              onChange={(event) => setPickupAddress(event.target.value)}
              placeholder="Local de recolha"
              className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none focus:border-[#E6C364]/40"
            />
            <input
              value={destAddress}
              onChange={(event) => setDestAddress(event.target.value)}
              placeholder="Destino"
              className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none focus:border-[#E6C364]/40"
            />
          </section>

          <section className="space-y-3">
            <SectionTitle title="4. Urgencia e peso" />
            <div className="grid grid-cols-2 gap-3">
              <OptionCard active={urgency === 'normal'} onClick={() => setUrgency('normal')}>
                Normal
              </OptionCard>
              <OptionCard active={urgency === 'express'} onClick={() => setUrgency('express')}>
                Express +30%
              </OptionCard>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-white">Peso estimado</p>
                <p className="text-sm font-black text-[#E6C364]">{weightKg} kg</p>
              </div>
              <input
                type="range"
                min={10}
                max={500}
                step={10}
                value={weightKg}
                onChange={(event) => setWeightKg(Number(event.target.value))}
                className="mt-4 w-full accent-[#E6C364]"
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle title="5. Estimativa" />
            <div className="rounded-[2rem] border border-[#E6C364]/20 bg-[#111111] p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#E6C364]/70">Estimativa de preço</p>
              <div className="mt-3 space-y-2 text-sm font-bold text-white/75">
                <p>Carga: {cargoType}</p>
                <p>Urgencia: {urgency}</p>
                <p>Ajudantes: {needsHelpers ? helperCount : 0}</p>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Preço previsto</p>
                  <p className="text-3xl font-black text-[#E6C364]">{Math.round(quote).toLocaleString('pt-AO')} Kz</p>
                </div>
                <div className="rounded-full bg-[#E6C364]/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#E6C364]">
                  Tracking depois
                </div>
              </div>
            </div>
          </section>

          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Instruções especiais, acesso ao edifício, fragilidade, contacto na entrega..."
            className="min-h-[110px] w-full rounded-[1.75rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none focus:border-[#E6C364]/40"
          />
        </div>

        <div className="border-t border-white/10 p-6">
          <button
            onClick={() => void handleSubmit()}
            disabled={loading || !!success}
            className="w-full rounded-[2rem] py-4 text-sm font-black uppercase tracking-[0.18em] text-black transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #E6C364, #C9A84C)',
              boxShadow: '0 20px 50px rgba(230,195,100,0.25)',
            }}
          >
            {loading ? 'A registar interesse...' : success ? 'Interesse registado' : 'Notificar-me'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">{title}</p>;
}

function OptionCard({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[1.5rem] border px-4 py-4 text-left text-sm font-black transition-all ${
        active ? 'border-[#E6C364]/35 bg-[#E6C364]/10 text-[#E6C364]' : 'border-white/10 bg-white/5 text-white'
      }`}
    >
      {children}
    </button>
  );
}
