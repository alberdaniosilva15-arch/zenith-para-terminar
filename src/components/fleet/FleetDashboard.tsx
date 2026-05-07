import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { parseSupabasePoint } from '../../services/rideService';
import type { FleetCarRecord, FleetDriverAgreementRecord, FleetRecord } from '../../types';
import FleetAddCar from './FleetAddCar';
import FleetAI from './FleetAI';
import FleetBilling from './FleetBilling';
import FleetCarList from './FleetCarList';
import FleetUpgradeModal from './FleetUpgradeModal';
import Map3D from '../Map3D';
import mapboxgl from 'mapbox-gl';
import FleetCarTracker from './FleetCarTracker';

interface FleetDashboardProps {
  ownerId: string;
  ownerName?: string;
}

const FleetDashboard: React.FC<FleetDashboardProps> = ({ ownerId, ownerName }) => {
  const [fleet, setFleet] = useState<FleetRecord | null>(null);
  const [cars, setCars] = useState<FleetCarRecord[]>([]);
  const [agreements, setAgreements] = useState<FleetDriverAgreementRecord[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [driverLocations, setDriverLocations] = useState<Record<string, { label: string; coords?: [number, number] }>>({});
  const [subscriptionPlan, setSubscriptionPlan] = useState<'free' | 'pro' | 'elite'>('free');
  const [search, setSearch] = useState('');
  const [newFleetName, setNewFleetName] = useState(`${ownerName ?? 'Zenith'} Fleet`);
  const [loading, setLoading] = useState(true);
  const [showAddCar, setShowAddCar] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'billing'>('overview');
  const [trackingCarId, setTrackingCarId] = useState<string | null>(null);
  const [mapObj, setMapObj] = useState<mapboxgl.Map | null>(null);
  const markersRef = React.useRef<Record<string, mapboxgl.Marker>>({});

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
          return [location.driver_id, { label: 'Localizacao protegida pelo blackout' }];
        }

        const coords = parseSupabasePoint(location.location);
        const pretty = coords
          ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
          : location.status === 'available'
            ? 'Disponivel sem coordenadas'
            : 'Privado ou offline';
        return [location.driver_id, { label: pretty, coords: coords ? [coords.lng, coords.lat] : undefined }];
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

  useEffect(() => {
    if (!mapObj) return;
    
    // Remover marcadores antigos
    Object.values(markersRef.current).forEach(marker => marker.remove());
    markersRef.current = {};

    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    let hasCoords = false;

    cars.forEach(car => {
      const loc = car.driver_id ? driverLocations[car.driver_id] : null;
      if (loc && loc.coords) {
        const el = createWhiteCarMarkerElement();
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(loc.coords)
          .addTo(mapObj);
        markersRef.current[car.id] = marker;

        minLng = Math.min(minLng, loc.coords[0]);
        maxLng = Math.max(maxLng, loc.coords[0]);
        minLat = Math.min(minLat, loc.coords[1]);
        maxLat = Math.max(maxLat, loc.coords[1]);
        hasCoords = true;
      }
    });

    if (hasCoords && cars.length > 1) {
      mapObj.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 40, maxZoom: 15 }
      );
    } else if (hasCoords && cars.length === 1) {
      mapObj.flyTo({ center: [minLng, minLat], zoom: 15 });
    }
  }, [mapObj, cars, driverLocations]);

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
      <div className="zr-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="zr-loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  if (!fleet) {
    return (
      <div className="zr-app" style={{ minHeight: '100vh', padding: '20px' }}>
        <section className="zr-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p className="zr-kicker">Modo Dono de Frota</p>
          <h2 className="zr-section-title">Criar a tua primeira frota</h2>
          <p className="zr-copy" style={{ marginBottom: '24px' }}>
            Vamos começar com um nome operacional para o teu painel. Podes mudar isto mais tarde.
          </p>
          <input
            value={newFleetName}
            onChange={(event) => setNewFleetName(event.target.value)}
            className="zr-input"
            style={{ width: '100%', marginBottom: '20px' }}
            placeholder="Nome da Frota"
          />
          <button
            onClick={() => void handleCreateFleet()}
            className="zr-button zr-button--block"
          >
            Criar frota
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Zenith Fleet</p>
            <h1 className="zr-section-title">{fleet.name}</h1>
          </div>
          <div className="zr-inline">
            <button onClick={() => setShowAddCar(true)} className="zr-button zr-button--sm">
              + Carro
            </button>
            <button onClick={() => setShowUpgrade(true)} className="zr-button zr-button--sm zr-button--ghost">
              Plano {subscriptionPlan}
            </button>
          </div>
        </div>
        <p className="zr-copy" style={{ marginTop: '12px', fontSize: '12px' }}>
          Privacidade com acordo mútuo e controlo operacional avançado.
        </p>
      </header>

      <div style={{ padding: '14px' }}>
        {/* KPI Grid */}
        <div className="zr-kpi-grid" style={{ marginBottom: '24px' }}>
          <div className="zr-kpi-card">
            <p className="zr-meta">Carros</p>
            <h3 className="zr-section-title">{filteredCars.length}</h3>
          </div>
          <div className="zr-kpi-card">
            <p className="zr-meta">Activos</p>
            <h3 className="zr-section-title" style={{ color: 'var(--success)' }}>{activeCars}</h3>
          </div>
          <div className="zr-kpi-card">
            <p className="zr-meta">Parados</p>
            <h3 className="zr-section-title" style={{ color: 'var(--danger)' }}>{idleCars}</h3>
          </div>
        </div>

        {/* Tabs */}
        <div className="zr-scroll-x" style={{ marginBottom: '24px', marginInline: '-14px', paddingInline: '14px' }}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`zr-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
          >
            Operação
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`zr-tab ${activeTab === 'billing' ? 'is-active' : ''}`}
          >
            Faturação
          </button>
        </div>

        {activeTab === 'overview' && (
          <div className="animate-in fade-in">
            {/* Mapa Operacional */}
            <section className="zr-card" style={{ padding: 0, overflow: 'hidden', marginBottom: '24px' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid var(--line)' }} className="zr-inline zr-inline--between">
                <div>
                  <p className="zr-kicker">Real-time</p>
                  <h3 className="zr-section-title" style={{ fontSize: '14px' }}>Localização da Frota</h3>
                </div>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Procurar matrícula..."
                  className="zr-input"
                  style={{ width: '150px', fontSize: '12px', padding: '6px 12px' }}
                />
              </div>
              <div style={{ height: '300px', position: 'relative' }}>
                <Map3D
                  center={[13.2344, -8.8383]}
                  zoom={11}
                  mode="admin"
                  onMapReady={(map) => setMapObj(map)}
                />
              </div>
            </section>

            {/* Listagem Rápida / Monitorização */}
            <section className="zr-card" style={{ marginBottom: '24px' }}>
              <p className="zr-kicker">Monitorização</p>
              <h3 className="zr-section-title" style={{ marginBottom: '16px' }}>Estado dos Veículos</h3>
              <div className="zr-list">
                {filteredCars.map((car) => {
                  const locInfo = car.driver_id ? driverLocations[car.driver_id] : null;
                  const label = locInfo?.label ?? 'Sem localização';
                  return (
                    <div key={car.id} className="zr-list-item">
                      <div>
                        <strong style={{ display: 'block' }}>{car.plate}</strong>
                        <span className="zr-meta">
                          {car.driver_id ? driverNames[car.driver_id] ?? 'Motorista associado' : 'Sem motorista'}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`zr-chip ${car.active ? 'zr-chip--success' : 'zr-chip--muted'}`} style={{ marginBottom: '4px' }}>
                          {car.active ? 'Activo' : 'Inactivo'}
                        </span>
                        <p className="zr-meta" style={{ fontSize: '10px' }}>{label}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <FleetCarList
              cars={filteredCars}
              driverNames={driverNames}
              agreementByCarId={agreementByCarId}
              onTrackCar={(carId) => setTrackingCarId(carId)}
            />

            <FleetAI
              totalCars={filteredCars.length}
              activeCars={activeCars}
              idleCars={idleCars}
              driverNames={Object.values(driverNames)}
            />
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="animate-in fade-in">
            <FleetBilling fleetId={fleet.id} />
          </div>
        )}
      </div>

      {/* Modais Overlay */}
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

      {trackingCarId && (
        <FleetCarTracker
          car={cars.find(c => c.id === trackingCarId)!}
          driverName={cars.find(c => c.id === trackingCarId)?.driver_id ? driverNames[cars.find(c => c.id === trackingCarId)!.driver_id!] : undefined}
          locationInfo={cars.find(c => c.id === trackingCarId)?.driver_id ? driverLocations[cars.find(c => c.id === trackingCarId)!.driver_id!] : undefined}
          onClose={() => setTrackingCarId(null)}
        />
      )}
    </div>
  );
};

function isInBlackoutWindow(start: string, end: string) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Luanda' }));
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHour = 0, startMinute = 0] = start.split(':').map(Number);
  const [endHour = 0, endMinute = 0] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function createWhiteCarMarkerElement() {
  const el = document.createElement('div');
  el.className = 'fleet-car-marker';
  el.style.width = '36px';
  el.style.height = '36px';
  el.style.backgroundColor = '#FFFFFF';
  el.style.borderRadius = '50%';
  el.style.border = '2px solid #E6C364';
  el.style.boxShadow = '0 0 15px rgba(255,255,255,0.4)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.innerHTML = '<span style="font-size:18px;">🚗</span>';
  return el;
}

export default FleetDashboard;
