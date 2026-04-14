// src/components/ParentTrackingPage.tsx
// FASE 2 — Página de Rastreio Parental (Acesso Público via Token)
// Segurança: Validação via RPC validate_tracking_token

import { useEffect, useState, useRef, Suspense } from "react";
import React from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Map3DHandle } from "./Map3D";
import { DriverTracker } from "../lib/driverTracker";

const Map3D = React.lazy(() => import("./Map3D"));

// ─── Tipos ────────────────────────────────────────────────────
interface RideTrackingInfo {
  id:           string;
  status:       string;
  studentName:  string;
  driverId:     string | null;
  destination:  [number, number] | null;
}

// ─── Componente ───────────────────────────────────────────────
export default function ParentTrackingPage() {
  const { token } = useParams<{ token: string }>();
  
  // Estados
  const [ride,  setRide]  = useState<RideTrackingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Refs para instâncias persistentes
  const mapRef     = useRef<Map3DHandle>(null);
  const trackerRef = useRef<DriverTracker | null>(null);

  // ── 1. Validar token e buscar dados da corrida ─────────────
  useEffect(() => {
    if (!token) return;

    const fetchRideData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Chamada RPC que valida o token e a expiração (Segurança)
        const { data, error: rpcErr } = await supabase.rpc("validate_tracking_token", {
          p_token: token
        });

        if (rpcErr || !data || data.length === 0) {
          setError("Link de rastreio inválido ou expirado.");
          return;
        }

        const info = data[0];
        setRide({
          id:           info.ride_id,
          status:       info.status,
          studentName:  info.student_name,
          driverId:     info.driver_id,
          destination:  info.dest_coords ? [info.dest_coords.lng, info.dest_coords.lat] : null,
        });

      } catch (err) {
        setError("Erro de ligação ao servidor.");
      } finally {
        setLoading(false);
      }
    };

    fetchRideData();
  }, [token]);

  // ── 2. Subscrever localização em tempo real (Supabase) ─────
  useEffect(() => {
    if (!ride?.driverId) return;

    // Criar canal de subscrição
    const channel = supabase
      .channel(`tracking_${ride.id}`)
      .on(
        "postgres_changes",
        {
          event:  "UPDATE",
          schema: "public",
          table:  "driver_locations",
          filter: `driver_id=eq.${ride.driverId}`,
        },
        (payload) => {
          const newLoc = payload.new as { lat: number; lng: number; heading?: number };
          if (trackerRef.current) {
            trackerRef.current.updateLocation({
              lng:     newLoc.lng,
              lat:     newLoc.lat,
              heading: newLoc.heading,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ride?.id, ride?.driverId]);

  // ── 3. Inicializar Tracker quando o mapa estiver pronto ────
  const handleMapReady = (map: mapboxgl.Map) => {
    if (trackerRef.current) trackerRef.current.destroy();
    
    trackerRef.current = new DriverTracker(map);

    // Focar no destino se existir
    if (ride?.destination) {
      map.flyTo({
        center: ride.destination,
        zoom:   14,
        pitch:  45,
        duration: 2000,
      });
    }
  };

  // ── Renderização: Erro ──────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
          <span className="text-4xl">🔒</span>
        </div>
        <h1 className="text-white text-2xl font-black mb-2">Acesso Restrito</h1>
        <p className="text-white/40 max-w-xs">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-8 px-8 py-3 bg-white/5 border border-white/10 rounded-full text-white/60 text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all"
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  // ── Renderização: Loading ───────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-white/40 text-[10px] font-black uppercase tracking-[0.3em] mt-6">Zenith Orbital Tracking</p>
      </div>
    );
  }

  // ── Renderização: UI de Rastreio ────────────────────────────
  return (
    <div className="w-screen h-screen relative bg-[#0B0B0B] overflow-hidden">
      
      {/* MAPA (Fundo) */}
      <Suspense fallback={<div className="w-screen h-screen bg-[#0B0B0B] flex items-center justify-center"><div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
        <Map3D 
          ref={mapRef}
          mode="tracking"
          onMapReady={handleMapReady}
        />
      </Suspense>

      {/* OVERLAY: HUD de Informação */}
      <div className="absolute top-0 left-0 right-0 p-6 pointer-events-none">
        <div className="max-w-md mx-auto flex items-start justify-between">
          
          <div className="bg-[#0B0B0B]/80 backdrop-blur-2xl border border-white/10 p-5 rounded-[2.5rem] shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-primary rounded-3xl flex items-center justify-center font-black text-white text-2xl shadow-lg shadow-primary/20">
                {ride?.studentName?.charAt(0) || "Z"}
              </div>
              <div>
                <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mb-1">Passageiro Escolar</p>
                <h2 className="text-white font-black text-xl leading-none">{ride?.studentName || "Sincronizando..."}</h2>
                <div className="mt-3 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${ride?.status === "in_progress" ? "bg-green-500 animate-pulse" : "bg-primary"}`}></div>
                  <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest">
                    {ride?.status?.replace("_", " ") || "Procurando..."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-primary/95 px-5 py-2.5 rounded-full font-black text-[9px] text-white italic shadow-xl shadow-primary/30">
            ZENITH LIVE
          </div>
        </div>
      </div>

      {/* FOOTER: Status da Rede */}
      <div className="absolute bottom-10 left-0 right-0 pointer-events-none flex flex-col items-center gap-2 opacity-30">
        <div className="w-1 h-1 bg-green-500 rounded-full animate-ping" />
        <p className="text-[8px] font-black text-white tracking-[0.6em] uppercase">Zenith Orbital Systems — Luanda, AO</p>
      </div>

    </div>
  );
}
