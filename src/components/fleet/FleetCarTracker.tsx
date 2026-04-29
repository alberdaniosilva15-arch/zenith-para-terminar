import React, { useEffect, useRef, useState } from 'react';
import type { FleetCarRecord } from '../../types';
import Map3D from '../Map3D';
import mapboxgl from 'mapbox-gl';

interface FleetCarTrackerProps {
  car: FleetCarRecord;
  driverName?: string;
  locationInfo?: { label: string; coords?: [number, number] };
  onClose: () => void;
}

function createWhiteCarMarkerElement() {
  const el = document.createElement('div');
  el.className = 'fleet-car-marker';
  el.style.width = '48px';
  el.style.height = '48px';
  el.style.backgroundColor = '#FFFFFF';
  el.style.borderRadius = '50%';
  el.style.border = '3px solid #E6C364';
  el.style.boxShadow = '0 0 20px rgba(255,255,255,0.5)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.innerHTML = '<span style="font-size:24px;">🚗</span>';
  return el;
}

const FleetCarTracker: React.FC<FleetCarTrackerProps> = ({ car, driverName, locationInfo, onClose }) => {
  const [mapObj, setMapObj] = useState<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const coords = locationInfo?.coords;
  const initialCenter: [number, number] = coords || [13.2344, -8.8383]; // Default Luanda se blackout

  useEffect(() => {
    if (!mapObj) return;

    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }

    if (coords) {
      const el = createWhiteCarMarkerElement();
      markerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat(coords)
        .addTo(mapObj);
      
      mapObj.flyTo({ center: coords, zoom: 16, pitch: 45 });
    }
  }, [mapObj, coords]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#050912] text-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/40 px-4 py-4 backdrop-blur-md">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-primary/70 font-black">Rastreamento Individual</p>
          <h2 className="text-xl font-black">{car.plate}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Map Area */}
      <div className="relative flex-1">
        <Map3D
          center={initialCenter}
          zoom={16}
          pitch={45}
          mode="admin"
          onMapReady={setMapObj}
        />

        {!coords && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10">
            <div className="text-center p-6 bg-black/80 rounded-3xl border border-white/10 max-w-[80%]">
              <span className="text-4xl block mb-4">🛡️</span>
              <h3 className="text-lg font-black text-white mb-2">Localização Oculta</h3>
              <p className="text-sm text-white/60">
                A viatura não pode ser rastreada neste momento devido ao acordo de blackout ativo (privacidade do motorista).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="shrink-0 rounded-t-[2rem] border-t border-white/10 bg-black/90 p-6 backdrop-blur-xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-black">Motorista</p>
            <p className="text-sm font-black mt-1">{driverName ?? 'Nenhum'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-black">Modelo</p>
            <p className="text-sm font-black mt-1">{car.model ?? 'Desconhecido'}</p>
          </div>
          <div className="col-span-2">
            <p className="text-[10px] uppercase tracking-widest text-white/40 font-black">Estado Atual</p>
            <p className="text-sm font-black mt-1 text-primary">{locationInfo?.label ?? 'Sem dados'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FleetCarTracker;
