// =============================================================================
// ZENITH RIDE v3.0 — cache.ts
// Cache em memória com TTL para evitar queries repetidas à BD/API
// =============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class MemoryCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs: number): void {
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ─── Instâncias singleton ────────────────────────────────────────────────────

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
const FIVE_MIN = 5 * 60 * 1000;
const THIRTY_SEC = 30 * 1000;

/** Cache de preços por zona (muda raramente) */
export const zonePriceCache = new MemoryCache<{ origin: string; dest: string; price: number }>(100);

/** Cache de geocoding Mapbox (endereços não mudam) */
export const geocodeCache = new MemoryCache<{ lat: number; lng: number }>(200);

/** Cache de perfis de motorista (mudam lentamente) */
export const profileCache = new MemoryCache<{ name: string; avatar_url: string | null; rating: number; total_rides: number; level: string }>(100);

/** Cache de active ride (evita re-reads imediatos) */
export const activeRideCache = new MemoryCache<unknown>(1);

/** Cache genérico para serviços diversos */
export const serviceCache = new MemoryCache<unknown>(100);

// ─── Helpers de TTL ──────────────────────────────────────────────────────────

export const TTL = {
  ZONE_PRICE: ONE_HOUR,
  GEOCODE: ONE_DAY,
  PROFILE: FIVE_MIN,
  ACTIVE_RIDE: THIRTY_SEC,
  SERVICE: FIVE_MIN,
} as const;
