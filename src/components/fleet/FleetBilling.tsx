import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { FleetBillingEvent } from '../../types';
import { buildFleetBillingPDF, saveFile } from '../../services/pdfService';

interface FleetBillingProps {
  fleetId: string;
}

interface FleetSubscriptionLite {
  plan: 'free' | 'pro' | 'elite';
  price_per_car_kz: number;
  started_at: string;
}

export default function FleetBilling({ fleetId }: FleetBillingProps) {
  const [events, setEvents] = useState<FleetBillingEvent[]>([]);
  const [subscription, setSubscription] = useState<FleetSubscriptionLite | null>(null);
  const [carsCount, setCarsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const loadBilling = useCallback(async () => {
    setLoading(true);

    const [eventsRes, subscriptionRes, carsRes] = await Promise.all([
      supabase
        .from('fleet_billing_events')
        .select('*')
        .eq('fleet_id', fleetId)
        .order('created_at', { ascending: false }),
      supabase
        .from('fleet_subscriptions')
        .select('plan, price_per_car_kz, started_at')
        .eq('fleet_id', fleetId)
        .maybeSingle(),
      supabase
        .from('fleet_cars')
        .select('id', { count: 'exact', head: true })
        .eq('fleet_id', fleetId)
        .eq('active', true),
    ]);

    if (!eventsRes.error) {
      setEvents((eventsRes.data ?? []) as FleetBillingEvent[]);
    }

    if (!subscriptionRes.error) {
      setSubscription((subscriptionRes.data ?? null) as FleetSubscriptionLite | null);
    }

    setCarsCount(carsRes.count ?? 0);
    setLoading(false);
  }, [fleetId]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const ledger = useMemo(() => {
    if (events.length > 0) {
      return events;
    }

    if (!subscription) {
      return [];
    }

    return [{
      id: `synthetic-${fleetId}`,
      fleet_id: fleetId,
      plan: subscription.plan,
      amount_kz: (subscription.price_per_car_kz ?? 0) * Math.max(carsCount, 1),
      cars_count: carsCount,
      billing_month: new Date().toISOString(),
      pdf_url: null,
      created_at: subscription.started_at,
    }] satisfies FleetBillingEvent[];
  }, [carsCount, events, fleetId, subscription]);

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const totalSpentThisMonth = ledger
    .filter((entry) => (entry.billing_month ?? '').slice(0, 7) === currentMonthKey)
    .reduce((sum, entry) => sum + Number(entry.amount_kz ?? 0), 0);
  const costPerCar = carsCount > 0 ? totalSpentThisMonth / carsCount : 0;

  const handleDownload = async () => {
    if (!ledger.length) return;

    setDownloading(true);

    try {
      const base64 = await buildFleetBillingPDF({
        fleetId,
        plan: subscription?.plan ?? ledger[0].plan,
        activeCars: carsCount,
        totalSpentThisMonth,
        costPerCar,
        items: ledger,
      });

      await saveFile(base64, `zenith_frota_${fleetId.slice(0, 8)}_billing.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/70">Faturação Zenith Fleet</p>
            <h3 className="mt-2 text-lg font-black">Custos, recibos e plano actual</h3>
            <p className="mt-1 text-[11px] font-bold text-white/60">
              Resumo financeiro preparado para operação diária e controlo por carro.
            </p>
          </div>
          <button
            onClick={() => void handleDownload()}
            disabled={downloading || !ledger.length}
            className="rounded-full bg-primary px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40"
          >
            {downloading ? 'A gerar PDF...' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Total mês" value={`${Math.round(totalSpentThisMonth).toLocaleString('pt-AO')} Kz`} />
        <Metric label="Carros activos" value={String(carsCount)} />
        <Metric label="Custo/carro" value={`${Math.round(costPerCar).toLocaleString('pt-AO')} Kz`} />
      </div>

      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 text-white">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-white/45">Histórico de pagamentos</p>
            <p className="text-sm font-black">
              Plano {subscription?.plan ?? 'free'} {subscription ? `· ${subscription.price_per_car_kz.toLocaleString('pt-AO')} Kz/carro` : ''}
            </p>
          </div>
          <button
            onClick={() => void loadBilling()}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white/80"
          >
            Actualizar
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm font-bold text-white/55">A carregar faturação...</div>
        ) : ledger.length === 0 ? (
          <div className="py-8 text-center text-sm font-bold text-white/55">Ainda não existem registos de faturação.</div>
        ) : (
          <div className="space-y-3">
            {ledger.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <div>
                  <p className="text-sm font-black text-white">
                    {new Date(entry.billing_month).toLocaleDateString('pt-AO', { month: 'long', year: 'numeric' })}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                    Plano {entry.plan} · {entry.cars_count} carro{entry.cars_count === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-primary">
                    {Math.round(entry.amount_kz).toLocaleString('pt-AO')} Kz
                  </p>
                  <p className="text-[10px] font-bold text-white/45">
                    {new Date(entry.created_at).toLocaleDateString('pt-AO')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4 text-white">
      <p className="text-[9px] font-black uppercase tracking-widest text-white/45">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}
