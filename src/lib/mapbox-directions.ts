const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  geometry: GeoJSON.LineString;
}

export async function getRoute(
  originLng: number, originLat: number,
  destLng:   number, destLat:   number
): Promise<RouteResult | null> {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${originLng},${originLat};${destLng},${destLat}` +
    `?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;

  return {
    distanceKm:  Math.round(route.distance / 1000 * 10) / 10,  // metros → km (1 decimal)
    durationMin: Math.round(route.duration / 60),              // segundos → minutos
    geometry:    route.geometry,
  };
}

// Preço estimado em KZS baseado na distância
export function estimatePrice(distanceKm: number, surgeMultiplier = 1.0): number {
  const BASE_KZS     = 500;   // taxa de partida
  const PER_KM_KZS   = 150;   // por km
  const raw = BASE_KZS + (distanceKm * PER_KM_KZS * surgeMultiplier);
  return Math.round(raw / 50) * 50; // arredondar para múltiplo de 50 KZS
}
