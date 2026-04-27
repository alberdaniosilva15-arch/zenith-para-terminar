// =============================================================================
// ZENITH RIDE v3.0 — useAppStore.ts
// Store Zustand global: Auth + Ride + DriverTracking
// =============================================================================

import { create } from 'zustand';
import type { DbUser, DbProfile, RideState, AuctionState, PostRideState, LatLng } from '../types';
import { RideStatus, UserRole } from '../types';

// ─── Tipos das slices ─────────────────────────────────────────────────────────

interface AuthSlice {
  dbUser:   DbUser | null;
  profile:  DbProfile | null;
  role:     UserRole;
  setUser:  (user: DbUser | null, profile: DbProfile | null) => void;
  clearUser: () => void;
  updateProfile: (data: Partial<Pick<DbProfile, 'name' | 'avatar_url' | 'phone'>>) => void;
}

interface RideSlice {
  ride:     RideState;
  auction:  AuctionState;
  postRide: PostRideState;
  setRide:     (partial: Partial<RideState>) => void;
  resetRide:   () => void;
  setAuction:  (partial: Partial<AuctionState>) => void;
  resetAuction: () => void;
  setPostRide: (state: PostRideState) => void;
  resetPostRide: () => void;
}

interface DriverTrackingSlice {
  driverCoords:    LatLng | null;
  isTracking:      boolean;
  trackingError:   string | null;
  setDriverCoords: (coords: LatLng | null) => void;
  setIsTracking:   (v: boolean) => void;
  setTrackingError:(e: string | null) => void;
}

interface ToastSlice {
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  clearToast: () => void;
}

type AppStore = AuthSlice & RideSlice & DriverTrackingSlice & ToastSlice;

// ─── Valores iniciais ─────────────────────────────────────────────────────────

export const INITIAL_RIDE: RideState = { status: RideStatus.IDLE, surgeMultiplier: 1.0 };
export const INITIAL_AUCTION: AuctionState = { loading: false, drivers: [], selectedDriver: null, error: null };
export const INITIAL_POST_RIDE: PostRideState = {
  active: false, rideId: null, driverId: null,
  driverName: null, driverRating: null, priceKz: null,
};

// ─── Store ────────────────────────────────────────────────────────────────────
// v3.5: Removido middleware `persist` — não persistia nada (partialize retornava {})
// e causava overhead desnecessário de serialização a cada mudança de estado.
// O ride state é sempre refrescado de getActiveRide() no arranque.

export const useAppStore = create<AppStore>()(
  (set) => ({
    // ── Auth ───────────────────────────────────────────────────────────────
    dbUser: null,
    profile: null,
    role: UserRole.PASSENGER,

    setUser: (dbUser, profile) => set({
      dbUser,
      profile,
      role: (dbUser?.role as UserRole) ?? UserRole.PASSENGER,
    }),
    clearUser: () => set({
      dbUser: null, profile: null, role: UserRole.PASSENGER,
    }),
    updateProfile: (data) => set((s) => ({
      profile: s.profile ? { ...s.profile, ...data } : null,
    })),

    // ── Ride ───────────────────────────────────────────────────────────────
    ride:     INITIAL_RIDE,
    auction:  INITIAL_AUCTION,
    postRide: INITIAL_POST_RIDE,

    setRide:      (partial) => set((s) => ({ ride: { ...s.ride, ...partial } })),
    resetRide:    () => set({ ride: INITIAL_RIDE }),
    setAuction:   (partial) => set((s) => ({ auction: { ...s.auction, ...partial } })),
    resetAuction: () => set({ auction: INITIAL_AUCTION }),
    setPostRide:  (postRide) => set({ postRide }),
    resetPostRide: () => set({ postRide: INITIAL_POST_RIDE }),

    // ── Driver Tracking ────────────────────────────────────────────────────
    driverCoords:  null,
    isTracking:    false,
    trackingError: null,

    setDriverCoords: (driverCoords) => set({ driverCoords }),
    setIsTracking:   (isTracking) => set({ isTracking }),
    setTrackingError:(trackingError) => set({ trackingError }),

    // ── Toast ──────────────────────────────────────────────────────────────
    toast: null,
    showToast: (message, type = 'info') => {
      set({ toast: { message, type } });
      setTimeout(() => set({ toast: null }), 4000);
    },
    clearToast: () => set({ toast: null }),
  })
);

// ─── Selectors tipados ────────────────────────────────────────────────────────
export const useAuthStore      = () => useAppStore((s) => ({ dbUser: s.dbUser, profile: s.profile, role: s.role }));
export const useRideStore      = () => useAppStore((s) => s.ride);
export const useAuctionStore   = () => useAppStore((s) => s.auction);
export const usePostRideStore  = () => useAppStore((s) => s.postRide);
export const useDriverLocStore = () => useAppStore((s) => s.driverCoords);
export const useToastStore     = () => useAppStore((s) => ({ toast: s.toast, showToast: s.showToast, clearToast: s.clearToast }));
