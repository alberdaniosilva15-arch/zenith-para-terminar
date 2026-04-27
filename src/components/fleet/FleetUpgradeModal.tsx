import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

type Plan = 'free' | 'pro' | 'elite';

interface FleetUpgradeModalProps {
  fleetId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const PLANS: Record<Plan, { title: string; price: string; maxCars: string; description: string }> = {
  free: {
    title: 'Basico',
    price: 'Gratis',
    maxCars: '2 carros',
    description: 'Mapa limitado e visão operacional simples.',
  },
  pro: {
    title: 'Pro',
    price: '5.000 Kz/carro',
    maxCars: 'Ilimitado',
    description: 'Historico, alertas, heatmap e relatorios.',
  },
  elite: {
    title: 'Elite',
    price: '12.000 Kz/carro',
    maxCars: 'Ilimitado',
    description: 'Tudo do Pro com recomendações inteligentes.',
  },
};

const FleetUpgradeModal: React.FC<FleetUpgradeModalProps> = ({ fleetId, onClose, onSaved }) => {
  const [plan, setPlan] = useState<Plan>('pro');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      const { count: activeCars } = await supabase
        .from('fleet_cars')
        .select('id', { count: 'exact', head: true })
        .eq('fleet_id', fleetId)
        .eq('active', true);

      const carsCount = activeCars ?? 0;
      const pricePerCar = plan === 'elite' ? 12000 : plan === 'pro' ? 5000 : 0;

      await supabase.from('fleet_subscriptions').upsert({
        fleet_id: fleetId,
        plan,
        max_cars: plan === 'free' ? 2 : 999,
        price_per_car_kz: pricePerCar,
        started_at: new Date().toISOString(),
      }, { onConflict: 'fleet_id' });

      await supabase.from('fleet_billing_events').insert({
        fleet_id: fleetId,
        plan,
        amount_kz: pricePerCar * Math.max(carsCount, 1),
        cars_count: carsCount,
        billing_month: new Date().toISOString(),
      });

      await onSaved();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm p-4 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-[2rem] bg-[#0A0A0A] border border-white/10 p-6 text-white">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[9px] uppercase tracking-[0.22em] text-primary/70 font-black">Zenith Fleet</p>
            <h3 className="text-lg font-black mt-1">Upgrade do plano</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 text-white/60">×</button>
        </div>

        <div className="grid gap-3">
          {(Object.entries(PLANS) as Array<[Plan, typeof PLANS[Plan]]>).map(([key, item]) => (
            <button
              key={key}
              onClick={() => setPlan(key)}
              className={`rounded-[1.5rem] border p-4 text-left ${
                plan === key ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black">{item.title}</p>
                  <p className="text-[11px] text-white/60 mt-1">{item.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-primary">{item.price}</p>
                  <p className="text-[10px] text-white/50">{item.maxCars}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 py-3 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest"
          >
            {loading ? 'A guardar...' : 'Activar plano'}
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

export default FleetUpgradeModal;
