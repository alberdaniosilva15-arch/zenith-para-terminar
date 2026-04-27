import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { parseSupabasePoint } from '../../services/rideService';
import type { FleetCarRecord, FleetDriverAgreementRecord, FleetRecord } from '../../types';
import FleetAddCar from './FleetAddCar';
import FleetAI from './FleetAI';
import FleetBilling from './FleetBilling';
import FleetCarList from './FleetCarList';
import FleetUpgradeModal from './FleetUpgradeModal';

interface FleetDashboardProps {
  ownerId: string;
  ownerName?: string;
}

const FleetDashboard: React.FC<FleetDashboardProps> = ({ ownerId, ownerName }) => {
  const [fleet, setFleet] = useState<FleetRecord | null>(null);
  const [cars, setCars] = useState<FleetCarRecord[]>([]);
  const [agreements, setAgreements] = useState<FleetDriverAgreementRecord[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [driverLocations, setDriverLocations] = useState<Record<string, string>>({});
  const [subscriptionPlan, setSubscriptionPlan] = useState<'free' | 'pro' | 'elite'>('free');
  const [search, setSearch] = useState('');
  const [newFleetName, setNewFleetName] = useState(`${ownerName ?? 'Zenith'} Fleet`);
  const [loading, setLoading] = useState(true);
  const [showAddCar, setShowAddCar] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'billing'>('overview');

  const loadFleetData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: fleetRow } = await supabase
        .from('fleets')
        .select('*')
        .eq('owner_id', ownerId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!fleetRow) {
        setFleet(null);
        setCars([]);
        setAgreements([]);
        setDriverNames({});
        setDriverLocations({});
        return;
      }

      setFleet(fleetRow as FleetRecord);

      const [{ data: carRows }, { data: agreementRows }, { data: subRow }] = await Promise.all([
        supabase.from('fleet_cars').select('*').eq('fleet_id', fleetRow.id).order('created_at', { ascending: false }),
        supabase.from('fleet_driver_agreements').select('*').eq('fleet_id', fleetRow.id).order('created_at', { ascending: false }),
        supabase.from('fleet_subscriptions').select('plan').eq('fleet_id', fleetRow.id).maybeSingle(),
      ]);

      const carsData = (carRows ?? []) as FleetCarRecord[];
      const agreementsData = (agreementRows ?? []) as FleetDriverAgreementRecord[];
      setCars(carsData);
      setAgreements(agreementsData);
      setSubscriptionPlan((subRow?.plan as 'free' | 'pro' | 'elite' | undefined) ?? 'free');
      const agreementByDriverId = Object.fromEntries(agreementsData.map((agreement) => [agreement.driver_id, agreement]));

      const driverIds = Array.from(new Set([
        ...carsData.map((car) => car.driver_id).filter((value): value is string => !!value),
        ...agreementsData.map((agreement) => agreement.driver_id),
      ]));

      if (driverIds.length === 0) {
        setDriverNames({});
        setDriverLocations({});
        return;
      }

      const [{ data: profiles }, { data: locations }] = await Promise.all([
        supabase.from('profiles').select('user_id, name').in('user_id', driverIds),
        supabase.from('driver_locations').select('driver_id, location, status').in('driver_id', driverIds),
      ]);

      const profileMap = Object.fromEntries((profiles ?? []).map((profile) => [profile.user_id, profile.name]));
      const locationMap = Object.fromEntries((locations ?? []).map((location) => {
        const agreement = agreementByDriverId[location.driver_id] as FleetDriverAgreementRecord | undefined;
        if (agreement?.status === 'accepted' && isInBlackoutWindow(agreement.privacy_blackout_start, agreement.privacy_blackout_end)) {
          return [location.driver_id, 'Localizacao protegida pelo blackout'];
        }

        const coords = parseSupabasePoint(location.location);
        const pretty = coords
          ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
          : location.status === 'available'
            ? 'Disponivel sem coordenadas'
            : 'Privado ou offline';
        return [location.driver_id, pretty];
      }));

      setDriverNames(profileMap);
      setDriverLocations(locationMap);
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    void loadFleetData();
  }, [loadFleetData]);

  const filteredCars = useMemo(() => {
    if (!search.trim()) {
      return cars;
    }

    const normalized = search.toLowerCase();
    return cars.filter((car) => {
      const driverName = car.driver_id ? driverNames[car.driver_id] ?? '' : '';
      return (
        car.plate.toLowerCase().includes(normalized) ||
        (car.model ?? '').toLowerCase().includes(normalized) ||
        driverName.toLowerCase().includes(normalized)
      );
    });
  }, [cars, driverNames, search]);

  const agreementByCarId = useMemo(
    () => Object.fromEntries(agreements.map((agreement) => [agreement.car_id ?? '', agreement])),
    [agreements],
  );

  const activeCars = filteredCars.filter((car) => car.active).length;
  const idleCars = Math.max(filteredCars.length - activeCars, 0);

  const handleCreateFleet = async () => {
    if (!newFleetName.trim()) {
      return;
    }

    setLoading(true);
    try {
      await supabase.from('fleets').insert({
        owner_id: ownerId,
        name: newFleetName.trim(),
      });
      await loadFleetData();
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center text-white/60 text-sm">
        A preparar o painel da frota...
      </div>
    );
  }

  if (!fleet) {
    return (
      <div className="min-h-full bg-[#050912] p-4 text-white">
        <div className="rounded-[2.5rem] border border-white/10 bg-white/5 p-6">
          <p className="text-[10px] uppercase tracking-[0.22em] text-primary/70 font-black">Modo Dono de Frota</p>
          <h2 className="text-2xl font-black mt-2">Criar a tua primeira frota</h2>
          <p className="text-sm text-white/60 mt-3">
            Vamos começar com um nome operacional para o teu painel. Podes mudar isto mais tarde.
          </p>
          <input
            value={newFleetName}
            onChange={(event) => setNewFleetName(event.target.value)}
            className="w-full mt-5 rounded-2xl bg-black/20 border border-white/10 px-4 py-3 text-sm outline-none"
          />
          <button
            onClick={() => void handleCreateFleet()}
            className="mt-4 w-full py-3 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest"
          >
            Criar frota
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#050912] p-4 text-white space-y-4">
      <div className="rounded-[2.5rem] border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-primary/70 font-black">Zenith Fleet</p>
            <h1 className="text-2xl font-black mt-2">{fleet.name}</h1>
            <p className="text-sm text-white/60 mt-2">
              Privacidade com acordo mutuo, blackout configuravel e controlo operacional.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddCar(true)}
              className="px-4 py-3 rounded-2xl bg-primary text-white font-black text-[10px] uppercase tracking-widest"
            >
              + Carro
            </button>
            <button
              onClick={() => setShowUpgrade(true)}
              className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-white/80 font-black text-[10px] uppercase tracking-widest"
            >
              Plano {subscriptionPlan}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Carros" value={String(filteredCars.length)} />
        <Metric label="Activos" value={String(activeCars)} />
        <Metric label="Parados" value={String(idleCars)} />
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {[
          { id: 'overview', label: 'Operação', icon: '🗺️' },
          { id: 'billing', label: 'Faturação', icon: '💳' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'overview' | 'billing')}
            className={`shrink-0 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab.id
                ? 'bg-primary text-white'
                : 'border border-white/10 bg-white/5 text-white/70'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-white/40 font-black">Mapa operacional</p>
            <h3 className="text-white font-black text-sm mt-1">Carros visiveis agora</h3>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar motorista ou matricula"
            className="rounded-2xl bg-black/20 border border-white/10 px-4 py-2.5 text-sm outline-none"
          />
        </div>

        <div className="space-y-3">
          {filteredCars.map((car) => (
            <div key={car.id} className="rounded-2xl bg-black/20 border border-white/10 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black">{car.plate}</p>
                <p className="text-[11px] text-white/55">
                  {car.driver_id ? driverNames[car.driver_id] ?? 'Motorista associado' : 'Sem motorista'} · {car.active ? 'activo' : 'inactivo'}
                </p>
              </div>
              <p className="text-[11px] text-white/75 text-right">
                {car.driver_id ? driverLocations[car.driver_id] ?? 'Localizacao em proteccao' : 'Sem localizacao'}
              </p>
            </div>
          ))}
          {filteredCars.length === 0 && (
            <p className="text-sm text-white/55">Nenhum carro corresponde a esta pesquisa.</p>
          )}
        </div>
      </div>

      <FleetCarList
        cars={filteredCars}
        driverNames={driverNames}
        agreementByCarId={agreementByCarId}
      />

      <FleetAI
        totalCars={filteredCars.length}
        activeCars={activeCars}
        idleCars={idleCars}
        driverNames={Object.values(driverNames)}
      />
        </>
      )}

      {activeTab === 'billing' && (
        <FleetBilling fleetId={fleet.id} />
      )}

      {showAddCar && (
        <FleetAddCar
          fleetId={fleet.id}
          onCreated={loadFleetData}
          onClose={() => setShowAddCar(false)}
        />
      )}

      {showUpgrade && (
        <FleetUpgradeModal
          fleetId={fleet.id}
          onClose={() => setShowUpgrade(false)}
          onSaved={loadFleetData}
        />
      )}
    </div>
  );
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4">
      <p className="text-[9px] uppercase tracking-widest text-white/40 font-black">{label}</p>
      <p className="text-2xl font-black text-white mt-2">{value}</p>
    </div>
  );
}

function isInBlackoutWindow(start: string, end: string) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Luanda' }));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export default FleetDashboard;
