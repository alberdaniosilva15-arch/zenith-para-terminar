// src/services/mapboxRoutingService.ts
// Routing real com Mapbox Directions API — token já existente no projecto

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
  durationText: string;
  geojson: GeoJSON.Feature<GeoJSON.LineString>;
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

export async function getRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<RouteResult> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    `?geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox Directions error: ${res.status}`);

  const data = await res.json();

  if (!data.routes || data.routes.length === 0) {
    throw new Error('Nenhuma rota encontrada entre os pontos seleccionados');
  }

  const route = data.routes[0];
  const distanceKm = parseFloat((route.distance / 1000).toFixed(1));
  const durationSec: number = route.duration;
  const durationMinutes = Math.ceil(durationSec / 60);

  const durationText =
    durationMinutes < 60
      ? `${durationMinutes} min`
      : `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}min`;

  const coords = route.geometry.coordinates as [number, number][];
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);

  return {
    distanceKm,
    durationMinutes,
    durationText,
    geojson: {
      type: 'Feature',
      geometry: route.geometry,
      properties: {},
    },
    bbox: [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ],
  };
}
