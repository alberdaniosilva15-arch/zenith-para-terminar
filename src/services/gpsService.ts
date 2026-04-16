// src/services/gpsService.ts
// GPS REAL — sem fallback hardcoded silencioso

export interface GpsPosition {
  lat: number;
  lng: number;
  accuracy: number; // metros
  source: 'gps' | 'network' | 'fallback';
}

const LUANDA_FALLBACK: GpsPosition = {
  lat: -8.8390,
  lng: 13.2343,
  accuracy: 9999,
  source: 'fallback',
};

/**
 * Obtém posição real do utilizador.
 * Lança erro visível em vez de falhar silenciosamente.
 * Retorna fallback APENAS se o utilizador recusar permissão explicitamente.
 */
export async function getCurrentPosition(): Promise<GpsPosition> {
  if (!navigator.geolocation) {
    console.warn('[GPS] Geolocation não suportado — usando fallback Luanda');
    return LUANDA_FALLBACK;
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: pos.coords.accuracy < 100 ? 'gps' : 'network',
        });
      },
      (err) => {
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          // Utilizador recusou — fallback transparente
          console.warn('[GPS] Permissão negada — usando fallback Luanda');
          resolve(LUANDA_FALLBACK);
        } else {
          // Timeout ou indisponível — rejeita para o UI mostrar erro real
          reject(new Error(
            err.code === GeolocationPositionError.TIMEOUT
              ? 'GPS timeout — verifica se o GPS está activo'
              : 'Não foi possível obter localização'
          ));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Watch contínuo da posição — para tracking do condutor/passageiro em tempo real
 */
export function watchPosition(
  onUpdate: (pos: GpsPosition) => void,
  onError: (msg: string) => void
): () => void {
  if (!navigator.geolocation) {
    onError('Geolocation não suportado');
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => onUpdate({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      source: pos.coords.accuracy < 100 ? 'gps' : 'network',
    }),
    (err) => onError(err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
  );

  // Retorna função de cleanup
  return () => navigator.geolocation.clearWatch(watchId);
}
