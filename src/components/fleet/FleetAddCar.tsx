import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface FleetAddCarProps {
  fleetId: string;
  onCreated: () => Promise<void> | void;
  onClose: () => void;
}

const FleetAddCar: React.FC<FleetAddCarProps> = ({ fleetId, onCreated, onClose }) => {
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [driverContact, setDriverContact] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!plate.trim()) {
      setMessage('Indica a matricula do carro.');
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      let driverId: string | null = null;

      if (driverContact.trim()) {
        const isEmail = driverContact.includes('@');

        if (isEmail) {
          const { data: userRow } = await supabase
            .from('users')
            .select('id')
            .eq('email', driverContact.trim().toLowerCase())
            .maybeSingle();
          driverId = userRow?.id ?? null;
        } else {
          const normalizedPhone = driverContact.replace(/\D/g, '');
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('user_id')
            .or(`phone.eq.${normalizedPhone},phone.eq.+244${normalizedPhone}`)
            .maybeSingle();
          driverId = profileRow?.user_id ?? null;
        }
      }

      const { data: car, error: carError } = await supabase
        .from('fleet_cars')
        .insert({
          fleet_id: fleetId,
          plate: plate.trim().toUpperCase(),
          model: model.trim() || null,
          year: year ? Number(year) : null,
          driver_id: driverId,
        })
        .select('id')
        .single();

      if (carError || !car?.id) {
        throw carError ?? new Error('Nao foi possivel registar o carro.');
      }

      if (driverId) {
        await supabase.from('fleet_driver_agreements').insert({
          fleet_id: fleetId,
          driver_id: driverId,
          car_id: car.id,
          status: 'pending',
          agreement_type: 'minimal',
        });
      }

      await onCreated();
      onClose();
    } catch (error) {
      console.warn('[FleetAddCar] Falha ao criar carro:', error);
      setMessage('Nao foi possivel adicionar o carro agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-[2rem] bg-[#0A0A0A] border border-white/10 p-6 text-white">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[9px] uppercase tracking-[0.22em] text-primary/70 font-black">Nova viatura</p>
            <h3 className="text-lg font-black mt-1">Adicionar carro a frota</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 text-white/60">×</button>
        </div>

        <div className="space-y-4">
          <Field label="Matricula" value={plate} onChange={setPlate} placeholder="LD-00-00-AA" />
          <Field label="Modelo" value={model} onChange={setModel} placeholder="Toyota Hiace" />
          <Field label="Ano" value={year} onChange={setYear} placeholder="2021" />
          <Field
            label="Motorista (email ou telefone)"
            value={driverContact}
            onChange={setDriverContact}
            placeholder="opcional"
          />
        </div>

        {message && (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {message}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest"
          >
            {loading ? 'A guardar...' : 'Guardar carro'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/10 text-white/80 font-black text-[10px] uppercase tracking-widest"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-white/45 font-black">{label}</p>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-primary/50"
      />
    </div>
  );
}

export default FleetAddCar;
