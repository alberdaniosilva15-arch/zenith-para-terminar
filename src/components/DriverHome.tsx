// =============================================================================
// ZENITH RIDE v3.1 — DriverHome.tsx
// ✅ FIX: Subscrição Realtime a driver_notifications (resolve broadcast perdido)
//         Quando motorista reconecta → lê notificações pendentes da BD
// ✅ Mantém: subscribeToAvailableRides + subscribeToDriverAssignments (fallback)
// =============================================================================

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import RideTalk from './RideTalk';
import AvailableRidesList from './AvailableRidesList';
import DriverActiveCard from './DriverActiveCard';
import { DriverDocumentsForm } from './DriverDocumentsForm';
import PanicButton from './PanicButton';
import NightSafetyBanner from './NightSafetyBanner';
import { geminiService } from '../services/geminiService';
import { rideService } from '../services/rideService';
import { mapService } from '../services/mapService';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useIdleMount } from '../hooks/useIdleMount';
import { useSilentTripleTap } from '../hooks/useSilentTripleTap';
import DriverCopilot from './driver/DriverCopilot';
import DocExpiryBanner from './driver/DocExpiryBanner';
import DriverTierCard from './driver/DriverTierCard';
import FatigueAlert from './driver/FatigueAlert';
import MinIncomeGuard from './driver/MinIncomeGuard';
import DriverAgreementModal from './fleet/DriverAgreementModal';
import type { RideState, DbRide, FleetDriverAgreementRecord, LatLng } from '../types';
import { RideStatus, UserRole } from '../types';
import { useToastStore } from '../store/useAppStore';
import { cellToLatLng } from 'h3-js';
import { MapSingleton } from '../lib/mapInstance';

const Map3D = React.lazy(() => import('./Map3D'));

interface DriverHomeProps {
  ride:            RideState;
  onAcceptRide:    (rideId: string) => Promise<void>;
  onConfirmRide:   (rideId: string) => Promise<void>;
  onDeclineRide:   (rideId: string) => Promise<void>;
  onAdvanceStatus: (status: RideStatus) => Promise<void>;
  driverId:        string;
}

// Payload de notificação persistido em driver_notifications
interface NotifPayload {
  ride_id:        string;
  origin_address: string;
  dest_address:   string;
  price_kz:       number;
  distance_km:    number | null;
}

const DriverHome: React.FC<DriverHomeProps> = ({
  ride, onAcceptRide, onConfirmRide, onDeclineRide, onAdvanceStatus, driverId,
}) => {
  const { profile } = useAuth();
  const [isOnline,      setIsOnline]      = useState(false);
  const [availableRides, setAvailableRides] = useState<DbRide[]>([]);
  const [incomingRide,  setIncomingRide]  = useState<DbRide | null>(null);
  const [isAuctionRide, setIsAuctionRide] = useState(false);
  const [simulation,    setSimulation]    = useState<{
    dailyEstimateKz: number; bestZones: string[]; tips: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [heatmapData, setHeatmapData] = useState<Array<{ h3_index: string; demand_count: number; supply_count: number }>>([]);
  const [driverCoords, setDriverCoords] = useState<LatLng | null>(null);
  const [idleMinutes, setIdleMinutes] = useState(0);
  const [onlineSince, setOnlineSince] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [silentPanicSignal, setSilentPanicSignal] = useState(0);
  const [suspiciousPassenger, setSuspiciousPassenger] = useState<{ message: string; severity: 'soft' | 'high' } | null>(null);
  const [pendingAgreement, setPendingAgreement] = useState<(FleetDriverAgreementRecord & { fleet_name?: string | null }) | null>(null);
  // Contagem de notificações pendentes não lidas
  const [pendingNotifCount, setPendingNotifCount] = useState(0);

  const { showToast } = useToastStore();

  // Ganhos acumulados hoje
  const [todayEarnings, setTodayEarnings] = useState(0);

  const gpsRef    = useRef<(() => void) | null>(null);
  
  const unsubRef1 = useRef<(() => void) | null>(null); // subscribeToAvailableRides
  const unsubRef2 = useRef<(() => void) | null>(null); // subscribeToDriverAssignments
  const unsubRef3 = useRef<ReturnType<typeof supabase.channel> | null>(null); // driver_notifications
  
  // ✅ BUG #7 CORRIGIDO: timers para auto-mark notifications como lidas
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!profile) return;
    geminiService.simulateEarnings({
      rating: profile.rating,
      totalRides: profile.total_rides,
      level: profile.level,
    }).then(s => setSimulation(s));

    // Carregar ganhos de hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const loadEarnings = async () => {
      try {
        const { data } = await supabase
          .from('rides')
          .select('price_kz')
          .eq('driver_id', driverId)
          .eq('status', 'completed')
          .gte('completed_at', today.toISOString());
        
        const total = (data ?? []).reduce((sum, r) => sum + (Number(r.price_kz) || 0), 0);
        setTodayEarnings(total);
      } catch (err) {
        console.warn('[DriverHome] Falha ao carregar ganhos:', err);
      }
    };
    loadEarnings();

  }, [profile, driverId]);

  const [driverDocStatus, setDriverDocStatus] = useState<'approved' | 'pending' | 'rejected' | 'none'>('none');
  const [showDocsForm, setShowDocsForm] = useState(false);
  const [isSwitchingOnline, setIsSwitchingOnline] = useState(false);
  const isOnlineRef = useRef(false);
  const shouldMountMap = useIdleMount(true);
  const onlineHours = onlineSince ? (clockTick - new Date(onlineSince).getTime()) / 3_600_000 : 0;
  const hasActiveRide = Boolean(ride.rideId);

  useSilentTripleTap({
    enabled: isOnline && !!ride.rideId,
    onTrigger: () => setSilentPanicSignal((value) => value + 1),
  });

  // ── Heatmap (F5) ────────────────────────────────────────────────────────
  const heatmapMarkersRef = useRef<any[]>([]);

  const fetchAndDrawHeatmap = useCallback(async () => {
    if (!isOnline) return;
    const data = await rideService.getDemandHeatmap();
    setHeatmapData(data);
    
    // Limpar markers
    heatmapMarkersRef.current.forEach(m => m.remove());
    heatmapMarkersRef.current = [];

    const map = MapSingleton.get();
    if (!map) return;

    data.forEach(item => {
      // ratio demanda vs oferta
      const ratio = item.supply_count === 0 ? item.demand_count : item.demand_count / item.supply_count;
      if (ratio < 1.5 || item.demand_count === 0) return; // Só mostrar zonas ardentes

      const [lat, lng] = cellToLatLng(item.h3_index);
      const mapboxgl = (window as any).mapboxgl;
      if (!mapboxgl) return;

      const el = document.createElement('div');
      const dot = document.createElement('div');
      const isHot = ratio > 3;
      dot.style.cssText = `width:40px;height:40px;border-radius:50%;background:${isHot ? 'rgba(239,68,68,0.3)' : 'rgba(249,115,22,0.3)'};border:1px solid ${isHot ? 'rgba(239,68,68,0.8)' : 'rgba(249,115,22,0.8)'};display:flex;align-items:center;justify-content:center;animation:pulse 2s infinite;`;
      const icon = document.createElement('span');
      icon.style.cssText = 'font-size:8px;font-weight:bold;color:white;';
      icon.textContent = '🔥';
      dot.appendChild(icon);
      el.appendChild(dot);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
        
      heatmapMarkersRef.current.push(marker);
    });
  }, [isOnline]);

  useEffect(() => {
    let interval: any;
    if (isOnline) {
      fetchAndDrawHeatmap();
      interval = setInterval(fetchAndDrawHeatmap, 60000);
    } else {
      heatmapMarkersRef.current.forEach(m => m.remove());
      heatmapMarkersRef.current = [];
    }
    return () => clearInterval(interval);
  }, [isOnline, fetchAndDrawHeatmap]);

  useEffect(() => {
    if (!isOnline || !onlineSince) {
      return;
    }

    setClockTick(Date.now());
    const interval = window.setInterval(() => setClockTick(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [isOnline, onlineSince]);

  useEffect(() => {
    if (!isOnline || !onlineSince) {
      setIdleMinutes(0);
      return;
    }

    if (ride.rideId) {
      setIdleMinutes(0);
      return;
    }

    const recalc = () => {
      const minutes = Math.max(0, Math.floor((Date.now() - new Date(onlineSince).getTime()) / 60_000));
      setIdleMinutes(minutes);
      void supabase
        .from('driver_locations')
        .update({ online_minutes_idle: minutes })
        .eq('driver_id', driverId);
    };

    recalc();
    const interval = window.setInterval(recalc, 60_000);
    return () => window.clearInterval(interval);
  }, [driverId, isOnline, onlineSince, ride.rideId]);

  useEffect(() => {
    if (!ride.passengerId) {
      setSuspiciousPassenger(null);
      return;
    }

    let cancelled = false;

    const loadPassengerRisk = async () => {
      try {
        const [{ data: passengerProfile }, { count: totalTrips }, { count: cancelledTrips }] = await Promise.all([
          supabase.from('profiles').select('rating').eq('user_id', ride.passengerId!).maybeSingle(),
          supabase.from('rides').select('id', { count: 'exact', head: true }).eq('passenger_id', ride.passengerId!),
          supabase.from('rides').select('id', { count: 'exact', head: true }).eq('passenger_id', ride.passengerId!).eq('status', 'cancelled'),
        ]);

        if (cancelled) {
          return;
        }

        const rating = Number(passengerProfile?.rating ?? 5);
        const cancelRate = totalTrips ? ((cancelledTrips ?? 0) / totalTrips) * 100 : 0;

        if (rating < 3.5 || cancelRate > 40) {
          setSuspiciousPassenger({
            severity: rating < 3 || cancelRate > 55 ? 'high' : 'soft',
            message: rating < 3.5
              ? `⚠️ Passageiro com rating ${rating.toFixed(1)}`
              : `⚠️ Passageiro com historico de cancelamentos (${cancelRate.toFixed(0)}%)`,
          });
          return;
        }

        setSuspiciousPassenger(null);
      } catch (error) {
        console.warn('[DriverHome] Nao foi possivel calcular risco do passageiro:', error);
      }
    };

    void loadPassengerRisk();
    return () => {
      cancelled = true;
    };
  }, [ride.passengerId]);

  useEffect(() => {
    if (!driverId) {
      return;
    }

    const loadPendingAgreement = async () => {
      const { data } = await supabase
        .from('fleet_driver_agreements')
        .select('*, fleets(name)')
        .eq('driver_id', driverId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

      const agreement = data?.[0] as (FleetDriverAgreementRecord & { fleets?: { name?: string | null } | null }) | undefined;
      setPendingAgreement(agreement ? {
        ...agreement,
        fleet_name: agreement.fleets?.name ?? null,
      } : null);
    };

    void loadPendingAgreement();
  }, [driverId]);

  // ── Ler estado dos documentos ao iniciar ────────────────────────────────────
  useEffect(() => {
    if (!driverId) return;
    const fetchStatus = async () => {
      try {
        const { data } = await supabase.from('driver_documents').select('status').eq('driver_id', driverId).maybeSingle();
        setDriverDocStatus(data ? data.status as any : 'none');
      } catch (err) {
        console.warn('[DriverHome] Falha ao ler estado dos documentos:', err);
      }
    };
    fetchStatus();
  }, [driverId]);

  // ── Ir online ────────────────────────────────────────────────────────────
  const goOnline = useCallback(async () => {
    if (isSwitchingOnline) return;

    if (driverDocStatus !== 'approved') {
      showToast('Precisas de submeter e aprovar os dados do teu Carro e BI primeiro.', 'error');
      setShowDocsForm(true);
      return;
    }

    if (!profile?.emergency_contact_phone) {
      showToast('Define um contacto de emergência no Perfil antes de ficares online.', 'error');
      return;
    }

    setIsSwitchingOnline(true);

    // Tentar obter localização imediatamente para não falhar o UPSERT na base de dados
    let coords: { lat: number; lng: number } | undefined;
    try {
      const { getCurrentPosition } = await import('../services/gpsService');
      const pos = await getCurrentPosition();
      coords = { lat: pos.lat, lng: pos.lng };
    } catch (err) {
      console.warn('[DriverHome] goOnline GPS:', err);
      coords = { lat: -8.8390, lng: 13.2343 }; // Fallback Luanda
    }

    const success = await rideService.setDriverStatus(driverId, 'available', coords);
    if (!success) {
      showToast('Erro interno: O teu estado não pôde ser atualizado. Tenta novamente.', 'error');
      isOnlineRef.current = false;
      setIsOnline(false);
      setIsSwitchingOnline(false);
      return;
    }

    const onlineStartedAt = new Date().toISOString();
    setDriverCoords(coords ?? null);
    setOnlineSince(onlineStartedAt);
    setIdleMinutes(0);
    void supabase
      .from('driver_locations')
      .update({ online_since: onlineStartedAt, online_minutes_idle: 0 })
      .eq('driver_id', driverId);

    isOnlineRef.current = true;
    setIsOnline(true);
    setIsSwitchingOnline(false);
  }, [driverId, driverDocStatus, isSwitchingOnline, showToast]);

  const goOffline = useCallback(async () => {
    if (isSwitchingOnline) return;
    setIsSwitchingOnline(true);
    isOnlineRef.current = false;
    setIsOnline(false);
    setAvailableRides([]);
    setIncomingRide(null);
    setOnlineSince(null);
    setIdleMinutes(0);
    setSuspiciousPassenger(null);
    await rideService.setDriverStatus(driverId, 'offline');
    setIsSwitchingOnline(false);
  }, [driverId, isSwitchingOnline]);

  // ── Ler notificações pendentes (BD) ao reconectar ─────────────────────────
  const loadPendingNotifications = useCallback(async () => {
    try {
      const { data: notifs } = await supabase
        .from('driver_notifications')
        .select('id, ride_id, payload, created_at')
        .eq('driver_id', driverId)
        .is('read_at', null)
        .eq('type', 'new_ride')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!notifs || notifs.length === 0) return;

      setPendingNotifCount(notifs.length);
      const latest = notifs[0];
      if (!latest) return;
      const payload = latest.payload as NotifPayload;
      const rideId  = payload.ride_id ?? latest.ride_id;

      // BUG 5 FIX: buscar ride real da BD
      let realRide: DbRide | null = null;
      try {
        const { data } = await supabase.from('rides').select('*').eq('id', rideId).single();
        if (data) realRide = data as DbRide;
      } catch (err) { console.warn('[DriverHome] Falha ao obter ETA/distância fallback:', err); }

      const fallbackRide: DbRide = realRide ?? ({
        id:               rideId,
        origin_address:   payload.origin_address ?? '—',
        dest_address:     payload.dest_address   ?? '—',
        price_kz:         payload.price_kz       ?? 0,
        distance_km:      payload.distance_km    ?? null,
        status:           RideStatus.SEARCHING,
        driver_id:        null,
        driver_confirmed: false,
        passenger_id:     '',
        origin_lat: 0, origin_lng: 0,
        dest_lat: 0, dest_lng: 0,
        surge_multiplier: 1,
        created_at: latest.created_at ?? new Date().toISOString(),
        accepted_at: null, pickup_at: null, started_at: null,
        completed_at: null, cancelled_at: null, cancel_reason: null,
      } as DbRide);

      setIncomingRide(prev => {
        if (!prev) { setIsAuctionRide(false); return fallbackRide; }
        return prev;
      });

      // Marcar como lida
      await supabase
        .from('driver_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('driver_id', driverId)
        .is('read_at', null)
        .eq('type', 'new_ride');

    } catch (err) {
      console.warn('[DriverHome.loadPendingNotifications]', err);
    }
  }, [driverId]);

  // ── Subscrição Realtime a driver_notifications ────────────────────────────
  const subscribeToNotifications = useCallback(() => {
    if (unsubRef3.current) {
      supabase.removeChannel(unsubRef3.current);
      unsubRef3.current = null;
    }

    unsubRef3.current = supabase
      .channel(`driver-notifs:${driverId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'driver_notifications',
        filter: `driver_id=eq.${driverId}`,
      }, async (payload) => {
        const notif = payload.new as {
          id: string;
          ride_id: string;
          type: string;
          payload: NotifPayload;
          created_at: string;
        };

        if (notif.type !== 'new_ride') return;

        // BUG 5 FIX: buscar o ride real da BD em vez de usar fakeRide com coords 0,0
        const rideId = notif.payload?.ride_id ?? notif.ride_id;
        let realRide: DbRide | null = null;

        try {
          const { data } = await supabase
            .from('rides')
            .select('*')
            .eq('id', rideId)
            .single();
          if (data) realRide = data as DbRide;
        } catch (err) { console.warn('[DriverHome] Falha na auto-aceitação:', err); }

        // Fallback mínimo se a BD não responder
        const np = notif.payload;
        const fallbackRide: DbRide = realRide ?? ({
          id:               rideId,
          origin_address:   np.origin_address ?? '—',
          dest_address:     np.dest_address   ?? '—',
          price_kz:         np.price_kz       ?? 0,
          distance_km:      np.distance_km    ?? null,
          status:           RideStatus.SEARCHING,
          driver_id:        null,
          driver_confirmed: false,
          passenger_id:     '',
          origin_lat: 0, origin_lng: 0,
          dest_lat: 0, dest_lng: 0,
          surge_multiplier: 1,
          created_at: notif.created_at ?? new Date().toISOString(),
          accepted_at: null, pickup_at: null, started_at: null,
          completed_at: null, cancelled_at: null, cancel_reason: null,
        } as DbRide);

        setIncomingRide(prev => {
          if (!prev) { setIsAuctionRide(false); return fallbackRide; }
          return prev;
        });

        setPendingNotifCount(c => c + 1);

        // Marcar como lida após 5 segundos
        const timer = setTimeout(async () => {
          timersRef.current.delete(notif.id);
          if (!mountedRef.current) return;
          try {
            await supabase
              .from('driver_notifications')
              .update({ read_at: new Date().toISOString() })
              .eq('id', notif.id);
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn('[DriverHome] Falha ao marcar notificação como lida:', notif.id, err);
            }
          }
        }, 5000);

        timersRef.current.set(notif.id, timer);
      })
      .subscribe((status) => {
        console.log('[DriverHome] driver_notifications canal:', status);
      });
  }, [driverId]);

  // Effect único de lifecycle e unmount
  // ✅ BUG #7 CORRIGIDO: cleanup completo de todos os timers
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Limpar TODOS os timers de notificações pendentes
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
      if (gpsRef.current)    { gpsRef.current(); gpsRef.current = null; }
      if (unsubRef1.current) { unsubRef1.current(); unsubRef1.current = null; }
      if (unsubRef2.current) { unsubRef2.current(); unsubRef2.current = null; }
      if (unsubRef3.current) { supabase.removeChannel(unsubRef3.current); unsubRef3.current = null; }
      if (isOnlineRef.current) {
        rideService.setDriverStatus(driverId, 'offline');
        isOnlineRef.current = false;
      }
    };
  }, [driverId]);

  // Effect dependente do estado online
  useEffect(() => {
    if (!isOnline) {
      if (gpsRef.current)    { gpsRef.current(); gpsRef.current = null; }
      if (unsubRef1.current) { unsubRef1.current(); unsubRef1.current = null; }
      if (unsubRef2.current) { unsubRef2.current(); unsubRef2.current = null; }
      if (unsubRef3.current) { supabase.removeChannel(unsubRef3.current); unsubRef3.current = null; }
      return;
    }

    const initOnline = async () => {
      const { data: locationRow } = await supabase
        .from('driver_locations')
        .select('online_since, online_minutes_idle')
        .eq('driver_id', driverId)
        .maybeSingle();

      if (locationRow?.online_since) {
        setOnlineSince(locationRow.online_since);
      }
      if (typeof locationRow?.online_minutes_idle === 'number') {
        setIdleMinutes(locationRow.online_minutes_idle);
      }

      // GPS tracking
      gpsRef.current = mapService.watchPosition(async (coords, heading) => {
        setDriverCoords(coords);
        await rideService.updateDriverLocation(driverId, coords, heading);
      });

      // Carregar notificações pendentes da BD (se estava offline)
      await loadPendingNotifications();

      // Subscrição 1: corridas em "searching" (fallback manual)
      const rides = await rideService.getAvailableRides();
      setAvailableRides(rides);
      if (rides.length > 0) {
        const firstRide = rides[0];
        if (!firstRide) {
          return;
        }
        setIncomingRide(prev => {
          if (!prev) { setIsAuctionRide(false); return firstRide; }
          return prev;
        });
      }

      // 2. Subscreve a novas (SEM FILTRO H3 PARA DESENVOLVIMENTO)
      unsubRef1.current = rideService.subscribeToAvailableRides(
        (r) => {
          setAvailableRides(prev => [r, ...prev]);
          setIncomingRide(prev => {
            if (!prev) { setIsAuctionRide(false); return r; }
            return prev;
          });
        },
        (id) => {
          setAvailableRides(prev => prev.filter(r => r.id !== id));
          setIncomingRide(prev => prev?.id === id ? null : prev);
        },
        [] // <-- Removido driverH3Cells aqui para que o motorista de teste receba TODAS as corridas
      );

      // Subscrição 2: passageiro escolheu-me directamente (leilão)
      unsubRef2.current = rideService.subscribeToDriverAssignments(driverId, (r) => {
        if (r.status === RideStatus.ACCEPTED && !r.driver_confirmed) {
          setIncomingRide(prev => {
            if (!prev) { setIsAuctionRide(true); return r; }
            return prev;
          });
        }
      });

      // Subscrição 3: driver_notifications
      subscribeToNotifications();
    };

    initOnline();
  }, [isOnline, driverId, loadPendingNotifications, subscribeToNotifications]);



  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleConfirmAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    try {
      await onConfirmRide(incomingRide.id);
    } finally {
      setIncomingRide(null); setActionLoading(false);
      setPendingNotifCount(0);
    }
  };

  const handleDeclineAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    try {
      await onDeclineRide(incomingRide.id);
    } finally {
      setIncomingRide(null); setActionLoading(false);
    }
  };

  const handleAcceptSearching = async (rideId: string) => {
    setActionLoading(true);
    try {
      await onAcceptRide(rideId);
    } finally {
      setIncomingRide(null); setActionLoading(false);
      setPendingNotifCount(0);
    }
  };

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px', backgroundColor: 'var(--bg)' }}>
      <header className="zr-header">
        <div className="zr-inline zr-inline--between">
          <div>
            <p className="zr-kicker">Motorista</p>
            <h2 className="zr-section-title">Cockpit Operacional</h2>
          </div>
          <div className="zr-inline" style={{ gap: '10px' }}>
            <button className="zr-button zr-button--sm zr-button--ghost" style={{ padding: '4px', minWidth: '40px' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--gold)' }}>smart_toy</span>
            </button>
            <span className={`zr-chip ${isOnline ? 'zr-chip--success' : 'zr-chip--muted'}`}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px', marginRight: '4px' }}>
                {isOnline ? 'toggle_on' : 'toggle_off'}
              </span>
              {isOnline ? 'Online' : 'Offline'}
            </span>
            <div className="zr-avatar">{(profile?.name || 'D').charAt(0).toUpperCase()}</div>
          </div>
        </div>
      </header>

      <div style={{ padding: '14px' }}>
        {/* Banners e Alertas Operacionais */}
        <DocExpiryBanner
          driverId={driverId}
          onOpenDocuments={() => setShowDocsForm(true)}
        />
        
        <FatigueAlert
          isOnline={isOnline}
          onlineHours={onlineHours}
        />

        <MinIncomeGuard
          isOnline={isOnline}
          hasActiveRide={!!ride.rideId}
          idleMinutes={idleMinutes}
        />

        <NightSafetyBanner
          hasEmergencyContact={!!profile?.emergency_contact_phone}
          hasActiveRide={hasActiveRide}
          safetyContextKey={ride.rideId ?? null}
          onActivateSafety={() => {
            if (ride.rideId && profile?.emergency_contact_phone) {
              rideService.autoShareLiveTrackingOnRideStart({
                rideId: ride.rideId,
                ownerUserId: driverId,
                emergencyPhone: profile.emergency_contact_phone,
              });
            }
          }}
        />
        {/* Card de Status e Ganhos */}
        <section className="zr-card" style={{ marginBottom: '14px' }}>
          <div className="zr-inline zr-inline--between" style={{ marginBottom: '14px' }}>
            <div>
              <p className="zr-kicker">Ganhos Estimados</p>
              <h2 className="zr-section-title" style={{ color: 'var(--gold)', fontSize: '24px' }}>
                {simulation ? simulation.dailyEstimateKz.toLocaleString('pt-AO') : '—'} <span style={{ fontSize: '14px' }}>Kz/dia</span>
              </h2>
            </div>
            <button
              onClick={isOnline ? goOffline : goOnline}
              disabled={isSwitchingOnline}
              className={`zr-button ${isOnline ? 'zr-button--secondary' : ''}`}
              style={{ minWidth: '120px' }}
            >
              {isSwitchingOnline ? '...' : isOnline ? 'FICAR OFFLINE' : 'FICAR ONLINE'}
            </button>
          </div>
          
          {todayEarnings > 0 && (
            <div className="zr-alert-box zr-alert-box--success" style={{ padding: '12px' }}>
              <span className="material-symbols-outlined">payments</span>
              <div className="zr-alert-content">
                <strong>Ganhos Hoje: {todayEarnings.toLocaleString('pt-AO')} Kz</strong>
              </div>
            </div>
          )}
          
          {pendingNotifCount > 0 && !incomingRide && (
            <div className="zr-alert-box zr-alert-box--warning" style={{ marginTop: '12px', padding: '12px' }}>
              <span className="material-symbols-outlined">notifications_active</span>
              <div className="zr-alert-content">
                <strong>{pendingNotifCount} corrida{pendingNotifCount > 1 ? 's' : ''} pendente{pendingNotifCount > 1 ? 's' : ''}</strong>
              </div>
            </div>
          )}
        </section>

        {/* Mapa Operacional */}
        <section className="zr-card" style={{ padding: 0, overflow: 'hidden', height: '300px', marginBottom: '14px', position: 'relative', border: '1px solid var(--line)' }}>
          {shouldMountMap ? (
            <Suspense fallback={<div className="zr-empty">A carregar mapa...</div>}>
              <Map3D
                mode="driver"
                center={ride.carLocation ? [ride.carLocation.lng, ride.carLocation.lat] : undefined}
              />
            </Suspense>
          ) : (
            <div className="zr-empty">A preparar mapa...</div>
          )}
          
          <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="zr-chip zr-chip--muted" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', border: '1px solid var(--line)' }}>
              ⛽ 300-350 Kz/L
            </div>
          </div>
          
          <div style={{ position: 'absolute', bottom: '12px', left: '12px', zIndex: 1 }}>
            <div className="zr-chip zr-chip--info" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', border: '1px solid var(--line)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '4px' }}>shield</span>
              Zona Segura
            </div>
          </div>
        </section>

        {/* Copiloto e Gamificação */}
        <DriverCopilot
          isOnline={isOnline}
          hasActiveRide={hasActiveRide}
          driverCoords={driverCoords}
          heatmapData={heatmapData}
        />

        {!isOnline && !ride.rideId && (
          <div style={{ marginBottom: '14px' }}>
            <DriverTierCard driverId={driverId} />
          </div>
        )}

        {/* Segurança e SOS */}
        {isOnline && (
          <section className="zr-card zr-card--danger" style={{ marginBottom: '14px' }}>
            <div className="zr-inline zr-inline--between" style={{ marginBottom: '12px' }}>
              <div>
                <p className="zr-kicker">Safety Driver</p>
                <h3 className="zr-section-title" style={{ fontSize: '16px' }}>Protecção Activa</h3>
              </div>
              <span className="material-symbols-outlined" style={{ color: 'var(--danger)' }}>security</span>
            </div>
            
            {suspiciousPassenger && ride.rideId && (
              <div className="zr-alert-box zr-alert-box--warning" style={{ marginBottom: '14px' }}>
                <span className="material-symbols-outlined">warning</span>
                <div className="zr-alert-content">
                  <strong>Aviso discreto</strong>
                  <p>{suspiciousPassenger.message}</p>
                </div>
              </div>
            )}

            <PanicButton
              userId={driverId}
              rideId={ride.rideId}
              emergencyPhone={profile?.emergency_contact_phone ?? undefined}
              counterpartyName={ride.passengerName}
              counterpartyLabel="Passageiro"
              silentSignal={silentPanicSignal}
              enableScreamDetection={Boolean(ride.rideId)}
            />
            <p className="zr-meta" style={{ marginTop: '12px', textAlign: 'center' }}>
              Triple-tap no ecrã para SOS silencioso
            </p>
          </section>
        )}

        {/* Listagem de Corridas Disponíveis / Convites */}
        <AvailableRidesList 
          isOnline={isOnline}
          incomingRide={incomingRide}
          isAuctionRide={isAuctionRide}
          hasActiveRide={!!ride.rideId}
          actionLoading={actionLoading}
          pendingNotifCount={pendingNotifCount}
          onDeclineAuction={handleDeclineAuction}
          onConfirmAuction={handleConfirmAuction}
          onAcceptSearching={handleAcceptSearching}
          onIgnoreSearching={() => { setIncomingRide(null); setPendingNotifCount(0); }}
        />

        {/* Card de Corrida Activa */}
        <DriverActiveCard 
          ride={ride}
          driverId={driverId}
          onAdvanceStatus={onAdvanceStatus}
        />

        {/* Estado Offline / Dicas */}
        {!isOnline && !ride.rideId && (
          <div className="zr-empty" style={{ padding: '40px 20px', background: 'var(--surface)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--line)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--muted)', marginBottom: '12px' }}>no_accounts</span>
            <h3 className="zr-section-title">Estás Offline</h3>
            <p className="zr-copy">Fica online para começar a receber pedidos de Luanda.</p>
            {simulation?.tips && (
              <div style={{ marginTop: '20px', padding: '12px', borderTop: '1px solid var(--line)' }}>
                <p className="zr-meta">💡 {simulation.tips}</p>
              </div>
            )}
          </div>
        )}

        {/* Canal de Voz/Chat de Motoristas */}
        {isOnline && (
          <div style={{ marginTop: '14px' }}>
            <RideTalk zone="Motoristas" role={UserRole.DRIVER} />
          </div>
        )}
      </div>

      {/* Camadas de Modais (Documentos, Acordos) */}
      {showDocsForm && (
        <DriverDocumentsForm 
          driverId={driverId} 
          onClose={() => setShowDocsForm(false)} 
          onSuccess={(status) => {
            setDriverDocStatus(status as any);
            setShowDocsForm(false);
          }} 
        />
      )}

      {pendingAgreement && (
        <DriverAgreementModal
          agreementId={pendingAgreement.id}
          fleetName={pendingAgreement.fleet_name ?? 'Nova frota'}
          onClose={() => setPendingAgreement(null)}
          onResolved={async () => {
            const { data } = await supabase
              .from('fleet_driver_agreements')
              .select('*, fleets(name)')
              .eq('driver_id', driverId)
              .eq('status', 'pending')
              .order('created_at', { ascending: false })
              .limit(1);

            const agreement = data?.[0] as (FleetDriverAgreementRecord & { fleets?: { name?: string | null } | null }) | undefined;
            setPendingAgreement(agreement ? {
              ...agreement,
              fleet_name: agreement.fleets?.name ?? null,
            } : null);
          }}
        />
      )}
    </div>
  );
};
// Cancela todos os timers pendentes ao desmontar
// =============================================================================
export function useAutoMarkNotificationsRead(
  notifications: Array<{ id: string; read_at: string | null }>,
  onRead: (id: string) => void,
  delayMs = 5000,
) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    notifications.forEach((notif) => {
      if (notif.read_at || timersRef.current.has(notif.id)) return;

      const timer = setTimeout(async () => {
        timersRef.current.delete(notif.id);
        if (!mountedRef.current) return;

        try {
          await supabase
            .from('driver_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', notif.id)
            .eq('read_at', null);

          if (!mountedRef.current) return;
          onRead(notif.id);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[useAutoMarkNotificationsRead] Falha:', notif.id, err);
          }
        }
      }, delayMs);

      timersRef.current.set(notif.id, timer);
    });

    const currentIds = new Set(notifications.map((n) => n.id));
    timersRef.current.forEach((timer, id) => {
      if (!currentIds.has(id)) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    });
  }, [notifications, onRead, delayMs]);
}

export default DriverHome;
