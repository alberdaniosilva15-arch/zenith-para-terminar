import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useIdleMount } from "../hooks/useIdleMount";
import type { Map3DHandle } from "./Map3D";
import { DriverTracker } from "../lib/driverTracker";

const Map3D = React.lazy(() => import("./Map3D"));

interface TrackingPoint {
  lat: number;
  lng: number;
}

interface DriverTrackingPoint extends TrackingPoint {
  heading?: number;
  updatedAt?: string | null;
}

interface RideTrackingInfo {
  id: string;
  status: string;
  studentName: string;
  driverId: string | null;
  destination: [number, number] | null;
  driverLocation: DriverTrackingPoint | null;
}

interface TrackingRpcRow {
  ride_id: string;
  status: string;
  student_name: string;
  driver_id: string | null;
  dest_coords?: { lat?: unknown; lng?: unknown } | null;
  driver_coords?: { lat?: unknown; lng?: unknown } | null;
  driver_heading?: unknown;
  driver_updated_at?: string | null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrackingPoint(value: TrackingRpcRow["dest_coords"] | TrackingRpcRow["driver_coords"]): TrackingPoint | null {
  if (!value || typeof value !== "object") return null;
  const lat = toFiniteNumber(value.lat);
  const lng = toFiniteNumber(value.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

export default function ParentTrackingPage() {
  const { token } = useParams<{ token: string }>();

  const [ride, setRide] = useState<RideTrackingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const shouldMountMap = useIdleMount(!loading);

  const mapRef = useRef<Map3DHandle>(null);
  const trackerRef = useRef<DriverTracker | null>(null);

  const refreshTracking = useCallback(async (initial = false): Promise<boolean> => {
    if (!token) {
      if (initial) {
        setError("Link de rastreio invalido ou expirado.");
        setLoading(false);
      }
      return false;
    }

    if (initial) {
      setLoading(true);
      setError(null);
    }

    try {
      const { data, error: rpcErr } = await supabase.rpc("validate_tracking_token", {
        p_token: token,
      });

      const rows = Array.isArray(data) ? (data as TrackingRpcRow[]) : [];
      if (rpcErr || rows.length === 0) {
        if (initial) {
          setError("Link de rastreio invalido ou expirado.");
        }
        return false;
      }

      const info = rows[0];
      const destination = toTrackingPoint(info.dest_coords);
      const driverPoint = toTrackingPoint(info.driver_coords);
      const heading = toFiniteNumber(info.driver_heading);

      setRide((previous) => ({
        id: info.ride_id,
        status: info.status ?? previous?.status ?? "searching",
        studentName: info.student_name ?? previous?.studentName ?? "Passageiro",
        driverId: info.driver_id ?? null,
        destination: destination ? [destination.lng, destination.lat] : previous?.destination ?? null,
        driverLocation: driverPoint
          ? {
              lat: driverPoint.lat,
              lng: driverPoint.lng,
              ...(heading != null ? { heading } : {}),
              updatedAt: info.driver_updated_at ?? null,
            }
          : previous?.driverLocation ?? null,
      }));

      return true;
    } catch (fetchError) {
      console.warn("[ParentTrackingPage] refreshTracking falhou:", fetchError);
      if (initial) {
        setError("Erro de ligacao ao servidor.");
      }
      return false;
    } finally {
      if (initial) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    let intervalId: number | null = null;

    void (async () => {
      const ok = await refreshTracking(true);
      if (!active || !ok) return;

      intervalId = window.setInterval(() => {
        void refreshTracking(false);
      }, 5000);
    })();

    return () => {
      active = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [refreshTracking]);

  useEffect(() => {
    return () => {
      trackerRef.current?.destroy();
      trackerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ride?.destination) return;
    mapRef.current?.flyTo({
      center: ride.destination,
      zoom: 14,
      pitch: 45,
      duration: 1200,
    });
  }, [ride?.destination]);

  useEffect(() => {
    if (!ride?.driverLocation || !trackerRef.current) return;
    trackerRef.current.updateLocation({
      lng: ride.driverLocation.lng,
      lat: ride.driverLocation.lat,
      heading: ride.driverLocation.heading,
    });
  }, [ride?.driverLocation]);

  const handleMapReady = (map: mapboxgl.Map) => {
    trackerRef.current?.destroy();
    trackerRef.current = new DriverTracker(map);

    if (ride?.destination) {
      map.flyTo({
        center: ride.destination,
        zoom: 14,
        pitch: 45,
        duration: 2000,
      });
    }

    if (ride?.driverLocation) {
      trackerRef.current.updateLocation({
        lng: ride.driverLocation.lng,
        lat: ride.driverLocation.lat,
        heading: ride.driverLocation.heading,
      });
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
          <span className="text-4xl">!</span>
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-white/40 text-[10px] font-black uppercase tracking-[0.3em] mt-6">
          Zenith Orbital Tracking
        </p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen relative bg-[#0B0B0B] overflow-hidden">
      <Suspense
        fallback={
          <div className="w-screen h-screen bg-[#0B0B0B] flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        }
      >
        {shouldMountMap ? (
          <Map3D
            ref={mapRef}
            mode="tracking"
            onMapReady={handleMapReady}
          />
        ) : (
          <div className="w-screen h-screen bg-[#0B0B0B] flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </Suspense>

      <div className="absolute top-0 left-0 right-0 p-6 pointer-events-none">
        <div className="max-w-md mx-auto flex items-start justify-between">
          <div className="bg-[#0B0B0B]/80 backdrop-blur-2xl border border-white/10 p-5 rounded-[2.5rem] shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 bg-primary rounded-3xl flex items-center justify-center font-black text-white text-2xl shadow-lg shadow-primary/20">
                {ride?.studentName?.charAt(0) || "Z"}
              </div>
              <div>
                <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] mb-1">
                  Passageiro Monitorizado
                </p>
                <h2 className="text-white font-black text-xl leading-none">
                  {ride?.studentName || "Sincronizando..."}
                </h2>
                <div className="mt-3 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${ride?.status === "in_progress" ? "bg-green-500 animate-pulse" : "bg-primary"}`} />
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

      <div className="absolute bottom-10 left-0 right-0 pointer-events-none flex flex-col items-center gap-2 opacity-30">
        <div className="w-1 h-1 bg-green-500 rounded-full animate-ping" />
        <p className="text-[8px] font-black text-white tracking-[0.6em] uppercase">
          Zenith Orbital Systems - Luanda, AO
        </p>
      </div>
    </div>
  );
}
