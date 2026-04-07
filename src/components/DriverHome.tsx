// =============================================================================
// ZENITH RIDE v3.1 — DriverHome.tsx
// ✅ FIX: Subscrição Realtime a driver_notifications (resolve broadcast perdido)
//         Quando motorista reconecta → lê notificações pendentes da BD
// ✅ Mantém: subscribeToAvailableRides + subscribeToDriverAssignments (fallback)
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import RideTalk from './RideTalk';
import Map3D from './Map3D';
import AgoraCall from './AgoraCall';
import { geminiService } from '../services/geminiService';
import { rideService } from '../services/rideService';
import { mapService } from '../services/mapService';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { RideState, DbRide } from '../types';
import { RideStatus, UserRole } from '../types';

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
  // Contagem de notificações pendentes não lidas
  const [pendingNotifCount, setPendingNotifCount] = useState(0);

  const gpsRef    = useRef<(() => void) | null>(null);
  const unsubRef1 = useRef<(() => void) | null>(null); // subscribeToAvailableRides
  const unsubRef2 = useRef<(() => void) | null>(null); // subscribeToDriverAssignments
  const unsubRef3 = useRef<ReturnType<typeof supabase.channel> | null>(null); // driver_notifications

  useEffect(() => {
    if (!profile) return;
    geminiService.simulateEarnings({
      rating: profile.rating,
      totalRides: profile.total_rides,
      level: profile.level,
    }).then(s => setSimulation(s));
  }, [profile]);

  // ── Ir online ────────────────────────────────────────────────────────────
  const goOnline = useCallback(async () => {
    setIsOnline(true);
    await rideService.setDriverStatus(driverId, 'available');
  }, [driverId]);

  const goOffline = useCallback(async () => {
    setIsOnline(false);
    setAvailableRides([]);
    setIncomingRide(null);
    await rideService.setDriverStatus(driverId, 'offline');
  }, [driverId]);

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
        .limit(1); // Mostrar apenas a mais recente

      if (!notifs || notifs.length === 0) return;

      setPendingNotifCount(notifs.length);
      const latest = notifs[0];
      const payload = latest.payload as NotifPayload;

      // Converter payload em DbRide mínimo para mostrar popup
      const fakeRide: Partial<DbRide> & { id: string } = {
        id:             payload.ride_id ?? latest.ride_id,
        origin_address: payload.origin_address ?? '—',
        dest_address:   payload.dest_address   ?? '—',
        price_kz:       payload.price_kz       ?? 0,
        distance_km:    payload.distance_km    ?? null,
        status:         RideStatus.SEARCHING,
        driver_id:      null,
        driver_confirmed: false,
        passenger_id:   '',
        origin_lat: 0, origin_lng: 0,
        dest_lat: 0, dest_lng: 0,
        surge_multiplier: 1,
        created_at: latest.created_at ?? new Date().toISOString(),
        accepted_at: null, pickup_at: null, started_at: null,
        completed_at: null, cancelled_at: null, cancel_reason: null,
      };

      setIncomingRide(prev => {
        if (!prev) {
          setIsAuctionRide(false);
          return fakeRide as DbRide;
        }
        return prev;
      });

      // Marcar como lida após mostrar
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
        console.log('[DriverHome] Nova notificação persistente recebida:', notif.ride_id);

        // Criar fake ride para mostrar popup
        const np = notif.payload;
        const fakeRide: Partial<DbRide> & { id: string } = {
          id:             np.ride_id ?? notif.ride_id,
          origin_address: np.origin_address ?? '—',
          dest_address:   np.dest_address   ?? '—',
          price_kz:       np.price_kz       ?? 0,
          distance_km:    np.distance_km    ?? null,
          status:         RideStatus.SEARCHING,
          driver_id:      null,
          driver_confirmed: false,
          passenger_id:   '',
          origin_lat: 0, origin_lng: 0,
          dest_lat: 0, dest_lng: 0,
          surge_multiplier: 1,
          created_at: notif.created_at ?? new Date().toISOString(),
          accepted_at: null, pickup_at: null, started_at: null,
          completed_at: null, cancelled_at: null, cancel_reason: null,
        };

        setIncomingRide(prev => {
          if (!prev) {
            setIsAuctionRide(false);
            return fakeRide as DbRide;
          }
          return prev;
        });

        setPendingNotifCount(c => c + 1);

        // Marcar como lida automaticamente após 5s
        setTimeout(async () => {
          await supabase
            .from('driver_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', notif.id);
        }, 5000);
      })
      .subscribe((status) => {
        console.log('[DriverHome] driver_notifications canal:', status);
      });
  }, [driverId]);

  // ── Ciclo de vida online/offline ───────────────────────────────────────────
  useEffect(() => {
    if (!isOnline) {
      if (gpsRef.current)    { gpsRef.current(); gpsRef.current = null; }
      if (unsubRef1.current) { unsubRef1.current(); unsubRef1.current = null; }
      if (unsubRef2.current) { unsubRef2.current(); unsubRef2.current = null; }
      if (unsubRef3.current) { supabase.removeChannel(unsubRef3.current); unsubRef3.current = null; }
      return;
    }

    const initOnline = async () => {
      // GPS tracking
      gpsRef.current = mapService.watchPosition(async (coords, heading) => {
        await rideService.updateDriverLocation(driverId, coords, heading);
      });

      // Carregar notificações pendentes da BD (se estava offline)
      await loadPendingNotifications();

      // Subscrição 1: corridas em "searching" (fallback manual)
      const rides = await rideService.getAvailableRides();
      setAvailableRides(rides);
      if (rides.length > 0) {
        setIncomingRide(prev => {
          if (!prev) { setIsAuctionRide(false); return rides[0]; }
          return prev;
        });
      }

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
        }
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

      // Subscrição 3: driver_notifications — recebe INSERT mesmo offline
      subscribeToNotifications();
    };

    initOnline();

    return () => {
      if (gpsRef.current)    { gpsRef.current(); gpsRef.current = null; }
      if (unsubRef1.current) { unsubRef1.current(); unsubRef1.current = null; }
      if (unsubRef2.current) { unsubRef2.current(); unsubRef2.current = null; }
      if (unsubRef3.current) { supabase.removeChannel(unsubRef3.current); unsubRef3.current = null; }
    };
  }, [isOnline, driverId, loadPendingNotifications, subscribeToNotifications]);

  useEffect(() => () => {
    if (gpsRef.current)    gpsRef.current();
    if (unsubRef1.current) unsubRef1.current();
    if (unsubRef2.current) unsubRef2.current();
    if (unsubRef3.current) supabase.removeChannel(unsubRef3.current);
    rideService.setDriverStatus(driverId, 'offline');
  }, [driverId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleConfirmAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    await onConfirmRide(incomingRide.id);
    setIncomingRide(null); setActionLoading(false);
    setPendingNotifCount(0);
  };

  const handleDeclineAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    await onDeclineRide(incomingRide.id);
    setIncomingRide(null); setActionLoading(false);
  };

  const handleAcceptSearching = async (rideId: string) => {
    setActionLoading(true);
    await onAcceptRide(rideId);
    setIncomingRide(null); setActionLoading(false);
    setPendingNotifCount(0);
  };

  const nextAction: Record<string, { label: string; next: RideStatus }> = {
    [RideStatus.PICKING_UP]:  { label: 'CHEGUEI AO CLIENTE',  next: RideStatus.IN_PROGRESS },
    [RideStatus.IN_PROGRESS]: { label: 'CONCLUIR CORRIDA',    next: RideStatus.COMPLETED },
  };
  const currentAction = ride.status ? nextAction[ride.status] : null;

  return (
    <div className="p-4 space-y-5 bg-[#F8FAFC] min-h-screen pb-32">

      {/* HUD ganhos + toggle online */}
      <div className="bg-surface-container-low border border-outline-variant/20 p-6 rounded-[2.5rem] shadow-sm flex justify-between items-center">
        <div>
          <p className="text-[10px] font-black text-on-surface-variant/70 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1 h-1 bg-primary rounded-full" /> PREVISÃO DIÁRIA
          </p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-black text-on-surface italic">
              {simulation ? simulation.dailyEstimateKz.toLocaleString('pt-AO') : '—'}
            </span>
            <span className="text-[10px] font-black text-on-surface-variant/70 uppercase">Kz</span>
          </div>
          {simulation?.bestZones?.[0] && (
            <p className="text-[8px] text-on-surface-variant/70 mt-1 font-bold">
              Zona: {simulation.bestZones[0]}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* Badge de notificações pendentes */}
          {pendingNotifCount > 0 && !incomingRide && (
            <span className="text-[8px] font-black bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
              {pendingNotifCount} corrida{pendingNotifCount > 1 ? 's' : ''} pendente{pendingNotifCount > 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={isOnline ? goOffline : goOnline}
            className={`px-8 py-4 rounded-3xl font-black text-[10px] uppercase flex items-center gap-3 active:scale-95 transition-all ${
              isOnline
                ? 'bg-primary/100 text-white shadow-[0_15px_30px_rgba(34,197,94,0.3)]'
                : 'bg-[#0A0A0A] text-white shadow-xl'
            }`}
          >
            <div className="relative">
              <span className={`w-2.5 h-2.5 rounded-full bg-surface-container-low block ${isOnline ? 'animate-pulse' : ''}`} />
              {isOnline && <span className="absolute inset-0 bg-surface-container-low rounded-full animate-ping opacity-50" />}
            </div>
            {isOnline ? 'ONLINE' : 'FICAR ONLINE'}
          </button>
        </div>
      </div>

      {/* Mapa */}
      <div className="aspect-[4/3] w-full relative z-0 overflow-hidden rounded-[3rem] shadow-2xl border-4 border-white">
        <Map3D
          pickup={ride.pickupCoords}
          destination={ride.destCoords}
          carLocation={ride.carLocation}
          status={ride.status}
        />
        <div className="absolute top-6 right-6 bg-surface-container-low/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-outline-variant/20 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/8 rounded-xl flex items-center justify-center text-xl">⛽</div>
          <div>
            <p className="text-[8px] font-black text-on-surface-variant/70 uppercase">Média Luanda</p>
            <p className="text-xs font-black text-on-surface">300 Kz/L</p>
          </div>
        </div>
        <div className="absolute bottom-6 left-6 bg-[#0A0A0A]/90 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-xl flex items-center gap-3">
          <span className="text-xs">🛡️</span>
          <div>
            <p className="text-[8px] font-black text-primary uppercase">Vigilante</p>
            <p className="text-[10px] font-black text-white uppercase">Zona Segura</p>
          </div>
        </div>
      </div>

      {/* POPUP: passageiro escolheu-te (leilão / driver_notifications) */}
      {isOnline && incomingRide && isAuctionRide && !ride.rideId && (
        <div className="bg-surface-container-low border-2 border-primary p-8 rounded-[3.5rem] shadow-[0_40px_100px_rgba(230,195,100,0.1)] animate-in slide-in-from-bottom-20 duration-500">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl">🎯</span>
            <div>
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">Passageiro escolheu-te!</p>
              <p className="text-[9px] text-on-surface-variant/70 font-bold">Confirma para começar a corrida</p>
            </div>
          </div>
          <InfoRow icon="📍" label="Origem"  value={incomingRide.origin_address} />
          <InfoRow icon="🏁" label="Destino" value={incomingRide.dest_address} />
          <div className="flex gap-2 my-4">
            <Pill label={`${incomingRide.price_kz.toLocaleString('pt-AO')} Kz`} blue />
            {incomingRide.distance_km && <Pill label={`${incomingRide.distance_km.toFixed(1)} km`} />}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              onClick={handleDeclineAuction}
              disabled={actionLoading}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-all disabled:opacity-60"
            >
              Recusar
            </button>
            <button
              onClick={handleConfirmAuction}
              disabled={actionLoading}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-primary text-white shadow-xl hover:bg-primary transition-all active:scale-95 disabled:opacity-60"
            >
              {actionLoading ? <Spinner /> : 'CONFIRMAR'}
            </button>
          </div>
        </div>
      )}

      {/* POPUP: nova corrida em searching (via driver_notifications ou fallback) */}
      {isOnline && incomingRide && !isAuctionRide && !ride.rideId && (
        <div className="bg-surface-container-low border-2 border-outline-variant p-8 rounded-[3.5rem] shadow-2xl animate-in slide-in-from-bottom-20 duration-500">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-3 h-3 bg-primary rounded-full animate-ping" />
            <div>
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">
                Nova corrida disponível
              </p>
              <p className="text-[8px] text-on-surface-variant/60 font-bold uppercase">
                Notificação persistente · não se perde
              </p>
            </div>
          </div>
          <InfoRow icon="📍" label="Origem"  value={incomingRide.origin_address} />
          <InfoRow icon="🏁" label="Destino" value={incomingRide.dest_address} />
          <div className="flex gap-2 my-4">
            <Pill label={`${incomingRide.price_kz.toLocaleString('pt-AO')} Kz`} blue />
            {incomingRide.distance_km && <Pill label={`${incomingRide.distance_km.toFixed(1)} km`} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setIncomingRide(null); setPendingNotifCount(0); }}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-surface-container-low text-on-surface-variant hover:bg-surface-container transition-all"
            >
              Ignorar
            </button>
            <button
              onClick={() => handleAcceptSearching(incomingRide.id)}
              disabled={actionLoading}
              className="py-5 rounded-3xl font-black text-[10px] uppercase bg-[#0A0A0A] text-white shadow-xl hover:bg-surface-container-highest transition-all active:scale-95 disabled:opacity-60"
            >
              {actionLoading ? <Spinner /> : 'ACEITAR'}
            </button>
          </div>
        </div>
      )}

      {/* Corrida activa — avançar estado + VoIP */}
      {currentAction && ride.rideId && (
        <div className="bg-surface-container-low border border-primary/20 p-6 rounded-[2.5rem] vault-shadow space-y-4">
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 golden-gradient rounded-2xl flex items-center justify-center text-lg font-headline font-bold shrink-0">
              {(ride.passengerName ?? 'P').charAt(0)}
            </div>
            <div>
              <p className="font-black text-on-surface text-sm">Corrida activa</p>
              <p className="text-[10px] text-on-surface-variant font-label truncate">
                {ride.pickup} → {ride.destination}
              </p>
            </div>
          </div>

          <AgoraCall
            corridaId={ride.rideId}
            userId={driverId}
            peerName={ride.passengerName ?? 'Passageiro'}
            onEndCall={() => {}}
          />

          <button
            onClick={() => onAdvanceStatus(currentAction.next)}
            className="w-full py-5 golden-gradient rounded-3xl font-black text-[10px] uppercase tracking-widest vault-shadow active:scale-95 luxury-transition"
          >
            {currentAction.label}
          </button>
          <button
            onClick={() => onAdvanceStatus(RideStatus.CANCELLED)}
            className="w-full py-3 text-error font-black text-[9px] uppercase tracking-widest hover:bg-error/10 rounded-2xl luxury-transition"
          >
            Cancelar corrida
          </button>
        </div>
      )}

      {/* Offline */}
      {!isOnline && !ride.rideId && (
        <div className="bg-surface-container-low rounded-[2.5rem] p-8 text-center">
          <p className="text-3xl mb-3">🏍️</p>
          <p className="font-black text-on-surface-variant uppercase text-[10px] tracking-widest">Estás offline</p>
          <p className="text-xs text-on-surface-variant/70 mt-2 font-bold">
            Clica em FICAR ONLINE para receber corridas
          </p>
          {simulation?.tips && (
            <p className="text-[10px] text-primary font-bold mt-4 italic">💡 {simulation.tips}</p>
          )}
        </div>
      )}

      {isOnline && <RideTalk zone="Motoristas" role={UserRole.DRIVER} />}
    </div>
  );
};

// ── Sub-componentes ────────────────────────────────────────────────────────────
const InfoRow: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex gap-3 items-start mb-3">
    <span className="text-lg shrink-0">{icon}</span>
    <div className="min-w-0">
      <p className="text-[8px] font-black text-on-surface-variant/70 uppercase">{label}</p>
      <p className="text-sm font-black text-on-surface truncate">{value}</p>
    </div>
  </div>
);

const Pill: React.FC<{ label: string; blue?: boolean }> = ({ label, blue }) => (
  <span className={`text-[10px] font-black px-3 py-1.5 rounded-full ${
    blue ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant'
  }`}>
    {label}
  </span>
);

const Spinner = () => (
  <span className="flex items-center justify-center gap-2">
    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
    A processar...
  </span>
);

export default DriverHome;
