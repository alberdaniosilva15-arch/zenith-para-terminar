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

  // Timeout de 8 segundos para evitar spinners infinitos se a rede do telemóvel falhar
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('[Mapbox] Timeout ou erro de rede', error);
    return null;
  }

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

// ⚠️ Aqui vivia um `estimatePrice(distanceKm, surge)` com uma tarifa escrita à
// mão — `BASE_KZS = 500` e `PER_KM_KZS = 150`. Foi REMOVIDO em 16/09/2026.
//
// A razão: não existe fórmula de preço em TypeScript nenhum. A fonte de verdade
// é a função Postgres `calculate_fare_engine_pro`, que lê `pricing_config`.
// Duplicá-la aqui fazia com que o valor mostrado divergisse do cobrado — e a
// função nunca chegou a ser usada por ninguém (estava exportada e morta), o que
// só servia para alguém a voltar a ligar por engano.
//
// Quem precisa de um preço usa `src/services/fareQuote.ts`.
