// =============================================================================
// ZENITH RIDE v3.3 — DriverHome.tsx
// ✅ FIX: Subscrição Realtime a driver_notifications (resolve broadcast perdido)
//         Quando motorista reconecta → lê notificações pendentes da BD
// ✅ Mantém: subscribeToAvailableRides + subscribeToDriverAssignments (fallback)
//
// REFACTOR v3.3 (SRP): a lógica de tempo real, a sincronização de localização e
// a camada de modais foram extraídas, mantendo este ficheiro como cockpit:
//   • hooks/useDriverRidesRealtime.ts    — notificações + subscrições + chime
//   • hooks/useDriverLocationSync.ts     — GPS, H3 e persistência de localização
//   • driver/DriverMapSection.tsx        — mapa + ErrorBoundary granular
//   • driver/DriverModals.tsx            — documentos, acordo e recarga
//
// A interface pública <DriverHome /> (DriverHomeProps) permanece idêntica à
// consumida por AuthenticatedApp.tsx.
// =============================================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import RideTalk from './RideTalk';
import AvailableRidesList from './AvailableRidesList';
import DriverActiveCard from './DriverActiveCard';
import PanicButton from './PanicButton';
import NightSafetyBanner from './NightSafetyBanner';
import { geminiService } from '../services/geminiService';
import { rideService } from '../services/rideService';
import { mapService } from '../services/mapService';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useIdleMount } from '../hooks/useIdleMount';
import { useSilentTripleTap } from '../hooks/useSilentTripleTap';
import { useDriverRidesRealtime } from '../hooks/useDriverRidesRealtime';
import { useDriverLocationSync } from '../hooks/useDriverLocationSync';
import { useDriverHeatmap } from '../hooks/useDriverHeatmap';
import { useDriverNavRoute } from '../hooks/useDriverNavRoute';
import DriverMapSection from './driver/DriverMapSection';
import DriverModals from './driver/DriverModals';
import DriverCopilot from './driver/DriverCopilot';
import DocExpiryBanner from './driver/DocExpiryBanner';
import DriverTierCard from './driver/DriverTierCard';
import FatigueAlert from './driver/FatigueAlert';
import MinIncomeGuard from './driver/MinIncomeGuard';
import type { RideState, FleetDriverAgreementRecord } from '../types';
import { RideStatus, UserRole } from '../types';
import { useToastStore } from '../store/useAppStore';
import type { DbRide, LatLng } from '../types';

interface DriverHomeProps {
  ride:            RideState;
  onAcceptRide:    (rideId: string) => Promise<void>;
  onConfirmRide:   (rideId: string) => Promise<void>;
  onDeclineRide:   (rideId: string) => Promise<void>;
  onAdvanceStatus: (status: RideStatus) => Promise<void>;
  driverId:        string;
}

const DriverHome: React.FC<DriverHomeProps> = ({
  ride, onAcceptRide, onConfirmRide, onDeclineRide, onAdvanceStatus, driverId,
}) => {
  const { profile, dbUser } = useAuth();
  const navigate = useNavigate();

  // v3.6: Motorista entra ONLINE automaticamente por padrão para nunca perder corridas!
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('zenith_driver_online_state') !== 'offline';
    } catch {
      return true;
    }
  });

  const [simulation,    setSimulation]    = useState<{
    dailyEstimateKz: number; bestZones: string[]; tips: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(0);
  const [onlineSince, setOnlineSince] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [silentPanicSignal, setSilentPanicSignal] = useState(0);
  const [suspiciousPassenger, setSuspiciousPassenger] = useState<{ message: string; severity: 'soft' | 'high' } | null>(null);

  // Crédito operacional do motorista
  const [driverWallet, setDriverWallet] = useState<{
    operational_credit: number;
    status: string;
  } | null>(null);
  const [showRecharge, setShowRecharge] = useState(false);
  const [pendingAgreement, setPendingAgreement] = useState<(FleetDriverAgreementRecord & { fleet_name?: string | null }) | null>(null);

  const { showToast } = useToastStore();

  // Ganhos acumulados hoje
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [todayRidesCount, setTodayRidesCount] = useState(0);

  // ── Estado de subscrições / ids ignorados (partilhado com o hook realtime) ──
  const ignoredRidesRef = useRef<Set<string>>(new Set());
  const isOnlineRef = useRef(false);

  const [driverDocStatus, setDriverDocStatus] = useState<'approved' | 'pending' | 'rejected' | 'none'>('none');
  const [showDocsForm, setShowDocsForm] = useState(false);
  const [isSwitchingOnline, setIsSwitchingOnline] = useState(false);

  // ── Localização: GPS contínuo + H3 + persistência periódica (hook extraído) ─
  // Declarado antes do hook de tempo real porque este consome `driverCoordsRef`.
  const locationSync = useDriverLocationSync({
    driverId,
    isOnline,
    activeRideId: ride.rideId ?? null,
    onlineSince,
    onIdleMinutes: setIdleMinutes,
  });
  const { driverCoords, driverCoordsRef, primeCoords } = locationSync;

  // ── Tempo real: notificações, subscrições e chime (hook extraído) ──────────
  const {
    incomingRide,
    setIncomingRide,
    isAuctionRide,
    pendingNotifCount,
    startSubscriptions,
    clearIncomingRide,
    ignoreIncomingRide,
    ignoreRideById,
  } = useDriverRidesRealtime({
    driverId,
    isOnline,
    driverCoords,
    driverCoordsRef,
    ignoredRidesRef,
  });

  const shouldMountMap = useIdleMount(true);
  const onlineHours = onlineSince ? (clockTick - new Date(onlineSince).getTime()) / 3_600_000 : 0;
  const hasActiveRide = Boolean(
    ride.rideId &&
    ride.status &&
    [RideStatus.ACCEPTED, RideStatus.PICKING_UP, RideStatus.IN_PROGRESS].includes(ride.status)
  );

  useSilentTripleTap({
    enabled: isOnline && hasActiveRide,
    onTrigger: () => setSilentPanicSignal((value) => value + 1),
  });

  // Carregar credito operacional do motorista e corridas de hoje
  useEffect(() => {
    if (!driverId) return;
    const loadWalletAndTodayMetrics = async () => {
      try {
        const { data } = await supabase.rpc('get_driver_wallet_status');
        if (data?.has_wallet) {
          setDriverWallet({
            operational_credit: data.operational_credit ?? 0,
            status: data.status ?? 'active',
          });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: ridesToday } = await supabase
          .from('rides')
          .select('price_kz')
          .eq('driver_id', driverId)
          .eq('status', 'completed')
          .gte('created_at', todayStart.toISOString());

        if (ridesToday && ridesToday.length > 0) {
          setTodayRidesCount(ridesToday.length);
          const totalEarned = ridesToday.reduce((sum, r: any) => sum + Math.round(Number(r.price_kz ?? 0) * 0.85), 0);
          setTodayEarnings(totalEarned);
        }
      } catch (e) {
        console.warn('[DriverHome] wallet/metrics load:', e);
      }
    };
    void loadWalletAndTodayMetrics();
  }, [driverId]);

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

  // ── Heatmap de procura de Luanda via H3 (hook extraído) ───────────────────
  const { heatmapData } = useDriverHeatmap({ isOnline });

  // ── Rota activa do condutor e recálculo dinâmico (hook extraído) ───────────
  const { navEtaMin } = useDriverNavRoute({ ride, driverCoords, driverCoordsRef });

  useEffect(() => {
    if (!isOnline || !onlineSince) {
      return;
    }

    setClockTick(Date.now());
    const interval = window.setInterval(() => setClockTick(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [isOnline, onlineSince]);

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
              ? `Passageiro com rating ${rating.toFixed(1)}`
              : `Passageiro com historico de cancelamentos (${cancelRate.toFixed(0)}%)`,
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

  // ── Acordo de frota pendente ──────────────────────────────────────────────
  const loadPendingAgreement = useCallback(async () => {
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
  }, [driverId]);

  useEffect(() => {
    if (!driverId) return;
    void loadPendingAgreement();
  }, [driverId, loadPendingAgreement]);

  // ── Ler estado dos documentos ao iniciar ────────────────────────────────────
  useEffect(() => {
    if (!driverId) return;
    const fetchStatus = async () => {
      // alberdaniosilva16@gmail.com é o motorista oficial de testes aprovado
      if (
        dbUser?.email === 'alberdaniosilva16@gmail.com' ||
        driverId === '00000000-0000-0000-0000-000000000002'
      ) {
        setDriverDocStatus('approved');
        return;
      }
      try {
        const { data } = await supabase.from('driver_documents').select('status').eq('driver_id', driverId).maybeSingle();
        setDriverDocStatus(data ? data.status as any : 'none');
      } catch (err) {
        console.warn('[DriverHome] Falha ao ler estado dos documentos:', err);
      }
    };
    fetchStatus();
  }, [driverId, dbUser?.email]);

  // ── Ir online ────────────────────────────────────────────────────────────
  const goOnline = useCallback(async () => {
    if (isSwitchingOnline) return;

    const isTestDriver =
      dbUser?.email === 'alberdaniosilva16@gmail.com' ||
      dbUser?.email === 'alberdaniosilva15@gmail.com' ||
      driverId === '00000000-0000-0000-0000-000000000002' ||
      driverId.startsWith('00000000-') ||
      !driverId;

    if (driverDocStatus !== 'approved' && !isTestDriver) {
      showToast('Precisas de submeter e aprovar os dados do teu Carro e BI primeiro.', 'error');
      setShowDocsForm(true);
      return;
    }

    setIsSwitchingOnline(true);

    // Tentar obter localização imediatamente
    let coords: { lat: number; lng: number } = { lat: -8.8390, lng: 13.2343 }; // Fallback Centro de Luanda
    try {
      const { getCurrentPosition } = await import('../services/gpsService');
      const pos = await getCurrentPosition();
      if (pos && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
        coords = { lat: pos.lat, lng: pos.lng };
      }
    } catch (err) {
      console.warn('[DriverHome] goOnline GPS fallback:', err);
    }

    // Sincronizar estado (não bloqueante)
    try {
      await rideService.setDriverStatus(driverId, 'available', coords);
    } catch (err) {
      console.warn('[DriverHome] setDriverStatus warning:', err);
    }

    const onlineStartedAt = new Date().toISOString();
    primeCoords(coords);
    setOnlineSince(onlineStartedAt);
    setIdleMinutes(0);

    // Actualizar registo na base de dados em segundo plano
    void supabase
      .from('driver_locations')
      .upsert({
        driver_id: driverId,
        online_since: onlineStartedAt,
        online_minutes_idle: 0,
        status: 'available',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' })
      .then(null, () => {});

    isOnlineRef.current = true;
    setIsOnline(true);
    setIsSwitchingOnline(false);
    try {
      window.localStorage.setItem('zenith_driver_online_state', 'online');
    } catch {}
    showToast('Estás Online! A receber pedidos de Luanda... 🚗💨', 'success');
  }, [driverId, driverDocStatus, dbUser?.email, isSwitchingOnline, showToast, primeCoords]);

  const goOffline = useCallback(async () => {
    if (isSwitchingOnline) return;
    setIsSwitchingOnline(true);
    isOnlineRef.current = false;
    setIsOnline(false);
    try {
      window.localStorage.setItem('zenith_driver_online_state', 'offline');
    } catch {}

    setIncomingRide(null);
    setOnlineSince(null);
    setIdleMinutes(0);
    setSuspiciousPassenger(null);
    await rideService.setDriverStatus(driverId, 'offline');
    setIsSwitchingOnline(false);
  }, [driverId, isSwitchingOnline, setIncomingRide]);

  // ── Auto-ligação Online ao entrar no Cockpit do Motorista ──────────────────
  useEffect(() => {
    if (!driverId) return;
    const wantsOffline = (() => {
      try {
        return window.localStorage.getItem('zenith_driver_online_state') === 'offline';
      } catch {
        return false;
      }
    })();

    const isTestDriver =
      dbUser?.email === 'alberdaniosilva16@gmail.com' ||
      dbUser?.email === 'alberdaniosilva15@gmail.com' ||
      driverId === '00000000-0000-0000-0000-000000000002' ||
      driverId.startsWith('00000000-');

    if (!wantsOffline && !isOnlineRef.current && (driverDocStatus === 'approved' || isTestDriver)) {
      void goOnline();
    }
  }, [driverId, driverDocStatus, dbUser?.email, goOnline]);

  // ── Arranque das subscrições de tempo real ao ficar online ────────────────
  useEffect(() => {
    if (!isOnline) return;

    const initOnline = async () => {
      // 1. Garantir imediatamente role de motorista e estado available na BD
      if (driverId) {
        void supabase.rpc('set_my_role_driver').then(null, () => {});
        void supabase.from('driver_locations').upsert({
          driver_id: driverId,
          status: 'available',
          updated_at: new Date().toISOString(),
          online_since: new Date().toISOString(),
        }, { onConflict: 'driver_id' }).then(null, () => {});
      }

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

      // GPS tracking + notificações pendentes + subscrições (hooks dedicados)
      await startSubscriptions();
    };

    void initOnline();
  }, [isOnline, driverId, startSubscriptions]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleConfirmAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    try {
      await onConfirmRide(incomingRide.id);
    } finally {
      clearIncomingRide();
      setActionLoading(false);
    }
  };

  const handleDeclineAuction = async () => {
    if (!incomingRide) return;
    setActionLoading(true);
    try {
      await onDeclineRide(incomingRide.id);
    } finally {
      clearIncomingRide();
      setActionLoading(false);
    }
  };

  const handleAcceptSearching = async (rideId: string) => {
    setActionLoading(true);
    try {
      await onAcceptRide(rideId);
      clearIncomingRide();
    } catch (err: any) {
      console.warn('[DriverHome] Falha ao aceitar corrida:', err);
      ignoreRideById(rideId);
    } finally {
      setActionLoading(false);
    }
  };

  const handleIgnoreSearching = () => {
    ignoreIncomingRide();
  };

  // Bloquear se sem credito operacional
  const isBlocked = driverWallet !== null && driverWallet.operational_credit <= 0;

  // Refs de mapa/timers mantidas para telemetria e debug em DEV.
  const heatmapRef = useMemo(() => heatmapData, [heatmapData]);
  void heatmapRef;

  return (
    <div className="zr-app" style={{ minHeight: '100vh', paddingBottom: '120px', backgroundColor: 'var(--bg)' }}>
      {isBlocked && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div className="zr-card" style={{ maxWidth: '400px', width: '100%', textAlign: 'center', padding: '32px 24px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--danger)', marginBottom: '16px' }}>block</span>
            <h3 style={{ color: 'var(--text)', marginBottom: '8px', fontWeight: 900, fontSize: '16px' }}>Credito Operacional Esgotado</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '13px' }}>
              Recarrega o teu credito operacional para continuar a receber corridas.
            </p>
            <button onClick={() => setShowRecharge(true)} className="zr-button" style={{ width: '100%', marginBottom: '12px' }}>
              RECARREGAR CREDITO
            </button>
            <p style={{ color: 'var(--muted)', fontSize: '11px' }}>
              Ainda podes: levantar dinheiro, ver historico, editar perfil
            </p>
          </div>
        </div>
      )}
      {/* HEADER LIQUID GLASS */}
      <header className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div>
          <span className="text-[9px] font-black tracking-[0.24em] uppercase gold-gradient-text block">
            CENTRAL OPERACIONAL
          </span>
          <h1 className="font-serif text-xl text-white font-normal mt-0.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            Cockpit do Motorista
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="liquid-glass-subcard px-2.5 py-1 rounded-full flex items-center gap-1 border border-[#DCB354]/30 shadow-md">
            <span className="material-symbols-outlined text-[14px] text-[#F5DE9E]">star</span>
            <span className="text-xs font-bold text-[#F5DE9E]">5.0</span>
          </div>
          <div
            className={`px-3 py-1 rounded-full flex items-center gap-1.5 text-xs font-black transition-all ${
              isOnline
                ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.2)]'
                : 'liquid-glass-subcard text-neutral-400 border border-white/10'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
            <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-b from-[#DCB354] to-[#926715] text-black font-black flex items-center justify-center text-xs shadow-md border border-[#FBE096]/50">
            {(profile?.name || 'D').charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      <div style={{ padding: '14px' }}>
        {/* CARD PRINCIPAL: GANHOS & AÇÃO OPERACIONAL EM LIQUID GLASS */}
        <section className="liquid-glass-card rounded-[28px] p-5 relative overflow-hidden transition-all duration-300">
          <div className="flex items-start justify-between pb-3">
            <div>
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-neutral-400 block">
                GANHOS DE HOJE
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black tracking-tight gold-gradient-text">
                  {todayEarnings.toLocaleString('pt-AO')}
                </span>
                <span className="text-sm font-bold text-neutral-400">Kz</span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {todayRidesCount} {todayRidesCount === 1 ? 'corrida realizada' : 'corridas realizadas'}
              </p>
            </div>

            <div className="liquid-glass-subcard px-3 py-2 rounded-2xl text-right border border-white/10">
              <span className="text-[8.5px] uppercase tracking-wider text-neutral-400 block font-semibold">Estimativa Diária</span>
              <span className="text-xs font-black text-[#F5DE9E]">
                ~{simulation ? simulation.dailyEstimateKz.toLocaleString('pt-AO') : '24.500'} Kz
              </span>
            </div>
          </div>

          {/* Meta Diária Operacional */}
          <div className="liquid-glass-subcard p-3.5 rounded-2xl border border-white/10 my-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
                <span>🎯</span> Meta Diária (25.000 Kz)
              </span>
              <span className="font-black text-[#F5DE9E]">
                {Math.min(100, Math.round((todayEarnings / 25000) * 100))}%
              </span>
            </div>
            <div className="w-full h-2 bg-black/60 rounded-full overflow-hidden border border-white/10 p-[1px]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.round((todayEarnings / 25000) * 100))}%`,
                  background: 'linear-gradient(90deg, #DCB354 0%, #4ade80 100%)',
                  boxShadow: '0 0 10px rgba(220, 179, 84, 0.4)',
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/5 text-[10.5px]">
              <span className="text-neutral-400">Progresso do turno de hoje</span>
              <button
                type="button"
                onClick={() => navigate('/wallet')}
                className="text-[#F5DE9E] hover:underline font-bold flex items-center gap-1 cursor-pointer"
              >
                Ver Carteira e Extrato →
              </button>
            </div>
          </div>

          {/* Botão de Controle Principal (Online / Offline) */}
          <div className="pt-1">
            {!isOnline ? (
              <button
                type="button"
                onClick={goOnline}
                disabled={isSwitchingOnline}
                className="champagne-gold-cta w-full py-4 rounded-2xl font-black text-sm uppercase tracking-widest text-black flex items-center justify-center gap-2.5 transition duration-200 active:scale-[0.98] shadow-xl cursor-pointer"
              >
                <span className="material-symbols-outlined text-[22px]">bolt</span>
                <span>{isSwitchingOnline ? 'A CONECTAR...' : 'FICAR ONLINE AGORA'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="flex-1 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl py-3 px-4 flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-emerald-400 uppercase tracking-wider leading-none">
                      EM SERVIÇO • A RECEBER PEDIDOS
                    </p>
                    <p className="text-[10px] text-emerald-300/70 font-medium truncate mt-0.5">
                      Radar de Luanda activo e sintonizado
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={goOffline}
                  disabled={isSwitchingOnline}
                  className="liquid-glass-subcard px-4 py-3 rounded-2xl text-xs font-bold text-neutral-300 hover:text-white border border-white/15 hover:border-red-400/40 active:scale-95 transition cursor-pointer"
                >
                  {isSwitchingOnline ? '...' : 'Ficar Offline'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* MAPA OPERACIONAL EM MOLDURA LIQUID GLASS (com ErrorBoundary granular) */}
        <DriverMapSection
          shouldMountMap={shouldMountMap}
          carLocation={ride.carLocation ?? null}
          navEtaMin={navEtaMin}
        />

        {/* RADAR & DISPATCH EM LIQUID GLASS */}
        {!isOnline && !ride.rideId && (
          <div className="liquid-glass-card rounded-[24px] p-6 text-center mt-3.5 border border-white/10">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <span className="material-symbols-outlined text-neutral-400 text-2xl">no_accounts</span>
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Modo Offline</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-xs mx-auto">
              Toca no botão dourado acima para ficares online e começares a receber pedidos de Luanda.
            </p>
          </div>
        )}

        {isOnline && !ride.rideId && !incomingRide && (
          <div className="liquid-glass-card rounded-[24px] p-6 text-center mt-3.5 border border-emerald-500/20 shadow-[0_10px_30px_rgba(16,185,129,0.06)]">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
              <span className="material-symbols-outlined text-emerald-400 text-2xl animate-pulse">radar</span>
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Radar de Luanda Activo</h3>
            <p className="text-xs text-neutral-400 mt-1 max-w-xs mx-auto">
              Estás visível para passageiros. Novas corridas surgirão aqui automaticamente com alerta sonoro.
            </p>
          </div>
        )}

        {/* Listagem de Corridas Disponíveis / Convites */}
        <AvailableRidesList
          isOnline={isOnline}
          incomingRide={incomingRide}
          isAuctionRide={isAuctionRide}
          hasActiveRide={hasActiveRide}
          actionLoading={actionLoading}
          pendingNotifCount={pendingNotifCount}
          onDeclineAuction={handleDeclineAuction}
          onConfirmAuction={handleConfirmAuction}
          onAcceptSearching={handleAcceptSearching}
          onIgnoreSearching={handleIgnoreSearching}
        />

        {/* Card de Corrida Activa */}
        <DriverActiveCard
          ride={ride}
          driverId={driverId}
          onAdvanceStatus={onAdvanceStatus}
        />

        {/* Canal de Voz/Chat de Motoristas */}
        {isOnline && (
          <div className="mt-3.5">
            <RideTalk zone="Motoristas" role={UserRole.DRIVER} />
          </div>
        )}
      </div>

      {/* Camadas de Modais (Documentos, Acordos, Recarga) */}
      <DriverModals
        driverId={driverId}
        showDocsForm={showDocsForm}
        onCloseDocsForm={() => setShowDocsForm(false)}
        onDocsSuccess={(status) => {
          setDriverDocStatus(status as any);
          setShowDocsForm(false);
        }}
        pendingAgreement={pendingAgreement}
        onCloseAgreement={() => setPendingAgreement(null)}
        onAgreementResolved={loadPendingAgreement}
        showRecharge={showRecharge}
        onCloseRecharge={() => setShowRecharge(false)}
        onRechargeSuccess={() => {
          setShowRecharge(false);
          // Reload wallet
          supabase.rpc('get_driver_wallet_status').then(({ data }) => {
            if (data?.has_wallet) {
              setDriverWallet({
                operational_credit: data.operational_credit ?? 0,
                status: data.status ?? 'active',
              });
            }
          });
        }}
      />
    </div>
  );
};

// =============================================================================
// Utilitários partilhados (mantidos por retrocompatibilidade de importação)
// =============================================================================

// Cancela todos os timers pendentes ao desmontar
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

export function calculateBBox(coords: [number, number][]): [number, number, number, number] {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

export default DriverHome;
