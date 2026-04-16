// =============================================================================
// ZENITH RIDE — src/lib/geo.ts
// Utilitários geográficos centralizados (deduplicados de 4 ficheiros)
// =============================================================================

/**
 * Distância Haversine em metros entre dois pontos
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Distância Haversine em quilómetros entre dois pontos
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  return haversineMeters(lat1, lng1, lat2, lng2) / 1000;
}

/**
 * Distância Haversine em km entre dois objetos LatLng
 */
export function haversineKmLatLng(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng);
}
