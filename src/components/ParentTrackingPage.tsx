// =============================================================================
// ZENITH RIDE v3.0 — src/components/ParentTrackingPage.tsx
//
// Página pública para os pais acompanharem a corrida escolar.
// Acessível via: /track/:token (SEM login)
//
// Para activar, adicionar esta rota no main.tsx:
//   import ParentTrackingPage from './components/ParentTrackingPage';
//
//   // Em main.tsx, antes de renderizar <App />:
//   const path = window.location.pathname;
//   const trackMatch = path.match(/^\/track\/([0-9a-f-]{36})$/);
//   if (trackMatch) {
//     ReactDOM.createRoot(document.getElementById('root')!).render(
//       <React.StrictMode>
//         <ParentTrackingPage token={trackMatch[1]} />
//       </React.StrictMode>
//     );
//   } else {
//     // render App normal
//   }
// =============================================================================

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { rideService } from '../services/rideService';

interface ParentTrackingPageProps {
  token: string;
}

interface TrackingData {
  session_id:     string;
  contract_title: string;
  driver_name:    string;
  status:         string;
  origin:         string;
  destination:    string;
  expires_at:     string;
  driver_lat?:    number;
  driver_lng?:    number;
}

const ParentTrackingPage: React.FC<ParentTrackingPageProps> = ({ token }) => {
  const [data,    setData]    = useState<TrackingData | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let sessionChannel: any = null;
    let rideChannel: any = null;
    let driverLocUnsub: (() => void) | null = null;

    const cleanupRide = () => {
      if (rideChannel) { supabase.removeChannel(rideChannel); rideChannel = null; }
      if (driverLocUnsub) { driverLocUnsub(); driverLocUnsub = null; }
    };

    const handleSession = (session: any) => {
      if (!mounted) return;
      if (!session) { setExpired(true); setLoading(false); return; }
      if (new Date(session.expires_at) < new Date()) { setExpired(true); setLoading(false); return; }

      const ride = (session as any).rides;
      const contract = (session as any).contracts;
      const driverName = ride?.profiles?.name ?? 'Motorista';

      setData({
        session_id:     session.id,
        contract_title: contract?.title ?? 'Contrato Escolar',
        driver_name:    driverName,
        status:         ride?.status ?? session.status,
        origin:         ride?.origin_address ?? '',
        destination:    ride?.dest_address ?? '',
        expires_at:     session.expires_at,
        driver_lat:     ride?.driver_lat ?? undefined,
        driver_lng:     ride?.driver_lng ?? undefined,
      });

      setLoading(false);

      // Subscrever updates da corrida específica
      cleanupRide();
      if (ride?.id) {
        rideChannel = supabase.channel(`parent-tracking-ride:${ride.id}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${ride.id}` }, (p: any) => {
            const updated = p.new as any;
            setData(prev => prev ? ({
              ...prev,
              status: updated.status ?? prev.status,
              origin: updated.origin_address ?? prev.origin,
              destination: updated.dest_address ?? prev.destination,
            }) : prev);

            if (updated.driver_id && !driverLocUnsub) {
              driverLocUnsub = rideService.subscribeToDriverLocation(updated.driver_id, (coords) => {
                setData(prev => prev ? ({ ...prev, driver_lat: coords.lat, driver_lng: coords.lng }) : prev);
              });
            }

            if (updated.status === 'completed' || updated.status === 'cancelled') {
              cleanupRide();
            }
          })
          .subscribe();
      }
    };

    (async () => {
      const { data: session } = await supabase
        .from('school_tracking_sessions')
        .select(`
          id, status, expires_at,
          contracts ( title ),
          rides (
            id, status, origin_address, dest_address, driver_id,
            profiles!rides_driver_id_fkey ( name )
          )
        `)
        .eq('public_token', token)
        .maybeSingle();

      handleSession(session as any);

      // Subscrever alterações na sessão (por token público)
      sessionChannel = supabase.channel(`parent-tracking:${token}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'school_tracking_sessions', filter: `public_token=eq.${token}` }, (p: any) => {
          handleSession(p.new);
        })
        .subscribe();
    })();

    return () => {
      mounted = false;
      if (sessionChannel) supabase.removeChannel(sessionChannel);
      cleanupRide();
    };
  }, [token]);

  const loadSession = async () => {
    const { data: session } = await supabase
      .from('school_tracking_sessions')
      .select(`
        id, status, expires_at,
        contracts ( title ),
        rides (
          status,
          origin_address, dest_address,
          driver_id,
          profiles!rides_driver_id_fkey ( name )
        )
      `)
      .eq('public_token', token)
      .maybeSingle();

    if (!session) { setExpired(true); setLoading(false); return; }
    if (new Date(session.expires_at) < new Date()) { setExpired(true); setLoading(false); return; }

    const ride = (session as any).rides;
    const contract = (session as any).contracts;
    const driverName = ride?.profiles?.name ?? 'Motorista';

    setData({
      session_id:     session.id,
      contract_title: contract?.title ?? 'Contrato Escolar',
      driver_name:    driverName,
      status:         ride?.status ?? session.status,
      origin:         ride?.origin_address ?? '',
      destination:    ride?.dest_address ?? '',
      expires_at:     session.expires_at,
    });

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050912] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (expired || !data) {
    return (
      <div className="min-h-screen bg-[#050912] flex flex-col items-center justify-center p-8 text-center">
        <span className="text-5xl mb-6">🔒</span>
        <h1 className="text-white font-black text-xl mb-3">Link expirado</h1>
        <p className="text-white/40 text-sm">
          Este link de rastreamento já expirou ou é inválido.
          Pede ao motorista para gerar um novo link.
        </p>
      </div>
    );
  }

  const statusLabel: Record<string, string> = {
    searching:   '🔍 À procura de motorista',
    accepted:    '✓ Motorista confirmado',
    picking_up:  '🚗 A caminho da escola',
    in_progress: '🚀 Em rota',
    completed:   '✅ Chegou ao destino',
    cancelled:   '❌ Corrida cancelada',
  };

  const isEnRoute = ['picking_up', 'in_progress'].includes(data.status);

  return (
    <div className="min-h-screen bg-[#050912] flex flex-col">
      {/* Header */}
      <div className="bg-[#0A0A0A] px-6 py-5 flex items-center gap-3 border-b border-white/5">
        <div className="px-4 py-1.5 bg-primary rounded-full font-black text-sm text-white italic">
          Zenith Ride
        </div>
        <div>
          <p className="text-white font-black text-sm">{data.contract_title}</p>
          <p className="text-white/30 text-[9px] font-bold uppercase tracking-widest">Rastreamento ao vivo</p>
        </div>
      </div>

      {/* Status principal */}
      <div className="p-6 flex-1 space-y-5">
        {/* Status badge */}
        <div className={`rounded-[2.5rem] p-5 ${
          data.status === 'completed' ? 'bg-primary/10 border border-primary/30' :
          data.status === 'cancelled' ? 'bg-red-900/50 border border-red-500/30' :
          'bg-primary/8 border border-primary/20'
        }`}>
          <p className="text-white font-black text-xl text-center">
            {statusLabel[data.status] ?? data.status}
          </p>
        </div>

        {/* Info do motorista */}
        <div className="bg-surface-container-low/5 rounded-[2rem] p-5 flex items-center gap-4">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center font-black text-white text-xl shrink-0">
            {data.driver_name.charAt(0)}
          </div>
          <div>
            <p className="text-[8px] font-black text-white/30 uppercase tracking-widest mb-1">Motorista</p>
            <p className="text-white font-black text-sm">{data.driver_name}</p>
            <p className="text-white/40 text-[9px] font-bold">Zenith Ride · Motorista verificado</p>
          </div>
          {isEnRoute && (
            <div className="ml-auto">
              <div className="w-3 h-3 bg-primary rounded-full animate-pulse" />
            </div>
          )}
        </div>

        {/* Rota */}
        {data.origin && (
          <div className="bg-surface-container-low/5 rounded-[2rem] p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <div>
                <p className="text-[8px] font-black text-white/30 uppercase tracking-widest">Origem</p>
                <p className="text-white text-sm font-bold">{data.origin}</p>
              </div>
            </div>
            <div className="border-l-2 border-dashed border-white/10 ml-1 pl-4 py-1">
              <p className="text-[9px] text-white/20 font-bold">Em rota</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              <div>
                <p className="text-[8px] font-black text-white/30 uppercase tracking-widest">Destino</p>
                <p className="text-white text-sm font-bold">{data.destination}</p>
              </div>
            </div>
          </div>
        )}

        {/* Expiração */}
        <p className="text-center text-white/20 text-[9px] font-bold">
          Link válido até {new Date(data.expires_at).toLocaleTimeString('pt-AO', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
};

export default ParentTrackingPage;
