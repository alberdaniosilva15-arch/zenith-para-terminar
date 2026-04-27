import React, { useEffect, useMemo, useState } from 'react';
import { premiumService } from '../../services/premiumService';

interface PrivateDriverModalProps {
  userId: string;
  pickupName: string;
  destName: string;
  pickupCoords?: { lat: number; lng: number } | null;
  destCoords?: { lat: number; lng: number } | null;
  onClose: () => void;
}

type ReservationMode = 'hours' | 'full_day';
type VehicleClass = 'standard' | 'suv' | 'executive';

export default function PrivateDriverModal({
  userId,
  pickupName,
  destName,
  pickupCoords,
  destCoords,
  onClose,
}: PrivateDriverModalProps) {
  const [reservationMode, setReservationMode] = useState<ReservationMode>('hours');
  const [hours, setHours] = useState(2);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>('standard');
  const [scheduledAt, setScheduledAt] = useState('');
  const [favoriteDriverId, setFavoriteDriverId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [favoriteDrivers, setFavoriteDrivers] = useState<Array<{
    driver_id: string;
    driver_name: string;
    rating: number;
    total_rides: number;
  }>>([]);
  const [quote, setQuote] = useState<number>(0);

  const effectiveHours = reservationMode === 'full_day' ? 8 : Math.max(hours, 2);
  const estimatedDistanceKm = useMemo(() => {
    if (!pickupCoords || !destCoords) return 0;
    const dx = pickupCoords.lat - destCoords.lat;
    const dy = pickupCoords.lng - destCoords.lng;
    return Math.max(Math.sqrt(dx * dx + dy * dy) * 111, 4);
  }, [destCoords, pickupCoords]);

  useEffect(() => {
    premiumService.getFavoriteDrivers(userId).then(setFavoriteDrivers);
  }, [userId]);

  useEffect(() => {
    premiumService.estimatePrivateDriverPrice({
      hours: effectiveHours,
      estimatedDistanceKm,
    }).then((result) => setQuote(result?.totalKz ?? 0));
  }, [effectiveHours, estimatedDistanceKm, vehicleClass]);

  const handleSubmit = async () => {
    setLoading(true);
    const booking = await premiumService.createPrivateDriverBooking({
      userId,
      pickupAddress: pickupName || 'Origem a confirmar',
      pickupLat: pickupCoords?.lat ?? null,
      pickupLng: pickupCoords?.lng ?? null,
      destAddress: destName || 'Destino flexível',
      destLat: destCoords?.lat ?? null,
      destLng: destCoords?.lng ?? null,
      scheduledAt: scheduledAt || null,
      durationHours: effectiveHours,
      vehicleClass,
      notes: notes || null,
      favoriteDriverId: favoriteDriverId || null,
      notifyMe: true,
      estimatedDistanceKm,
    });
    setLoading(false);

    if (booking) {
      setSuccess('Interesse registado. Vais ser avisado assim que o Motorista Privado 24h abrir na Zenith.');
    }
  };

  return (
    <div className="fixed inset-0 z-[160] bg-black/85 p-4 backdrop-blur-md">
      <div
        className="mx-auto flex h-full w-full max-w-xl flex-col overflow-hidden rounded-[2.5rem] border"
        style={{
          background: 'linear-gradient(180deg, #0A0A0A 0%, #140f02 100%)',
          borderColor: 'rgba(230,195,100,0.2)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-start justify-between border-b border-white/10 p-6 text-white">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#E6C364]/75">Premium preview</p>
            <h2 className="mt-2 text-xl font-black">Motorista Privado 24h</h2>
            <p className="mt-1 text-[11px] font-bold text-white/60">
              Serviço premium com activação faseada. Regista-te primeiro e entra na fila de lançamento.
            </p>
          </div>
          <button onClick={onClose} className="h-10 w-10 rounded-full bg-white/5 text-white/55">
            ×
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6 text-white">
          {success && (
            <div className="rounded-[1.75rem] border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm font-bold text-emerald-100">
              {success}
            </div>
          )}

          <section className="space-y-3">
            <SectionTitle title="1. Tipo de reserva" />
            <div className="grid grid-cols-2 gap-3">
              <OptionCard active={reservationMode === 'hours'} onClick={() => setReservationMode('hours')}>
                Por horas
                <span className="block text-[10px] text-white/45">Mínimo 2h</span>
              </OptionCard>
              <OptionCard active={reservationMode === 'full_day'} onClick={() => setReservationMode('full_day')}>
                Dia inteiro
                <span className="block text-[10px] text-white/45">Pacote 8h</span>
              </OptionCard>
            </div>
            {reservationMode === 'hours' && (
              <input
                type="range"
                min={2}
                max={12}
                value={hours}
                onChange={(event) => setHours(Number(event.target.value))}
                className="w-full accent-[#E6C364]"
              />
            )}
          </section>

          <section className="space-y-3">
            <SectionTitle title="2. Classe do carro" />
            <div className="grid grid-cols-3 gap-3">
              {(['standard', 'suv', 'executive'] as VehicleClass[]).map((item) => (
                <OptionCard key={item} active={vehicleClass === item} onClick={() => setVehicleClass(item)}>
                  {item === 'standard' ? 'Standard' : item === 'suv' ? 'SUV' : 'Executivo'}
                </OptionCard>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle title="3. Início do serviço" />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none focus:border-[#E6C364]/40"
            />
          </section>

          <section className="space-y-3">
            <SectionTitle title="4. Motorista favorito" />
            <select
              value={favoriteDriverId}
              onChange={(event) => setFavoriteDriverId(event.target.value)}
              className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none"
            >
              <option value="">Sem preferência</option>
              {favoriteDrivers.map((driver) => (
                <option key={driver.driver_id} value={driver.driver_id}>
                  {driver.driver_name} · {driver.rating.toFixed(1)}★ · {driver.total_rides} corridas
                </option>
              ))}
            </select>
          </section>

          <section className="space-y-3">
            <SectionTitle title="5. Preview e estimativa" />
            <div className="rounded-[2rem] border border-[#E6C364]/20 bg-[#111111] p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#E6C364]/70">Rota sugerida</p>
              <div className="mt-3 space-y-2 text-sm font-bold text-white/75">
                <p>Pickup: {pickupName || 'Usar localização actual'}</p>
                <p>Destino: {destName || 'A confirmar no lançamento'}</p>
                <p>Janela: {effectiveHours} hora{effectiveHours === 1 ? '' : 's'} · {vehicleClass}</p>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Estimativa de preço</p>
                  <p className="text-3xl font-black text-[#E6C364]">
                    {Math.round(quote).toLocaleString('pt-AO')} Kz
                  </p>
                </div>
                <div className="rounded-full bg-[#E6C364]/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#E6C364]">
                  🔒 Em breve
                </div>
              </div>
            </div>
          </section>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notas especiais, preferências de rota ou contexto do serviço..."
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
            {loading ? 'A registar interesse...' : success ? 'Interesse registado' : 'Notificar-me primeiro'}
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
