// src/services/angolaLocationsService.ts
// Dynamic loader para angolaLocations.ts — evita carregar 685 KB no bundle inicial
import type { DetailedLocationResult } from '../data/angolaLocations';

let _modPromise: Promise<typeof import('../data/angolaLocations')> | null = null;

export function getAngolaLocationsModule(): Promise<typeof import('../data/angolaLocations')> {
  if (!_modPromise) {
    _modPromise = import('../data/angolaLocations');
  }
  return _modPromise;
}

export async function searchAngolaLocationsLazy(
  query: string,
  limit = 35
): Promise<DetailedLocationResult[]> {
  const mod = await getAngolaLocationsModule();
  return mod.searchAngolaLocations(query, limit);
}

export async function getAllAngolaLocationsLazy(): Promise<DetailedLocationResult[]> {
  const mod = await getAngolaLocationsModule();
  return mod.ANGOLA_LOCATIONS;
}

// Prefetch em background quando o browser estiver idle ou quando o usuário focar no input de busca
export function prefetchAngolaLocations(): void {
  if (typeof window !== 'undefined') {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        getAngolaLocationsModule();
      });
    } else {
      setTimeout(() => {
        getAngolaLocationsModule();
      }, 1500);
    }
  }
}
