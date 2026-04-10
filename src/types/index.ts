// ============================================================
// ZENITH RIDE — Tipos globais centralizados
// Padrão seguido pelo repo de referência (adrianhajdin/uber)
// ============================================================

export type UserRole = 'passenger' | 'driver' | 'admin';

export type RideStatus =
  | 'browsing' | 'searching' | 'accepted'
  | 'picking_up' | 'in_progress' | 'completed' | 'cancelled';

export type DriverStatus = 'offline' | 'available' | 'busy';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  name: string;
  avatar_url?: string;
  phone?: string;
  rating: number;
  total_rides: number;
  level: string;
  km_total: number;
  free_km_available: number;
  km_to_next_perk: number;
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  currency: string;
}

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id?: string;
  origin_address: string;
  origin_lat: number;
  origin_lng: number;
  dest_address: string;
  dest_lat: number;
  dest_lng: number;
  distance_km?: number;
  duration_min?: number;
  surge_multiplier: number;
  price_kz: number;
  status: RideStatus;
  driver_confirmed: boolean;
  payment_processed: boolean;
  created_at: string;
  accepted_at?: string;
  pickup_at?: string;
  started_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancel_reason?: string;
}

export interface DriverLocation {
  driver_id: string;
  lat: number;
  lng: number;
  heading?: number;
  status: DriverStatus;
  updated_at: string;
}

export interface NearbyDriver {
  driver_id: string;
  driver_name: string;
  avatar_url?: string;
  rating: number;
  total_rides: number;
  level: string;
  distance_m: number;
  eta_min: number;
  heading?: number;
  motogo_score: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  ride_id?: string;
  amount: number;
  type: 'ride_payment' | 'ride_earning' | 'top_up' | 'refund' | 'bonus' | 'withdrawal' | 'partner_payment';
  description?: string;
  balance_after: number;
  created_at: string;
}

export interface Contract {
  id: string;
  user_id: string;
  contract_type: 'school' | 'work' | 'family' | 'corporate';
  title: string;
  address: string;
  dest_lat: number;
  dest_lng: number;
  time_start: string;
  time_end: string;
  parent_monitoring: boolean;
  route_deviation_alert: boolean;
  max_deviation_km: number;
  contact_name?: string;
  contact_phone?: string;
  km_accumulated: number;
  bonus_kz: number;
  active: boolean;
  created_at: string;
}

// Zustand store types
export interface LocationStore {
  userLat: number | null;
  userLng: number | null;
  userAddress: string | null;
  destLat: number | null;
  destLng: number | null;
  destAddress: string | null;
  setUserLocation: (lat: number, lng: number, address: string) => void;
  setDestination:  (lat: number, lng: number, address: string) => void;
  clearDestination: () => void;
}

export interface RideStore {
  currentRide: Ride | null;
  selectedDriverId: string | null;
  setCurrentRide:    (ride: Ride | null) => void;
  setSelectedDriver: (id: string | null) => void;
}
