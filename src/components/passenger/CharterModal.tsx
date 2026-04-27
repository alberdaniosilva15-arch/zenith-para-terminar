import React, { useEffect, useMemo, useState } from 'react';
import { premiumService } from '../../services/premiumService';

interface CharterModalProps {
  userId: string;
  pickupName: string;
  destName: string;
  pickupCoords?: { lat: number; lng: number } | null;
  destCoords?: { lat: number; lng: number } | null;
  onClose: () => void;
}

type EventType = 'Escolar' | 'Igreja' | 'Empresa' | 'Evento' | 'Outro';
type Capacity = 20 | 40 | 60;

const CAPACITY_OPTIONS: Capacity[] = [20, 40, 60];
const EVENT_OPTIONS: EventType[] = ['Escolar', 'Igreja', 'Empresa', 'Evento', 'Outro'];

export default function CharterModal({
  userId,
  pickupName,
  destName,
  pickupCoords,
  destCoords,
  onClose,
}: CharterModalProps) {
  const [eventType, setEventType] = useState<EventType>('Empresa');
  const [capacity, setCapacity] = useState<Capacity>(20);
  const [scheduledAt, setScheduledAt] = useState('');
  const [routeDescription, setRouteDescription] = useState(
    [pickupName, destName].filter(Boolean).join(' -> '),
  );
  const [returnTrip, setReturnTrip] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [quote, setQuote] = useState(0);

  const estimatedDistanceKm = useMemo(() => {
    if (!pickupCoords || !destCoords) {
      return 10;
    }

    const dx = pickupCoords.lat - destCoords.lat;
    const dy = pickupCoords.lng - destCoords.lng;
    return Math.max(Math.sqrt(dx * dx + dy * dy) * 111, 10);
  }, [destCoords, pickupCoords]);

  useEffect(() => {
    premiumService.estimateCharterPrice({
      capacity,
      estimatedDistanceKm,
      returnTrip,
    }).then((result) => setQuote(result?.totalKz ?? 0));
  }, [capacity, estimatedDistanceKm, returnTrip]);

  const handleSubmit = async () => {
    setLoading(true);
    const booking = await premiumService.createCharterBooking({
      userId,
      pickupAddress: pickupName || 'Pickup a confirmar',
      pickupLat: pickupCoords?.lat ?? null,
      pickupLng: pickupCoords?.lng ?? null,
      destAddress: destName || 'Destino final a confirmar',
      destLat: destCoords?.lat ?? null,
      destLng: destCoords?.lng ?? null,
      scheduledAt: scheduledAt || null,
      eventType,
      capacity,
      routeDescription: routeDescription || null,
      returnTrip,
      notes: notes || null,
      estimatedDistanceKm,
      routeStops: routeDescription
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      notifyMe: true,
    });
    setLoading(false);

    if (booking) {
      setSuccess('Pedido registado no modo marketplace. A Zenith vai notificar-te quando abrir as primeiras empresas parceiras.');
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
            <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#E6C364]/75">Marketplace premium</p>
            <h2 className="mt-2 text-xl font-black">Fretamento Zenith</h2>
            <p className="mt-1 text-[11px] font-bold text-white/60">
              Comeca como marketplace. Capturamos a tua rota agora e alinhamos a operacao com parceiros.
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
            <SectionTitle title="1. Tipo de evento" />
            <div className="grid grid-cols-2 gap-3">
              {EVENT_OPTIONS.map((item) => (
                <OptionCard key={item} active={eventType === item} onClick={() => setEventType(item)}>
                  {item}
                </OptionCard>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle title="2. Capacidade" />
            <div className="grid grid-cols-3 gap-3">
              {CAPACITY_OPTIONS.map((item) => (
                <OptionCard key={item} active={capacity === item} onClick={() => setCapacity(item)}>
                  {item} pessoas
                </OptionCard>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle title="3. Data e hora" />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="w-full rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none focus:border-[#E6C364]/40"
            />
          </section>

          <section className="space-y-3">
            <SectionTitle title="4. Rota e paragens" />
            <textarea
              value={routeDescription}
              onChange={(event) => setRouteDescription(event.target.value)}
              placeholder="Pickup, paragens intermédias e destino final. Uma paragem por linha."
              className="min-h-[120px] w-full rounded-[1.75rem] border border-white/10 bg-white/5 px-4 py-4 text-sm outline-none focus:border-[#E6C364]/40"
            />
            <label className="flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-white/5 px-4 py-4">
              <div>
                <p className="text-sm font-black text-white">Ida e volta</p>
                <p className="text-[10px] font-bold text-white/50">Acrescenta margem operacional na estimativa</p>
              </div>
              <button
                type="button"
                onClick={() => setReturnTrip((value) => !value)}
                className={`h-8 w-14 rounded-full transition-all ${returnTrip ? 'bg-[#E6C364]' : 'bg-white/10'}`}
              >
                <span
                  className={`block h-6 w-6 rounded-full bg-white transition-all ${returnTrip ? 'translate-x-7' : 'translate-x-1'}`}
                />
              </button>
            </label>
          </section>

          <section className="space-y-3">
            <SectionTitle title="5. Estimativa" />
            <div className="rounded-[2rem] border border-[#E6C364]/20 bg-[#111111] p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#E6C364]/70">Estimativa de orçamento</p>
              <div className="mt-3 space-y-2 text-sm font-bold text-white/75">
                <p>Evento: {eventType}</p>
                <p>Capacidade: {capacity} pessoas</p>
                <p>Modelo: marketplace com confirmação humana</p>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Preço estimado</p>
                  <p className="text-3xl font-black text-[#E6C364]">{Math.round(quote).toLocaleString('pt-AO')} Kz</p>
                </div>
                <div className="rounded-full bg-[#E6C364]/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-[#E6C364]">
                  Notificar-me
                </div>
              </div>
            </div>
          </section>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notas especiais, acessos, horário de embarque, perfil dos passageiros..."
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
            {loading ? 'A registar interesse...' : success ? 'Interesse registado' : 'Solicitar orçamento'}
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
