// src/components/LocationSearchPanel.tsx
// Search autocomplete real com Mapbox Geocoding API
// GPS real sem hardcode
// Mostra rota + distância + ETA no mapa
// Design superior ao Yango — tema dark Zenith Ride

import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { getCurrentPosition, watchPosition } from '../services/gpsService';
import { getRoute } from '../services/mapboxRoutingService';
import { drawRoute, clearRoute } from '../map/mapRoutingLayer';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// ── Tipos ────────────────────────────────────────────────────────────────────
interface SearchResult {
  id: string;
  place_name: string;
  text: string;
  place_type: string[];
  center: [number, number]; // [lng, lat]
  distanceKm?: number;
}

interface Props {
  mapRef: React.MutableRefObject<mapboxgl.Map | null>;
  onRideRequest?: (data: {
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
    distanceKm: number;
    durationMinutes: number;
  }) => void;
}

// ── Utilitários ───────────────────────────────────────────────────────────────
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPlaceIcon(types: string[]): string {
  if (types.includes('airport')) return '✈️';
  if (types.includes('poi')) return '📍';
  if (types.includes('address')) return '🏠';
  if (types.includes('neighborhood') || types.includes('locality')) return '🏘️';
  if (types.includes('place')) return '🏙️';
  return '📍';
}

// ── Componente Principal ──────────────────────────────────────────────────────
export function LocationSearchPanel({ mapRef, onRideRequest }: Props) {
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLabel, setGpsLabel] = useState('A obter localização...');
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsSource, setGpsSource] = useState<'gps' | 'network' | 'fallback' | null>(null);

  const [destQuery, setDestQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedDest, setSelectedDest] = useState<SearchResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{
    distanceKm: number;
    durationText: string;
    durationMinutes: number;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originMarker = useRef<mapboxgl.Marker | null>(null);
  const destMarker = useRef<mapboxgl.Marker | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── GPS real ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let stopWatch: (() => void) | null = null;

    getCurrentPosition()
      .then(async (pos) => {
        setUserPos({ lat: pos.lat, lng: pos.lng });
        setGpsAccuracy(pos.accuracy);
        setGpsSource(pos.source);

        // Reverse geocode para mostrar nome do local actual
        const revUrl =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
          `${pos.lng},${pos.lat}.json` +
          `?types=address,neighborhood,locality,place` +
          `&language=pt` +
          `&access_token=${MAPBOX_TOKEN}`;

        const rev = await fetch(revUrl);
        const revData = await rev.json();
        const name = revData.features?.[0]?.place_name?.split(',')[0] ?? 'A tua localização';
        setGpsLabel(name);

        // Coloca marker do utilizador no mapa
        if (mapRef.current) {
          if (originMarker.current) originMarker.current.remove();

          const el = document.createElement('div');
          el.style.cssText = `
            width:18px;height:18px;
            background:#00D4FF;
            border:3px solid #fff;
            border-radius:50%;
            box-shadow:0 0 0 4px rgba(0,212,255,0.25), 0 0 16px rgba(0,212,255,0.6);
          `;
          originMarker.current = new mapboxgl.Marker({ element: el })
            .setLngLat([pos.lng, pos.lat])
            .addTo(mapRef.current);

          mapRef.current.flyTo({
            center: [pos.lng, pos.lat],
            zoom: 15,
            duration: 1200,
          });
        }

        // Watch contínuo para actualizar posição
        stopWatch = watchPosition(
          (updated) => {
            setUserPos({ lat: updated.lat, lng: updated.lng });
            originMarker.current?.setLngLat([updated.lng, updated.lat]);
          },
          () => {} // Erros de watch são silenciosos
        );
      })
      .catch((err: Error) => {
        setError(err.message + ' - A usar Luanda Centro (Fallback) para cálculo de distâncias.');
        setGpsLabel('Centro de Luanda');
        setUserPos({ lat: -8.8390, lng: 13.2343 }); // Fallback Luanda para não quebrar a UI
      });

    return () => { stopWatch?.(); };
  }, []);

  // ── Search autocomplete ─────────────────────────────────────────────────────
  const searchPlaces = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }

      setSearching(true);
      setError(null);

      try {
        const proximity = userPos
          ? `&proximity=${userPos.lng},${userPos.lat}`
          : `&proximity=13.2343,-8.8390`;

        const bbox = '12.8,-9.5,14.3,-7.5';

        // 1. Mapbox API — Focus em bairros e vias estruturantes + POIs grandes
        const mbUrl =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
          `${encodeURIComponent(query)}.json` +
          `?country=AO` +
          `&language=pt` +
          `&types=poi,address,neighborhood,locality,place` +
          `&limit=8` +
          proximity +
          `&bbox=${bbox}` +
          `&access_token=${MAPBOX_TOKEN}`;

        // 2. Photon API (OpenStreetMap) — Ibatível para Hospedarias, Colégios, Restaurantes africanos
        const phUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&bbox=${bbox}&limit=12`;

        const [mbRes, phRes] = await Promise.allSettled([
          fetch(mbUrl).then(r => r.json()),
          fetch(phUrl).then(r => r.json()),
        ]);

        const mapboxFeatures = mbRes.status === 'fulfilled' ? (mbRes.value.features || []) : [];
        const photonFeatures = phRes.status === 'fulfilled' ? (phRes.value.features || []) : [];

        // Traduzir Mapbox
        const mbParsed: SearchResult[] = mapboxFeatures.map((f: any) => ({
          id: f.id,
          place_name: f.place_name,
          text: f.text,
          place_type: f.place_type,
          center: f.center,
          distanceKm: userPos
            ? parseFloat(haversineKm(userPos.lat, userPos.lng, f.center[1], f.center[0]).toFixed(1))
            : undefined,
        }));

        // Traduzir Photon
        const phParsed: SearchResult[] = photonFeatures.map((f: any) => {
          const props = f.properties || {};
          const label = props.name || props.street || props.city || 'Desconhecido';
          const full = [label, props.street, props.city].filter(Boolean).join(', ');
          return {
            id: `photon-${props.osm_id || Math.random()}`,
            place_name: full,
            text: label,
            place_type: ['poi'], // força ícone POI
            center: f.geometry.coordinates as [number, number],
            distanceKm: userPos
              ? parseFloat(haversineKm(userPos.lat, userPos.lng, f.geometry.coordinates[1], f.geometry.coordinates[0]).toFixed(1))
              : undefined,
          };
        });

        // Combinar e ordenar interlavado ou apenas Photon primeiro (escolas/hospedarias vêm daqui)
        // Usar Map para remover duplicados pelo nome exacto
        const combinedMap = new Map<string, SearchResult>();
        [...phParsed, ...mbParsed].forEach(item => {
          if (!combinedMap.has(item.text.toLowerCase())) {
            combinedMap.set(item.text.toLowerCase(), item);
          }
        });

        // Ordenar por distância
        const finalResults = Array.from(combinedMap.values()).sort((a, b) => {
          if (a.distanceKm && b.distanceKm) return a.distanceKm - b.distanceKm;
          return 0;
        });

        setResults(finalResults.slice(0, 15));
      } catch (err) {
        console.warn('Geocoding error:', err);
        setError('Erro na pesquisa — verifica a ligação');
      } finally {
        setSearching(false);
      }
    },
    [userPos]
  );

  const handleQueryChange = (val: string) => {
    setDestQuery(val);
    setSelectedDest(null);
    setRouteInfo(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchPlaces(val), 350);
  };

  // ── Selecciona destino e calcula rota ────────────────────────────────────────
  const handleSelectDest = async (result: SearchResult) => {
    setSelectedDest(result);
    setDestQuery(result.text);
    setResults([]);

    if (!userPos || !mapRef.current) return;

    const dest = { lat: result.center[1], lng: result.center[0] };

    // Marker destino
    if (destMarker.current) destMarker.current.remove();
    const el = document.createElement('div');
    el.style.cssText = `
      width:14px;height:14px;
      background:#FF5A1F;
      border:3px solid #fff;
      border-radius:50%;
      box-shadow:0 0 0 4px rgba(255,90,31,0.25), 0 0 12px rgba(255,90,31,0.5);
    `;
    destMarker.current = new mapboxgl.Marker({ element: el })
      .setLngLat([dest.lng, dest.lat])
      .addTo(mapRef.current);

    // Calcula rota real
    setRouteLoading(true);
    setError(null);

    try {
      const route = await getRoute(userPos, dest);
      drawRoute(mapRef.current, route);
      setRouteInfo({
        distanceKm: route.distanceKm,
        durationText: route.durationText,
        durationMinutes: route.durationMinutes,
      });
      
      if (onRideRequest) {
        onRideRequest({
          origin: { lat: userPos.lat, lng: userPos.lng, label: gpsLabel },
          destination: { lat: dest.lat, lng: dest.lng, label: result.text },
          distanceKm: route.distanceKm,
          durationMinutes: route.durationMinutes,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Não foi possível calcular a rota');
      clearRoute(mapRef.current);
    } finally {
      setRouteLoading(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setDestQuery('');
    setSelectedDest(null);
    setResults([]);
    setRouteInfo(null);
    setError(null);
    if (mapRef.current) clearRoute(mapRef.current);
    if (destMarker.current) { destMarker.current.remove(); destMarker.current = null; }
    inputRef.current?.focus();
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Painel de Search ── */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        zIndex: 10,
        padding: '16px 16px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        pointerEvents: 'none',
      }}>

        {/* Origem — GPS real */}
        <div style={{
          background: 'rgba(10,12,18,0.92)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: '18px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          pointerEvents: 'auto',
          boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            width: 10, height: 10,
            background: gpsSource === 'fallback' ? '#FFB020' : '#00D4FF',
            borderRadius: '50%',
            flexShrink: 0,
            boxShadow: `0 0 8px ${gpsSource === 'fallback' ? '#FFB020' : '#00D4FF'}`,
            animation: gpsSource === null ? 'pulse 1.2s infinite' : 'none',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
              Recolha
            </div>
            <div style={{ fontSize: 14, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {gpsLabel}
            </div>
          </div>
          {gpsAccuracy !== null && gpsSource !== 'fallback' && (
            <div style={{ fontSize: 10, color: 'rgba(0,212,255,0.6)', flexShrink: 0 }}>
              ±{Math.round(gpsAccuracy)}m
            </div>
          )}
        </div>

        {/* Destino — Search */}
        <div style={{
          background: 'rgba(10,12,18,0.92)',
          backdropFilter: 'blur(20px)',
          border: `1px solid ${destQuery ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: '18px',
          overflow: 'visible',
          pointerEvents: 'auto',
          boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
          transition: 'border-color 0.2s',
          position: 'relative',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', gap: '12px' }}>
            <div style={{
              width: 10, height: 10,
              background: '#FF5A1F',
              borderRadius: '2px',
              flexShrink: 0,
              transform: 'rotate(45deg)',
              boxShadow: '0 0 8px rgba(255,90,31,0.6)',
            }} />
            <input
              ref={inputRef}
              value={destQuery}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Para onde vais?"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                caretColor: '#00D4FF',
              }}
            />
            {searching && (
              <div style={{
                width: 14, height: 14,
                border: '2px solid rgba(0,212,255,0.3)',
                borderTopColor: '#00D4FF',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
                flexShrink: 0,
              }} />
            )}
            {destQuery && !searching && (
              <button
                onClick={handleReset}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: 'rgba(255,255,255,0.5)',
                  width: 22, height: 22,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  fontSize: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >✕</button>
            )}
          </div>

          {/* Resultados da pesquisa */}
          {results.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0, right: 0,
              background: 'rgba(10,12,18,0.97)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(0,212,255,0.2)',
              borderTop: 'none',
              borderRadius: '0 0 18px 18px',
              overflow: 'hidden',
              zIndex: 20,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}>
              {results.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => handleSelectDest(r)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,212,255,0.07)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>
                    {getPlaceIcon(r.place_type)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      color: '#fff',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {r.text}
                    </div>
                    <div style={{
                      fontSize: 11, color: 'rgba(255,255,255,0.35)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      marginTop: 2,
                    }}>
                      {r.place_name.replace(r.text + ', ', '')}
                    </div>
                  </div>
                  {r.distanceKm !== undefined && (
                    <div style={{
                      fontSize: 12, fontWeight: 700,
                      color: 'rgba(0,212,255,0.7)',
                      flexShrink: 0,
                    }}>
                      {r.distanceKm} km
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Info Card — ETA + Distância (inferior) ── */}
      {(routeLoading || routeInfo) && (
        <div style={{
          position: 'absolute',
          bottom: 100, left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          pointerEvents: 'none',
        }}>
          {routeLoading ? (
            <div style={{
              background: 'rgba(10,12,18,0.92)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '50px',
              padding: '12px 24px',
              display: 'flex', alignItems: 'center', gap: '10px',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 13,
              boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
            }}>
              <div style={{
                width: 14, height: 14,
                border: '2px solid rgba(0,212,255,0.3)',
                borderTopColor: '#00D4FF',
                borderRadius: '50%',
                animation: 'spin 0.7s linear infinite',
              }} />
              A calcular rota...
            </div>
          ) : routeInfo && (
            <div style={{
              background: 'rgba(10,12,18,0.95)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(0,212,255,0.25)',
              borderRadius: '20px',
              padding: '14px 28px',
              display: 'flex', alignItems: 'center', gap: '28px',
              boxShadow: '0 0 40px rgba(0,212,255,0.12), 0 8px 32px rgba(0,0,0,0.6)',
              whiteSpace: 'nowrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: 18 }}>⏱</span>
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    Chegada
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
                    {routeInfo.durationText}
                  </div>
                </div>
              </div>
              <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: 18 }}>📍</span>
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    Distância
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#00D4FF' }}>
                    {routeInfo.distanceKm} km
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Erro ── */}
      {error && (
        <div style={{
          position: 'absolute',
          top: 170, left: 16, right: 16,
          zIndex: 10,
          background: 'rgba(220,50,50,0.15)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(220,50,50,0.3)',
          borderRadius: '14px',
          padding: '12px 16px',
          color: '#FF6B6B',
          fontSize: 13,
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚠️</span> {error}
        </div>
      )}

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
